---
slug: ufctipp
nev: UfcTipp — UFC tippjáték webapp a barátoknak
frissitve: 2026-10-21
aliasok: ufctipp, ufc tipp, ufc tippjáték, ufc fogadás, ufc meccs, ufc est, ufc-est
---

## Egy mondatban
Mobilra optimalizált webapp, amelyben a felhasználó és a barátai egy UFC-est minden meccsére tippelnek (ki nyer), pontokért, ranglistával; az admin meccsenként zárja a tippelést és rögzíti az eredményt.

## Cél
- Az est kártyája meccsenként: A oldal / B oldal, a versenyzők adatai és statisztikái
- Tipp leadása a meccs kezdetéig, utána zárás (admin gomb, opcionálisan tervezett időpont)
- Pontozás és ranglista a barátok között — tipp, nem pénzes fogadás
- Csatlakozás linkkel, becenév + PIN, regisztráció nélkül
- Első éles bevetés: UFC 333 (2026-10-24, Abu Dhabi)

## Amit használunk (kulcsszavak — ezekre kell találnia)
GitHub Pages · Supabase · PostgreSQL · RPC · Row Level Security · PHP (adatletöltő) · mobil-első webapp · vanilla JavaScript · UFC · MMA · tippjáték · ranglista · versenyzőstatisztika · ufcstats · admin-felület

## Ami kész
- Élesben fut: GitHub Pages (endy07.github.io/ufctipp) + Supabase (2026-10-21)
- UFC.com-letöltő: a UFC 333 14 meccse, 28 versenyző hivatalos statisztikái
- Tipp, admin-zárás, eredmény, ranglista, demó mód helyi teszthez

## Ami hátra van / most ezen dolgozunk
- Az est (2026-10-24) lebonyolítása, utána tapasztalatok
- Beugró / kártyaváltozás esetén adatfrissítés

## Jövőbeni tervek
- Több est kezelése, szezonális ranglista
- Bónusztippek (győzelem módja, menet)

## Ami NEM érdekel (negatív jelzés)
- Valódi pénzes fogadás, bukméker, odds-kereskedés — csak baráti pontverseny
- Natív mobilalkalmazás (iOS/Android) — böngészős webapp elég
- Élő stream / videó közvetítés az appban
