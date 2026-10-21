# UfcTipp — következő session

## 🧭 BELÉPÉSI PONT — 2026-10-21
**Javasolt folytatás:** az első éles gála (UFC 333, 2026-10-24, szombat; korai előmeccsek 16:00, fő kártya 20:00) után
nézzük meg együtt a tapasztalatokat: zárt-e és rögzített-e magától az automata (`tools/logs/`, Supabase `fights`:
`lock_source` / `result_source`), volt-e eltérés vagy kézi beavatkozás. Utána a halasztott apróságok.
**Félretéve (a felhasználó választ):**
- Múltbeli gálák visszanézése a felületen (ma mindig csak az aktuális gála látszik).
- A végső ellenőrzés halasztott apróságai (lent, „Ismert apróságok”).
**Döntésre vár:** nincs nyitott döntés.
**Először olvasd:** ez a fájl; `README.md` (működés); `docs/2026-10-21-automatizalas-terv.md` (a döntések).
**Figyelj:** élesben tesztelni csak `?demo`-val vagy `teszt-` slugú gálán szabad; a felhasználó valódi becenevével („Endy”)
ne próbálj belépni (2026-10-21-én egy gyorsítótárazott régi `api.js` miatt egyszer megtörtént — 1 hibás PIN-próba lett belőle).

## Állapot (2026-10-21, main = origin/main)
- **Élő:** https://endy07.github.io/ufctipp/ · repó: https://github.com/Endy07/ufctipp (publikus) · Supabase-projekt: `ufctipp`
  (Endy07's Org, Free, EU / Írország; URL és publishable kulcs: `js/config.js`).
- **Adatbázis:** 1 gála (`ufc-333`, 14 meccs, ESPN-párosítás 14/14), 2 játékos, 1 tipp (2026-10-21 hajnali állapot).
- **Automatika:** Supabase `pg_cron` `ufctipp-espn` percenként; a gépen a „UfcTipp szinkron” ütemezett feladat 5 percenként
  (utolsó ellenőrzött futás eredménye 0). Az admin-PIN a felhasználónál és a `tools/sync.local.json`-ban (gitignore).
- **Tesztek:** `php tests/test-sync.php` 23/23 · `supabase/test-002.sql` OK · `supabase/test-003.sql` OK (élesben futtatva).
  Visszajátszás a 2026-10-17-i Fight Nighttal: 13/13 helyes győztes; élő `pg_net`-próba: HTTP 200, helyes eredmény.

## A felhasználó döntései (2026-10-21)
- GitHub Pages + Supabase („megfelel”); tipp pontokért, pénz nincs; címmeccs 2 pont (az én javaslatom, nem kifogásolta).
- Mások tippje **csak a meccs végén** látszik („Legyen úgy, hogy csak a meccs végén fedődik fel.”).
- **Teljes automatika** („Teljesen automatikusan legyen minden. Nekünk csak szavazgatni kelljen.”): UFC.com + az ESPN ingyenes
  adatfolyama („van egy ingyenes adatforrás, az nagyon jó”); a gépén fut a kártyaszinkron.
- **Minden gála** (számozott + Fight Night), ranglista: Ez a gála / Összesített, szűrő Mind / Számozott / Fight Night.
- A versenyzők valós magasság szerint, közös talpvonalon, teljes alakban (a felhasználó kérése).
- Versenyzőcsere → a tippek törlődnek, „tippelj újra” (az én javaslatom; nem válaszolt rá, a tervben az én döntésemként áll).

## Hibaelhárítás
| Látszat | Ok | Teendő |
|---|---|---|
| Az admin oldalon az „Utolsó automatikus frissítés” régi | a gép nem futtatta a szinkront (kikapcsolt / alvó gép, PHP-hiba) | `tools\sync.cmd` dupla katt; napló: `tools/logs/sync-<dátum>.log` |
| `ELUTASÍTVA — N nyitott meccs tűnt volna el` a naplóban | a UFC.com-oldal hiányos volt (szerkezetváltás vagy hiba) | nézd meg a UFC.com eseményoldalt; ha valóban elmaradtak, kézzel törölni (SQL), ha nem: várni a következő futásra |
| `ESPN x/y`, ahol x < y | egy meccs nem párosult (névelírás, beugró) | az a meccs nem zárul magától: az admin zárja / rögzíti; vagy várni a következő kártyaszinkronra |
| „eltérés az ESPN és a UFC.com győztese között” | a két forrás mást mond | az admin rögzíti kézzel a helyes eredményt (`#admin`) |
| Nem zárul / nem kap eredményt egy meccs a gála alatt | ESPN-hiba (`settings.espn_last_error`) vagy nem párosult | `select * from settings where key like 'espn%'`; `select * from cron.job_run_details order by start_time desc limit 5`; kézi admin |
| Módosítás után a böngésző a régi felületet mutatja | gyorsítótár | emeld a `?v=N`-t az `index.html`-ben |
| `git checkout` / merge: „unable to unlink tools/sync-hidden.vbs” | az ütemezett szinkron épp fut, zárolja a fájlt | várj, vagy átmenetileg tiltsd le a feladatot; a félbemaradt állapotot `git status`-szal nézd meg |
| A Supabase „Potential issue detected” ablakot dob | `delete` / `drop` a lekérdezésben | csak saját tesztadat törlésénél erősítsd meg |

## Ismert apróságok (a végső ellenőrzés halasztott pontjai, 2026-10-21)
- `get_event`: `starts_at` nélküli gála a lista elejére kerülne (`nulls last` hiányzik; a szinkron mindig küld időt).
- Az „aktuális gála” ablaka 1 nap (a terv 2 napot írt); múltbeli gálát a felület nem mutat.
- `espn_tick` a még függő `pg_net`-választ eldobja (percenkénti ütemnél ártalmatlan).
- Döntetlen / NC után a következő meccs nem zárul azonnal (az ESPN „zajlik” jelzésére vár, 1–2 perc).
- A `sync.php auto` HIBA-t naplóz, ha az adatbázisban egyáltalán nincs gála.
- Új gála érkezésekor a fejléc címe csak újratöltéskor frissül; a felület 90 mp-enként a teljes gála-adatot lekéri.
- `espn_apply`: a `%kotko%` ág halott (ártalmatlan).
