<?php
// UFC.com esemény- és versenyzőoldalak letöltése → data/<event>.json + supabase/seed-<event>.sql
// Használat: php tools/scrape-ufc.php ufc-333 [--refresh]
// A nyers HTML a tools/cache/ mappába kerül (nincs verziókövetve), így újrafuttatáskor nem tölt le újra.

declare(strict_types=1);

$slug    = $argv[1] ?? 'ufc-333';
$refresh = in_array('--refresh', $argv, true);
$root    = dirname(__DIR__);
$cache   = __DIR__ . '/cache';
if (!is_dir($cache)) mkdir($cache, 0777, true);

function fetch_page(string $url, string $cacheFile, bool $refresh): string
{
    if (!$refresh && is_file($cacheFile) && filesize($cacheFile) > 10000) {
        return file_get_contents($cacheFile);
    }
    $ctx = stream_context_create(['http' => [
        'header'  => "User-Agent: Mozilla/5.0 (UfcTipp baráti tippjáték)\r\nAccept-Language: en\r\n",
        'timeout' => 30,
    ]]);
    $html = @file_get_contents($url, false, $ctx);
    if ($html === false || strlen($html) < 10000) {
        fwrite(STDERR, "HIBA: nem sikerült letölteni: $url\n");
        exit(1);
    }
    file_put_contents($cacheFile, $html);
    usleep(700000); // kíméljük a szervert
    return $html;
}

function dom(string $html): DOMXPath
{
    $d = new DOMDocument();
    libxml_use_internal_errors(true);
    $d->loadHTML('<?xml encoding="UTF-8">' . $html);
    libxml_clear_errors();
    return new DOMXPath($d);
}

function cls(string $c): string
{
    return "contains(concat(' ', normalize-space(@class), ' '), ' $c ')";
}

function txt(?DOMNode $n): string
{
    return $n ? trim(preg_replace('/\s+/u', ' ', $n->textContent)) : '';
}

function first(DOMXPath $x, string $q, ?DOMNode $ctx = null): ?DOMNode
{
    $r = $x->query($q, $ctx);
    return ($r && $r->length) ? $r->item(0) : null;
}

function num(string $s): ?float
{
    return preg_match('/-?\d+(\.\d+)?/', $s, $m) ? (float) $m[0] : null;
}

function athlete_slug(string $href): string
{
    return preg_match('~/athlete/([^/?#]+)~', $href, $m) ? $m[1] : '';
}

// ---- Esemény ----
$eventUrl = "https://www.ufc.com/event/$slug";
$x = dom(fetch_page($eventUrl, "$cache/event-$slug.html", $refresh));

$title = txt(first($x, "//title"));
$sections = [];
foreach (['main-card' => 'main', 'prelims-card' => 'prelims', 'early-prelims' => 'early'] as $id => $key) {
    $n = first($x, "//*[@id='$id']");
    if (!$n) continue;
    $ts = first($x, ".//*[@data-timestamp]", $n);
    if (!$ts) $ts = first($x, "following::*[@data-timestamp][1]", $n);
    $sections[] = ['key' => $key, 'line' => $n->getLineNo(), 'start' => $ts ? (int) $ts->getAttribute('data-timestamp') : null];
}
usort($sections, fn($a, $b) => $a['line'] <=> $b['line']);

$fights = [];
foreach ($x->query("//div[" . cls('c-listing-fight') . " and @data-fmid]") as $f) {
    $line = $f->getLineNo();
    $card = null;
    foreach ($sections as $s) if ($s['line'] < $line) $card = $s['key'];
    if (!$card) continue;

    $classText = txt(first($x, ".//*[" . cls('c-listing-fight__class--mobile') . "]//*[" . cls('c-listing-fight__class-text') . "]", $f));
    $ranks = [];
    foreach ($x->query(".//*[" . cls('c-listing-fight__class--mobile') . "]//*[" . cls('c-listing-fight__corner-rank') . "]", $f) as $r) {
        $ranks[] = txt($r);
    }
    $side = function (string $color) use ($x, $f) {
        $a = first($x, ".//*[" . cls("c-listing-fight__corner-name--$color") . "]//a", $f);
        $img = first($x, ".//*[" . cls("c-listing-fight__corner-image--$color") . "]//img", $f);
        $country = first($x, ".//*[" . cls("c-listing-fight__country--$color") . "]", $f);
        return [
            'slug'    => $a ? athlete_slug($a->getAttribute('href')) : '',
            'name'    => $a ? txt($a) : '',
            'image'   => $img ? $img->getAttribute('src') : null,
            'country' => $country ? txt($country) : null,
            'flag'    => ($country && ($fi = $country->getElementsByTagName('img')->item(0))) ? $fi->getAttribute('src') : null,
        ];
    };
    $odds = [];
    foreach ($x->query(".//*[" . cls('c-listing-fight__odds-amount') . "]", $f) as $o) $odds[] = txt($o);

    $red  = $side('red');
    $blue = $side('blue');
    $red['rank']  = $ranks[0] ?? '';
    $blue['rank'] = $ranks[1] ?? '';
    $red['odds']  = $odds[0] ?? '';
    $blue['odds'] = $odds[1] ?? '';

    $fights[] = [
        'id'         => (int) $f->getAttribute('data-fmid'),
        'card'       => $card,
        'weightClass'=> $classText,
        'titleBout'  => stripos($classText, 'title') !== false,
        'a'          => $red,
        'b'          => $blue,
    ];
}
if (count($fights) === 0) {
    fwrite(STDERR, "HIBA: egy meccset sem találtam az eseményoldalon — változott a UFC.com szerkezete?\n");
    exit(1);
}

