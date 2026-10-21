-- UfcTipp — 003: javítások a végső ellenőrzés alapján (2026-10-21). Újrafuttatható, csak függvényeket cserél.
-- Ellenőrzés: test-003.sql (egy „OK” sor). Lásd: .superpowers ledger „Final:” sorai / docs/2026-10-21-automatizalas-terv.md
--  - lezárt meccsen a szinkron nem töröl tippet és nem cserél versenyzőt; tömeges eltűnésnél elutasít
--  - csere után az elavult ESPN-párosítás törlődik (különben rossz oldalra írná a győztest)
--  - hibás ESPN-válasz nem állítja le a figyelőt
--  - az admin kézi döntése (eredmény törlése, újranyitás, lock_at) tényleg elsőbbséget kap
--  - a UFC.com győztese ellenőrzi az automata eredményt; eltérésnél visszavonás, az admin dönt
--  - a naplóban látszik az ESPN-párosítás aránya

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
  v_kept int[] := '{}';     -- lezárt meccs, amelyen a kártya eltér: nem nyúlunk hozzá
  v_ids int[];
  v_title boolean;
  v_open boolean;
  v_pair_changed boolean;
  v_gone int;
begin
  select coalesce(array_agg((x->>'id')::int), '{}') into v_ids from jsonb_array_elements(p->'fights') x;

  -- védőkorlát: ha egyszerre több mint 2 nyitott meccs tűnne el, az valószínűleg feldolgozási hiba, nem lemondás
  select count(*) into v_gone from fights f
  where f.event = v_slug and fight_is_open(f) and not (f.id = any (v_ids));
  if v_gone > 2 then
    update events set sync_note = format('%s: ELUTASÍTVA — %s nyitott meccs tűnt volna el egyszerre (ellenőrizd a UFC.com-ot)',
      to_char(now() at time zone 'Europe/Budapest', 'MM-DD HH24:MI'), v_gone) where slug = v_slug;
    return json_build_object('error', format('%s nyitott meccs tűnt volna el egyszerre — a szinkron nem módosított semmit', v_gone));
  end if;

  insert into events (slug, title, kind, starts_at, data, espn_event_id, espn_date, last_sync_at, updated_at)
  values (v_slug, ev->>'title', coalesce(ev->>'kind', 'fightnight'), (ev->>'starts_at')::timestamptz,
          p->'data', ev->>'espn_event_id', ev->>'espn_date', now(), now())
  on conflict (slug) do update set
    title = excluded.title, kind = excluded.kind, starts_at = excluded.starts_at,
    data = coalesce(excluded.data, events.data),
    espn_event_id = coalesce(excluded.espn_event_id, events.espn_event_id),
    espn_date = coalesce(excluded.espn_date, events.espn_date),
    last_sync_at = now(), updated_at = now();

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

    v_open := fight_is_open(cur);
    v_pair_changed := cur.a_slug is not null and cur.b_slug is not null
      and (cur.a_slug is distinct from inc->>'a_slug' or cur.b_slug is distinct from inc->>'b_slug');

    if v_pair_changed and not v_open then
      -- lezárt / kész meccs: a tippek és a versenyzők maradnak (a kártya-eltérés csak a naplóba kerül)
      v_kept := v_kept || cur.id;
    elsif v_pair_changed then
      if cur.a_slug = inc->>'b_slug' and cur.b_slug = inc->>'a_slug' then
        -- csak a sarkok cseréltek helyet: a tippek oldala is fordul
        update picks set side = case side when 'A' then 'B' else 'A' end where fight_id = cur.id;
      else
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
      -- kézi lock_at-hoz nem nyúlunk; lejárt lock_at-ot nem tolunk későbbre (az újranyitná a meccset)
      lock_at = case
        when lock_source = 'manual' then lock_at
        when lock_at is not null and lock_at <= now() then lock_at
        else coalesce((inc->>'lock_at')::timestamptz, lock_at) end,
      a_slug = case when v_open or a_slug is null then inc->>'a_slug' else a_slug end,
      b_slug = case when v_open or b_slug is null then inc->>'b_slug' else b_slug end,
      -- a versenyzők változtak, de nincs új ESPN-párosítás: a régi elavult, töröljük (különben rossz oldalra írna)
      espn_id = case when v_open and v_pair_changed and inc->>'espn_id' is null then null else coalesce(inc->>'espn_id', espn_id) end,
      espn_a = case when v_open and v_pair_changed and inc->>'espn_a' is null then null else coalesce(inc->>'espn_a', espn_a) end,
      updated_at = now()
    where id = cur.id;
  end loop;

  -- elmaradt meccs: csak a még nyitottat töröljük (a tippek kaszkáddal mennek); lezártat / készet soha
  with del as (
    delete from fights f where f.event = v_slug and fight_is_open(f) and not (f.id = any (v_ids)) returning f.id
  ) select coalesce(array_agg(id), '{}') into v_removed from del;

  update events set sync_note = format('%s: +%s / -%s / csere %s / sorrend %s%s%s',
    to_char(now() at time zone 'Europe/Budapest', 'MM-DD HH24:MI'),
    coalesce(array_length(v_added, 1), 0), coalesce(array_length(v_removed, 1), 0),
    coalesce(array_length(v_swapped, 1), 0), coalesce(array_length(v_moved, 1), 0),
    case when ev ? 'espn_matched' then format(' / ESPN %s/%s', ev->>'espn_matched', ev->>'fight_count') else '' end,
    case when coalesce(array_length(v_kept, 1), 0) > 0 then format(' / lezárt meccsen eltérő kártya: %s', array_to_string(v_kept, ', ')) else '' end)
  where slug = v_slug;

  return json_build_object('added', to_json(v_added), 'removed', to_json(v_removed),
                           'swapped', to_json(v_swapped), 'moved', to_json(v_moved), 'kept', to_json(v_kept));
