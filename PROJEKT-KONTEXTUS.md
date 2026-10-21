---
slug: ufctipp
nev: UfcTipp — UFC tippjáték webapp a barátoknak
frissitve: 2026-10-21
aliasok: ufctipp, ufc tipp, ufc tippjáték, ufc fogadás, ufc meccs, ufc est, ufc-est
---

## Egy mondatban
Mobilra optimalizált webapp, amelyben a felhasználó és a barátai minden UFC-gála (számozott és Fight Night) minden meccsére tippelnek (ki nyer), pontokért, ranglistával; a gála felvétele, a beugrók, a zárás és az eredmény teljesen automatikus (UFC.com + ESPN), az admin csak felülbírál.

## Cél
- Az est kártyája meccsenként: A oldal / B oldal, a versenyzők adatai és statisztikái
- Tipp leadása a meccs kezdetéig, utána automatikus zárás (ESPN „zajlik”), az admin felülbírálhat
- Pontozás és ranglista a barátok között — tipp, nem pénzes fogadás
- Csatlakozás linkkel, becenév + PIN, regisztráció nélkül
- Első éles bevetés: UFC 333 (2026-10-24, Abu Dhabi)

## Amit használunk (kulcsszavak — ezekre kell találnia)
GitHub Pages · Supabase · PostgreSQL · RPC · Row Level Security · pg_cron · pg_net · ESPN API · web scraping · Windows Feladatütemező · PHP (adatletöltő) · mobil-első webapp · vanilla JavaScript · UFC · MMA · tippjáték · ranglista · versenyzőstatisztika · ufcstats · admin-felület

## Ami kész
- Élesben fut: GitHub Pages (endy07.github.io/ufctipp) + Supabase (2026-10-21)
- UFC.com-letöltő: a UFC 333 14 meccse, 28 versenyző hivatalos statisztikái
- Tipp, ranglista (gála + összesített, számozott / Fight Night szűrő), demó mód
- Teljes automatika: gála felvétele és kártyaváltozás (beugró) a gépről, zárás + eredmény a Supabase-ben az ESPN-ből

## Ami hátra van / most ezen dolgozunk
- Az első éles est (2026-10-24) megfigyelése, utána tapasztalatok
- Múltbeli gálák böngészése a felületen

## Jövőbeni tervek
- Szezonális ranglista, múltbeli gálák böngészése
- Bónusztippek (győzelem módja, menet)

## Ami NEM érdekel (negatív jelzés)
- Valódi pénzes fogadás, bukméker, odds-kereskedés — csak baráti pontverseny
- Natív mobilalkalmazás (iOS/Android) — böngészős webapp elég
- Élő stream / videó közvetítés az appban
