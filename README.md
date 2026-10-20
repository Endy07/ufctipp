# UFC Tipp

Baráti tippjáték egy UFC-estre: mindenki megtippeli, ki nyeri a meccseket, amíg az admin le nem zárja őket.
Mobil-első statikus webapp (GitHub Pages) + Supabase (adatok, szabályok).

## Helyben
`http://localhost/2026/UfcTipp/`. Ha a `js/config.js` üres, **demó módban** fut: minden adat csak a böngészőben él, az admin-PIN `0000`.

## Élesítés

### 1. Supabase
1. A Supabase-projekt **SQL Editor**-ában futtasd le sorban: `supabase/schema.sql`, majd `supabase/seed-ufc-333.sql`.
2. Állítsd be az admin-PIN-t (ugyanott; a `…` helyére a saját PIN-ed — ez **nem** kerül a repóba):
   ```sql
   insert into settings (key, value) values ('admin_pin_hash', extensions.crypt('…', extensions.gen_salt('bf')))
   on conflict (key) do update set value = excluded.value;
   ```
3. **Project Settings → API**: a Project URL és az anon / publishable kulcs kerül a `js/config.js`-be.
   A service_role / secret kulcs SOHA ne kerüljön ide.

### 2. GitHub Pages
Repó → Settings → Pages → Deploy from branch → `main`, `/ (root)`.

## Adatfrissítés a UFC.com-ról
```
php tools/scrape-ufc.php ufc-333 --refresh
```
Újraírja a `data/ufc-333.json`-t (meccsek, versenyzők, statisztikák) és a `supabase/seed-ufc-333.sql`-t.
Ha a kártya változik (beugró), a seedet újra le kell futtatni a Supabase-ben; a meglévő meccsek állapota megmarad.
Egy kiesett meccs sorát kézzel kell törölni (`delete from fights where id = …`), a tippjeivel együtt törlődik.

## Az est menete (admin)
- Az `#admin` oldalon (a link végére `#admin`) lépj be az admin-PIN-nel.
- Amikor egy meccs elkezdődik: **Tippelés lezárása**. Utána: győztes + mód → **Eredmény mentése**.
- Tartalékként minden szekció nyitómeccse a szekció hivatalos kezdésekor magától lezárul.
