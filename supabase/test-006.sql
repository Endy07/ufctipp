-- UfcTipp — önellenőrző teszt a 006-os módtipphez.
-- A Supabase SQL-szerkesztőben futtatható; a `teszt-g6` adatain dolgozik, a végén eltakarít. Siker: egy „OK” sor.
do $$
declare
  base jsonb;
  r json;
  lb json;
begin
  delete from fights where event = 'teszt-g6';
  delete from events where slug = 'teszt-g6';
  delete from players where nick in ('teszt-g6a', 'teszt-g6b');

  base := '{
    "event": {"slug": "teszt-g6", "title": "Teszt 6", "kind": "fightnight", "starts_at": "2030-01-01T18:00:00Z",
              "espn_date": null, "espn_matched": 0, "fight_count": 3},
    "data": {"fights": []},
    "fights": [
      {"id": 990601, "ord": 1, "card": "main", "title_bout": true,  "a_slug": "a1", "b_slug": "b1", "espn_id": null, "espn_a": null, "lock_at": null},
      {"id": 990602, "ord": 2, "card": "main", "title_bout": false, "a_slug": "a2", "b_slug": "b2", "espn_id": null, "espn_a": null, "lock_at": null},
      {"id": 990603, "ord": 3, "card": "main", "title_bout": false, "a_slug": "a3", "b_slug": "b3", "espn_id": null, "espn_a": null, "lock_at": null}
    ]}';
  perform sync_event_apply(base);
  perform join_game('teszt-g6a', '1234');
  perform join_game('teszt-g6b', '1234');

  -- (1) kategóriák
  if method_cat('KO/TKO') <> 'KO/TKO' or method_cat('Orvosi leállítás') <> 'KO/TKO' or method_cat('Feladás') <> 'Feladás'
     or method_cat('Pontozás (egyhangú)') <> 'Pontozás' or method_cat('Pontozás (megosztott)') <> 'Pontozás'
     or method_cat('Kizárás') is not null or method_cat(null) is not null then
    raise exception '(1) a method_cat hibás';
  end if;

  -- (2) érvénytelen mód elutasítva, a régi (4 paraméteres) hívás működik, módot a tipp megőrzi
  r := place_pick('teszt-g6a', '1234', 990601, 'A', 'Bunyó');
  if r->>'error' is null then raise exception '(2) érvénytelen mód elfogadva'; end if;
  r := place_pick('teszt-g6a', '1234', 990601, 'A');
  if r->>'error' is not null then raise exception '(2) a mód nélküli tipp hibás: %', r; end if;
  perform place_pick('teszt-g6a', '1234', 990601, 'A', 'KO/TKO');
  perform place_pick('teszt-g6a', '1234', 990602, 'A', 'Pontozás');
  perform place_pick('teszt-g6a', '1234', 990603, 'B', 'Feladás');
  perform place_pick('teszt-g6b', '1234', 990601, 'A', 'Feladás');
  perform place_pick('teszt-g6b', '1234', 990602, 'A');
  perform place_pick('teszt-g6b', '1234', 990603, 'A', 'Feladás');
  if (my_picks('teszt-g6a', '1234')->'methods'->>'990601') <> 'KO/TKO' then
    raise exception '(2) a my_picks nem adja vissza a módot';
  end if;

  -- (3) a futó meccs módja nem látszik (a tippek null)
  if (select (x->'picks') is not null and (x->>'picks') <> 'null' from json_array_elements(get_board('teszt-g6')->'fights') x limit 1) then
    raise exception '(3) a tippek a meccs vége előtt látszanak';
  end if;

  -- (4) pontozás: címmeccs (2 pont) + mód találat; sima meccs; téves mód; téves győztes
  update fights set status = 'done', winner = 'A', method = 'KO/TKO' where id = 990601;   -- a: 2+1, b: 2 (téves mód)
  update fights set status = 'done', winner = 'A', method = 'Pontozás (egyhangú)' where id = 990602;  -- a: 1+1, b: 1 (nincs mód)
  update fights set status = 'done', winner = 'A', method = 'Feladás' where id = 990603;  -- a: 0 (téves oldal), b: 1+1
  lb := get_board('teszt-g6')->'leaderboard';
  if (select (x->>'points')::int from json_array_elements(lb) x where x->>'nick' = 'teszt-g6a') <> 5
     or (select (x->>'bonus')::int from json_array_elements(lb) x where x->>'nick' = 'teszt-g6a') <> 2 then
    raise exception '(4) teszt-g6a pontja / bónusza hibás: %', lb;
  end if;
  if (select (x->>'points')::int from json_array_elements(lb) x where x->>'nick' = 'teszt-g6b') <> 5
     or (select (x->>'bonus')::int from json_array_elements(lb) x where x->>'nick' = 'teszt-g6b') <> 1 then
    raise exception '(4) teszt-g6b pontja / bónusza hibás: %', lb;
  end if;

  -- (5) a módok a meccs végén látszanak a board-on és az előzményekben; az összesítő is bónuszos
  if (select count(*) from json_array_elements(get_board('teszt-g6')->'fights') x, json_array_elements(x->'picks') p
      where p->>'method' is not null) <> 5 then
    raise exception '(5) a board nem mutatja a módokat';
  end if;
  if (select count(*) from json_array_elements(get_history()->'events') e, json_array_elements(e->'fights') f,
         json_array_elements(f->'picks') p where e->>'slug' = 'teszt-g6' and p->>'method' is not null) <> 5 then
    raise exception '(5) az előzmények nem mutatják a módokat';
  end if;
  if (select (x->>'points')::int from json_array_elements(get_overall('fightnight')) x where x->>'nick' = 'teszt-g6a') < 5 then
    raise exception '(5) az összesített nem számolja a bónuszt';
  end if;

  -- (6) mód nélküli (régi) tipp pontja nem változik: a teszt-g6b 990602-es tippje módtalan, de 1 pontot ért (lásd 4)

  delete from fights where event = 'teszt-g6';
  delete from events where slug = 'teszt-g6';
  delete from players where nick in ('teszt-g6a', 'teszt-g6b');
end $$;

select 'OK' as teszt;
