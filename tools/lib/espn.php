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
// Csak egyértelmű párosítást ad vissza: mindkét versenyző egyezzen (teljes névvel vagy vezetéknévvel).
function espn_match(array $fights, array $espnEvent): array
{
    $out = [];
    foreach ($fights as $f) {
        $a = $f['a']['name'];
        $b = $f['b']['name'];
        foreach ($espnEvent['competitions'] ?? [] as $c) {
            $comp = [];
            foreach ($c['competitors'] ?? [] as $x) $comp[] = ['id' => (string) $x['id'], 'name' => $x['athlete']['displayName'] ?? ''];
            if (count($comp) !== 2) continue;
            foreach ([[0, 1], [1, 0]] as [$i, $j]) {
                $full = norm_name($comp[$i]['name']) === norm_name($a) && norm_name($comp[$j]['name']) === norm_name($b);
                $last = last_name_key($comp[$i]['name']) === last_name_key($a) && last_name_key($comp[$j]['name']) === last_name_key($b);
                if ($full || $last) {
                    $out[$f['id']] = ['espn_id' => (string) $c['id'], 'espn_a' => $comp[$i]['id']];
                    break 2;
                }
            }
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
