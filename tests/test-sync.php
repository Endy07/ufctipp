<?php
// UfcTipp — a szinkronprogram tesztjei (hálózat nélkül, a tests/fixtures/ fájljaiból).
// Futtatás: php tests/test-sync.php   → a végén „N/N teszt OK”, hibánál kilépési kód 1.

declare(strict_types=1);

require __DIR__ . '/../tools/lib/ufc.php';
require __DIR__ . '/../tools/lib/espn.php';

$fx = __DIR__ . '/fixtures';
$pass = 0;
$fail = 0;

function check(string $name, bool $ok, string $detail = ''): void
{
    global $pass, $fail;
    if ($ok) { $pass++; echo "  ok   $name\n"; }
    else { $fail++; echo "  HIBA $name" . ($detail !== '' ? " — $detail" : '') . "\n"; }
}

function test(string $name, callable $fn): void
{
    try { $fn(); } catch (Throwable $e) { check($name, false, get_class($e) . ': ' . $e->getMessage()); }
}

test('test_parse_event_333', function () use ($fx) {
    $ev = parse_event(file_get_contents("$fx/ufc-333.html"));
    check('test_parse_event_333: 14 meccs', count($ev['fights']) === 14, (string) count($ev['fights']));
    check('test_parse_event_333: 3 szekció', count($ev['sections']) === 3);
    check('test_parse_event_333: fő meccs Volkanovski–Evloev',
        $ev['fights'][0]['a']['slug'] === 'alexander-volkanovski' && $ev['fights'][0]['b']['slug'] === 'movsar-evloev');
    check('test_parse_event_333: címmeccs jelölve', $ev['fights'][0]['titleBout'] === true);
});

test('test_parse_results_past', function () use ($fx) {
    $res = parse_results(file_get_contents("$fx/ufc-332.html"));
    $withWinner = array_filter($res, fn($r) => in_array($r['winner'], ['A', 'B'], true));
    check('test_parse_results_past: van eredmény', count($res) >= 10, (string) count($res));
    check('test_parse_results_past: minden meccsnek van győztese', count($withWinner) === count($res),
        count($withWinner) . '/' . count($res));
    $first = reset($res);
    check('test_parse_results_past: mód és menet', $first['method'] !== '' && $first['round'] !== null);
});

test('test_parse_results_upcoming_empty', function () use ($fx) {
    $res = parse_results(file_get_contents("$fx/ufc-333.html"));
    check('test_parse_results_upcoming_empty: jövőbeli gálán nincs eredmény',
        count(array_filter($res, fn($r) => $r['winner'] !== null)) === 0);
});

test('test_upcoming_events', function () use ($fx) {
    $list = upcoming_events(file_get_contents("$fx/ufc-events.html"), strtotime("2026-10-21T00:00:00Z"));
    check('test_upcoming_events: első a UFC 333', ($list[0]['slug'] ?? '') === 'ufc-333', json_encode($list[0] ?? null));
    check('test_upcoming_events: időbélyeg', ($list[0]['start'] ?? 0) === 1792850400);
    check('test_upcoming_events: van Fight Night', (bool) array_filter($list, fn($e) => str_starts_with($e['slug'], 'ufc-fight-night')));
    check('test_upcoming_events: típus', event_kind('ufc-333') === 'numbered' && event_kind('ufc-fight-night-october-31-2026') === 'fightnight');
});

test('test_norm_name', function () {
    check('test_norm_name: aposztróf', norm_name('Lone’er Kavanagh') === norm_name("Lone'er Kavanagh"));
    check('test_norm_name: kötőjel/szóköz', norm_name('Abdul-Rakhman Yakhyaev') === norm_name('Abdul Rakhman Yakhyaev')
        && norm_name('Abdul Rakhman Yakhyaev') === norm_name('Abdulrakhman Yakhyaev'));
    check('test_norm_name: ékezet', norm_name('Cristian Pérez') === norm_name('Cristian Perez'));
});

