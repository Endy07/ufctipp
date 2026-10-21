# CLAUDE.md — UFC tippjáték barátoknak (új projekt)

Magyarul beszélünk. A projektet a pult (`C:\xampp\htdocs\Claude`) indította 2026-10-21-én a felhasználó diktált jegyzetéből
(Könyvjelzők `notes.note_id = 61`, „UFC meccs fogadási weboldal barátokkal"; a Hub 3 tennivalót aratott le belőle).
**Állapot (2026-10-21): élesben fut, teljesen automatikus** — https://endy07.github.io/ufctipp/ (GitHub Pages + Supabase).
**Belépési pont: `KOVETKEZO-SESSION.md`** (állapot, következő lépés, hibaelhárítás). Felépítés és működés: `README.md`.

## A felhasználó szavai (a jegyzetből, szó szerint)
„A hétvégén lesz egy UFC mérkőzés, vagyis hát egy egész est, UFC est, és szeretnék egy olyat csinálni, hogy a barátaimmal egy
weboldalon bejelölhessük, hogy szerintünk ki nyeri az adott meccset. Itt ugye bárhány barátom csatlakozhat erre a weboldalra,
mindenki beteheti a voksát, amíg el nem indul a meccs. Ezt lehet, hogy egy adminnak, azaz, hogy nekem kellene rányomni, hogy
most már nem lehet fogadni, vagy lehet, hogy valahogy a meccshez kéne szinkronizálni, hogyha te le tudod valahogy szedni, hogy
mikor kezdődik pontosan melyik meccs, és akkor automatikusan lezáródna. De itt nálunk lehet egy pár másodperc, pár perces eltérés
is itt a streamelésben is. Lehet, hogy az adminos jobb. Ezt majd nem tudom, ezt rád bízom, mit javasolsz. És a lényeg, a lényeg
az egésznek, hogy szeretném, hogyha ez mobilon lenne először is optimalizálva, mobil nézetre. Ugye látszódna, hogy ki kivel
játszik, minden adat látszódna az adott emberről, minden stat látszódna, meg minden adata, meg minden az adott versenyzőről.
A oldal, B oldal. Nagyon szuper, teljes értékű webappot szeretnék. Addig tudjunk ráfogadni, amíg el nem kezdődik a fight.
Szeretném, hogyha ezt teljesen kidolgoznád."

## Tartós szabályok és csapdák (2026-10-21)
- **Éles adatbázis:** a tesztekhez `index.html?demo` (nem nyúl a Supabase-hez). Élesben csak a `teszt-` slugú gálán tesztelj, és takaríts.
- **SQL a Supabase-ben:** a migrációkat / teszteket az SQL-szerkesztőben futtatjuk (Chrome); a Supabase „Potential issue”
  ablakot dob minden `delete`/`drop`-nál — csak akkor erősítsd meg, ha a törlés a saját tesztadatodat érinti.
- **Belső függvények** (`*_apply`, `espn_process`, `espn_tick`) anon számára tiltottak; minden új függvénynél `revoke` / `grant` a mintára.
- **Cache:** a JS/CSS módosítás után emeld a `?v=N`-t az `index.html`-ben (a böngésző és a GitHub Pages is gyorsítótáraz).
- **Ág váltása előtt** állítsd le / várd meg az ütemezett szinkront: futás közben a `tools/sync-hidden.vbs` zárolt, és a checkout félbemarad.
- Az admin-PIN (6 jegyű) csak a Supabase-ben (hash) és a gépen a `tools/sync.local.json`-ban van; a játékos-PIN 4 jegyű, másik dolog.

## Döntések röviden (részletek: `docs/2026-10-21-terv.md`, `docs/2026-10-21-automatizalas-terv.md`)
- Tipp pontokért (címmeccs 2 pont), pénz nincs; csatlakozás becenév + 4 jegyű PIN; mobil-első.
- Hol fut: GitHub Pages + Supabase (eldőlt 2026-10-21). Zárás és eredmény automatikus (ESPN), az admin csak felülbírál.
- Mások tippje csak a meccs végén látszik; minden gála (számozott + Fight Night); beugrónál a tippek törlődnek.

## Menet (új munkánál)
1. Rövid egyeztetés a felhasználóval (egyszerre egy kérdés, mindig javaslattal; kevés kérdés — a kisebb dolgokat döntsd el és írd le).
2. A jóváhagyott terv azonnal `docs\<dátum>-terv.md`-be.
3. Építés, tesztekkel (`php tests/test-sync.php`, `supabase/test-00N.sql`); helyben: `http://localhost/2026/UfcTipp/` (`?demo`).
4. Nagyobb változásnál frissítsd a `PROJEKT-KONTEXTUS.md`-t (`frissitve:`), a `KEPESSEGEK.md`-t és a belépési pontot.

## Szabályok
- Autonómia: 1 — helyben commitolhatsz ebbe a repóba; push / GitHub / tárhely / FTP / domain / token / élesítés NINCS a felhasználó igene nélkül (ellenőrzőlistába írd).
- Más projektekhez csak olvasva nyúlj.
- Fájlt Write/Edit eszközzel írj, ne shell-heredoc-kal; többsoros commit-üzenet: `git commit -F <fájl>`.
- Folyamatot csak a sajátodat állítsd le (PID / útvonal). Portot a `C:\Claude-memoria\kozos\portok.js foglal` adja, ha kell.
- Titok (jelszó, kulcs, admin-PIN) a repóba és a memóriába nem kerülhet.

## Memória
Állapotlap: `C:\Claude-memoria\projektek\ufctipp.md`, napló: `C:\Claude-memoria\naplo\<dátum>\ufctipp.md`, egy sor a `C:\Claude-memoria\kozos\projektek.md`-be. Nem kell commitolnod (a pult teszi).
Visszajelzés a végén a pultnak (SendMessage): mi kész, hol, mi vár a felhasználóra.
