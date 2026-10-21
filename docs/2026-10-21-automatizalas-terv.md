# UfcTipp — teljes automatizálás (terv, 2026-10-21)

## Cél és miért
A felhasználó szavaival: „Teljesen automatikusan legyen minden. Nekünk csak szavazgatni kelljen."
A gálát a rendszer magától vegye fel, amint ismert; kövesse a kártya változásait (beugró, törölt meccs, sorrend);
a meccs kezdetekor zárja a tippelést; a meccs végén rögzítse az eredményt. Késő esti gálánál előző nap
is lehessen tippelni, és reggelre kész legyen az eredmény.

## Nem cél / anti-cél
- Nem cél: pénzes fogadás, értesítések (push, e-mail), natív app.
- Anti-cél: **hibás eredményt rögzíteni.** Ha egy forrás bizonytalan, inkább ne rögzítsen (az admin kézzel megteszi).
- Anti-cél: a kézi admin-döntés felülírása. Amit az admin kézzel rögzített / zárt, azt az automata nem írja át.

## A felhasználó döntései
- Adatforrás: **UFC.com** (kártya, versenyzőadatok, statisztikák, képek) + az **ESPN ingyenes, kulcs nélküli UFC-adatfolyama**
  (`site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=ÉÉÉÉHHNN`: meccsenkénti állapot és győztes).
  A felhasználó: „van egy ingyenes adatforrás, az nagyon jó."
- **A felhasználó gépén fut** (ütemezett feladat + kézzel is indítható). „A gépem úgyis nagyon sokszor megy."
- Mások tippjei csak a meccs végén látszanak (már kész).

## Az én döntéseim (felülbírálhatók)
- **Versenyzőcsere** egy meccsen: az arra a meccsre leadott tippek törlődnek, a meccs „Megváltozott — tippelj újra!”
  jelzést kap (amíg mindenki újra nem tippelt, vagy a meccs le nem zárul). **Elmaradt meccs:** eltűnik a tippjeivel együtt.
  Csak sorrend- vagy szekcióváltozás: a tippek maradnak.
- **Zárás** (bármelyik, ami előbb jön): (1) az ESPN „zajlik" állapotot jelez; (2) a futási sorrendben előző meccs
  véget ért (ESPN vagy UFC.com eredmény) — a következő meccs ilyenkor 10–20 percen belül kezdődik; (3) a szekció
  hivatalos kezdési ideje a szekció nyitómeccsére (már megvan); (4) admin gomb.
- **Eredmény:** az ESPN „vége" + győztes jelzése alapján; ha a UFC.com is közöl eredményt, egyeznie kell, különben
  nem rögzít (és a naplóba írja). Mód / menet / idő a UFC.com-ról, ha már ott van; ha nincs, később pótolja.
  Döntetlen / no contest: csak egyértelmű jelzésből.
- **Tippelés** a kártya felvételétől nyitva (akár napokkal előre), meccsenként a zárásig.
- **Gálák:** a felhasználó döntése (2026-10-21): **mindet** felveszi, a számozott nagy gálákat (UFC 333) és a heti
  Fight Nightokat is; a típus címkeként látszik.
- **Ranglista:** „Ez a gála" + „Összesített", az összesítettben szűrővel: Mind / Számozott / Fight Night
  (a felhasználó ötlete, az én pontosításommal: egy játék, szűrhető ranglista).
