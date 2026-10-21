<?php
// UfcTipp szinkron: UFC.com (+ ESPN-párosítás) → Supabase. A felhasználó gépén fut (Feladatütemező / sync.cmd).
//
//   php tools/sync.php auto [--force]   az ütemező ezt hívja; az időponthoz illően dönt (lásd cmd_auto)
//   php tools/sync.php discover         a következő gála felvétele
//   php tools/sync.php card [slug]      a kártya újraolvasása, változások bevezetése (beugró, elmaradt meccs, sorrend)
//   php tools/sync.php details [slug]   a lement meccsek módja / menete / ideje a UFC.com-ról
//   --dry                               nem ír a Supabase-be, csak kiírja, mit küldene
//
// Beállítás: tools/sync.local.json (minta: sync.local.example.json) — az admin-PIN csak itt van, nincs verziókövetve.
// Az élő zárást és a győztest NEM ez rögzíti, hanem a Supabase percenként (espn_tick), így alvó gép mellett is megy.

declare(strict_types=1);

require __DIR__ . '/lib/ufc.php';
require __DIR__ . '/lib/espn.php';

const CACHE = __DIR__ . '/cache';
const LOGS = __DIR__ . '/logs';
const STATE = __DIR__ . '/state.json';

$args = array_slice($argv, 1);
$dry = in_array('--dry', $args, true);
$force = in_array('--force', $args, true);
$pos = array_values(array_filter($args, fn($a) => !str_starts_with($a, '--')));
$mode = $pos[0] ?? 'auto';

foreach ([CACHE, LOGS] as $d) if (!is_dir($d)) mkdir($d, 0777, true);
date_default_timezone_set('Europe/Budapest');

function logmsg(string $m): void
{
    $line = date('Y-m-d H:i:s') . "  $m";
    echo $line . "\n";
    file_put_contents(LOGS . '/sync-' . date('Y-m-d') . '.log', $line . "\n", FILE_APPEND);
}

function config(): array
{
    $file = __DIR__ . '/sync.local.json';
    $c = is_file($file) ? json_decode(file_get_contents($file), true) : null;
    if (!is_array($c) || empty($c['supabaseUrl']) || empty($c['supabaseKey']) || empty($c['adminPin'])) {
        throw new RuntimeException('hiányzik vagy hiányos a tools/sync.local.json (minta: tools/sync.local.example.json)');
    }
    return $c;
}

function rpc(string $fn, array $args): array
{
    $c = config();
    $headers = "apikey: {$c['supabaseKey']}\r\nContent-Type: application/json\r\n";
    if (!str_starts_with($c['supabaseKey'], 'sb_')) $headers .= "Authorization: Bearer {$c['supabaseKey']}\r\n";
    $body = @file_get_contents(rtrim($c['supabaseUrl'], '/') . "/rest/v1/rpc/$fn", false, stream_context_create(['http' => [
        'method' => 'POST', 'header' => $headers, 'content' => json_encode($args), 'timeout' => 60, 'ignore_errors' => true,
    ]]));
    $data = $body === false ? null : json_decode($body, true);
    if (!is_array($data)) throw new RuntimeException("$fn: nincs válasz a Supabase-től");
    if (isset($data['error'])) throw new RuntimeException("$fn: {$data['error']}");
    if (isset($data['message']) && isset($data['code'])) throw new RuntimeException("$fn: {$data['message']}");
    return $data;
}

function state(): array
{
    return is_file(STATE) ? (json_decode(file_get_contents(STATE), true) ?: []) : [];
}

function save_state(array $s): void
{
    file_put_contents(STATE, json_encode($s, JSON_PRETTY_PRINT));
}

// A UFC.com módszer-szövege a felület (admin-lista) magyar elnevezéseivel
function method_hu(string $m): string
{
    $t = strtolower($m);
    return match (true) {
        str_contains($t, 'ko') => 'KO/TKO',
        str_contains($t, 'sub') => 'Feladás',
        str_contains($t, 'unanimous') => 'Pontozás (egyhangú)',
        str_contains($t, 'split') => 'Pontozás (megosztott)',
        str_contains($t, 'majority') => 'Pontozás (többségi)',
        str_contains($t, 'decision') => 'Pontozás',
        str_contains($t, 'dq') => 'Kizárás',
        default => $m,
    };
}

