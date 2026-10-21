# UfcTipp automatizálás — megvalósítási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gála felvétele, a kártyaváltozások, a zárás és az eredmény rögzítése emberi beavatkozás nélkül történjen.

**Architecture:** A gépen futó `tools/sync.php` olvassa a UFC.com-ot (és az ESPN-t a párosításhoz), és admin-PIN-es RPC-ken át tölti fel a gálát a Supabase-be. Az élő rész (zárás, győztes) a Supabase-ben fut: `pg_cron` percenként, `pg_net` kéri le az ESPN JSON-t, a `espn_apply(jsonb)` alkalmazza. A felület a gálát az adatbázisból olvassa.

**Tech Stack:** PHP 8 (XAMPP, függőség nélkül), Supabase Postgres (pg_cron, pg_net, pgcrypto), vanilla JS.

**Spec:** `docs/2026-10-21-automatizalas-terv.md`

## Global Constraints
- Anti-cél: hibás eredményt nem rögzít. Automata eredmény csak akkor, ha ESPN `status.type.completed = true` és **pontosan egy** versenyzőnél `winner = true`; különben semmi (az admin dönt).
- Kézi döntést nem ír felül: `result_source = 'manual'` eredményt soha; kézzel zárt meccset nem nyit újra.
- Migráció csak bővítő; a meglévő `players` / `picks` sorok megmaradnak.
- Titok nincs a repóban: az admin-PIN a `tools/sync.local.json`-ban (gitignore), a felhasználó írja be.
- Versenyzőcsere → a meccs tippjei törlődnek, `changed = true`; elmaradt meccs (még nincs eredménye) → törlés tippekkel; csak sorrend/szekció változás → tippek maradnak.
- Mások tippjei és a megoszlás csak `status = 'done'`-nál látszanak (már kész, meg kell őrizni).
- Gálatípus: `numbered`, ha a slug `^ufc-\d+$`, különben `fightnight`.
- A demó mód (`?demo`) tovább működik a `data/ufc-333.json`-ból.

## Review Focus
- A UFC.com és az ESPN sarka eltér (pl. UFC: Kavanagh piros, ESPN: Temirov az első) → a győztest névpárosítással kell az A/B oldalra fordítani, nem sorrend szerint. Teszt: Task 2 `test_espn_match_swapped_corners`.
- Ugyanaz a UFC.com fight-id, de más versenyző (beugró) → csere, nem új meccs. Teszt: Task 1 SQL-teszt „swap”.
- Lezárt (de még nem kész) meccsnél nyitásra semmi nem nyit újra; ESPN `in` → zárás akkor is, ha `lock_at` jövőbeli. Teszt: Task 1 „espn in locks”.
- Döntetlen / NC (ESPN `completed`, nincs winner) → nem rögzít. Teszt: Task 1 „no winner no result”.
- Egy már kész meccs eltűnik a UFC.com kártyáról (utólag) → nem töröljük. Teszt: Task 1 „done fight survives removal”.

---

### Task 1: Adatbázis-bővítés + szinkron- és ESPN-függvények

**Files:**
- Create: `supabase/migrate-002-automatizalas.sql`
- Create: `supabase/test-002.sql` (önellenőrző teszt: `teszt-` slugú gálán fut, a végén takarít; hibánál `raise exception`)
- Modify: `supabase/schema.sql` (a migráció tartalma is bekerül, hogy friss telepítésnél is meglegyen)

