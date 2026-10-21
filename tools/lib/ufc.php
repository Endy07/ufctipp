<?php
// UFC.com feldolgozás: eseményoldal (kártya, eredmények), versenyzőoldal (adatok, statisztikák), eseménylista.
// A letöltő (scrape-ufc.php) és a szinkronprogram (sync.php) közösen használja.

declare(strict_types=1);

function fetch_page(string $url, ?string $cacheFile = null, bool $refresh = true, int $minBytes = 10000): string
{
    if ($cacheFile && !$refresh && is_file($cacheFile) && filesize($cacheFile) > $minBytes) {
        return file_get_contents($cacheFile);
    }
    $ctx = stream_context_create(['http' => [
        'header'  => "User-Agent: Mozilla/5.0 (UfcTipp baráti tippjáték)\r\nAccept-Language: en\r\n",
        'timeout' => 30,
    ]]);
    $html = @file_get_contents($url, false, $ctx);
    if ($html === false || strlen($html) < $minBytes) {
        throw new RuntimeException("nem sikerült letölteni: $url");
    }
    if ($cacheFile) file_put_contents($cacheFile, $html);
    usleep(500000); // kíméljük a szervert
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

function event_kind(string $slug): string
{
    return preg_match('/^ufc-\d+$/', $slug) ? 'numbered' : 'fightnight';
}

// A teljes alakos (átlátszó hátterű) kép befoglaló doboza: hol kezdődik a fej és hol van a talp.
function body_box(string $url, string $cacheFile, bool $refresh): ?array
{
    if ($refresh || !is_file($cacheFile)) {
        $bin = @file_get_contents($url, false, stream_context_create(['http' => ['header' => "User-Agent: Mozilla/5.0 (UfcTipp)\r\n", 'timeout' => 30]]));
        if ($bin === false) return null;
        file_put_contents($cacheFile, $bin);
        usleep(300000);
    }
    $im = @imagecreatefromstring(file_get_contents($cacheFile));
    if (!$im) return null;
    $w = imagesx($im);
    $h = imagesy($im);
    $rowHas = function (int $y) use ($im, $w): bool {
        for ($x = 0; $x < $w; $x += 2) {
            if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) < 100) return true; // 0 = átlátszatlan
        }
        return false;
    };
    $top = 0;
    while ($top < $h && !$rowHas($top)) $top++;
    $bottom = $h - 1;
    while ($bottom > $top && !$rowHas($bottom)) $bottom--;
    imagedestroy($im);
    if ($top >= $bottom) return null;
    return ['w' => $w, 'h' => $h, 'top' => $top, 'bottom' => $bottom];
}

// Eseményoldal → cím, szekciók (kezdési idővel), meccsek (fő meccs = 1. sorrend).
function parse_event(string $html): array
{
    $x = dom($html);
    $sections = [];
    foreach (['main-card' => 'main', 'prelims-card' => 'prelims', 'early-prelims' => 'early'] as $id => $key) {
        $n = first($x, "//*[@id='$id']");
        if (!$n) continue;
        $ts = first($x, ".//*[@data-timestamp]", $n) ?? first($x, "following::*[@data-timestamp][1]", $n);
        $sections[] = ['key' => $key, 'line' => $n->getLineNo(), 'start' => $ts ? (int) $ts->getAttribute('data-timestamp') : null];
    }
    usort($sections, fn($a, $b) => $a['line'] <=> $b['line']);

    $fights = [];
    foreach ($x->query("//div[" . cls('c-listing-fight') . " and @data-fmid]") as $f) {
        $card = null;
        foreach ($sections as $s) if ($s['line'] < $f->getLineNo()) $card = $s['key'];
        if (!$card) continue;

        $classText = txt(first($x, ".//*[" . cls('c-listing-fight__class--mobile') . "]//*[" . cls('c-listing-fight__class-text') . "]", $f));
        $ranks = [];
        foreach ($x->query(".//*[" . cls('c-listing-fight__class--mobile') . "]//*[" . cls('c-listing-fight__corner-rank') . "]", $f) as $r) {
            $ranks[] = txt($r);
        }
        $odds = [];
        foreach ($x->query(".//*[" . cls('c-listing-fight__odds-amount') . "]", $f) as $o) $odds[] = txt($o);
        $side = function (string $color, int $i) use ($x, $f, $ranks, $odds) {
            $a = first($x, ".//*[" . cls("c-listing-fight__corner-name--$color") . "]//a", $f);
            $img = first($x, ".//*[" . cls("c-listing-fight__corner-image--$color") . "]//img", $f);
            $country = first($x, ".//*[" . cls("c-listing-fight__country--$color") . "]", $f);
            return [
                'slug'    => $a ? athlete_slug($a->getAttribute('href')) : '',
                'name'    => $a ? txt($a) : '',
                'image'   => $img ? $img->getAttribute('src') : null,
                'country' => $country ? txt($country) : null,
                'flag'    => ($country && ($fi = $country->getElementsByTagName('img')->item(0))) ? $fi->getAttribute('src') : null,
                'rank'    => $ranks[$i] ?? '',
                'odds'    => $odds[$i] ?? '',
            ];
        };
        $fights[] = [
            'id'          => (int) $f->getAttribute('data-fmid'),
            'card'        => $card,
            'weightClass' => $classText,
            'titleBout'   => stripos($classText, 'title') !== false,
            'a'           => $side('red', 0),
            'b'           => $side('blue', 1),
        ];
    }
    foreach ($fights as $i => &$fi) $fi['order'] = $i + 1;
    unset($fi);

    return [
        'title'    => trim(explode('|', txt(first($x, '//title')))[0]),
        'sections' => array_map(fn($s) => ['key' => $s['key'], 'start' => $s['start']], $sections),
        'fights'   => $fights,
    ];
}