end $$;

-- A UFC.com eredmény-adatai: pontosítja az automata eredményt (mód, menet, idő), és ellenőrzi a győztest.
-- Eltérésnél az automata eredményt visszavonja, és az admin dönt (result_source = 'manual' → az ESPN sem írja vissza).
create or replace function sync_details_apply(p_rows jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  f fights;
  n int := 0;
  v_bad int[] := '{}';
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into f from fights where id = (r->>'id')::int;
    if f.id is null or f.status <> 'done' or f.result_source is distinct from 'auto' then
      continue;
    end if;
    if r->>'winner' in ('A', 'B') and f.winner in ('A', 'B') and r->>'winner' <> f.winner then
      update fights set status = 'locked', winner = null, method = null, round = null, time = null,
                        result_source = 'manual', updated_at = now()
      where id = f.id;
      v_bad := v_bad || f.id;
      update events set sync_note = coalesce(sync_note, '') || format(' / eltérés az ESPN és a UFC.com győztese között: %s — az admin döntsön', f.id)
      where slug = f.event;
      continue;
    end if;
    update fights set
      method = coalesce(nullif(r->>'method', ''), method),
      round = coalesce((r->>'round')::int, round),
      time = coalesce(nullif(r->>'time', ''), time),
      updated_at = now()
    where id = f.id;
    n := n + 1;
  end loop;
  return json_build_object('updated', n, 'mismatch', to_json(v_bad));
end $$;

create or replace function sync_details(p_pin text, p_rows jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  return sync_details_apply(p_rows);
end $$;

-- ESPN: az admin kézi döntését tiszteletben tartja (kézzel nyitott meccset nem zár vissza)
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

    if v_state in ('in', 'post') and f.status = 'open' and f.lock_source is distinct from 'manual' then
      update fights set status = 'locked', lock_source = 'auto', updated_at = now() where id = f.id;
      v_locked := v_locked || f.id;
      f.status := 'locked';
    end if;

    if v_done and f.status <> 'done' and f.result_source is distinct from 'manual' then
      select coalesce(jsonb_agg(x), '[]') into v_winners from jsonb_array_elements(c->'competitors') x
      where (x->>'winner')::boolean;
      if jsonb_array_length(v_winners) = 1 and f.espn_a is not null
         and exists (select 1 from jsonb_array_elements(c->'competitors') x where x->>'id' = f.espn_a) then
        v_win := v_winners->0->>'id';
        v_side := case when v_win = f.espn_a then 'A' else 'B' end;
        select d->'type'->>'text' into v_det from jsonb_array_elements(coalesce(c->'details', '[]')) d
        where d->'type'->>'text' like 'Unofficial Winner %' limit 1;
        update fights set
          status = 'done', winner = v_side, result_source = 'auto',
          method = case
            when v_det ilike '%ko%tko%' or v_det ilike '%kotko%' then 'KO/TKO'
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
        where event = f.event and ord = f.ord - 1 and status = 'open' and lock_source is distinct from 'manual';
      end if;
    end if;
  end loop;
  return json_build_object('locked', to_json(v_locked), 'decided', to_json(v_decided));
end $$;

-- Egy ESPN-válasz feldolgozása hibatűrően: rossz válasz (pl. HTML-hibaoldal) nem görgeti vissza a figyelőt
create or replace function espn_process(p_body text) returns json
language plpgsql security definer set search_path = public as $$
begin
  return espn_apply(p_body::jsonb);
exception when others then
  insert into settings (key, value) values ('espn_last_error', to_char(now(), 'YYYY-MM-DD HH24:MI:SS') || ' ' || sqlerrm)
  on conflict (key) do update set value = excluded.value;
  return json_build_object('error', sqlerrm);
end $$;

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
      perform espn_process(v_body);
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

-- Admin-döntés (belső, PIN nélkül; az admin_set_fight hívja). A kézi döntés elsőbbséget kap az automatával szemben:
--  - eredmény rögzítése vagy törlése → result_source = 'manual' (az ESPN nem írja vissza)
--  - zárás / újranyitás → lock_source = 'manual' (az ESPN nem zár vissza kézzel nyitott meccset)
create or replace function admin_set_fight_apply(
  p_fight integer, p_status text, p_winner text default null,
  p_method text default null, p_round integer default null, p_time text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  cur fights;
begin
  if p_status is null or p_status not in ('open', 'locked', 'done') then
    return json_build_object('error', 'Érvénytelen állapot.');
  end if;
  if p_status = 'done' and (p_winner is null or p_winner not in ('A', 'B', 'draw', 'nc')) then
    return json_build_object('error', 'Eredményhez győztes kell (A, B, döntetlen vagy no contest).');
  end if;
  select * into cur from fights where id = p_fight;
  if cur.id is null then
    return json_build_object('error', 'Nincs ilyen meccs.');
  end if;
  update fights set
    status  = p_status,
    lock_at = case when p_status = 'open' and lock_at is not null and lock_at <= now() then null else lock_at end,
    winner  = case when p_status = 'done' then p_winner else null end,
    method  = case when p_status = 'done' then nullif(trim(p_method), '') else null end,
    round   = case when p_status = 'done' then p_round else null end,
    time    = case when p_status = 'done' then nullif(trim(p_time), '') else null end,
    lock_source = 'manual',
    result_source = case
      when p_status = 'done' then 'manual'
      when cur.status = 'done' then 'manual'   -- az admin törölte az eredményt: az automata ne írja vissza
      else result_source end,
    updated_at = now()
  where id = p_fight;
  return json_build_object('fight', p_fight, 'status', p_status);
end $$;

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
  return admin_set_fight_apply(p_fight, p_status, p_winner, p_method, p_round, p_time);
end $$;

revoke all on function sync_details_apply(jsonb) from public, anon, authenticated;
revoke all on function espn_process(text) from public, anon, authenticated;
revoke all on function admin_set_fight_apply(integer, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function sync_event_apply(jsonb) from public, anon, authenticated;
revoke all on function espn_apply(jsonb) from public, anon, authenticated;
revoke all on function espn_tick() from public, anon, authenticated;