**Interfaces — Produces:**
- `events(slug text pk, title text, kind text check in ('numbered','fightnight'), starts_at timestamptz, data jsonb, espn_event_id text, espn_date text, last_sync_at timestamptz, sync_note text)`
- `fights` új oszlopai: `a_slug text, b_slug text, espn_id text, espn_a text, changed boolean default false, lock_source text, result_source text`
- `sync_event(p_pin text, p_payload jsonb) returns json` — payload: `{event:{slug,title,kind,starts_at,espn_event_id,espn_date}, data:{…a mai data/*.json szerkezete…}, fights:[{id,ord,card,title_bout,a_slug,b_slug,espn_id,espn_a,lock_at}]}`; visszaad: `{added:[],removed:[],swapped:[],moved:[]}` (fight-id-k).
- `sync_details(p_pin text, p_rows jsonb) returns json` — `[{id,method,round,time}]`; csak `result_source='auto'` meccsen tölt.
- `espn_apply(p_json jsonb) returns json` — egy ESPN scoreboard-választ alkalmaz (anon nem hívhatja); visszaad `{locked:[],decided:[]}`.
- `espn_tick() returns void` — pg_cron hívja percenként: az előző `net._http_response` feldolgozása (`espn_apply`), majd új `net.http_get` a következő/zajló gála `espn_date`-jére (csak ha van gála `starts_at - 12h … starts_at + 14h` között). A kérés-id a `settings('espn_req')`-ben.
- `get_event(p_slug text default null) returns json` — az aktuális gála: a legkorábbi, amelynek `starts_at > now() - interval '1 day'`; ha nincs, a legutóbbi. `{slug,title,kind,starts_at,data,last_sync_at,sync_note}`.
- `get_overall(p_kind text default null) returns json` — összesített ranglista (minden gála vagy csak a típus).
- `get_board` kiegészül: fightonként `changed`; `admin_set_fight` beírja: `lock_source='manual'` zárásnál, `result_source='manual'` eredménynél.
- Zárási szabály `espn_apply`-ban: ESPN `state in ('in','post')` → `status='locked', lock_source='auto'` ha `status='open'`; továbbá ha egy meccs `done` lett, a futási sorrendben következő (`ord = kész.ord - 1`, ugyanazon gálán) is zár.
- Módszer az ESPN-ből: a `details[].type.text` „Unofficial Winner X”: `Kotko`→`KO/TKO`, `Submission`→`Feladás`, `Decision`→`Pontozás`; menet = `status.period`, idő = `status.displayClock`.

- [ ] **Step 1:** Írd meg a `test-002.sql`-t: felvesz egy `teszt-gala` eseményt két meccsel (id 990001, 990002), két játékossal és tippekkel, majd sorban ellenőrzi: (a) `sync_event` újra azonos adattal → üres változáslista; (b) 990001 `b_slug` csere → `swapped=[990001]`, tippjei törölve, `changed=true`; (c) 990002 kimarad a payloadból → `removed=[990002]`; (d) `espn_apply` `state='in'` → 990001 `locked`; (e) `completed`, egy winner → `done`, győztes oldal a `espn_a` alapján; (f) `completed`, nincs winner → marad `locked`; (g) kézi `admin_set_fight(...,'done','B')` után `espn_apply` A-győzelemmel → marad `B`; (h) egy `done` meccs kimarad a payloadból → nem törlődik. A végén törli a `teszt-` adatokat.
- [ ] **Step 2:** Futtasd a Supabase SQL-szerkesztőben a migráció NÉLKÜL → hibával áll meg (nincs `sync_event`).
- [ ] **Step 3:** Írd meg a `migrate-002-automatizalas.sql`-t a fenti interfészekkel; `create extension if not exists pg_cron; create extension if not exists pg_net;`; a `ufc-333` sor felvétele az `events`-be (a `data` később a sync-ből jön); a cron: `select cron.schedule('ufctipp-espn', '* * * * *', 'select espn_tick()')`. A `revoke`/`grant` minta a mai `schema.sql` szerint (anon: `get_event`, `get_overall`, `sync_event`, `sync_details`; nem: `espn_apply`, `espn_tick`).
- [ ] **Step 4:** Futtasd a migrációt, majd a `test-002.sql`-t → „OK” sor, kivétel nélkül; `select count(*) from players` változatlan.
- [ ] **Step 5:** Commit.

### Task 2: `tools/sync.php` — UFC.com + ESPN → Supabase

**Files:**
- Create: `tools/lib/ufc.php` (a `scrape-ufc.php` függvényei: `fetch_page`, `dom`, `parse_event(string $html): array`, `parse_athlete(string $html, string $slug): array`, `body_box`, `parse_results(string $html): array` → `[fightId => ['winner'=>'A'|'B'|null,'method','round','time']]`, `upcoming_events(string $eventsHtml): array` → `[['slug','url']]`)
- Create: `tools/lib/espn.php` (`espn_scoreboard(string $yyyymmdd): ?array`, `espn_match(array $fights, array $espnEvent): array` → `[fightId => ['espn_id','espn_a']]`, `norm_name(string): string`)
- Create: `tools/sync.php` (módok: `discover`, `card [slug]`, `details`, `auto`; `--dry` csak kiírja a payloadot)
- Create: `tools/sync.cmd` (dupla kattra `php tools\sync.php auto --force` és `pause`)
- Create: `tools/sync.local.example.json` (`{"supabaseUrl":"","supabaseKey":"","adminPin":""}`); `.gitignore`: `tools/sync.local.json`, `tools/logs/`, `tools/state.json`
- Modify: `tools/scrape-ufc.php` → vékony burok a `lib/ufc.php` köré (a demó JSON-hoz)
- Test: `tests/test-sync.php` (fixture-ök: `tests/fixtures/ufc-332.html`, `tests/fixtures/ufc-333.html`, `tests/fixtures/espn-20261024.json`, `tests/fixtures/espn-20261017.json`)

