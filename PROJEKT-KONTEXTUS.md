---
slug: ufctipp
nev: UfcTipp — UFC tippjáték webapp a barátoknak
frissitve: 2026-11-05
aliasok: ufctipp, ufc tipp, ufc tippjáték, ufc fogadás, ufc meccs, ufc est, ufc-est
---

## Egy mondatban
Mobilra optimalizált webapp, amelyben a felhasználó és a barátai minden UFC-gála (számozott és Fight Night) minden meccsére tippelnek (ki nyer), pontokért, ranglistával; a gála felvétele, a beugrók, a zárás és az eredmény teljesen automatikus (UFC.com + ESPN), az admin csak felülbírál.

## Cél
- Az est kártyája meccsenként: A oldal / B oldal, a versenyzők adatai és statisztikái
- Tipp leadása a meccs kezdetéig, utána automatikus zárás (ESPN „zajlik”), az admin felülbírálhat
- Pontozás és ranglista a barátok között — tipp, nem pénzes fogadás
- Módtipp **kikapcsolva 2026-10-31-től** (`METHOD_TIPS: false` + `picks_method_off` trigger; csak a győztes számít, minden meccs 1 pont). Eredeti szabály (2026-10-24): a győztes mellé opcionálisan a mód (KO/TKO, Submission/feladás, Pontozás); minden meccs (címmeccs is) 1 pont; pontos győztes+mód 2 pont, rossz mód 0 (`migrate-006`)
- Pontos zárás (2026-10-24): az ESPN 1. menet indulásakor zár (`period >= 1`), nincs menetrendi tartalék `lock_at` (`migrate-005`)
- Csatlakozás linkkel, becenév + PIN, regisztráció nélkül
- Első éles bevetés: UFC 333 (2026-10-24, Abu Dhabi)

## Amit használunk (kulcsszavak — ezekre kell találnia)
GitHub Pages · Supabase · PostgreSQL · RPC · Row Level Security · pg_cron · pg_net · ESPN API · web scraping · Windows Feladatütemező · PHP (adatletöltő) · mobil-első webapp · vanilla JavaScript · UFC · MMA · tippjáték · ranglista · versenyzőstatisztika · ufcstats · admin-felület

## Ami kész
- Élesben fut: GitHub Pages (endy07.github.io/ufctipp) + Supabase (2026-10-21)
- UFC.com-letöltő: a UFC 333 14 meccse, 28 versenyző hivatalos statisztikái
- Tipp, ranglista (gála + összesített, számozott / Fight Night szűrő), demó mód
- Teljes automatika: gála felvétele és kártyaváltozás (beugró) a gépről, zárás + eredmény a Supabase-ben az ESPN-ből

- Történet (múltbeli gálák), statisztika (találati arány, széria, díjak, fej-fej), szezonranglista, megosztás képként, naptár-emlékeztető, csak megnézhető játékosprofil (#profil/<becenév>) — élesben (2026-10-22)

## Ami hátra van / most ezen dolgozunk
- A migrate-008 élesbe tétele (a pult) + push; a 2026-11-07-i gála (Cortes Acosta vs Walker) kártyájának felkerülése (a UFC.com apránként adja a meccs-azonosítókat); a Történet / Statisztika / Profil számainak ellenőrzése az éles adaton

## Jövőbeni tervek
- Bónusztippek (győzelem módja, menet) — a módtipp megépült, de 2026-10-31-től inaktív; a felhasználó később dönt a visszahozásáról

## Ami NEM érdekel (negatív jelzés)
- Valódi pénzes fogadás, bukméker, odds-kereskedés — csak baráti pontverseny
- Natív mobilalkalmazás (iOS/Android) — böngészős webapp elég
- Élő stream / videó közvetítés az appban
