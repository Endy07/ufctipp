# Történet, statisztika és társai — terv (2026-10-21)

A felhasználó kérése: „látjuk az előző meccseket, egy history oldalt; statisztika, ki hány százalékba fogad jól vagy rosszul;
és még amit javaslok" — az összes javaslatomat jóváhagyta („Elfogadom minden javaslatodat").

## Elv
Egyetlen új, csak olvasó adatbázis-függvény (`get_history`) adja a lejátszott meccseket **a tippekkel együtt** — mások tippje a meccs
végén amúgy is nyilvános (a meglévő szabály), a lezáratlan meccsek tippjei **nem** kerülnek bele. A számítás a böngészőben fut
(`js/stats.js`, tiszta függvények, node-dal tesztelhető), így nincs külön SQL a százalékokhoz, és a demó mód ugyanazt használja.

## Új felület
| Hely | Tartalom |
|---|---|
| **Történet** (`#tortenet`, `#tortenet/<gála>`) | gálák listája (Mind / Számozott / Fight Night), gálánként győztes (trófea), saját eredményem; részletnél gála-ranglista, meccsenként eredmény, saját tipp (talált / nem), társaság megoszlása, ki kire tippelt, „a tömeg tévedett" jelzés |
| **Statisztika** (`#statisztika`) | mindenki találati aránya (talált/nem talált sáv); játékos-kártya: százalék, széria, favorit/esélytelen, címmeccsek, legjobb/leggyengébb súlycsoport, kedvenc versenyző, tömeg ellen; díjak; trófeatábla; fej-fej mellett |
| **Ranglista → Szezon** | évi összesítés (a gálák pontjai évenként) |
| **Megosztás** | a gála ranglistája képként (Web Share / letöltés) a Ranglista és a Történet részletnél |
| **Emlékeztető** | a Meccsek tetején visszaszámláló a következő zárásig/kezdésig + naptár-fájl (.ics, 30 perccel előtte) |

Nem készül: valódi push-értesítés (szerver-oldali VAPID/edge function kellene, iPhone-on telepített PWA) — helyette az .ics.

## Döntéseim (a felhasználó nem kérdezett rá)
- Széria: a tippelt meccsek sorrendjében (gála kezdete, azon belül a kártya alulról felfelé); a kihagyott meccs nem szakítja meg.
- Statisztikába csak az eldőlt (A/B győztes) meccsek számítanak; döntetlen / NC nem.
- Favorit = a kisebb fogadóirodai szorzójú oldal (az `odds` a UFC.com-adatból); ha hiányzik, a meccs kimarad a favorit/esélytelen számból.
- Díjak és „legjobb/leggyengébb" csak elég minta után (legalább 5 eldőlt tipp, súlycsoportnál/versenyzőnél 3, ill. 2).
- Demóban három kitalált múltbeli gála (`data/demo-history.json`) mutatja a funkciókat.
- Cache-verzió `?v=6`.

## Tesztek
`node tests/test-stats.js` (számítások), `supabase/test-004.sql` (a függvény, saját `teszt-` adaton, takarít), böngészős nézet `?demo`-ban.