**Interfaces — Consumes:** Task 1 `sync_event`, `sync_details` payloadjai.

- [ ] **Step 1:** Teszt: `test_parse_results_past` — a `ufc-332.html`-ből minden meccsnél van `winner` és `method`; `test_parse_event_333` — 14 meccs, 3 szekció; `test_espn_match_swapped_corners` — UFC 333-nál a Kavanagh–Temirov meccs `espn_a` = Kavanagh ESPN-id-je (5147737); `test_norm_name` — `Lone’er` = `Lone'er`, `Abdul-Rakhman` = `Abdul Rakhman` = `Abdulrakhman`; mind a 14 UFC 333 meccs párosul.
- [ ] **Step 2:** `php tests/test-sync.php` → FAIL (nincs lib).
- [ ] **Step 3:** Valósítsd meg a libeket. Párosítás: a két versenyző `norm_name`-jének halmaza egyezzen; ha nem, vezetéknév-egyezés mindkét oldalon. `auto` ütemezés a `tools/state.json` alapján: `discover`+`card` ha az utolsó >20 órája volt; a gála `starts_at`-ja előtti 24 órában `card` óránként, az előtti 2 órában 10 percenként; `starts_at - 30 perc … + 14 óra` között `details` 5 percenként. Napló: `tools/logs/sync-ÉÉÉÉ-HH-NN.log`.
- [ ] **Step 4:** `php tests/test-sync.php` → PASS; `php tools/sync.php card ufc-333 --dry` → 14 meccs, mind `espn_id`-vel.
- [ ] **Step 5:** Commit.

### Task 3: Felület az adatbázisból + csere-jelzés + ranglisták + szinkronállapot

**Files:**
- Modify: `js/api.js` (`event()`, `overall(kind)`; demóban a statikus JSON és helyi számolás)
- Modify: `js/app.js` (indulás: `api.event()`; nincs gála → „A következő gála még nincs kiírva.”; `changed` meccsen „Megváltozott — tippelj újra!” jelvény, a nudge-ban is; ranglista: „Ez a gála” / „Összesített” fül, összesítettben Mind / Számozott / Fight Night chip; admin: utolsó szinkron ideje + `sync_note`; a fejléc címe a gálából)
- Modify: `css/app.css`, `index.html` (`?v=4`)

- [ ] **Step 1:** Demó módban (`?demo`): a kártya betölt, a `changed` jelzés megjelenik egy kézzel beállított meccsen, a fülek váltanak — Playwright-ellenőrzés (képernyőkép 430 px széles).
- [ ] **Step 2:** Éles módban: `get_event` adja a UFC 333-at, a játékosok és tippek megvannak (a meglévő „Endy” tippje látszik nála).
- [ ] **Step 3:** Commit + push (a felhasználó már jóváhagyta a GitHub Pages-frissítéseket ebben a projektben).

### Task 4: Élesítés a gépen + teljes visszajátszásos teszt

- [ ] **Step 1:** A felhasználó kitölti a `tools/sync.local.json`-t (admin-PIN); `php tools/sync.php card ufc-333` → a Supabase-ben az `events.data` és a meccsek `espn_id`-je kitöltve.
- [ ] **Step 2:** Visszajátszás: `espn_apply` a `espn-20261017.json`-nal egy ideiglenes `teszt-fn` gálán (a sync `card`-dal felvéve a múlt heti Fight Nightból) → minden meccs `done`, helyes győztessel; utána takarítás.
- [ ] **Step 3:** A felhasználó igenjével: Windows Feladatütemező feladat „UfcTipp szinkron”, 5 percenként `php tools\sync.php auto`, „Futtatás, ha a gép felébred” bekapcsolva.
- [ ] **Step 4:** README: az automata működése, kézi indítás, napló helye; PROJEKT-KONTEXTUS frissítés; commit + push.
