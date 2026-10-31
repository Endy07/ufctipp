-- UfcTipp — 007: a módtipp kikapcsolása (2026-10-31). Újrafuttatható.
-- A felhasználó döntése: a „plusz pontozás” (KO/TKO, Feladás, Pontozás) egy időre inaktív; csak a győztes számít.
-- ÉLESBEN MÁR FUTOTT (a pult futtatta a Supabase SQL-szerkesztőjében) — a repóban a nyilvántartás miatt van.
--
-- Hatás: minden mentett tipp `method`-ja null lesz (insert/update előtt), így a pick_points mindig a sima 1 pontot adja.
-- Felület: js/config.js → METHOD_TIPS: false.
--
-- VISSZAKAPCSOLÁS (mindkettő kell):
--   1) drop trigger picks_method_off on picks;      -- és opcionálisan: drop function picks_method_off();
--   2) js/config.js: METHOD_TIPS: true  (+ a ?v=N emelése az index.html-ben)
-- A korábban nullázott módtippek nem állíthatók vissza.

create or replace function picks_method_off() returns trigger
language plpgsql as $$
begin
  new.method := null;
  return new;
end;
$$;

drop trigger if exists picks_method_off on picks;
create trigger picks_method_off before insert or update on picks
  for each row execute function picks_method_off();

-- Az aktuális gála módtippjeinek törlése (egyszeri; élesben megtörtént). Ellenőrzés: 0-nak kell lennie.
update picks set method = null where method is not null;
-- select count(*) from picks where method is not null;
