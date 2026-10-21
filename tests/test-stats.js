// node tests/test-stats.js — a js/stats.js számításai kézzel kiszámolt példán.
const assert = require('assert');
const S = require('../js/stats.js');

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('ok  ' + name); };

const fight = (id, ord, o) => ({
  id, ord, card: 'main', title_bout: !!o.title, points: o.title ? 2 : 1, status: o.status || 'done', winner: o.winner ?? null,
  weight: o.weight || 'Lightweight Bout',
  a: { name: o.an || 'Aaa Alfa', odds: o.oa ?? '-200' }, b: { name: o.bn || 'Bbb Beta', odds: o.ob ?? '+170' },
  picks: o.status === 'open' ? null : (o.picks || []),
});
const P = (nick, side) => ({ nick, side });

// 1. gála (régebbi, 2026-03): négy meccs; ord 4 = az első (alulról), ord 1 = a főmeccs
const e1 = {
  slug: 'e1', title: 'UFC 1', kind: 'numbered', starts_at: '2026-03-07T22:00:00Z',
  fights: [
    fight(1, 1, { title: true, winner: 'B', weight: 'Heavyweight Title Bout', picks: [P('Anna', 'A'), P('Bela', 'B'), P('Cili', 'B')] }), // az esélytelen nyer, 2 pont
    fight(2, 2, { winner: 'A', picks: [P('Anna', 'A'), P('Bela', 'A'), P('Cili', 'B')] }),
    fight(3, 3, { winner: 'A', picks: [P('Anna', 'A'), P('Bela', 'B'), P('Cili', 'B')] }),
    fight(4, 4, { winner: 'draw', picks: [P('Anna', 'A'), P('Bela', 'A')] }),
  ],
};
// 2. gála (újabb, 2026-09): három meccs, az utolsó még nyitott → nem teljes
const e2 = {
  slug: 'e2', title: 'UFC Fight Night 2', kind: 'fightnight', starts_at: '2026-09-12T19:00:00Z',
  fights: [
    fight(11, 1, { winner: 'A', picks: [P('Anna', 'B'), P('Bela', 'A'), P('Cili', 'A')] }),
    fight(12, 2, { winner: 'B', picks: [P('Anna', 'B'), P('Bela', 'A')] }),
    fight(13, 3, { status: 'open' }),
  ],
};
const h = { events: [e2, e1] }; // a szerver újabb-elöl adja; a számítás nem függ a sorrendtől

t('impliedPct és favorit', () => {
  assert.strictEqual(Math.round(S.impliedPct('-200')), 67);
  assert.strictEqual(Math.round(S.impliedPct('+170')), 37);
  assert.strictEqual(S.impliedPct(''), null);
  assert.strictEqual(S.favoriteSide(e1.fights[0]), 'A');
  assert.strictEqual(S.favoriteSide(fight(9, 1, { oa: '-110', ob: '-110' })), null);
});

t('gála-ranglista: pont, találat, holtverseny', () => {
  const tab = S.eventTable(e1);
  const by = Object.fromEntries(tab.map((r) => [r.nick, r]));
  // Anna: 2. és 3. meccs talált = 2 pont, a címmeccsen nem; Bela: címmeccs (2) + 2. meccs (1) = 3; Cili: címmeccs (2)
  assert.deepStrictEqual([by.Anna.points, by.Anna.correct, by.Anna.decided], [2, 2, 3]);
  assert.deepStrictEqual([by.Bela.points, by.Bela.correct, by.Bela.decided], [3, 2, 3]);
  assert.deepStrictEqual([by.Cili.points, by.Cili.correct, by.Cili.decided], [2, 1, 3]);
  assert.deepStrictEqual(tab.map((r) => r.nick + r.place), ['Bela1', 'Anna2', 'Cili2'].map((x) => x));
  assert.strictEqual(by.Anna.picks, 4); // a döntetlenre adott tipp is „tipp", de nem eldőlt
});

t('győztes és befejezettség', () => {
  assert.deepStrictEqual(S.eventWinners(e1), { complete: true, nicks: ['Bela'], points: 3 });
  assert.strictEqual(S.eventWinners(e2).complete, false);
});

t('trófeák: csak befejezett gála számít', () => {
  const tr = S.trophies(h);
  assert.deepStrictEqual(tr.table, [{ nick: 'Bela', n: 1 }]);
  assert.strictEqual(tr.events[0].slug, 'e2'); // újabb elöl
});

t('szezon: évenként összegez', () => {
  const s = S.season(h);
  assert.deepStrictEqual(Object.keys(s), ['2026']);
  const bela = s['2026'].find((r) => r.nick === 'Bela');
  assert.strictEqual(bela.points, 3 + 1); // e1: 3, e2: 11. meccs talált (1), 12. nem
  assert.strictEqual(bela.events, 2);
});

