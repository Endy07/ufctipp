-- UfcTipp — önellenőrző teszt a 005-ös pontos zároláshoz.
-- A Supabase SQL-szerkesztőben futtatható; a `teszt-g5` adatain dolgozik, a végén eltakarít. Siker: egy „OK” sor.
do $$
declare
  base jsonb;
  espn jsonb;
  r json;
begin
  delete from fights where event = 'teszt-g5';
  delete from events where slug = 'teszt-g5';

  base := '{
    "event": {"slug": "teszt-g5", "title": "Teszt 5", "kind": "fightnight", "starts_at": "2030-01-01T18:00:00Z",
              "espn_date": "20300101", "espn_matched": 3, "fight_count": 3},
    "data": {"fights": []},
    "fights": [
      {"id": 990501, "ord": 1, "card": "main", "title_bout": false, "a_slug": "a1", "b_slug": "b1", "espn_id": "e501", "espn_a": "x501", "lock_at": null},
      {"id": 990502, "ord": 2, "card": "main", "title_bout": false, "a_slug": "a2", "b_slug": "b2", "espn_id": "e502", "espn_a": "x502", "lock_at": null},
      {"id": 990503, "ord": 3, "card": "main", "title_bout": false, "a_slug": "a3", "b_slug": "b3", "espn_id": "e503", "espn_a": "x503", "lock_at": null}
    ]}';
  perform sync_event_apply(base);

  -- (1) pre-fight: state 'in', period 0 → NEM zár
  espn := '{"events": [{"competitions": [{"id": "e501", "status": {"period": 0, "displayClock": "-",
            "type": {"state": "in", "completed": false}}, "competitors": [], "details": []}]}]}';
  perform espn_apply(espn);
  if (select status from fights where id = 990501) <> 'open' then
    raise exception '(1) a pre-fight (period 0) állapot zárt';
  end if;

  -- (2) az 1. menet elindult: state 'in', period 1 → zár, lock_source = auto
  perform espn_apply(jsonb_set(espn, '{events,0,competitions,0,status,period}', '1'));
  if (select status from fights where id = 990501) <> 'locked' or (select lock_source from fights where id = 990501) <> 'auto' then
    raise exception '(2) az 1. menet indulásakor nem zárt';
  end if;

  -- (3) a következő meccs az előző eredményekor NEM zár (ord-1 szabály megszűnt)
  perform espn_apply('{"events": [{"competitions": [{"id": "e501", "status": {"period": 1, "displayClock": "2:00",
            "type": {"state": "post", "completed": true}},
            "competitors": [{"id": "x501", "winner": true}, {"id": "y501", "winner": false}], "details": []}]}]}');
  if (select status from fights where id = 990501) <> 'done' then
    raise exception '(3) az eredmény nem rögzült';
  end if;
  if (select status from fights where id = 990502) <> 'open' or (select status from fights where id = 990503) <> 'open' then
    raise exception '(3) az előző meccs eredménye zárt egy másik meccset';
  end if;

  -- (4) 'post' állapot (gyors befejezés, az 1. menetet nem láttuk) → zár
  perform espn_apply('{"events": [{"competitions": [{"id": "e502", "status": {"period": 1, "displayClock": "0:09",
            "type": {"state": "post", "completed": false}}, "competitors": [], "details": []}]}]}');
  if (select status from fights where id = 990502) <> 'locked' then
    raise exception '(4) post állapotban nem zárt';
  end if;

  -- (5) kézzel nyitott meccset az automata nem zár vissza
  perform admin_set_fight_apply(990503, 'open');
  perform espn_apply('{"events": [{"competitions": [{"id": "e503", "status": {"period": 2, "displayClock": "3:00",
            "type": {"state": "in", "completed": false}}, "competitors": [], "details": []}]}]}');
  if (select status from fights where id = 990503) <> 'open' then
    raise exception '(5) a kézzel nyitott meccset visszazárta';
  end if;

  -- (6) a cron 10 másodpercenként fut, és a függvények anon számára tiltottak
  if not exists (select 1 from cron.job where jobname = 'ufctipp-espn' and schedule = '10 seconds') then
    raise exception '(6) az ufctipp-espn ütemezése nem 10 másodperc';
  end if;
  if has_function_privilege('anon', 'espn_tick()', 'execute') or has_function_privilege('anon', 'espn_apply(jsonb)', 'execute') then
    raise exception '(6) belső függvény anon számára elérhető';
  end if;

  delete from fights where event = 'teszt-g5';
  delete from events where slug = 'teszt-g5';
end $$;

select 'OK' as teszt;
