-- UfcTipp — 006: a győzelem módjának tippelése (2026-10-24). Újrafuttatható.
-- Szabály (a felhasználó szavai szerint):
--   - csak a győztest tippeli (nincs mód): talál → a meccs pontja (1, címmeccsen 2), ahogy eddig;
--   - győztes + mód: a győztes ÉS a mód is talál → a meccs pontjának duplája (1 → 2, címmeccsen 2 → 4);
--     a győztes talál, de a mód nem → 0 pont; a győztes nem talál → 0 pont.
-- Régi (mód nélküli) tippek pontja nem változik. A tényleges mód a fights.method-ból jön (ESPN / UFC.com / admin),
-- method_cat() sorolja: KO/TKO (az adatforrások nem választják szét a KO-t és a TKO-t; orvosi leállítás is ide), Feladás,
-- Pontozás (egyhangú / megosztott / többségi). Kizárás / Egyéb: a módtipp nem találhat (0 pont).
-- Mások módtippje is csak a meccs végén látszik. Ellenőrzés: test-006.sql (egy „OK” sor).

alter table picks add column if not exists method text;
alter table picks drop constraint if exists picks_method_check;
alter table picks add constraint picks_method_check check (method is null or method in ('KO/TKO', 'Feladás', 'Pontozás'));

create or replace function method_cat(m text) returns text
language sql immutable as $$
  select case
    when m is null then null
    when m ilike 'KO%' or m ilike '%TKO%' or m ilike 'Orvosi%' then 'KO/TKO'
    when m ilike 'Felad%' or m ilike '%submission%' then 'Feladás'
    when m ilike 'Pontoz%' or m ilike '%decision%' then 'Pontozás'
  end;
$$;

-- Egy tipp pontja: nincs mód → f_points; mód → dupla, ha talál, különben 0; rossz győztes → 0
create or replace function pick_points(p_method text, p_side text, f_status text, f_winner text, f_method text, f_points integer) returns integer
language sql immutable as $$
  select case
    when f_status is distinct from 'done' or f_winner is distinct from p_side then 0
    when p_method is null then f_points
    when p_method = method_cat(f_method) then 2 * f_points
    else 0 end;
$$;

-- 1, ha a módtipp pontos volt (győztes + mód)
create or replace function pick_exact(p_method text, p_side text, f_status text, f_winner text, f_method text) returns integer
language sql immutable as $$
  select case when p_method is not null and f_status = 'done' and f_winner = p_side and p_method = method_cat(f_method) then 1 else 0 end;
$$;

-- a korábbi 4 paraméteres változat helyett az 5 paraméteres (a p_method elhagyható → a régi hívás is működik)
drop function if exists place_pick(text, text, integer, text);
create or replace function place_pick(p_nick text, p_pin text, p_fight integer, p_side text, p_method text default null) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  a record;
  f fights;
begin
  select * into a from auth_player(p_nick, p_pin);
  if a.err is not null then
    return json_build_object('error', a.err);
  end if;
  select * into f from fights where fights.id = p_fight;
  if f.id is null then
    return json_build_object('error', 'Nincs ilyen meccs.');
  end if;
  if not fight_is_open(f) then
    return json_build_object('error', 'Erre a meccsre már nem lehet tippelni — lezárták.');
  end if;
  if p_method is not null and p_method not in ('KO/TKO', 'Feladás', 'Pontozás') then
    return json_build_object('error', 'Érvénytelen mód.');
  end if;
  if p_side is null then
    delete from picks where player_id = a.id and fight_id = p_fight;
  elsif p_side in ('A', 'B') then
    insert into picks (player_id, fight_id, side, method) values (a.id, p_fight, p_side, p_method)
    on conflict (player_id, fight_id) do update set side = excluded.side, method = excluded.method, updated_at = now();
  else
    return json_build_object('error', 'Érvénytelen oldal.');
  end if;
  return json_build_object('fight', p_fight, 'side', p_side, 'method', p_method);
end $$;

