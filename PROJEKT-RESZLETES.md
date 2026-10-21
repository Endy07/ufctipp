# UfcTipp — hogyan dolgozunk

## A lánc lépésről lépésre
1. **Az est felvétele:** az admin felveszi az estet és a meccseket (sorrend, súlycsoport, címmeccs-e, tervezett kezdés). A kártya forrása a hivatalos eseményoldal és a Wikipédia.
2. **Versenyzőadatok:** név, becenév, rekord (győzelem-vereség-döntetlen), magasság, karfesztáv, kor, állás, nemzetiség, kép és a szokásos ütés-/birkózás-statisztikák. A hivatalos UFC.com esemény- és versenyzőoldalairól, egy letöltő szkripttel.
3. **Csatlakozás:** meghívó link → becenév + PIN; a böngésző megjegyzi.
4. **Tippelés:** meccsenként A vagy B oldal, módosítható a zárásig.
5. **Zárás:** az admin meccsenként zárja a tippelést (a stream késése miatt ez a megbízható), opcionálisan egy tervezett időpont után automatikusan zár.
6. **Eredmény és pontozás:** az admin rögzíti a győztest; a pontok és a ranglista azonnal frissülnek.

## Miért így (a mért döntések)
- Admin-zárás az automatikus helyett: a baráti társaság streamje percekkel késhet, a hivatalos kezdési idők meccsenként csak becslések.
- GitHub Pages + Supabase: ingyenes, a gépnek nem kell bekapcsolva lennie; minden szabályt az adatbázis-függvények ellenőriznek, a böngésző csak a nyilvános kulcsot látja.

## Ahol most fáj (ide keresünk jobb megoldást)
- Versenyzőstatisztikák tiszta, megbízható forrása (nincs hivatalos nyilvános UFC API).
- A versenyzőadatok frissítése a kártyaváltozáskor (beugró) jelenleg kézi újrafuttatás + SQL.

## Kizárt utak (ne ajánld)
- Valódi pénzes fogadás és fizetés — jogi és baráti okból is kizárt.
- Teljes regisztráció e-maillel — túl nagy súrlódás egy esti játékhoz.

## Vaskorlátok
- Rövid határidő: az első éles est 2026-10-24.
- Mobil-első felület; a barátok telefonon, böngészőből használják.
- Futtatókörnyezet: statikus oldal (GitHub Pages) + Supabase (Postgres, RPC-függvények); a PHP csak az adatletöltőhöz kell. Keretrendszer és build-lépés nincs.
