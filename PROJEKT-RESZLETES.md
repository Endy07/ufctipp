# UfcTipp — hogyan dolgozunk

## A lánc lépésről lépésre
1. **Gála felvétele (naponta, a felhasználó gépéről):** a szinkronprogram a UFC.com eseménylistájából kiválasztja a következő
   gálát (számozott és Fight Night is), letölti a kártyát és minden versenyző profilját, és admin-PIN-nel védett
   adatbázis-függvényen át feltölti. Onnantól napokkal előre lehet tippelni.
2. **ESPN-párosítás:** a UFC.com-meccseket név alapján párosítja az ESPN ingyenes UFC-adatfolyamának meccseivel
   (teljes név, majd csak egyértelmű vezetéknév; az ESPN néha fordítva sorolja a sarkokat).
3. **Kártyaváltozás:** a gála napján egyre sűrűbben újraolvassa a kártyát. Beugrónál a nyitott meccs tippjei törlődnek
   („tippelj újra”), elmaradt nyitott meccs eltűnik, sarokcserénél a tippek is átfordulnak; lezárt meccshez nem nyúl.
4. **Csatlakozás és tippelés:** meghívó link → becenév + 4 jegyű PIN; meccsenként A vagy B oldal, módosítható a zárásig.
5. **Zárás és eredmény (a felhőben, percenként):** az adatbázis időzítője lekéri az ESPN-t; a meccs kezdetekor zárja a
   tippelést, a végén rögzíti a győztest, a módot, a menetet. A következő meccs is zárul, amint az előző véget ért.
6. **Kereszt-ellenőrzés:** a UFC.com eredménye pontosítja a módot, és ha a győztes eltér, az automata eredményt visszavonja —
   az admin dönt. A kézi admin-döntést az automata nem írja felül.
7. **Felület:** mobil-első oldal; a meccsek A/B oldallal, a versenyzők valós magasság szerint egy talpvonalon; összevetés
   („tale of the tape”); ranglista gálánként, szezononként és összesítve (szűrhető). Mások tippje csak a meccs végén látszik.
8. **Történet és statisztika:** a `get_history()` az eldőlt meccseket adja a tippekkel; a böngésző (`js/stats.js`) számolja a találati
   arányt, szériát, favorit / esélytelen mintát, díjakat, trófeákat, fej-fej mellett összevetést. Új gála felvétele ehhez nem kell semmit.

## Miért így (a mért döntések)
- **Zárás az ESPN „zajlik” jelzésére** az admin gomb helyett: a felhasználó teljes automatát kért; a stream késése miatt a valódi
  kezdés a tisztességes pont. A kézi admin megmaradt felülbírálásnak.
- **Az élő rész a felhőben, nem a gépen:** egy alvó gép mellett egy késő esti gálán utólag is lehetett volna tippelni.
- **Eredmény csak egyértelmű jelzésből** (vége + pontosan egy győztes, és a párosítás biztos): rossz eredmény rosszabb, mint a késés.
- GitHub Pages + Supabase: ingyenes; minden szabályt az adatbázis-függvények ellenőriznek, a böngésző csak a nyilvános kulcsot látja.
- Mérés: a 2026-10-17-i Fight Night visszajátszása 13/13 helyes győztes; az élő HTTP-lekérés a felhőből működik.

## Ahol most fáj (ide keresünk jobb megoldást)
- A UFC.com-nak nincs nyilvános API-ja: a kártya HTML-feldolgozásból jön, szerkezetváltásra érzékeny (védőkorlát: tömeges
  eltűnésnél a szinkron elutasít).
- Az ESPN adatfolyama nem hivatalos; ha megszűnik vagy változik, az automata zárás és eredmény leáll (a kézi admin marad).
- A kártyaszinkron a felhasználó gépén fut: ha a gép napokig ki van kapcsolva, a beugrók nem kerülnek be.
- Múltbeli gálák visszanézése még nincs a felületen.

## Kizárt utak (ne ajánld)
- Valódi pénzes fogadás és fizetés — jogi és baráti okból is kizárt.
- Teljes regisztráció e-maillel — túl nagy súrlódás egy esti játékhoz.
- Fizetős sport-API (az ingyenes TheSportsDB-kulcsot megszüntették; az ESPN-folyam elég).

## Vaskorlátok
- Ingyenes csomagok: GitHub Pages, Supabase Free (pg_cron, pg_net); nincs saját szerver.
- Mobil-első felület; a barátok telefonon, böngészőből használják.
- Statikus oldal, keretrendszer és build-lépés nélkül; a szinkron PHP 8 (XAMPP) a felhasználó Windows-gépén.
