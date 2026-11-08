# UfcTipp — következő session

## 🧭 BELÉPÉSI PONT — 2026-11-07 (este)
**Frissen élesben (2026-11-07):** `migrate-008` (kétértelmű ESPN-mód → nincs mód; `test-008` OK) és `migrate-009` (ideiglenes meccsazonosító; `test-009` OK, visszagörgetve); pusholva (`4226064`). A 11-07-i Fight Night (Cortes Acosta vs Walker) mind a 14 meccse fent van: 3 valódi `data-fmid`-del, 11 **ideiglenes negatív azonosítóval** (a UFC.com nem adott nekik `data-fmid`-ot; az id a versenyzőpár slugjaiból képzett crc32, a sarkoktól független). A valódi azonosító megérkezésekor a `sync_event_apply` a versenyzőpár alapján átkulcsolja a sort (`picks.fight_id` `on update cascade`), a tipp megmarad (sarokcserénél az oldala fordul). Versenyzőcsere ideiglenes meccsen = törlés + a tippek elvesznek (mint a valódinál).
**Esti incidens (2026-11-07, 22:53–23:12) — tanulság:** a UFC.com két meccset (Nakamura–Schmid, Bashi–Calderon) hibás „Hub import” sablonban adott ki (nincs `c-listing-fight`), a szinkron elmaradtnak vette és törölte őket a tippekkel együtt (a tippek elvesztek, mentés nincs). Javítva: a meccs azonosságát a versenyzőpár adja; `sync.php card` átveszi az előző kártyáról azt a meccset, amely az oldalról hiányzik, de az ESPN-en megvan; `migrate-010` (a `sync_event_apply` minden, a küldeményben nem szereplő azonosítójú, azonos párú sort átkulcsol — a UFC.com a gála napján a 4xxx stub-azonosítókat 13xxx valódiakra cserélte). A duplán maradt sorokat kézi SQL takarította (tippek átvíve). A Nakamura–Schmid meccs (id 4335) a UFC.com-oldalról hiányzik, az ESPN-ről vettük át. Az `espn_apply` `select … where espn_id` duplikált sornál tetszőlegest választ — dupla sor tehát hibát jelent.
**Utóhatás (2026-11-08):** a 23:33-as szinkron duplikált sort vett fel (Parsons–Souza, `-288230908`), mert a UFC.com ugyanazt a párt újra azonosító nélkül adta, miközben a sor már valódi azonosítóval megvolt. `migrate-011` (élesben, 11-08): az ilyen bejövő negatív sort kihagyja, a meglévőt megtartja; a dupla sort töröltem (nem volt tippje). Ellenőrizve: 14 meccs, 48 tipp, ranglista változatlan (MRK 10, TiTi 8, Razy 6, Endy 5).
**Javasolt folytatás:** (1) a gála után ellenőrizd, hogy a meccsek lezártak/eldőltek-e (ESPN 14/14 volt párosítva), és hogy az átkulcsolás megtörtént-e, ha a UFC.com közben azonosítót adott (`select id from fights where event like '%november-07%'`, negatív id ne maradjon az eldőlt meccseken); (2) a „Félretéve” és „Ismert apróságok” lista változatlan.
**Élesben (2026-11-05):** a módtipp KI (`METHOD_TIPS: false`, `?v=10`, pusholva a0edd24 + a `picks_method_off` trigger, `migrate-007`); minden meccs 1 pont, csak a győztes számít. A 2026-10-31-i gála (Moicano vs Nolan) 12/12 meccse a UFC.com-mal egyezik (a győztesek jók voltak; 5 meccs idejét a `sync.php details` javította); ranglista: TiTi 10, MRK 8, Endy 7, Csator024 0.
**Félretéve (a felhasználó választ):** a módtipp visszahozása később („majd lehet alakítunk ezen”); valódi push-értesítés; az „Ismert apróságok”.
**Döntésre vár:** nincs nyitott döntés (a migrate-008 és 009 élesben; a felhasználó 2026-11-07-én mindent jóváhagyott).
**Először olvasd:** ez a fájl; `supabase/migrate-009-ideiglenes-meccs.sql`, `test-009.sql`, `migrate-008-espn-mod-egyertelmu.sql`; `README.md`.
**Figyelj:** a UFC.com a kártya meccseit gyakran azonosító (`data-fmid`) nélkül teszi ki — 2026-11-07 óta a szinkron ezeket **ideiglenes negatív azonosítóval** felveszi (migrate-009), és a valódi megérkezésekor átkulcsolja (a tipp megmarad); a negatív id szándékos, ne töröld és ne cseréld kézzel (a tippek törlődnének). A `parse_event()` negatív-id ágára nincs automata teszt (csak `test-009.sql` az SQL-oldalra). Az ESPN-nél a `Unofficial Winner` részletből a kétértelmű eset (Kotko + Decision egyszerre) a 005-ben rossz módot adott (008 javítja). A UFC.com időt eltelt időként adja (ESPN: hátralévő).

## Korábban (2026-10-25)
Pontos zárás (migrate-005) és módtipp (migrate-006) élesben (a módtipp azóta KI van kapcsolva, lásd fent); Történet, Statisztika, Szezon, megosztás, .ics, profil; a zárás késésének mérése még hátravan.

