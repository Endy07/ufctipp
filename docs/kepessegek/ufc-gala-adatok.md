---
azonosito: ufc-gala-adatok
projekt: ufctipp
nev: UFC-gála adatai és élő eredménye (UFC.com + ESPN)
mit_tud: Egy UFC-gála teljes kártyáját és minden versenyző hivatalos statisztikáját JSON-ba gyűjti a UFC.com-ról, és az ESPN ingyenes adatfolyamából meccsenként az élő állapotot és a győztest adja.
bemenet: a gála UFC.com-slugja (pl. ufc-333, ufc-fight-night-october-31-2026), vagy semmi (a következő gála a ufc.com/events oldalról)
kimenet: data/<slug>.json (meccsek, versenyzők, statisztikák, képek); ESPN-párosítás (espn_id, A-sarok ESPN-id)
hogyan_hivd:
  cli:
    - C:\xampp\php\php.exe tools\scrape-ufc.php <slug> --refresh
    - C:\xampp\php\php.exe tools\sync.php card <slug> --dry
  doc: KEPESSEGEK.md
licenc: nem
licenc_forras: https://www.ufc.com/terms (2026-10-21)
tipikus_ido: 1 perc (28 versenyzőoldal, gyorsítótárral)
korlat: A UFC.com-nak nincs nyilvános API-ja (HTML-feldolgozás, szerkezetváltásra érzékeny); az ESPN-folyam nem hivatalos. Csak magáncélra.
tesztelve: 2026-10-21
frissitve: 2026-10-21
cimkek: [ufc, mma, sport, scraping, espn, eredmeny, statisztika]
---
## Recept
1. **Kártya + statisztikák:** a projekt mappájában `php tools/scrape-ufc.php ufc-333 --refresh` → `data/ufc-333.json`.
   A szerkezet: `event` (cím, szekciók kezdési idővel), `fights` (sorrend, súlycsoport, címmeccs, rang, szorzó, ország, kép +
   a kép fej–talp doboza), `athletes` (rekord, kor, magasság / karfesztáv cm-ben, ütés-, birkózás-statisztika, győzelmek
   módja, utolsó 3 UFC-meccs).
2. **Következő gálák:** `tools/lib/ufc.php` → `upcoming_events(html, time())` a `https://www.ufc.com/events` oldalból.
3. **Lement meccsek eredménye a UFC.com-ról:** `parse_results(html)` → győztes (A/B), mód, menet, idő.
4. **Élő állapot / győztes:** `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=ÉÉÉÉHHNN`
   (kulcs nélkül). Párosítás a UFC.com-meccsekkel: `tools/lib/espn.php` → `espn_find_event()` / `espn_match()` —
   az ESPN néha fordítva sorolja a sarkokat, ezért mindig a párosítás `espn_a` mezőjével fordítsd A/B-re.
5. Kíméletesen: a letöltő gyorsítótáraz (`tools/cache/`), kérések között szünetet tart. A kódot ne másold át — hivatkozz rá.