create or replace function my_picks(p_nick text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  a record;
begin
  select * into a from auth_player(p_nick, p_pin);
  if a.err is not null then
    return json_build_object('error', a.err);
  end if;
  return json_build_object(
    'picks', coalesce((select json_object_agg(fight_id, side) from picks where player_id = a.id), '{}'::json),
    'methods', coalesce((select json_object_agg(fight_id, method) from picks where player_id = a.id and method is not null), '{}'::json));
end $$;

create or replace function get_overall(p_kind text default null) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(r order by r.points desc, r.correct desc, lower(r.nick)), '[]'::json)
  from (
    select pl.nick,
           coalesce(sum(pick_points(p.method, p.side, f.status, f.winner, f.method, f.points)), 0)::int as points,
           count(f.id) filter (where f.status = 'done' and f.winner = p.side)::int as correct,
           count(f.id) filter (where f.status = 'done' and f.winner in ('A', 'B'))::int as decided,
           coalesce(sum(pick_exact(p.method, p.side, f.status, f.winner, f.method)), 0)::int as bonus,
           count(distinct f.event)::int as events
    from players pl
    left join picks p on p.player_id = pl.id
    left join fights f on f.id = p.fight_id
                      and (p_kind is null or exists (select 1 from events e where e.slug = f.event and e.kind = p_kind))
    group by pl.id, pl.nick
  ) r;
$$;

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
          select coalesce(json_agg(json_build_object('nick', pl.nick, 'side', p.side, 'method', p.method) order by lower(pl.nick)), '[]'::json)
          from picks p join players pl on pl.id = p.player_id where p.fight_id = f.id) end
      ) order by f.ord)
      from fights f where f.event = p_event), '[]'::json),
    'leaderboard', coalesce((
      select json_agg(r order by r.points desc, r.correct desc, lower(r.nick))
      from (
        select pl.nick,
               coalesce(sum(pick_points(p.method, p.side, f.status, f.winner, f.method, f.points)), 0)::int as points,
               count(f.id) filter (where f.status = 'done' and f.winner = p.side)::int as correct,
               count(f.id) filter (where f.status = 'done' and f.winner in ('A', 'B'))::int as decided,
               coalesce(sum(pick_exact(p.method, p.side, f.status, f.winner, f.method)), 0)::int as bonus,
               count(f.id)::int as picks
        from players pl
        left join picks p on p.player_id = pl.id
        left join fights f on f.id = p.fight_id and f.event = p_event
        group by pl.id, pl.nick
      ) r), '[]'::json)
  );
$$;

create or replace function get_history() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'now', now(),
    'events', coalesce((
      select json_agg(json_build_object(
        'slug', e.slug, 'title', e.title, 'kind', e.kind, 'starts_at', e.starts_at,
        'fights', (
          select coalesce(json_agg(json_build_object(
            'id', f.id, 'ord', f.ord, 'card', f.card, 'title_bout', f.title_bout, 'points', f.points,
            'status', f.status, 'winner', f.winner, 'method', f.method, 'round', f.round, 'time', f.time,
            'weight', d->>'weightClass',
            'a', json_build_object('name', d->'a'->>'name', 'slug', f.a_slug, 'odds', d->'a'->>'odds', 'rank', d->'a'->>'rank'),
            'b', json_build_object('name', d->'b'->>'name', 'slug', f.b_slug, 'odds', d->'b'->>'odds', 'rank', d->'b'->>'rank'),
            'picks', case when f.status <> 'done' then null else (
              select coalesce(json_agg(json_build_object('nick', pl.nick, 'side', p.side, 'method', p.method) order by lower(pl.nick)), '[]'::json)
              from picks p join players pl on pl.id = p.player_id where p.fight_id = f.id) end
          ) order by f.ord), '[]'::json)
          from fights f
          left join lateral (
            select x from jsonb_array_elements(e.data->'fights') x where (x->>'id')::int = f.id limit 1
          ) dd(d) on true
          where f.event = e.slug
        )
      ) order by e.starts_at desc nulls last)
      from events e
      where exists (select 1 from fights f where f.event = e.slug and f.status = 'done')
    ), '[]'::json)
  );
$$;

grant execute on function place_pick(text, text, integer, text, text) to anon, authenticated;
grant execute on function my_picks(text, text)                       to anon, authenticated;
grant execute on function get_overall(text)                          to anon, authenticated;
grant execute on function get_board(text)                            to anon, authenticated;
grant execute on function get_history()                              to anon, authenticated;
