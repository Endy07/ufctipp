-- UfcTipp — 004: történet és statisztika (csak olvasó függvény; semmit nem módosít). Újrafuttatható.
-- Terv: docs/2026-10-21-tortenet-statisztika-terv.md
--
-- get_history(): minden gála, amelyben van már eldőlt meccs, a meccsek adataival. A tippek (ki kire) CSAK az eldőlt
-- (status = 'done') meccseknél szerepelnek — ugyanaz a szabály, mint a get_board-ban: mások tippje a meccs végén derül ki.
-- A versenyzők neve / esélye az events.data-ból jön (a fights tábla csak a slugot tárolja).

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
              select coalesce(json_agg(json_build_object('nick', pl.nick, 'side', p.side) order by lower(pl.nick)), '[]'::json)
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

grant execute on function get_history() to anon, authenticated;