// A UFC.com a szekción belül a legutolsó (legnagyobb) meccsel kezd; a sorrend: fő meccs = 1.
foreach ($fights as $i => &$fi) $fi['order'] = $i + 1;
unset($fi);

// ---- Versenyzők ----
$athletes = [];
$slugs = [];
foreach ($fights as $fi) { $slugs[] = $fi['a']['slug']; $slugs[] = $fi['b']['slug']; }

foreach (array_unique($slugs) as $s) {
    if ($s === '') continue;
    fwrite(STDERR, "  versenyző: $s\n");
    $ax = dom(fetch_page("https://www.ufc.com/athlete/$s", "$cache/athlete-$s.html", $refresh));

    $a = ['slug' => $s, 'url' => "https://www.ufc.com/athlete/$s"];
    $a['name']     = txt(first($ax, "//*[" . cls('hero-profile__name') . "]"));
    $a['nickname'] = trim(txt(first($ax, "//*[" . cls('hero-profile__nickname') . "]")), '" ');
    $a['division'] = txt(first($ax, "//*[" . cls('hero-profile__division-title') . "]"));
    $rec = txt(first($ax, "//*[" . cls('hero-profile__division-body') . "]"));
    $a['record'] = preg_match('/(\d+)-(\d+)-(\d+)/', $rec, $m) ? ['w' => (int) $m[1], 'l' => (int) $m[2], 'd' => (int) $m[3]] : null;
    $a['tags'] = [];
    foreach ($ax->query("//*[" . cls('hero-profile__tag') . "]") as $t) $a['tags'][] = txt($t);
    $img = first($ax, "//img[" . cls('hero-profile__image') . "]");
    $a['image'] = $img ? $img->getAttribute('src') : null;

    $a['hero'] = [];
    foreach ($ax->query("//*[" . cls('hero-profile__stat') . "]") as $h) {
        $a['hero'][txt(first($ax, ".//*[" . cls('hero-profile__stat-text') . "]", $h))] =
            num(txt(first($ax, ".//*[" . cls('hero-profile__stat-numb') . "]", $h)));
    }

    $a['totals'] = [];
    foreach ($ax->query("//dl[" . cls('c-overlap__stats') . "]") as $dl) {
        $a['totals'][txt(first($ax, ".//*[" . cls('c-overlap__stats-text') . "]", $dl))] =
            num(txt(first($ax, ".//*[" . cls('c-overlap__stats-value') . "]", $dl)));
    }
    // Pontosság: a UFC.com kördiagramja is ezt mutatja (bevitt / megkísérelt)
    $pct = fn($l, $t) => !empty($a['totals'][$t]) ? (int) round(($a['totals'][$l] ?? 0) / $a['totals'][$t] * 100) : null;
    $a['accuracy'] = [
        'striking' => $pct('Sig. Strikes Landed', 'Sig. Strikes Attempted'),
        'takedown' => $pct('Takedowns Landed', 'Takedowns Attempted'),
    ];
    $a['rates'] = [];
    foreach ($ax->query("//*[" . cls('c-stat-compare__group') . "]") as $g) {
        $label = txt(first($ax, ".//*[" . cls('c-stat-compare__label') . "]", $g));
        $val   = txt(first($ax, ".//*[" . cls('c-stat-compare__number') . "]", $g));
        if ($label !== '') $a['rates'][$label] = str_replace(' ', '', $val);
    }
    $a['bars'] = [];
    foreach ($ax->query("//*[" . cls('c-stat-3bar__group') . "]") as $g) {
        $label = txt(first($ax, ".//*[" . cls('c-stat-3bar__label') . "]", $g));
        $val   = txt(first($ax, ".//*[" . cls('c-stat-3bar__value') . "]", $g));
        if (preg_match('/(\d+)\s*\((\d+)%\)/', $val, $m)) $a['bars'][$label] = ['n' => (int) $m[1], 'pct' => (int) $m[2]];
    }
    $a['target'] = [];
    foreach (['head', 'body', 'leg'] as $t) {
        $v = first($ax, "//*[@id='e-stat-body_x5F__x5F_{$t}_value']");
        $p = first($ax, "//*[@id='e-stat-body_x5F__x5F_{$t}_percent']");
        if ($v) $a['target'][$t] = ['n' => (int) num(txt($v)), 'pct' => (int) num(txt($p))];
    }
    $a['bio'] = [];
    foreach ($ax->query("//*[" . cls('c-bio__field') . "]") as $b) {
        $label = txt(first($ax, ".//*[" . cls('c-bio__label') . "]", $b));
        if ($label !== '') $a['bio'][$label] = txt(first($ax, ".//*[" . cls('c-bio__text') . "]", $b));
    }
    $in = fn($k) => isset($a['bio'][$k]) && num($a['bio'][$k]) ? num($a['bio'][$k]) : null;
    $a['heightCm']   = $in('Height') ? round($in('Height') * 2.54) : null;
    $a['reachCm']    = $in('Reach') ? round($in('Reach') * 2.54) : null;
    $a['legReachCm'] = $in('Leg reach') ? round($in('Leg reach') * 2.54) : null;
    $a['weightKg']   = $in('Weight') ? round($in('Weight') * 0.45359237, 1) : null;
    $a['age']        = $in('Age') ? (int) $in('Age') : null;

    $a['lastFights'] = [];
    foreach ($ax->query("//*[" . cls('c-card-event--athlete-results__matchup-wrapper') . "]") as $w) {
        $card = $w->parentNode;
        while ($card && !($card instanceof DOMElement && str_contains($card->getAttribute('class'), 'c-card-event--athlete-results'))) $card = $card->parentNode;
        $winner = null;
        foreach ($ax->query(".//*[" . cls('c-card-event--athlete-results__image') . " and " . cls('win') . "]//a", $w) as $wa) {
            $winner = athlete_slug($wa->getAttribute('href'));
        }
        $info = first($ax, "following::*[" . cls('c-card-event--athlete-results__info') . "][1]", $w);
        if (!$info) continue;
        $opp = null;
        foreach ($ax->query(".//*[" . cls('c-card-event--athlete-results__headline') . "]//a", $info) as $l) {
            if (athlete_slug($l->getAttribute('href')) !== $s) $opp = txt($l);
        }
        $res = [];
        foreach ($ax->query(".//*[" . cls('c-card-event--athlete-results__result') . "]", $info) as $r) {
            $res[txt(first($ax, ".//*[" . cls('c-card-event--athlete-results__result-label') . "]", $r))] =
                txt(first($ax, ".//*[" . cls('c-card-event--athlete-results__result-text') . "]", $r));
        }
        $a['lastFights'][] = [
            'opponent' => $opp,
            'date'     => txt(first($ax, ".//*[" . cls('c-card-event--athlete-results__date') . "]", $info)),
            'result'   => $winner === null ? 'other' : ($winner === $s ? 'win' : 'loss'),
            'round'    => $res['Round'] ?? '',
            'time'     => $res['Time'] ?? '',
            'method'   => $res['Method'] ?? '',
        ];
    }
    $athletes[$s] = $a;
}