## Állapot (2026-11-07; main = origin/main, minden pusholva)
- **Élő:** https://endy07.github.io/ufctipp/ · repó: https://github.com/Endy07/ufctipp (publikus) · Supabase-projekt: `ufctipp`
  (Endy07's Org, Free, EU / Írország; URL és publishable kulcs: `js/config.js`).
- **Adatbázis:** több gála (a legutóbbi `ufc-fight-night-october-31-2026`, 12 meccs, 4 játékos); a pontos játékos-/tippszám a `get_board`-ból kérdezhető le.
- **Adatbázis-migrációk:** `schema.sql` + `migrate-002`–`009` élesben (001 nincs külön fájl; `schema.sql` az alap) (007: módtipp ki, 2026-10-31; 008 + 009: 2026-11-07). A korai zárást a menetrendi `lock_at` és az ESPN `in`/period 0 okozta (javítva).
- **Automatika:** Supabase `pg_cron` `ufctipp-espn` 10 másodpercenként (`espn_tick`; gála idején ≤ 8 s-onként kér az ESPN-től, egyébként 55 s);
  a gépen a „UfcTipp szinkron” ütemezett feladat 5 percenként (`lock_at` már nem kerül be). Az admin-PIN a felhasználónál és a `tools/sync.local.json`-ban (gitignore).
- **Tesztek:** `php tests/test-sync.php` 23/23 · `supabase/test-002`…`test-006.sql`, `test-008.sql`, `test-009.sql` OK (élesben futtatva) · `node tests/test-stats.js` 14/14.
  Visszajátszás a 2026-10-17-i Fight Nighttal: 13/13 helyes győztes; élő `pg_net`-próba: HTTP 200, helyes eredmény.

## A felhasználó döntései (2026-10-21)
- GitHub Pages + Supabase („megfelel”); tipp pontokért, pénz nincs; minden meccs 1 pont (a címmeccs sem ér többet, 2026-10-24); módtipp: pontos győztes+mód 2 pont, rossz mód 0 (**2026-10-31-től inaktív** — a felhasználó: „csak tegyük inaktívvá… majd később lehet alakítunk ezen”).
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
| Egy meccs túl korán / későn zárt | az ESPN `period` jelzése késik, vagy a meccs nem párosult (`espn_id`); korán csak kézi zárás lehet (`lock_source='manual'`) | nézd a `fights.updated_at`-et és a `settings.espn_*` sorokat; kézzel az admin „Zárás most” gombja zár |
| Nem zárul / nem kap eredményt egy meccs a gála alatt | ESPN-hiba (`settings.espn_last_error`) vagy nem párosult | `select * from settings where key like 'espn%'`; `select * from cron.job_run_details order by start_time desc limit 5`; kézi admin (a „Zárás most” gomb zár, az eredményt is kézzel lehet rögzíteni) |
| Üres Történet / Statisztika / Profil | még nincs eldőlt meccs, vagy a `get_history()` nem fut | első gála előtt ez normális; egyébként `supabase/test-004.sql`, `curl .../rpc/get_history` |
| A `#profil/<becenév>` „még nem tippelt eldőlt meccsre” | a játékosnak még nincs eldőlt tippje (a profil a `get_history()`-ból számol) | normális; az első lejátszott gála után megjelenik |
| `egy meccset sem találtam` a gála előtti napokban (új gála) | a UFC.com még nem adott meccs-azonosítót (`data-fmid`) a kártyának; 2026-11-07 óta a szinkron ideiglenes negatív azonosítóval felveszi, és a valódi megérkezésekor átkulcsolja (migrate-009) | nincs teendő; ha egy eldőlt meccsnél negatív `fights.id` maradt, a UFC.com nem adott neki azonosítót — ártalmatlan |
| Módosítás után a böngésző a régi felületet mutatja | gyorsítótár | emeld a `?v=N`-t az `index.html`-ben |
| `git checkout` / merge: „unable to unlink tools/sync-hidden.vbs” | az ütemezett szinkron épp fut, zárolja a fájlt | várj, vagy átmenetileg tiltsd le a feladatot; a félbemaradt állapotot `git status`-szal nézd meg |
| A Supabase „Potential issue detected” ablakot dob | `delete` / `drop` a lekérdezésben | csak saját tesztadat törlésénél erősítsd meg |

## Ismert apróságok (a végső ellenőrzés halasztott pontjai, 2026-10-21)
- `get_event`: `starts_at` nélküli gála a lista elejére kerülne (`nulls last` hiányzik; a szinkron mindig küld időt).
- Az „aktuális gála” ablaka 1 nap (a terv 2 napot írt); a múltbeli gálákat a Történet mutatja.
- Statisztika: a kitalált demó-előzmények (`data/demo-history.json`) csak a `?demo` módban látszanak (a Profilra is igaz); élesen addig üres a Történet, amíg nincs eldőlt meccs.
- `espn_tick` a még függő `pg_net`-választ eldobja (60 mp után újat kér; a 10 mp-es ütemben a következő tick dolgozza fel a választ).
- (2026-10-25) Az „előző meccs eredménye → a következő zár” szabály megszűnt: minden meccs csak a saját 1. menetének indulásakor (ESPN `period >= 1`) vagy `post` állapotban zár.
- A `sync.php auto` HIBA-t naplóz, ha az adatbázisban egyáltalán nincs gála.
- Új gála érkezésekor a fejléc címe csak újratöltéskor frissül; a felület 90 mp-enként a teljes gála-adatot lekéri.
- `espn_apply`: a `%kotko%` ág halott (ártalmatlan).
