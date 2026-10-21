-- UfcTipp — önellenőrző teszt a 003-as javításokhoz (a végső ellenőrzés megállapításai).
-- A Supabase SQL-szerkesztőben futtatható; a `teszt-g3` adatain dolgozik, a végén eltakarít. Siker: egy „OK” sor.
do $$
declare
  r json;
  p1 bigint;
  f fights;
  base jsonb;
  pl jsonb;
  espn jsonb;
begin
  delete from fights where event = 'teszt-g3';
  delete from events where slug = 'teszt-g3';
  delete from players where nick = 'teszt-g3p';

  base := '{
    "event": {"slug": "teszt-g3", "title": "Teszt 3", "kind": "fightnight", "starts_at": "2030-01-01T18:00:00Z",
              "espn_date": "20300101", "espn_matched": 4, "fight_count": 4},
    "data": {"fights": []},
    "fights": [
      {"id": 990201, "ord": 1, "card": "main", "title_bout": false, "a_slug": "a1", "b_slug": "b1", "espn_id": "e201", "espn_a": "x201", "lock_at": null},
      {"id": 990202, "ord": 2, "card": "main", "title_bout": false, "a_slug": "a2", "b_slug": "b2", "espn_id": "e202", "espn_a": "x202", "lock_at": null},
      {"id": 990203, "ord": 3, "card": "main", "title_bout": false, "a_slug": "a3", "b_slug": "b3", "espn_id": "e203", "espn_a": "x203", "lock_at": null},
      {"id": 990204, "ord": 4, "card": "main", "title_bout": false, "a_slug": "a4", "b_slug": "b4", "espn_id": "e204", "espn_a": "x204", "lock_at": null}
    ]}';
  perform sync_event_apply(base);
  insert into players (nick, pin_hash) values ('teszt-g3p', 'x') returning id into p1;
  insert into picks (player_id, fight_id, side) values (p1, 990201, 'A'), (p1, 990202, 'A');

  -- (1) lezárt meccsen a „csere” nem töröl tippet és nem írja át a versenyzőket
  update fights set status = 'locked' where id = 990201;
  perform sync_event_apply(jsonb_set(base, '{fights,0,b_slug}', '"masvalaki"'));
  if not exists (select 1 from picks where fight_id = 990201) then
    raise exception '(1) lezárt meccs tippje törlődött';
  end if;
  if (select b_slug from fights where id = 990201) <> 'b1' or (select changed from fights where id = 990201) then
    raise exception '(1) lezárt meccs versenyzője / jelzője megváltozott';
  end if;

  -- (2) lezárt meccs a kártyáról eltűnve sem törlődik
  pl := jsonb_set(base, '{fights}', (base->'fights') - 0);
  perform sync_event_apply(pl);
  if not exists (select 1 from fights where id = 990201) then
    raise exception '(2) lezárt meccs törlődött';
  end if;

  -- (3) tömeges eltűnés (>2 nyitott meccs) → a szinkron elutasítja, nem töröl
  r := sync_event_apply(jsonb_set(base, '{fights}', jsonb_build_array(base->'fights'->0)));
  if r->>'error' is null or (select count(*) from fights where event = 'teszt-g3') <> 4 then
    raise exception '(3) a tömeges törlést nem utasította el: %', r;
  end if;

  -- (4) sarokcsere / versenyzőcsere új ESPN-párosítás nélkül → az elavult espn_a törlődik
  pl := jsonb_set(base, '{fights,2}', '{"id": 990203, "ord": 3, "card": "main", "title_bout": false, "a_slug": "b3", "b_slug": "a3", "espn_id": null, "espn_a": null, "lock_at": null}');
  pl := jsonb_set(pl, '{fights,3}', '{"id": 990204, "ord": 4, "card": "main", "title_bout": false, "a_slug": "a4", "b_slug": "uj4", "espn_id": null, "espn_a": null, "lock_at": null}');
  perform sync_event_apply(pl);
  if (select espn_a from fights where id = 990203) is not null or (select espn_a from fights where id = 990204) is not null then
    raise exception '(4) csere után elavult espn_a maradt';
  end if;
  perform sync_event_apply(base);  -- vissza az eredeti párosításhoz

  -- (5) hibás ESPN-válasz nem dob kivételt
  r := espn_process('<html>hiba</html>');
  if r->>'error' is null then
    raise exception '(5) hibás válasznál hibajelzés kellett: %', r;
  end if;

  -- (6) az admin által törölt eredményt az automata nem rakja vissza
  update fights set status = 'done', winner = 'A', result_source = 'auto' where id = 990202;
  perform admin_set_fight_apply(990202, 'locked');
  espn := '{"events": [{"competitions": [{"id": "e202", "status": {"period": 1, "displayClock": "1:00",
            "type": {"state": "post", "completed": true}},
            "competitors": [{"id": "x202", "winner": true}, {"id": "y202", "winner": false}], "details": []}]}]}';
  perform espn_apply(espn);
  if (select status from fights where id = 990202) <> 'locked' or (select winner from fights where id = 990202) is not null then
    raise exception '(6) az automata visszaírta a kézzel törölt eredményt';
  end if;

  -- (7) kézzel újranyitott meccset az automata nem zár vissza
  update fights set status = 'locked', lock_source = 'auto' where id = 990203;
  perform admin_set_fight_apply(990203, 'open');
  perform espn_apply(replace(replace(espn::text, 'e202', 'e203'), '"completed": true', '"completed": false')::jsonb);
  if (select status from fights where id = 990203) <> 'open' then
    raise exception '(7) a kézzel nyitott meccset visszazárta';
  end if;

  -- (8) a szinkron nem írja felül a kézi lock_at-ot, és lejárt lock_at-ot nem tol későbbre
  perform sync_event_apply(jsonb_set(base, '{fights,2,lock_at}', '"2030-01-01T18:00:00Z"'));
  if (select lock_at from fights where id = 990203) is not null then
    raise exception '(8) kézi meccs lock_at-ját felülírta';
  end if;
  update fights set lock_at = now() - interval '1 minute' where id = 990204;
  perform sync_event_apply(jsonb_set(base, '{fights,3,lock_at}', to_jsonb(to_char((now() + interval '1 hour') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
  if (select lock_at from fights where id = 990204) > now() then
    raise exception '(8) lejárt lock_at-ot későbbre tolta (újranyitás)';
  end if;

  -- (9) UFC.com és az automata eredmény eltér → visszavonás, az admin dönt
  update fights set status = 'done', winner = 'A', result_source = 'auto' where id = 990204;
  r := sync_details_apply('[{"id": 990204, "winner": "B", "method": "KO/TKO", "round": 1, "time": "1:00"}]');
  select * into f from fights where id = 990204;
  if f.status <> 'locked' or f.winner is not null or f.result_source <> 'manual' then
    raise exception '(9) eltérésnél nem vonta vissza: % % %', f.status, f.winner, f.result_source;
  end if;
  if (select sync_note from events where slug = 'teszt-g3') not like '%eltérés%' then
    raise exception '(9) az eltérés nem került a naplóba';
  end if;

  -- (10) a napló tartalmazza az ESPN-párosítás arányát
  perform sync_event_apply(jsonb_set(base, '{event,espn_matched}', '3'));
  if (select sync_note from events where slug = 'teszt-g3') not like '%ESPN 3/4%' then
    raise exception '(10) az ESPN-párosítás aránya hiányzik: %', (select sync_note from events where slug = 'teszt-g3');
  end if;

  delete from fights where event = 'teszt-g3';
  delete from events where slug = 'teszt-g3';
  delete from players where nick = 'teszt-g3p';
end $$;

select 'OK' as teszt;
