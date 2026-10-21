-- UfcTipp — 002: automatizálás (gálák az adatbázisban, szinkron a gépről, ESPN-figyelő percenként).
-- Csak bővítő: a meglévő játékosok és tippek megmaradnak. Újrafuttatható.
-- Terv: docs/2026-10-21-automatizalas-terv.md

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists events (
  slug          text primary key,
  title         text not null,
  kind          text not null default 'fightnight' check (kind in ('numbered', 'fightnight')),
  starts_at     timestamptz,               -- az első szekció kezdése
  data          jsonb,                     -- a felület adatai: {event, fights, athletes} (UFC.com)
  espn_event_id text,
  espn_date     text,                      -- ÉÉÉÉHHNN: az ESPN scoreboard ?dates= paramétere
  last_sync_at  timestamptz,
  sync_note     text,
  updated_at    timestamptz not null default now()
);
alter table events enable row level security;

alter table fights add column if not exists a_slug text;
alter table fights add column if not exists b_slug text;
alter table fights add column if not exists espn_id text;
alter table fights add column if not exists espn_a text;      -- az A (piros) sarok ESPN-versenyzőazonosítója
alter table fights add column if not exists changed boolean not null default false;
alter table fights add column if not exists lock_source text check (lock_source in ('manual', 'auto'));
alter table fights add column if not exists result_source text check (result_source in ('manual', 'auto'));
create index if not exists fights_espn_id on fights (espn_id);

-- ---------------------------------------------------------------- szinkron (a gépről, admin-PIN-nel)

