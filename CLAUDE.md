# CLAUDE.md — UFC tippjáték barátoknak (új projekt)

Magyarul beszélünk. A projektet a pult (`C:\xampp\htdocs\Claude`) indította 2026-10-21-én a felhasználó diktált jegyzetéből
(Könyvjelzők `notes.note_id = 61`, „UFC meccs fogadási weboldal barátokkal"; a Hub 3 tennivalót aratott le belőle).
**Állapot: kód még nincs. Határidő: a hétvégi UFC-est** — előtte működnie kell.

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

## Amit tudunk / javaslat (a session pontosítsa a felhasználóval, röviden)
- **Tipp, nem pénzes fogadás**: a barátok pontokért tippelnek (ranglista). Valódi pénz nem szerepel.
- Mobil-első, teljes értékű webapp: az est meccsei (kártya), A oldal / B oldal, a versenyzők adatai és statisztikái, tipp leadása, ranglista.
- **Lezárás: admin gomb meccsenként** (a stream késése miatt a felhasználó is ezt hajlítja), opcionálisan egy tervezett kezdési idő, ami után automatikusan zár — az admin felülbírálhatja. Eredmény rögzítése az adminnál → pontozás.
- Csatlakozás: link / meghívó, egyszerű becenév + PIN vagy hasonló (nem kell teljes regisztráció).
- A versenyzők adatai: járj utána, honnan szedhetők (pl. nyilvános oldalak, ÁSZF-et nézd); ha nincs tiszta forrás, admin-felület a kézi/félautomata feltöltéshez. Az est pontos dátumát és kártyáját nézd meg.
- **Nyitott, fontos kérdés: hol fut?** A barátoknak interneten kell elérniük — tárhely / domain / élesítés a felhasználó döntése és igene (lent).

## Menet
1. Rövid egyeztetés a felhasználóval (egyszerre egy kérdés, mindig javaslattal; kevés kérdés — a kisebb dolgokat döntsd el és írd le).
2. A jóváhagyott terv azonnal `docs\<dátum>-terv.md`-be.
3. Építés, tesztekkel; helyben futtatható legyen (XAMPP: `http://localhost/2026/UfcTipp/`).
4. Írd meg a `PROJEKT-KONTEXTUS.md`-t és a `PROJEKT-RESZLETES.md`-t (sablon: `C:\xampp\htdocs\2026\Konyvjelzok\docs\projekt-kontextus-sablon.md`).

## Szabályok
- Autonómia: 1 — helyben commitolhatsz ebbe a repóba; push / GitHub / tárhely / FTP / domain / token / élesítés NINCS a felhasználó igene nélkül (ellenőrzőlistába írd).
- Más projektekhez csak olvasva nyúlj.
- Fájlt Write/Edit eszközzel írj, ne shell-heredoc-kal; többsoros commit-üzenet: `git commit -F <fájl>`.
- Folyamatot csak a sajátodat állítsd le (PID / útvonal). Portot a `C:\Claude-memoria\kozos\portok.js foglal` adja, ha kell.
- Titok (jelszó, kulcs, admin-PIN) a repóba és a memóriába nem kerülhet.

## Memória
Állapotlap: `C:\Claude-memoria\projektek\ufctipp.md`, napló: `C:\Claude-memoria\naplo\<dátum>\ufctipp.md`, egy sor a `C:\Claude-memoria\kozos\projektek.md`-be. Nem kell commitolnod (a pult teszi).
Visszajelzés a végén a pultnak (SendMessage): mi kész, hol, mi vár a felhasználóra.
