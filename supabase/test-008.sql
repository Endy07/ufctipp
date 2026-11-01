-- UfcTipp — önellenőrző teszt a 008-as (egyértelmű ESPN-mód) függvényhez.
-- A Supabase SQL-szerkesztőben futtatható; a `teszt-g8` adatain dolgozik, a végén eltakarít. Siker: egy „OK” sor.
-- A valódi meccsek eredményét nem érinti.
do $$
declare
  base jsonb;
begin
  delete from fights where event = 'teszt-g8';
  delete from events where slug = 'teszt-g8';

  base := '{
    "event": {"slug": "teszt-g8", "title": "Teszt 8", "kind": "fightnight", "starts_at": "2030-01-01T18:00:00Z",
              "espn_date": "20300101", "espn_matched": 4, "fight_count": 4},
    "data": {"fights": []},
    "fights": [
      {"id": 990801, "ord": 1, "card": "main", "title_bout": false, "a_slug": "a1", "b_slug": "b1", "espn_id": "e801", "espn_a": "x801", "lock_at": null},
      {"id": 990802, "ord": 2, "card": "main", "title_bout": false, "a_slug": "a2", "b_slug": "b2", "espn_id": "e802", "espn_a": "x802", "lock_at": null},
      {"id": 990803, "ord": 3, "card": "main", "title_bout": false, "a_slug": "a3", "b_slug": "b3", "espn_id": "e803", "espn_a": "x803", "lock_at": null},
      {"id": 990804, "ord": 4, "card": "main", "title_bout": false, "a_slug": "a4", "b_slug": "b4", "espn_id": "e804", "espn_a": "x804", "lock_at": null}
    ]}';
  perform sync_event_apply(base);

  -- (1) egyértelmű: csak „Kotko” → KO/TKO
  perform espn_apply('{"events": [{"competitions": [{"id": "e801", "status": {"period": 2, "displayClock": "1:10",
    "type": {"state": "post", "completed": true}},
    "competitors": [{"id": "x801", "winner": true}, {"id": "y801", "winner": false}],
    "details": [{"type": {"text": "Unofficial Winner Kotko"}}]}]}]}');
  if (select method from fights where id = 990801) is distinct from 'KO/TKO' then
    raise exception '(1) az egyértelmű KO/TKO nem íródott be';
  end if;

  -- (2) kétértelmű: „Kotko” + „Decision” egyszerre → nincs mód (null), a meccs mégis lezárul
  perform espn_apply('{"events": [{"competitions": [{"id": "e802", "status": {"period": 3, "displayClock": "5:00",
    "type": {"state": "post", "completed": true}},
    "competitors": [{"id": "x802", "winner": true}, {"id": "y802", "winner": false}],
    "details": [{"type": {"text": "Unofficial Winner Kotko"}}, {"type": {"text": "Unofficial Winner Decision"}}]}]}]}');
  if (select status from fights where id = 990802) <> 'done' or (select winner from fights where id = 990802) <> 'A' then
    raise exception '(2) a kétértelmű mód miatt nem rögzült a győztes';
  end if;
  if (select method from fights where id = 990802) is not null then
    raise exception '(2) kétértelmű módnál mód íródott be';
  end if;

  -- (3) ugyanaz a kategória kétszer (két Decision-részlet) még egyértelmű → Pontozás
  perform espn_apply('{"events": [{"competitions": [{"id": "e803", "status": {"period": 3, "displayClock": "5:00",
    "type": {"state": "post", "completed": true}},
    "competitors": [{"id": "x803", "winner": false}, {"id": "y803", "winner": true}],
    "details": [{"type": {"text": "Unofficial Winner Decision"}}, {"type": {"text": "Unofficial Winner Decision Unanimous"}}]}]}]}');
  if (select method from fights where id = 990803) is distinct from 'Pontozás' or (select winner from fights where id = 990803) <> 'B' then
    raise exception '(3) az azonos kategóriájú részletek nem adtak Pontozás módot';
  end if;

  -- (4) nincs részlet → nincs mód
  perform espn_apply('{"events": [{"competitions": [{"id": "e804", "status": {"period": 1, "displayClock": "2:00",
    "type": {"state": "post", "completed": true}},
    "competitors": [{"id": "x804", "winner": true}, {"id": "y804", "winner": false}], "details": []}]}]}');
  if (select method from fights where id = 990804) is not null then
    raise exception '(4) részlet nélkül mód íródott be';
  end if;

  -- (5) belső függvény anon számára tiltott
  if has_function_privilege('anon', 'espn_apply(jsonb)', 'execute') then
    raise exception '(5) az espn_apply anon számára elérhető';
  end if;

  delete from fights where event = 'teszt-g8';
  delete from events where slug = 'teszt-g8';
end $$;

select 'OK' as teszt;
