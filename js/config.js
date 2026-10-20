// A Supabase-projekt elérése. Az anon / publishable kulcs NYILVÁNOS: arra tervezték, hogy a böngészőben legyen;
// a jogosultságokat az adatbázis függvényei ellenőrzik (supabase/schema.sql). Titkos kulcs ide SOHA nem kerülhet.
// Ha üres, az app demó módban fut: minden adat csak az adott böngészőben (localStorage) él.
window.UFCTIPP_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
  event: 'ufc-333',
};
