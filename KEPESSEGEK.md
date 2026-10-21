# UfcTipp — képességek mások számára

**Mit tud:** UFC-gálák hivatalos adatai géppel olvasható formában, és élő eredménykövetés.
**Frissítve:** 2026-10-21 · **Projekt:** `C:\xampp\htdocs\2026\UfcTipp` · Élő app: https://endy07.github.io/ufctipp/
**Képesség-kártya:** `docs/kepessegek/ufc-gala-adatok.md` (a pult kártyás keresője és az Obsidian ebből dolgozik).

## 1. UFC-gála kártyája és a versenyzők statisztikái (UFC.com)
- `php tools/scrape-ufc.php <esemény-slug> [--refresh]` → `data/<slug>.json`:
  meccsek (sorrend, szekció, súlycsoport, címmeccs, rang, szorzó, ország, teljes alakos kép + a kép befoglaló doboza)
  és versenyzők (rekord, kor, magasság/karfesztáv cm-ben, ütés-/birkózás-statisztikák, győzelmek módja, utolsó 3 UFC-meccs).
- Függvénytár: `tools/lib/ufc.php` — `parse_event()`, `parse_athlete()`, `parse_results()` (lement meccsek győztese, módja,
  menete, ideje), `upcoming_events()` (a következő gálák a ufc.com/events oldalról), `build_event_data()`.
- Esemény-slug: a UFC.com címéből (pl. `ufc-333`, `ufc-fight-night-october-31-2026`).

## 2. ESPN ingyenes UFC-adatfolyama (élő állapot, győztes)
- Kulcs nélkül: `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=ÉÉÉÉHHNN` — meccsenként
  `status.type.state` (`pre` / `in` / `post`), `completed`, `competitors[].winner`, menet (`status.period`), idő (`displayClock`).
  Nem hivatalos nyilvános API: bármikor változhat.
- `tools/lib/espn.php` — `espn_match()`: UFC.com-meccs ↔ ESPN-meccs párosítás (teljes név, egyértelmű vezetéknév;
  figyel arra, hogy az ESPN néha fordítva sorolja a sarkokat), `espn_find_event()`.

## Hogyan hívd
- Másik projektből: olvasd / futtasd a fenti PHP-fájlokat (PHP 8, XAMPP, függőség nélkül; a GD kell a képdobozhoz).
- Ne másold át a kódot a saját projektedbe (elavulna) — hivatkozz rá, vagy kérj bővítést ebben a projektben.
- A UFC.com-ot kíméletesen: a letöltő gyorsítótáraz (`tools/cache/`), kérések között szünetet tart.
