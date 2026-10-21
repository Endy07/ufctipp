-- UfcTipp — önellenőrző teszt a 002-es migrációhoz (szinkron + ESPN).
-- A Supabase SQL-szerkesztőben futtatható; a `teszt-gala` adatain dolgozik, a végén eltakarít.
-- Siker: az utolsó lekérdezés egy „OK” sort ad. Hiba: kivétel a hibás eset leírásával.
do $$
declare
  r json;
  p1 bigint;
  p2 bigint;
  f fights;
  payload jsonb;
  espn jsonb;
begin
  -- előző, félbemaradt futás maradéka
  delete from fights where event = 'teszt-gala';
  delete from events where slug = 'teszt-gala';
  delete from players where nick in ('teszt-p1', 'teszt-p2');

  payload := '{
    "event": {"slug": "teszt-gala", "title": "Teszt gála", "kind": "fightnight",
              "starts_at": "2030-01-01T18:00:00Z", "espn_event_id": "1", "espn_date": "20300101"},
    "data": {"fights": []},
    "fights": [
      {"id": 990001, "ord": 1, "card": "main", "title_bout": false, "a_slug": "anna", "b_slug": "bela",
       "espn_id": "e1", "espn_a": "ea", "lock_at": null},
      {"id": 990002, "ord": 2, "card": "main", "title_bout": false, "a_slug": "cili", "b_slug": "dani",
       "espn_id": "e2", "espn_a": "ec", "lock_at": null}
    ]}';
  r := sync_event_apply(payload);
  if (select count(*) from fights where event = 'teszt-gala') <> 2 then
    raise exception 'felvétel: 2 meccs kellene';
  end if;

  insert into players (nick, pin_hash) values ('teszt-p1', 'x') returning id into p1;
  insert into players (nick, pin_hash) values ('teszt-p2', 'x') returning id into p2;
  insert into picks (player_id, fight_id, side) values (p1, 990001, 'A'), (p2, 990001, 'B'), (p1, 990002, 'A');

  -- (a) azonos adattal újra: nincs változás
  r := sync_event_apply(payload);
  if json_array_length(r->'added') + json_array_length(r->'removed') + json_array_length(r->'swapped') + json_array_length(r->'moved') <> 0 then
    raise exception '(a) azonos szinkron változást jelzett: %', r;
  end if;

  -- (a2) sarokcsere (A↔B): a tippek oldala is fordul, nem törlődnek
  r := sync_event_apply(jsonb_set(payload, '{fights,1}', '{"id": 990002, "ord": 2, "card": "main", "title_bout": false,
        "a_slug": "dani", "b_slug": "cili", "espn_id": "e2", "espn_a": "ed", "lock_at": null}'));
  if (select side from picks where player_id = p1 and fight_id = 990002) <> 'B' then
    raise exception '(a2) sarokcserénél a tipp oldalának fordulnia kellett';
  end if;

  -- (b) versenyzőcsere: tippek törlődnek, changed = true
  r := sync_event_apply(jsonb_set(payload, '{fights,0,b_slug}', '"beugro"'));
  if not (r->'swapped')::jsonb @> '[990001]' then
    raise exception '(b) csere nem jelzett: %', r;
  end if;
  if exists (select 1 from picks where fight_id = 990001) then
    raise exception '(b) a csere után maradt tipp';
  end if;
  if not (select changed from fights where id = 990001) then
    raise exception '(b) changed jelző hiányzik';
  end if;

  -- (c) kimaradt (még eredmény nélküli) meccs törlődik
  payload := jsonb_set(payload, '{fights}', jsonb_build_array(jsonb_set(payload->'fights'->0, '{b_slug}', '"beugro"')));
  r := sync_event_apply(payload);
  if not (r->'removed')::jsonb @> '[990002]' or exists (select 1 from fights where id = 990002) then
    raise exception '(c) elmaradt meccs nem törlődött: %', r;
  end if;

  -- (d) ESPN „zajlik” → zárás
  espn := '{"events": [{"competitions": [{"id": "e1", "status": {"period": 1, "displayClock": "1:00",
            "type": {"state": "in", "completed": false}},
            "competitors": [{"id": "ea", "winner": false}, {"id": "eb", "winner": false}], "details": []}]}]}';
  perform espn_apply(espn);
  select * into f from fights where id = 990001;
  if f.status <> 'locked' or f.lock_source <> 'auto' then
    raise exception '(d) ESPN in → zárás kellett, kapott: % / %', f.status, f.lock_source;
  end if;

  -- (f) vége, de nincs győztes (döntetlen / NC) → nem rögzít
  espn := jsonb_set(espn, '{events,0,competitions,0,status,type}', '{"state": "post", "completed": true}');
  perform espn_apply(espn);
  if (select status from fights where id = 990001) <> 'locked' then
    raise exception '(f) győztes nélkül eredményt rögzített';
  end if;

  -- (e) vége, egy győztes (a B oldal ESPN-azonosítója) → done, B nyert, mód a details-ből
  espn := jsonb_set(espn, '{events,0,competitions,0,competitors}', '[{"id": "ea", "winner": false}, {"id": "eb", "winner": true}]');
  espn := jsonb_set(espn, '{events,0,competitions,0,details}', '[{"type": {"text": "Unofficial Winner Kotko"}}]');
  espn := jsonb_set(espn, '{events,0,competitions,0,status,period}', '2');
  perform espn_apply(espn);
  select * into f from fights where id = 990001;
  if f.status <> 'done' or f.winner <> 'B' or f.result_source <> 'auto' or f.method <> 'KO/TKO' or f.round <> 2 then
    raise exception '(e) automata eredmény hibás: % % % % %', f.status, f.winner, f.result_source, f.method, f.round;
  end if;

  -- (g) kézi eredményt az automata nem ír felül
  update fights set winner = 'A', result_source = 'manual' where id = 990001;
  perform espn_apply(espn);
  if (select winner from fights where id = 990001) <> 'A' then
    raise exception '(g) az automata felülírta a kézi eredményt';
  end if;

  -- (h) kész meccs a kártyáról eltűnve sem törlődik
  r := sync_event_apply(jsonb_set(payload, '{fights}', '[]'));
  if not exists (select 1 from fights where id = 990001) then
    raise exception '(h) kész meccs törlődött';
  end if;

  -- get_event / get_overall működik
  if get_event('teszt-gala')->>'slug' <> 'teszt-gala' then
    raise exception 'get_event hibás';
  end if;
  perform get_overall(null);
  perform get_overall('fightnight');

  delete from fights where event = 'teszt-gala';
  delete from events where slug = 'teszt-gala';
  delete from players where nick in ('teszt-p1', 'teszt-p2');
end $$;

select 'OK' as teszt;