$out = [
    'event' => [
        'slug'     => $slug,
        'title'    => trim(explode('|', $title)[0]),
        'url'      => $eventUrl,
        'sections' => array_map(fn($s) => ['key' => $s['key'], 'start' => $s['start']], $sections),
        'scrapedAt'=> gmdate('c'),
        'source'   => 'UFC.com (hivatalos esemény- és versenyzőoldalak)',
    ],
    'fights'   => $fights,
    'athletes' => $athletes,
];

if (!is_dir("$root/data")) mkdir("$root/data", 0777, true);
file_put_contents("$root/data/$slug.json", json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");

// ---- Seed SQL ----
$startOf = [];
foreach ($sections as $s) $startOf[$s['key']] = $s['start'];
$lastInCard = [];
foreach ($fights as $fi) $lastInCard[$fi['card']] = $fi['id']; // a szekció utoljára listázott meccse = a nyitómeccs
$q = fn($v) => $v === null ? 'null' : "'" . str_replace("'", "''", (string) $v) . "'";
$rows = [];
foreach ($fights as $fi) {
    $lock = ($lastInCard[$fi['card']] === $fi['id'] && !empty($startOf[$fi['card']])) ? gmdate('Y-m-d H:i:s+00', $startOf[$fi['card']]) : null;
    $rows[] = sprintf("  (%d, %s, %d, %s, %s, %d, %s)", $fi['id'], $q($slug), $fi['order'], $q($fi['card']),
        $fi['titleBout'] ? 'true' : 'false', $fi['titleBout'] ? 2 : 1, $q($lock));
}
$sql = "-- Generálta: tools/scrape-ufc.php ($slug) " . gmdate('Y-m-d H:i') . " UTC. Újrafuttatható: a meglévő meccsek állapotát nem bántja.\n"
     . "insert into fights (id, event, ord, card, title_bout, points, lock_at) values\n" . implode(",\n", $rows) . "\n"
     . "on conflict (id) do update set event = excluded.event, ord = excluded.ord, card = excluded.card,\n"
     . "  title_bout = excluded.title_bout, points = excluded.points;\n";
file_put_contents("$root/supabase/seed-$slug.sql", $sql);

fwrite(STDERR, sprintf("Kész: %d meccs, %d versenyző → data/%s.json, supabase/seed-%s.sql\n", count($fights), count($athletes), $slug, $slug));