- **Kézi vs. automata:** külön mezőnként. Az automata nem nyit újra kézzel zárt meccset, és nem írja felül a kézzel
  rögzített eredményt — de a kézzel *zárt* meccshez hozzáírja az eredményt (különben a „reggelre kész" nem teljesülne).
- **Az élő rész (zárás + eredmény) a Supabase-ben fut, nem a gépen:** az ESPN-adat JSON, ezt a Postgres maga is fel
  tudja dolgozni (pg_cron percenként + pg_net HTTP-kérés). Így ha a gép alszik vagy ki van kapcsolva a hajnali gála
  alatt, akkor sem marad nyitva egy már lement meccs, és reggelre kész az eredmény. (Az ellenőrzés jelezte: csak a
  gépre építve egy alvó gép mellett utólag is lehetne tippelni.) A UFC.com-oldal feldolgozása (kártya, statisztika,
  képek, változások) marad a gépen; ha az nem fut, az utolsó ismert kártya érvényes.
- **Migráció:** csak bővítő, a meglévő játékosok és tippek megmaradnak; az SQL-t én futtatom a Supabase felületén (Chrome).
- A gála adatai (kártya, versenyzők) **az adatbázisba** kerülnek, a felület onnan olvas; a statikus `data/*.json`
  megszűnik (a letöltő a helyi gyorsítótárban megtartja hibakereséshez).

## Felépítés
### Adatbázis (Supabase)
- Új tábla `events`: slug, cím, kezdések (szekciónként), állapot (közelgő / zajlik / vége), a kártya és a versenyzők
  adatai JSON-ban (ugyanaz a szerkezet, mint ma a `data/ufc-333.json`), utolsó szinkron ideje, rövid szinkronnapló.
- `fights` bővül: a két versenyző azonosítója (slug), „megváltozott" jelző, az eredmény forrása (kézi / automata).
- Új RPC-k (admin-PIN-nel védve, mint a mostani admin-függvények):
  - `sync_event(pin, adat)`: felveszi / frissíti a gálát; új meccs be, kiesett meccs (ha még nincs eredménye) törlés,
    versenyzőcsere → tippek törlése + jelző, sorrend frissítése.
  - `sync_status(pin, meccsenkénti állapotok)`: zárás és eredmény a fenti szabályok szerint; kézi döntést nem ír felül.
- Nyilvános: `get_event()` — az aktuális gála (a legközelebbi még nem lezárt, vagy a legutóbbi 2 napon belül — megvalósítva: 1 nap, lásd KOVETKEZO-SESSION.md „Ismert apróságok”),
  `get_board(event)` (mai), és összesített ranglista.

### A szinkronprogram (a felhasználó gépén)
- `tools/sync.php` — a mostani letöltőből; PHP (XAMPP), külső függőség nélkül.
  - `discover`: a UFC.com eseménylistájából a következő gála; felvétel `sync_event`-tel.
  - `card`: az aktuális gála kártyájának újraolvasása, változások bevezetése.
  - `live`: a UFC.com eredmény-adataival (mód, menet, idő) pótolja az ESPN-ből rögzített eredményeket.
  - `auto` (az ütemező ezt hívja): az idő alapján eldönti, mit futtasson:
    - naponta egyszer `discover` + `card`;
    - a gála napján óránként `card`, a szekciók kezdése előtti 2 órában 10 percenként;
    - a gála alatt 5 percenként `live` (a zárás és a győztes ettől függetlenül a Supabase-ben megy).
- Supabase-oldal: `pg_cron` percenként, csak ha van zajló vagy 12 órán belül kezdődő gála: ESPN-lekérés (`pg_net`),
  az előző válasz feldolgozása → zárás / eredmény a fenti szabályokkal.
- Az admin-PIN egy **helyi, nem verziókövetett** fájlban (`tools/sync.local.json`), amit a felhasználó maga ír be.
- Kézi indítás: `tools/sync.cmd` (dupla katt) — mindent egyszer lefuttat, és kiírja, mit talált.
- Ütemezés: Windows Feladatütemező, percenként `auto` (a felhasználó igenjével hozom létre). Ha a gép ki van
  kapcsolva vagy alszik, nem fut — ilyenkor a tartalék zárás (szekciókezdés) és a kézi admin marad.
- Napló: `tools/logs/sync-ÉÉÉÉ-HH-NN.log`, és röviden az `events` táblában (az admin oldalon látszik az utolsó szinkron).

### Felület
- A gála az adatbázisból jön (`get_event`); ha nincs közelgő gála: „A következő gála még nincs kiírva."
- „Megváltozott — tippelj újra!" jelzés a meccsen; a felső összesítő is jelzi.
- Ranglista: „Ez a gála" / „Összesített" váltó; az összesítettben Mind / Számozott / Fight Night szűrő.
- Admin oldal: utolsó szinkron ideje + napló röviden; a kézi gombok maradnak (felülírják az automatát).

## Sorrend és határidő
1. **Szombat (2026-10-24) előtt, a UFC 333-ra:** DB-bővítés, `sync.php` (card + live), felület az adatbázisból,
   csere-jelzés, ütemezett feladat. Teszt: egy múlt heti gálán (UFC 332 / Fight Night) „visszajátszva".
2. Utána: `discover` (következő gála automatikus felvétele), összesített ranglista.

## Ami a builderre marad
- A UFC.com és az ESPN versenyzőinek párosítása (névnormalizálás: ékezet, kötőjel, aposztróf, vezetéknév-egyezés).
- A naplók formája, a hibakezelés részletei (hálózati hiba → a következő futás újrapróbál).