t('játékos: százalék, favorit / esélytelen, címmeccs', () => {
  const a = S.playerStats(h, 'anna');
  // eldőlt meccsek: 1(B nyert),2,3 (e1), 11,12 (e2) → Anna tippjei: A✗, A✓, A✓, B✗, B✓ = 3/5
  assert.deepStrictEqual([a.picks, a.hits, a.misses, a.pct, a.points], [5, 3, 2, 60, 3]);
  assert.deepStrictEqual(a.title, { picks: 1, hits: 0 });
  // favorit az A (-200); Anna A-ra: 1,2,3 (favorit, 2 talált), B-re: 11 és 12 (esélytelen, 1 talált)
  assert.deepStrictEqual(a.fav, { picks: 3, hits: 2 });
  assert.deepStrictEqual(a.dog, { picks: 2, hits: 1 });
  assert.strictEqual(a.favShare, 60);
});

t('széria: időrend szerint, a kihagyott meccs nem szakít', () => {
  const a = S.playerStats(h, 'Anna');
  // időrend: e1 ord4 (draw, kihagyva), ord3 ✓, ord2 ✓, ord1 ✗, e2 ord2 (12.) ✓, ord1 (11.) ✗ ... pontosabban:
  // e1: 3✓ 2✓ 1✗ ; e2: 12 ✓? (12: Anna B, nyert B → ✓), 11 ✗ (Anna B, nyert A)
  assert.strictEqual(a.streak.bestWin, 2);
  assert.strictEqual(a.streak.current.type, 'loss');
  assert.strictEqual(a.streak.current.n, 1);
  assert.deepStrictEqual(a.recent, ['h', 'h', 'm', 'h', 'm']);
});

t('tömeg ellen: legalább 3 tippelőnél', () => {
  // e1/2. meccs: A2 B1 → a többség A (nyert); Cili ellene tippelt (✗)
  const c = S.playerStats(h, 'Cili');
  assert.strictEqual(c.againstCrowd.picks >= 1, true);
  assert.deepStrictEqual(S.crowd(e1.fights[1]), { a: 2, b: 1, total: 3, majority: 'A', crowdWrong: false, minority: 'B' });
  assert.strictEqual(S.crowd(e1.fights[0]).crowdWrong, false); // 1–2, a többség (B) nyert
  assert.strictEqual(S.crowd(fight(9, 1, { winner: 'B', picks: [P('x', 'A'), P('y', 'A'), P('z', 'B')] })).crowdWrong, true);
  assert.strictEqual(S.crowd(fight(9, 1, { winner: 'B', picks: [P('x', 'A'), P('y', 'A')] })).crowdWrong, false); // kevés tippelő
});

t('súlycsoport és kedvenc versenyző', () => {
  const b = S.playerStats(h, 'Bela');
  const w = Object.fromEntries(b.weight.map((x) => [x.name, x]));
  assert.deepStrictEqual([w.Lightweight.picks, w.Lightweight.hits], [4, 2]);
  assert.deepStrictEqual([w.Heavyweight.picks, w.Heavyweight.hits], [1, 1]);
  // csak a Lightweight éri el a 3 tippet → az a „legjobb", leggyengébb nincs
  assert.strictEqual(b.bestWeight.name, 'Lightweight');
  assert.strictEqual(b.worstWeight, null);
});

t('fej-fej mellett', () => {
  const r = S.headToHead(h, 'Anna', 'Bela');
  // közös eldőlt meccsek: 1,2,3,11,12 → mindkettő tippelt mindegyikre
  assert.strictEqual(r.common, 5);
  assert.strictEqual(r.bothHit + r.onlyA + r.onlyB + r.bothMiss, 5);
  assert.strictEqual(r.pointsA, 3);
  assert.strictEqual(r.pointsB, 4);
  // e1: Bela 3 – Anna 2; e2: 1 – 1 (döntetlen)
  assert.deepStrictEqual([r.eventsA, r.eventsB, r.eventsTie], [0, 1, 1]);
});

t('díjak: kevés mintánál nincs díj', () => {
  assert.deepStrictEqual(S.awards({ events: [e2] }), []);
  // Anna és Bela eléri az 5 eldőlt tippet, Cili nem → két jogosult, van díj, Cili nem szerepel
  const aw = S.awards(h);
  assert.ok(aw.length >= 1);
  assert.ok(aw.every((a) => a.nick !== 'Cili'));
});

t('üres bemenet nem dob hibát', () => {
  assert.deepStrictEqual(S.overview({ events: [] }), []);
  assert.deepStrictEqual(S.awards(null), []);
  assert.strictEqual(S.playerStats(null, 'x').pct, null);
});

t('demó-előzmények: értelmes arányok', () => {
  const d = require('../data/demo-history.json');
  const ov = S.overview(d);
  assert.strictEqual(ov.length, 5);
  ov.forEach((s) => { assert.ok(s.pct >= 0 && s.pct <= 100); assert.strictEqual(s.hits + s.misses, s.picks); });
  assert.ok(S.awards(d).length >= 4);
});

console.log(`\n${ok} teszt rendben.`);
