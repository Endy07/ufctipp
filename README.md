# UFC Tipp

Baráti tippjáték az UFC-gálákra: mindenki megtippeli, ki nyeri a meccseket, amíg el nem kezdődnek; a pontok és a ranglista
maguktól frissülnek. Mobil-első statikus webapp (GitHub Pages) + Supabase (adatok, szabályok, élő eredményfigyelő).
Élő: https://endy07.github.io/ufctipp/ · admin: a link végére `#admin`.

## Helyben
`http://localhost/2026/UfcTipp/` — élesben az igazi adatbázissal dolgozik. Kipróbáláshoz: `index.html?demo` (**demó mód**:
minden adat csak a böngészőben él, a `data/ufc-333.json` gálával, admin-PIN `0000`).
A CSS/JS hivatkozások `?v=N` verziót kapnak (`index.html`); módosítás után emeld, különben a böngésző a régit használja.

## Telepítés (egyszer; 2026-10-21-én megtörtént)
### 1. Supabase
1. Az **SQL Editor**-ban sorban: `supabase/schema.sql`, `supabase/seed-ufc-333.sql`, `supabase/migrate-002-automatizalas.sql`,
   `supabase/migrate-003-javitasok.sql`. Ellenőrzés: `supabase/test-002.sql` és `test-003.sql` — egy-egy „OK” sor.
2. Admin-PIN (ugyanott; a `…` helyére a saját PIN — ez **nem** kerül a repóba):
   ```sql
   insert into settings (key, value) values ('admin_pin_hash', extensions.crypt('…', extensions.gen_salt('bf')))
   on conflict (key) do update set value = excluded.value;
   ```
3. **Project Settings → API keys**: a Project URL és a publishable kulcs a `js/config.js`-be. A secret / service_role kulcs SOHA.
### 2. GitHub Pages
Repó → Settings → Pages → Deploy from branch → `main`, `/ (root)`.
### 3. A gép (szinkron)
`tools/sync.local.json` (minta: `sync.local.example.json`) — az `adminPin` mezőbe az admin-PIN; a fájl nincs verziókövetve.
Windows Feladatütemező: „UfcTipp szinkron”, 5 percenként `wscript tools\sync-hidden.vbs` (ablak nélkül; kimaradt futást pótol).

## Automatika
- **Gála és kártya** (a gépről): `tools/sync.php` — UFC.com (kártya, versenyzők, statisztikák, képek) + ESPN-párosítás →
  Supabase `sync_event`. Az `auto` mód naponta egyszer felveszi a következő gálát, a gála előtti napon óránként, az utolsó
  2 órában és a gála alatt 10 percenként újraolvassa a kártyát, a gála alatt 5 percenként pontosítja az eredményeket.
  Kézi indítás: `tools\sync.cmd` (dupla katt). Napló: `tools/logs/`. Próbafuttatás: `php tools/sync.php card <slug> --dry`
  (a teljes küldeményt `tools/cache/sync-<slug>.sql`-be is kiírja; az SQL-szerkesztőben PIN nélkül lefuttatható).
- **Zárás és eredmény** (a Supabase-ben, a géptől függetlenül): `pg_cron` percenként → `espn_tick` → ESPN → `espn_apply`.
  A meccs kezdetekor zár, a végén rögzíti a győztest — csak egyértelmű jelzésből (döntetlen / NC az adminé).
  A UFC.com győztese ellenőrzi; eltérésnél visszavonja, és az admin dönt (az admin oldalon a napló sora jelzi).
- **Versenyzőcsere:** nyitott meccsen a tippek törlődnek, a felület „tippelj újra” jelzést mutat; elmaradt nyitott meccs eltűnik.
  Lezárt / kész meccshez a szinkron nem nyúl. Ha egyszerre több mint 2 nyitott meccs tűnne el, a szinkron elutasítja.
- **Az admin elsőbbsége:** amit az admin oldalon kézzel tesz (zárás, újranyitás, eredmény, eredmény törlése), azt az automata
  nem írja felül.

## Az est menete
Semmit nem kell csinálni. Ha valami nem stimmel: `#admin` → admin-PIN → a meccsnél zárás / újranyitás / eredmény.
Az admin oldal tetején: „Utolsó automatikus frissítés” (benne pl. `ESPN 14/14` — a nem párosult meccset az automata nem zárja).

## Tesztek
- `php tests/test-sync.php` — UFC.com/ESPN feldolgozás és párosítás (fixture-ökből, hálózat nélkül).
- `supabase/test-002.sql`, `supabase/test-003.sql` — az adatbázis-szabályok (az SQL-szerkesztőben; saját tesztadat, utána takarít).

## Demó-adat frissítése
`php tools/scrape-ufc.php ufc-333 --refresh` — újraírja a `data/ufc-333.json`-t (a `?demo` módhoz) és a `supabase/seed-ufc-333.sql`-t.
