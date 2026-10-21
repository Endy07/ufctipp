<?php
// ESPN ingyenes UFC-adatfolyama: a UFC.com-meccsek párosítása az ESPN-meccsekkel (az élő zárás és az eredmény
// a Supabase-ben az ESPN-azonosítók alapján megy, lásd supabase/migrate-002-automatizalas.sql: espn_apply).

declare(strict_types=1);

function espn_scoreboard(string $yyyymmdd): ?array
{
    $json = @file_get_contents("https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=$yyyymmdd",
        false, stream_context_create(['http' => ['timeout' => 20]]));
    $data = $json === false ? null : json_decode($json, true);
    return is_array($data) ? $data : null;
}

// Névösszevetéshez: ékezet, aposztróf, kötőjel, szóköz és kis-nagybetű nélkül
function norm_name(string $n): string
{
    $n = mb_strtolower($n, 'UTF-8');
    $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $n);
    if ($t !== false) $n = $t;
    return preg_replace('/[^a-z]/', '', $n);
}

function last_name_key(string $n): string
{
    $p = preg_split('/\s+/', trim($n));
    return norm_name(end($p));
}

// [fightId => ['espn_id' => ..., 'espn_a' => az A (piros) sarok ESPN-azonosítója]]
// Csak egyértelmű párosítást ad vissza (egy rossz párosítás rossz oldalra írná a győztest):
//  1. teljes névvel mindkét oldal;
//  2. a maradék vezetéknévvel — csak ha a két vezetéknév különbözik, és a meccsnek egyetlen jelöltje van,
//     amelyre más meccs nem pályázik. Egy ESPN-meccs legfeljebb egy UFC-meccshez tartozhat.
function espn_match(array $fights, array $espnEvent): array
{
    $comps = [];
    foreach ($espnEvent['competitions'] ?? [] as $c) {
        $p = [];
        foreach ($c['competitors'] ?? [] as $x) $p[] = ['id' => (string) $x['id'], 'name' => $x['athlete']['displayName'] ?? ''];
        if (count($p) === 2) $comps[(string) $c['id']] = $p;
    }
    $out = [];
    $used = [];

    foreach ($fights as $f) {
        foreach ($comps as $cid => $p) {
            if (isset($used[$cid])) continue;
            foreach ([[0, 1], [1, 0]] as [$i, $j]) {
                if (norm_name($p[$i]['name']) === norm_name($f['a']['name']) && norm_name($p[$j]['name']) === norm_name($f['b']['name'])) {
                    $out[$f['id']] = ['espn_id' => (string) $cid, 'espn_a' => $p[$i]['id']];
                    $used[$cid] = true;
                    continue 3;
                }
            }
        }
    }

    $cand = [];   // fightId => [[cid, espn_a]]
    $claims = []; // cid => hány meccs pályázik rá
    foreach ($fights as $f) {
        if (isset($out[$f['id']])) continue;
        $la = last_name_key($f['a']['name']);
        $lb = last_name_key($f['b']['name']);
        if ($la === $lb) continue;
        foreach ($comps as $cid => $p) {
            if (isset($used[$cid])) continue;
            foreach ([[0, 1], [1, 0]] as [$i, $j]) {
                if (last_name_key($p[$i]['name']) === $la && last_name_key($p[$j]['name']) === $lb) {
                    $cand[$f['id']][] = [(string) $cid, $p[$i]['id']];
                    $claims[$cid] = ($claims[$cid] ?? 0) + 1;
                }
            }
        }
    }
    foreach ($cand as $fid => $list) {
        if (count($list) === 1 && $claims[$list[0][0]] === 1) {
            $out[$fid] = ['espn_id' => $list[0][0], 'espn_a' => $list[0][1]];
        }
    }
    return $out;
}

// A gála ESPN-megfelelője: a kezdés napján és a szomszédos napokon keres; az nyer, ahol a legtöbb meccs párosul.
function espn_find_event(array $fights, int $startTs): ?array
{
    $best = null;
    foreach ([0, -1, 1] as $d) {
        $date = gmdate('Ymd', $startTs + $d * 86400);
        $sb = espn_scoreboard($date);
        foreach ($sb['events'] ?? [] as $e) {
            $m = espn_match($fights, $e);
            if (!$best || count($m) > count($best['match'])) $best = ['date' => $date, 'event' => $e, 'match' => $m];
        }
        if ($best && count($best['match']) === count($fights)) break;
    }
    return ($best && count($best['match']) > 0) ? $best : null;
}