-- A gála felvétele / frissítése. Belső függvény (PIN nélkül), a `sync_event` és a teszt hívja.
create or replace function sync_event_apply(p jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb := p->'event';
  v_slug text := ev->>'slug';
  inc jsonb;
  cur fights;
  v_added int[] := '{}';
  v_removed int[] := '{}';
  v_swapped int[] := '{}';
  v_moved int[] := '{}';
  v_ids int[];
  v_title boolean;
begin
  insert into events (slug, title, kind, starts_at, data, espn_event_id, espn_date, last_sync_at, updated_at)
  values (v_slug, ev->>'title', coalesce(ev->>'kind', 'fightnight'), (ev->>'starts_at')::timestamptz,
          p->'data', ev->>'espn_event_id', ev->>'espn_date', now(), now())
  on conflict (slug) do update set
    title = excluded.title, kind = excluded.kind, starts_at = excluded.starts_at,
    data = coalesce(excluded.data, events.data),
    espn_event_id = coalesce(excluded.espn_event_id, events.espn_event_id),
    espn_date = coalesce(excluded.espn_date, events.espn_date),
    last_sync_at = now(), updated_at = now();

  select coalesce(array_agg((x->>'id')::int), '{}') into v_ids from jsonb_array_elements(p->'fights') x;

  for inc in select * from jsonb_array_elements(p->'fights') loop
    v_title := coalesce((inc->>'title_bout')::boolean, false);
    select * into cur from fights where id = (inc->>'id')::int;
    if cur.id is null then
      insert into fights (id, event, ord, card, title_bout, points, lock_at, a_slug, b_slug, espn_id, espn_a)
      values ((inc->>'id')::int, v_slug, (inc->>'ord')::int, inc->>'card', v_title, case when v_title then 2 else 1 end,
              (inc->>'lock_at')::timestamptz, inc->>'a_slug', inc->>'b_slug', inc->>'espn_id', inc->>'espn_a');
      v_added := v_added || (inc->>'id')::int;
      continue;
    end if;

    if cur.status <> 'done' and cur.a_slug is not null and cur.b_slug is not null then
      if cur.a_slug = inc->>'b_slug' and cur.b_slug = inc->>'a_slug' then
        -- csak a sarkok cseréltek helyet: a tippek oldala is fordul
        update picks set side = case side when 'A' then 'B' else 'A' end where fight_id = cur.id;
      elsif cur.a_slug is distinct from inc->>'a_slug' or cur.b_slug is distinct from inc->>'b_slug' then
        -- versenyzőcsere: a meccs tippjei érvénytelenek
        delete from picks where fight_id = cur.id;
        update fights set changed = true where id = cur.id;
        v_swapped := v_swapped || cur.id;
      end if;
    end if;

    if cur.ord is distinct from (inc->>'ord')::int or cur.card is distinct from inc->>'card' then
      v_moved := v_moved || cur.id;
    end if;

    update fights set
      event = v_slug,
      ord = (inc->>'ord')::int,
      card = inc->>'card',
      title_bout = v_title,
      points = case when v_title then 2 else 1 end,
      lock_at = coalesce((inc->>'lock_at')::timestamptz, lock_at),
      a_slug = case when status = 'done' then coalesce(a_slug, inc->>'a_slug') else inc->>'a_slug' end,
      b_slug = case when status = 'done' then coalesce(b_slug, inc->>'b_slug') else inc->>'b_slug' end,
      espn_id = coalesce(inc->>'espn_id', espn_id),
      espn_a = coalesce(inc->>'espn_a', espn_a),
      updated_at = now()
    where id = cur.id;
  end loop;

  -- elmaradt (még eredmény nélküli) meccsek: törlés, a tippek kaszkáddal mennek
  with del as (
    delete from fights where event = v_slug and status <> 'done' and not (id = any (v_ids)) returning id
  ) select coalesce(array_agg(id), '{}') into v_removed from del;

  update events set sync_note = format('%s: +%s / -%s / csere %s / sorrend %s',
    to_char(now() at time zone 'Europe/Budapest', 'MM-DD HH24:MI'),
    coalesce(array_length(v_added, 1), 0), coalesce(array_length(v_removed, 1), 0),
    coalesce(array_length(v_swapped, 1), 0), coalesce(array_length(v_moved, 1), 0))
  where slug = v_slug;

  return json_build_object('added', to_json(v_added), 'removed', to_json(v_removed),
                           'swapped', to_json(v_swapped), 'moved', to_json(v_moved));
end $$;

create or replace function sync_event(p_pin text, p_payload jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  return sync_event_apply(p_payload);
end $$;

-- A UFC.com pontosabb eredmény-adatai (mód, menet, idő) az automata eredményekhez
create or replace function sync_details(p_pin text, p_rows jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
  r jsonb;
  n int := 0;
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    update fights set
      method = coalesce(nullif(r->>'method', ''), method),
      round = coalesce((r->>'round')::int, round),
      time = coalesce(nullif(r->>'time', ''), time),
      updated_at = now()
    where id = (r->>'id')::int and status = 'done' and result_source = 'auto';
    if found then n := n + 1; end if;
  end loop;
  return json_build_object('updated', n);
end $$;

-- ---------------------------------------------------------------- ESPN (élő zárás + eredmény)

-- Egy ESPN scoreboard-válasz alkalmazása. Eredményt csak egyértelmű jelzésből rögzít (vége + pontosan egy győztes),
-- kézi eredményt nem ír felül, kézzel zárt meccset nem nyit újra.
create or replace function espn_apply(p_json jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  f fights;
  v_state text;
  v_done boolean;
  v_winners jsonb;
  v_win text;
  v_side text;
  v_det text;
  v_locked int[] := '{}';
  v_decided int[] := '{}';
begin
  for c in select comp from jsonb_array_elements(coalesce(p_json->'events', '[]')) e,
                         jsonb_array_elements(coalesce(e->'competitions', '[]')) comp loop
    select * into f from fights where espn_id = c->>'id';
    if f.id is null then
      continue;
    end if;
    v_state := c#>>'{status,type,state}';
    v_done := coalesce((c#>>'{status,type,completed}')::boolean, false);

    if v_state in ('in', 'post') and f.status = 'open' then
      update fights set status = 'locked', lock_source = 'auto', updated_at = now() where id = f.id;
      v_locked := v_locked || f.id;
      f.status := 'locked';
    end if;

    if v_done and f.status <> 'done' and f.result_source is distinct from 'manual' then
      select coalesce(jsonb_agg(x), '[]') into v_winners from jsonb_array_elements(c->'competitors') x
      where (x->>'winner')::boolean;
      if jsonb_array_length(v_winners) = 1 then
        v_win := v_winners->0->>'id';
        if v_win = f.espn_a then
          v_side := 'A';
        elsif exists (select 1 from jsonb_array_elements(c->'competitors') x where x->>'id' = v_win)
              and f.espn_a is not null
              and exists (select 1 from jsonb_array_elements(c->'competitors') x where x->>'id' = f.espn_a) then
          v_side := 'B';
        else
          v_side := null; -- a párosítás nem egyértelmű: nem rögzítünk
        end if;
        if v_side is not null then
          select d->'type'->>'text' into v_det from jsonb_array_elements(coalesce(c->'details', '[]')) d
          where d->'type'->>'text' like 'Unofficial Winner %' limit 1;
          update fights set
            status = 'done', winner = v_side, result_source = 'auto',
            method = case
              when v_det ilike '%kotko%' or v_det ilike '%ko%tko%' then 'KO/TKO'
              when v_det ilike '%submission%' then 'Feladás'
              when v_det ilike '%decision%' then 'Pontozás'
              else method end,
            round = coalesce((c#>>'{status,period}')::int, round),
            time = coalesce(c#>>'{status,displayClock}', time),
            updated_at = now()
          where id = f.id;
          v_decided := v_decided || f.id;
          -- a futási sorrendben következő meccs (egy hellyel feljebb a kártyán) hamarosan kezdődik: zárjuk
          update fights set status = 'locked', lock_source = 'auto', updated_at = now()
          where event = f.event and ord = f.ord - 1 and status = 'open';
        end if;
      end if;
    end if;
  end loop;
  return json_build_object('locked', to_json(v_locked), 'decided', to_json(v_decided));
end $$;

-- pg_cron percenként hívja: feldolgozza az előző ESPN-választ, és kér egy újat — csak gála idején.
create or replace function espn_tick() returns void
language plpgsql security definer set search_path = public, net as $$
declare
  v_req bigint;
  v_body text;
  v_status int;
  ev events;
begin
  select value::bigint into v_req from settings where key = 'espn_req';
  if v_req is not null then
    select content, status_code into v_body, v_status from net._http_response where id = v_req;
    if v_status = 200 and v_body is not null then
      perform espn_apply(v_body::jsonb);
    end if;
    delete from settings where key = 'espn_req';
  end if;

  select * into ev from events
  where espn_date is not null and starts_at between now() - interval '14 hours' and now() + interval '12 hours'
    and exists (select 1 from fights f where f.event = events.slug and f.status <> 'done')
  order by starts_at limit 1;
  if ev.slug is null then
    return;
  end if;

  v_req := net.http_get(
    url := 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=' || ev.espn_date,
    timeout_milliseconds := 20000);
  insert into settings (key, value) values ('espn_req', v_req::text)
  on conflict (key) do update set value = excluded.value;
end $$;

-- ---------------------------------------------------------------- olvasás (nyilvános)

-- Az aktuális gála: a legkorábbi, ami legfeljebb egy napja kezdődött; ha nincs ilyen, a legutóbbi.
create or replace function get_event(p_slug text default null) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('slug', e.slug, 'title', e.title, 'kind', e.kind, 'starts_at', e.starts_at,
                           'data', e.data, 'last_sync_at', e.last_sync_at, 'sync_note', e.sync_note)
  from events e
  where e.data is not null and (p_slug is null or e.slug = p_slug)
  order by (e.starts_at > now() - interval '1 day') desc,
           case when e.starts_at > now() - interval '1 day' then e.starts_at end asc nulls last,
           e.starts_at desc
  limit 1;
$$;

-- Összesített ranglista: minden gála, vagy csak egy típus (numbered / fightnight)
create or replace function get_overall(p_kind text default null) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(r order by r.points desc, r.correct desc, lower(r.nick)), '[]'::json)
  from (
    select pl.nick,
           coalesce(sum(case when f.status = 'done' and f.winner = p.side then f.points else 0 end), 0)::int as points,
           count(f.id) filter (where f.status = 'done' and f.winner = p.side)::int as correct,
           count(f.id) filter (where f.status = 'done' and f.winner in ('A', 'B'))::int as decided,
           count(distinct f.event)::int as events
    from players pl
    left join picks p on p.player_id = pl.id
    left join fights f on f.id = p.fight_id
                      and (p_kind is null or exists (select 1 from events e where e.slug = f.event and e.kind = p_kind))
    group by pl.id, pl.nick
  ) r;
$$;

-- get_board: a `changed` jelzővel bővítve (a többi változatlan: mások tippje csak a meccs végén)
create or replace function get_board(p_event text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'now', now(),
    'players', (select count(*) from players),
    'fights', coalesce((
      select json_agg(json_build_object(
        'id', f.id, 'status', f.status, 'open', fight_is_open(f), 'lock_at', f.lock_at,
        'winner', f.winner, 'method', f.method, 'round', f.round, 'time', f.time, 'points', f.points,
        'changed', f.changed,
        'count_total', (select count(*) from picks p where p.fight_id = f.id),
        'count_a', case when f.status = 'done' then (select count(*) from picks p where p.fight_id = f.id and p.side = 'A') end,
        'count_b', case when f.status = 'done' then (select count(*) from picks p where p.fight_id = f.id and p.side = 'B') end,
        'picks', case when f.status <> 'done' then null else (
          select coalesce(json_agg(json_build_object('nick', pl.nick, 'side', p.side) order by lower(pl.nick)), '[]'::json)
          from picks p join players pl on pl.id = p.player_id where p.fight_id = f.id) end
      ) order by f.ord)
      from fights f where f.event = p_event), '[]'::json),
    'leaderboard', coalesce((
      select json_agg(r order by r.points desc, r.correct desc, lower(r.nick))
      from (
        select pl.nick,
               coalesce(sum(case when f.status = 'done' and f.winner = p.side then f.points else 0 end), 0)::int as points,
               count(f.id) filter (where f.status = 'done' and f.winner = p.side)::int as correct,
               count(f.id) filter (where f.status = 'done' and f.winner in ('A', 'B'))::int as decided,
               count(f.id)::int as picks
        from players pl
        left join picks p on p.player_id = pl.id
        left join fights f on f.id = p.fight_id and f.event = p_event
        group by pl.id, pl.nick
      ) r), '[]'::json)
  );
$$;

-- admin_set_fight: a kézi döntés forrását is rögzíti (az automata ezt nem írja felül)
create or replace function admin_set_fight(
  p_pin text, p_fight integer, p_status text, p_winner text default null,
  p_method text default null, p_round integer default null, p_time text default null
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  if p_status is null or p_status not in ('open', 'locked', 'done') then
    return json_build_object('error', 'Érvénytelen állapot.');
  end if;
  if p_status = 'done' and (p_winner is null or p_winner not in ('A', 'B', 'draw', 'nc')) then
    return json_build_object('error', 'Eredményhez győztes kell (A, B, döntetlen vagy no contest).');
  end if;
  update fights set
    status  = p_status,
    lock_at = case when p_status = 'open' and lock_at is not null and lock_at <= now() then null else lock_at end,
    winner  = case when p_status = 'done' then p_winner else null end,
    method  = case when p_status = 'done' then nullif(trim(p_method), '') else null end,
    round   = case when p_status = 'done' then p_round else null end,
    time    = case when p_status = 'done' then nullif(trim(p_time), '') else null end,
    lock_source   = case when p_status = 'open' then null else 'manual' end,
    result_source = case when p_status = 'done' then 'manual' else null end,
    updated_at = now()
  where id = p_fight;
  if not found then
    return json_build_object('error', 'Nincs ilyen meccs.');
  end if;
  return json_build_object('fight', p_fight, 'status', p_status);
end $$;

-- ---------------------------------------------------------------- jogosultságok
revoke all on function sync_event_apply(jsonb) from public, anon, authenticated;
revoke all on function espn_apply(jsonb) from public, anon, authenticated;
revoke all on function espn_tick() from public, anon, authenticated;
grant execute on function sync_event(text, jsonb)   to anon, authenticated;
grant execute on function sync_details(text, jsonb) to anon, authenticated;
grant execute on function get_event(text)           to anon, authenticated;
grant execute on function get_overall(text)         to anon, authenticated;

-- ---------------------------------------------------------------- ütemezés
select cron.unschedule(jobid) from cron.job where jobname = 'ufctipp-espn';
select cron.schedule('ufctipp-espn', '* * * * *', 'select public.espn_tick()');
