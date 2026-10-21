-- UfcTipp — önellenőrző teszt a 004-es (történet) függvényhez: get_history.
-- A Supabase SQL-szerkesztőben futtatható; a `teszt-g4` adatain dolgozik, a végén eltakarít. Siker: egy „OK” sor.
do $$
declare
  h json;
  e json;
  p1 bigint;
  p2 bigint;
begin
  delete from fights where event = 'teszt-g4';
  delete from events where slug = 'teszt-g4';
  delete from players where nick in ('teszt-g4a', 'teszt-g4b');

  perform sync_event_apply('{
    "event": {"slug": "teszt-g4", "title": "Teszt 4: Aaa vs Bbb", "kind": "fightnight", "starts_at": "2030-02-02T18:00:00Z", "fight_count": 2},
    "data": {"fights": [
      {"id": 990401, "weightClass": "Lightweight Bout", "a": {"name": "Aaa Alfa", "odds": "-150", "rank": "3"}, "b": {"name": "Bbb Beta", "odds": "+130", "rank": null}},
      {"id": 990402, "weightClass": "Welterweight Bout", "a": {"name": "Ccc Gamma", "odds": "+100", "rank": null}, "b": {"name": "Ddd Delta", "odds": "-120", "rank": null}}
    ]},
    "fights": [
      {"id": 990401, "ord": 1, "card": "main", "title_bout": false, "a_slug": "a1", "b_slug": "b1", "lock_at": null},
      {"id": 990402, "ord": 2, "card": "main", "title_bout": false, "a_slug": "a2", "b_slug": "b2", "lock_at": null}
    ]}'::jsonb);

  insert into players (nick, pin_hash) values ('teszt-g4a', 'x') returning id into p1;
  insert into players (nick, pin_hash) values ('teszt-g4b', 'x') returning id into p2;
  insert into picks (player_id, fight_id, side) values (p1, 990401, 'A'), (p2, 990401, 'B'), (p1, 990402, 'A');

  -- (1) eldőlt meccs nélkül a gála nem szerepel az előzményekben
  h := get_history();
  if exists (select 1 from json_array_elements(h->'events') x where x->>'slug' = 'teszt-g4') then
    raise exception '(1) eldőlt meccs nélküli gála bekerült az előzményekbe';
  end if;

  -- az első meccs eldől
  update fights set status = 'done', winner = 'A', method = 'KO/TKO', round = 2, time = '1:11' where id = 990401;
  h := get_history();
  select x into e from json_array_elements(h->'events') x where x->>'slug' = 'teszt-g4';
  if e is null then
    raise exception '(2) az eldőlt meccses gála nem szerepel';
  end if;

  -- (3) két meccs, az eldőltnél a tippek és a nevek / esély / súlycsoport megvannak
  if json_array_length(e->'fights') <> 2 then
    raise exception '(3) nem 2 meccs: %', e->'fights';
  end if;
  if (e->'fights'->0->>'weight') <> 'Lightweight Bout' or (e->'fights'->0->'a'->>'name') <> 'Aaa Alfa'
     or (e->'fights'->0->'b'->>'odds') <> '+130' or (e->'fights'->0->'a'->>'rank') <> '3' then
    raise exception '(3) hibás meccsadatok: %', e->'fights'->0;
  end if;
  if json_array_length(e->'fights'->0->'picks') <> 2 then
    raise exception '(3) az eldőlt meccs tippjei hiányoznak: %', e->'fights'->0->'picks';
  end if;

  -- (4) a NEM eldőlt meccs tippjei nem szivárognak ki
  if (e->'fights'->1->'picks') is not null and (e->'fights'->1->>'picks') <> 'null' then
    raise exception '(4) nyitott meccs tippjei kiszivárogtak: %', e->'fights'->1->'picks';
  end if;
  if exists (select 1 from json_array_elements(e->'fights') f where f->>'status' <> 'done' and f->>'winner' is not null) then
    raise exception '(4) nyitott meccsnél győztes szerepel';
  end if;

  -- takarítás
  delete from fights where event = 'teszt-g4';
  delete from events where slug = 'teszt-g4';
  delete from players where nick in ('teszt-g4a', 'teszt-g4b');
  raise notice 'OK';
end $$;

select 'OK' as teszt_004;
