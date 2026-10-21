<?php
// UFC.com esemény- és versenyzőoldalak letöltése → data/<event>.json + supabase/seed-<event>.sql
// A data/*.json a demó módhoz kell (?demo); élesben a gálát a sync.php tölti az adatbázisba.
// Használat: php tools/scrape-ufc.php ufc-333 [--refresh]
// A nyers HTML a tools/cache/ mappába kerül (nincs verziókövetve), így újrafuttatáskor nem tölt le újra.

declare(strict_types=1);

require __DIR__ . '/lib/ufc.php';

$slug    = $argv[1] ?? 'ufc-333';
$refresh = in_array('--refresh', $argv, true);
$root    = dirname(__DIR__);
$cache   = __DIR__ . '/cache';
if (!is_dir($cache)) mkdir($cache, 0777, true);

try {
    $out = build_event_data($slug, $cache, $refresh, fn($m) => fwrite(STDERR, "  $m\n"));
} catch (Throwable $e) {
    fwrite(STDERR, 'HIBA: ' . $e->getMessage() . "\n");
    exit(1);
}

if (!is_dir("$root/data")) mkdir("$root/data", 0777, true);
file_put_contents("$root/data/$slug.json", json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");

// ---- Seed SQL (az első telepítéshez; később a sync.php tartja karban) ----
$startOf = [];
foreach ($out['event']['sections'] as $s) $startOf[$s['key']] = $s['start'];
$opener = [];
foreach ($out['fights'] as $fi) $opener[$fi['card']] = $fi['id']; // a szekció utoljára listázott meccse = a nyitómeccs
$q = fn($v) => $v === null ? 'null' : "'" . str_replace("'", "''", (string) $v) . "'";
$rows = [];
foreach ($out['fights'] as $fi) {
    $lock = ($opener[$fi['card']] === $fi['id'] && !empty($startOf[$fi['card']])) ? gmdate('Y-m-d H:i:s+00', $startOf[$fi['card']]) : null;
    $rows[] = sprintf("  (%d, %s, %d, %s, %s, %d, %s)", $fi['id'], $q($slug), $fi['order'], $q($fi['card']),
        $fi['titleBout'] ? 'true' : 'false', $fi['titleBout'] ? 2 : 1, $q($lock));
}
$sql = "-- Generálta: tools/scrape-ufc.php ($slug) " . gmdate('Y-m-d H:i') . " UTC. Újrafuttatható: a meglévő meccsek állapotát nem bántja.\n"
     . "insert into fights (id, event, ord, card, title_bout, points, lock_at) values\n" . implode(",\n", $rows) . "\n"
     . "on conflict (id) do update set event = excluded.event, ord = excluded.ord, card = excluded.card,\n"
     . "  title_bout = excluded.title_bout, points = excluded.points;\n";
file_put_contents("$root/supabase/seed-$slug.sql", $sql);

fwrite(STDERR, sprintf("Kész: %d meccs, %d versenyző → data/%s.json, supabase/seed-%s.sql\n", count($out['fights']), count($out['athletes']), $slug, $slug));