function cmd_card(string $slug, bool $dry): void
{
    logmsg("kártya: $slug");
    $data = build_event_data($slug, CACHE, true, fn($m) => null);
    $starts = array_filter(array_column($data['event']['sections'], 'start'));
    $start = $starts ? min($starts) : time();

    $espn = espn_find_event($data['fights'], $start);
    $match = $espn['match'] ?? [];
    logmsg(sprintf('ESPN: %s, párosítva %d/%d meccs', $espn ? $espn['event']['name'] : 'nincs találat', count($match), count($data['fights'])));

    $startOf = [];
    foreach ($data['event']['sections'] as $s) $startOf[$s['key']] = $s['start'];
    $opener = [];
    foreach ($data['fights'] as $f) $opener[$f['card']] = $f['id']; // a szekció utoljára listázott meccse nyit
    $fights = [];
    foreach ($data['fights'] as $f) {
        $fights[] = [
            'id'         => $f['id'],
            'ord'        => $f['order'],
            'card'       => $f['card'],
            'title_bout' => $f['titleBout'],
            'a_slug'     => $f['a']['slug'],
            'b_slug'     => $f['b']['slug'],
            'espn_id'    => $match[$f['id']]['espn_id'] ?? null,
            'espn_a'     => $match[$f['id']]['espn_a'] ?? null,
            'lock_at'    => ($opener[$f['card']] === $f['id'] && !empty($startOf[$f['card']])) ? gmdate('c', $startOf[$f['card']]) : null,
        ];
    }
    $payload = [
        'event' => [
            'slug' => $slug, 'title' => $data['event']['title'], 'kind' => event_kind($slug),
            'starts_at' => gmdate('c', $start),
            'espn_event_id' => $espn ? (string) $espn['event']['id'] : null,
            'espn_date' => $espn['date'] ?? null,
            // a naplóba (admin oldal): hány meccs párosult az ESPN-nel — a nem párosultat az automata nem zárja
            'espn_matched' => count($match),
            'fight_count' => count($data['fights']),
        ],
        'data' => $data,
        'fights' => $fights,
    ];
    if ($dry) {
        echo json_encode(['event' => $payload['event'], 'fights' => $fights], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
        // a teljes küldemény SQL-ként is: a Supabase SQL-szerkesztőjében PIN nélkül lefuttatható (első feltöltés, hibakeresés)
        $sql = 'select sync_event_apply($ufctipp$' . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '$ufctipp$::jsonb);';
        file_put_contents(CACHE . "/sync-$slug.sql", $sql);
        logmsg('SQL-változat: tools/cache/sync-' . $slug . '.sql');
        return;
    }
    $r = rpc('sync_event', ['p_pin' => config()['adminPin'], 'p_payload' => $payload]);
    logmsg('változások: ' . json_encode($r));
}

function cmd_details(string $slug, bool $dry): void
{
    $res = parse_results(fetch_page("https://www.ufc.com/event/$slug", CACHE . "/event-$slug.html", true));
    $rows = [];
    foreach ($res as $id => $r) {
        if ($r['winner'] === null || $r['method'] === '') continue;
        // a győztes is megy: a Supabase ellenőrzi az automata (ESPN) eredménnyel, eltérésnél visszavonja
        $rows[] = ['id' => $id, 'winner' => $r['winner'], 'method' => method_hu($r['method']), 'round' => $r['round'], 'time' => $r['time']];
    }
    logmsg("részletek: $slug, " . count($rows) . ' lement meccs a UFC.com-on');
    if ($dry || !$rows) return;
    $r = rpc('sync_details', ['p_pin' => config()['adminPin'], 'p_rows' => $rows]);
    logmsg('részletek frissítve: ' . json_encode($r));
}

function cmd_discover(): ?string
{
    $list = upcoming_events(fetch_page('https://www.ufc.com/events', CACHE . '/events.html', true), time());
    if (!$list) {
        logmsg('nincs kiírt következő gála');
        return null;
    }
    logmsg('következő gála: ' . $list[0]['slug'] . ' (' . date('Y-m-d H:i', $list[0]['start']) . ')');
    return $list[0]['slug'];
}

// Az ütemező 5 percenként hívja. Naponta egyszer felvétel + kártya; a gála előtti napon óránként, az utolsó
// 2 órában és a gála alatt 10 percenként kártya; a gála alatt 5 percenként a részletek.
function cmd_auto(bool $force, bool $dry): void
{
    $st = state();
    $now = time();
    if ($force || $now - ($st['daily'] ?? 0) > 20 * 3600) {
        $slug = cmd_discover();
        if ($slug) {
            cmd_card($slug, $dry);
            $st['card'][$slug] = $now;
        }
        $st['daily'] = $now;
        save_state($st);
    }

    $ev = rpc('get_event', []);
    if (empty($ev['slug']) || empty($ev['starts_at'])) return;
    $slug = $ev['slug'];
    $start = strtotime($ev['starts_at']);

    if ($now >= $start - 24 * 3600 && $now <= $start + 14 * 3600) {
        $every = ($now >= $start - 2 * 3600) ? 600 : 3600;
        if ($force || $now - ($st['card'][$slug] ?? 0) >= $every) {
            cmd_card($slug, $dry);
            $st['card'][$slug] = $now;
            save_state($st);
        }
    }
    if ($now >= $start - 1800 && $now <= $start + 14 * 3600) {
        if ($force || $now - ($st['details'][$slug] ?? 0) >= 300) {
            cmd_details($slug, $dry);
            $st['details'][$slug] = $now;
            save_state($st);
        }
    }
}

try {
    switch ($mode) {
        case 'discover':
            $slug = cmd_discover();
            if ($slug) cmd_card($slug, $dry);
            break;
        case 'card':
            cmd_card($pos[1] ?? (rpc('get_event', [])['slug'] ?? 'ufc-333'), $dry);
            break;
        case 'details':
            cmd_details($pos[1] ?? (rpc('get_event', [])['slug'] ?? 'ufc-333'), $dry);
            break;
        case 'auto':
            cmd_auto($force, $dry);
            break;
        default:
            fwrite(STDERR, "ismeretlen mód: $mode (auto | discover | card | details)\n");
            exit(2);
    }
} catch (Throwable $e) {
    logmsg('HIBA: ' . $e->getMessage());
    exit(1);
}