// Eseményoldal → meccsenkénti eredmény: [fightId => [winner: A|B|draw|nc|null, method, round, time]]
function parse_results(string $html): array
{
    $x = dom($html);
    $out = [];
    foreach ($x->query("//div[" . cls('c-listing-fight') . " and @data-fmid]") as $f) {
        $res = function (string $c) use ($x, $f): string {
            return txt(first($x, ".//*[" . cls('c-listing-fight__results--desktop') . "]//*[" . cls('c-listing-fight__result-text') . " and " . cls($c) . "]", $f));
        };
        $outcome = function (string $color) use ($x, $f): string {
            $n = first($x, ".//*[" . cls("c-listing-fight__corner-body--$color") . "]//*[contains(@class, 'c-listing-fight__outcome--')]", $f);
            return $n ? strtolower(txt($n)) : '';
        };
        $red = $outcome('red');
        $blue = $outcome('blue');
        $winner = null;
        if ($red === 'win' && $blue !== 'win') $winner = 'A';
        elseif ($blue === 'win' && $red !== 'win') $winner = 'B';
        elseif ($red === 'draw' && $blue === 'draw') $winner = 'draw';
        elseif ($red !== '' && str_contains($red, 'no contest')) $winner = 'nc';
        $round = $res('round');
        $out[(int) $f->getAttribute('data-fmid')] = [
            'winner' => $winner,
            'method' => $res('method'),
            'round'  => $round !== '' ? (int) $round : null,
            'time'   => $res('time'),
        ];
    }
    return $out;
}

// Az eseménylista (ufc.com/events) közelgő gálái időrendben: [[slug, start (unix), main (unix)]].
// A lista a múltbeli gálákat is tartalmazza: csak a legfeljebb egy napja kezdődötteket adjuk vissza.
function upcoming_events(string $html, int $now): array
{
    $x = dom($html);
    $seen = [];
    foreach ($x->query("//*[@data-main-card-timestamp]") as $n) {
        $card = $n;
        $link = null;
        for ($i = 0; $i < 8 && $card && !$link; $i++) {
            $card = $card->parentNode;
            if ($card instanceof DOMElement) $link = first($x, ".//a[starts-with(@href, '/event/')]", $card);
        }
        if (!$link || !preg_match('~^/event/([^/?#]+)~', $link->getAttribute('href'), $m)) continue;
        $times = array_filter([
            (int) $n->getAttribute('data-early-card-timestamp'),
            (int) $n->getAttribute('data-prelims-card-timestamp'),
            (int) $n->getAttribute('data-main-card-timestamp'),
        ]);
        if (!$times || isset($seen[$m[1]]) || min($times) < $now - 86400) continue;
        $seen[$m[1]] = ['slug' => $m[1], 'start' => min($times), 'main' => (int) $n->getAttribute('data-main-card-timestamp')];
    }
    $list = array_values($seen);
    usort($list, fn($a, $b) => $a['start'] <=> $b['start']);
    return $list;
}

// Versenyzőoldal → adatok és statisztikák
function parse_athlete(string $html, string $s): array
{
    $ax = dom($html);
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
    return $a;
}

// A teljes gála-adat a felületnek (ugyanaz a szerkezet, mint a data/<slug>.json): esemény, meccsek, versenyzők.
function build_event_data(string $slug, string $cache, bool $refresh, ?callable $log = null): array
{
    $log = $log ?? fn($m) => null;
    $url = "https://www.ufc.com/event/$slug";
    $ev = parse_event(fetch_page($url, "$cache/event-$slug.html", $refresh));
    if (!$ev['fights']) throw new RuntimeException("egy meccset sem találtam: $url — változott a UFC.com szerkezete?");

    foreach ($ev['fights'] as &$fi) {
        foreach (['a', 'b'] as $k) {
            $c = &$fi[$k];
            // a kártya képei teljes alakosak (fejtől talpig) — a profiloldal „full body" képe csak derékig ér
            $c['imageBox'] = $c['image'] ? body_box($c['image'], "$cache/card-{$c['slug']}.png", false) : null;
            unset($c);
        }
    }
    unset($fi);

    $athletes = [];
    foreach ($ev['fights'] as $fi) {
        foreach ([$fi['a']['slug'], $fi['b']['slug']] as $s) {
            if ($s === '' || isset($athletes[$s])) continue;
            $log("versenyző: $s");
            // versenyzőadatot naponta elég frissíteni: a gyorsítótár 20 óráig érvényes
            $file = "$cache/athlete-$s.html";
            $fresh = $refresh && (!is_file($file) || filemtime($file) < time() - 20 * 3600);
            $athletes[$s] = parse_athlete(fetch_page("https://www.ufc.com/athlete/$s", $file, $fresh), $s);
        }
    }
    return [
        'event' => [
            'slug'      => $slug,
            'title'     => $ev['title'],
            'url'       => $url,
            'sections'  => $ev['sections'],
            'scrapedAt' => gmdate('c'),
            'source'    => 'UFC.com (hivatalos esemény- és versenyzőoldalak)',
        ],
        'fights'   => $ev['fights'],
        'athletes' => $athletes,
    ];
}
