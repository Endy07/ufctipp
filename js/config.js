// A Supabase-projekt elérése. Az anon / publishable kulcs NYILVÁNOS: arra tervezték, hogy a böngészőben legyen;
// a jogosultságokat az adatbázis függvényei ellenőrzik (supabase/schema.sql). Titkos kulcs ide SOHA nem kerülhet.
// Ha üres, az app demó módban fut: minden adat csak az adott böngészőben (localStorage) él.
window.UFCTIPP_CONFIG = {
  supabaseUrl: 'https://facvpkfrscaxkpnxujxz.supabase.co',
  supabaseKey: 'sb_publishable_GvuApPKwydD37pUBooyK1g_19AqT3ym',
  event: 'ufc-333',
  // Módtipp (KO/TKO, Feladás, Pontozás + pontos mód bónusz). false = a felületen nem látszik, a tipp mód nélkül megy.
  // Szerveroldalon a picks_method_off trigger is nullázza (supabase/migrate-007). Visszakapcsolás: mindkettő.
  METHOD_TIPS: false,
};