test('test_espn_match_333', function () use ($fx) {
    $ev = parse_event(file_get_contents("$fx/ufc-333.html"));
    $espn = json_decode(file_get_contents("$fx/espn-20261024.json"), true);
    $m = espn_match($ev['fights'], $espn['events'][0]);
    check('test_espn_match_333: mind a 14 párosul', count($m) === 14, (string) count($m));
    $kav = array_values(array_filter($ev['fights'], fn($f) => $f['a']['slug'] === 'loneer-kavanagh'))[0];
    check('test_espn_match_swapped_corners: Kavanagh az A oldal az ESPN-ben is',
        ($m[$kav['id']]['espn_a'] ?? '') === '5147737', json_encode($m[$kav['id']] ?? null));
    check('test_espn_match_333: fő meccs ESPN-id', ($m[13063]['espn_id'] ?? '') === '401911632');
});

function fake_fight(int $id, string $a, string $b): array
{
    return ['id' => $id, 'a' => ['name' => $a], 'b' => ['name' => $b]];
}

function fake_comp(string $id, array $people): array
{
    return ['id' => $id, 'competitors' => array_map(fn($p) => ['id' => $p[0], 'athlete' => ['displayName' => $p[1]]], $people)];
}

test('test_espn_match_same_surname', function () {
    // azonos vezetéknév mindkét oldalon, az ESPN fordított sorrendben: a teljes név dönt
    $m = espn_match([fake_fight(1, 'Ana Silva', 'Bia Silva')],
        ['competitions' => [fake_comp('c1', [['b', 'Bia Silva'], ['a', 'Ana Silva']])]]);
    check('test_espn_match_same_surname: teljes névvel jó oldal', ($m[1]['espn_a'] ?? '') === 'a', json_encode($m));
    // csak vezetéknév egyezik, és az is azonos a két oldalon → nem egyértelmű, nincs párosítás
    $m = espn_match([fake_fight(1, 'Ana Silva', 'Bia Silva')],
        ['competitions' => [fake_comp('c1', [['b', 'Beatriz Silva'], ['a', 'Anna Silva']])]]);
    check('test_espn_match_same_surname: kétértelműnél nincs párosítás', !isset($m[1]), json_encode($m));
});

test('test_espn_match_two_bouts_same_surnames', function () {
    $fights = [fake_fight(1, 'Joao Silva', 'Rui Santos'), fake_fight(2, 'Pedro Silva', 'Leo Santos')];
    $ev = ['competitions' => [
        fake_comp('c1', [['p', 'Pedro Silva'], ['l', 'Leo Santos']]),
        fake_comp('c2', [['j', 'João Silva'], ['r', 'Rui Santos']]),
    ]];
    $m = espn_match($fights, $ev);
    check('test_espn_match_two_bouts_same_surnames: 1 → c2', ($m[1]['espn_id'] ?? '') === 'c2', json_encode($m));
    check('test_espn_match_two_bouts_same_surnames: 2 → c1', ($m[2]['espn_id'] ?? '') === 'c1', json_encode($m));
});

test('test_espn_match_no_double_use', function () {
    // két UFC-meccs ugyanarra az ESPN-meccsre mutatna vezetéknév alapján → egyik sem kapja meg
    $fights = [fake_fight(1, 'Joao Silva', 'Rui Santos'), fake_fight(2, 'Pedro Silva', 'Leo Santos')];
    $m = espn_match($fights, ['competitions' => [fake_comp('c1', [['x', 'Marco Silva'], ['y', 'Tiago Santos']])]]);
    check('test_espn_match_no_double_use: kétértelmű vezetéknév-párosítás elutasítva', count($m) === 0, json_encode($m));
});

echo "\n" . $pass . '/' . ($pass + $fail) . " teszt OK\n";
exit($fail ? 1 : 0);
