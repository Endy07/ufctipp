// Statisztika a lejátszott gálákból (get_history). Tiszta függvények: a böngészőben és node-ban (tests/test-stats.js) is fut.
// Bemenet: { events: [{ slug, title, kind, starts_at, fights: [{ id, ord, card, title_bout, points, status, winner, weight,
//            a: { name, odds }, b: { name, odds }, picks: [{ nick, side }] | null }] }] }
// Csak az eldőlt (A vagy B győztes) meccsek számítanak; a döntetlen / no contest nem.

(function (root) {
  'use strict';

  const MIN_PICKS = 5;      // díjakhoz és „legjobb / leggyengébb" jelzéshez ennyi eldőlt tipp kell
  const MIN_GROUP = 3;      // súlycsoportonként
  const MIN_CROWD = 3;      // „a tömeg ellen" csak legalább ennyi tippelőnél értelmezhető

  const low = (s) => String(s).toLowerCase();
  const byNick = (a, b) => String(a).localeCompare(String(b), 'hu');

  // Amerikai szorzóból becsült nyerési esély (%), null ha nincs adat
  function impliedPct(odds) {
    const o = parseInt(String(odds ?? '').replace('+', ''), 10);
    if (!o || Number.isNaN(o)) return null;
    return o < 0 ? (-o / (-o + 100)) * 100 : (100 / (o + 100)) * 100;
  }

  // 'A' / 'B' ha egyértelmű a favorit, különben null
  function favoriteSide(f) {
    const a = impliedPct(f.a && f.a.odds), b = impliedPct(f.b && f.b.odds);
    if (a == null || b == null || Math.abs(a - b) < 0.5) return null;
    return a > b ? 'A' : 'B';
  }

  const decided = (f) => f.status === 'done' && (f.winner === 'A' || f.winner === 'B');
  const timeOf = (e) => (e.starts_at ? Date.parse(e.starts_at) : Infinity);

  // Időrendi sorrend: gála kezdete szerint, azon belül a kártya alulról felfelé (az `ord` 1 = a főmeccs, az az utolsó)
  function chrono(history) {
    const events = (history && history.events ? history.events : []).slice().sort((x, y) => timeOf(x) - timeOf(y));
    const out = [];
    events.forEach((e) => {
      (e.fights || []).slice().sort((x, y) => y.ord - x.ord).forEach((f) => out.push({ e, f }));
    });
    return out;
  }

  function nicks(history) {
    const seen = new Map();
    ((history && history.events) || []).forEach((e) => (e.fights || []).forEach((f) => (f.picks || []).forEach((p) => {
      if (!seen.has(low(p.nick))) seen.set(low(p.nick), p.nick);
    })));
    return [...seen.values()].sort(byNick);
  }

  // Egy meccs társasági képe: hányan tippeltek A-ra / B-re, ki a többség, tévedett-e a tömeg
  function crowd(f) {
    const picks = f.picks || [];
    const a = picks.filter((p) => p.side === 'A').length;
    const b = picks.filter((p) => p.side === 'B').length;
    const majority = a > b ? 'A' : b > a ? 'B' : null;
    return {
      a, b, total: a + b, majority,
      crowdWrong: decided(f) && !!majority && a + b >= MIN_CROWD && majority !== f.winner,
      minority: majority ? (majority === 'A' ? 'B' : 'A') : null,
    };
  }

  // ---------------------------------------------------------------- gála-ranglista, trófeák

  function eventTable(event) {
    const rows = new Map();
    (event.fights || []).forEach((f) => (f.picks || []).forEach((p) => {
      const k = low(p.nick);
      if (!rows.has(k)) rows.set(k, { nick: p.nick, points: 0, correct: 0, decided: 0, picks: 0 });
      const r = rows.get(k);
      r.picks++;
      if (decided(f)) {
        r.decided++;
        if (f.winner === p.side) { r.correct++; r.points += f.points || 1; }
      }
    }));
    const list = [...rows.values()].sort((x, y) => y.points - x.points || y.correct - x.correct || byNick(x.nick, y.nick));
    let place = 0, prev = null;
    list.forEach((r, i) => { if (r.points !== prev) { place = i + 1; prev = r.points; } r.place = place; });
    return list;
  }

  const eventComplete = (event) => (event.fights || []).length > 0 && event.fights.every((f) => f.status === 'done');

  // A gála győztesei (holtversenynél többen); a befejezetlen gálánál „éllovas"
  function eventWinners(event) {
    const t = eventTable(event);
    if (!t.length || t[0].points <= 0) return { complete: eventComplete(event), nicks: [], points: 0 };
    const top = t[0].points;
    return { complete: eventComplete(event), nicks: t.filter((r) => r.points === top).map((r) => r.nick), points: top };
  }

  function trophies(history) {
    const events = [];
    const count = {};
    ((history && history.events) || []).slice().sort((x, y) => timeOf(y) - timeOf(x)).forEach((e) => {
      const w = eventWinners(e);
      events.push({ slug: e.slug, title: e.title, ...w });
      if (w.complete) w.nicks.forEach((n) => { count[n] = (count[n] || 0) + 1; });
    });
    const table = Object.entries(count).map(([nick, n]) => ({ nick, n })).sort((x, y) => y.n - x.n || byNick(x.nick, y.nick));
    return { events, table };
  }

  // ---------------------------------------------------------------- szezon (naptári év)

  function yearOf(iso) {
    if (!iso) return null;
    return +new Intl.DateTimeFormat('en', { timeZone: 'Europe/Budapest', year: 'numeric' }).format(new Date(iso));
  }

  function season(history) {
    const years = new Map();
    ((history && history.events) || []).forEach((e) => {
      const y = yearOf(e.starts_at);
      if (y == null) return;
      if (!years.has(y)) years.set(y, new Map());
      const m = years.get(y);
      eventTable(e).forEach((r) => {
        const k = low(r.nick);
        if (!m.has(k)) m.set(k, { nick: r.nick, points: 0, correct: 0, decided: 0, events: 0 });
        const t = m.get(k);
        t.points += r.points; t.correct += r.correct; t.decided += r.decided; t.events++;
      });
    });
    const out = {};
    [...years.keys()].sort((a, b) => b - a).forEach((y) => {
      const list = [...years.get(y).values()].sort((a, b) => b.points - a.points || b.correct - a.correct || byNick(a.nick, b.nick));
      let place = 0, prev = null;
      list.forEach((r, i) => { if (r.points !== prev) { place = i + 1; prev = r.points; } r.place = place; });
      out[y] = list;
    });
    return out;
  }

  // ---------------------------------------------------------------- játékos-statisztika

  const pct = (h, n) => (n ? Math.round((h / n) * 100) : null);

  function playerStats(history, nick) {
    const key = low(nick);
    const s = {
      nick, picks: 0, hits: 0, misses: 0, pct: null, points: 0, events: 0,
      title: { picks: 0, hits: 0 }, fav: { picks: 0, hits: 0 }, dog: { picks: 0, hits: 0 },
      favShare: null,
      withCrowd: { picks: 0, hits: 0 }, againstCrowd: { picks: 0, hits: 0 },
      streak: { current: { type: null, n: 0 }, bestWin: 0, worstLoss: 0 },
      recent: [], weight: [], fighters: [], byEvent: [],
      bestWeight: null, worstWeight: null, favFighter: null, nemesis: null,
    };
    const weights = new Map(), fighters = new Map(), events = new Map();
    let run = { type: null, n: 0 };

    chrono(history).forEach(({ e, f }) => {
      if (!decided(f)) return;
      const mine = (f.picks || []).find((p) => low(p.nick) === key);
      if (!mine) return;
      const hit = mine.side === f.winner;
      s.picks++;
      if (hit) { s.hits++; s.points += f.points || 1; } else s.misses++;
      if (f.title_bout) { s.title.picks++; if (hit) s.title.hits++; }

      const fav = favoriteSide(f);
      if (fav) {
        const g = mine.side === fav ? s.fav : s.dog;
        g.picks++; if (hit) g.hits++;
      }
      const c = crowd(f);
      if (c.total >= MIN_CROWD && c.majority) {
        const g = mine.side === c.majority ? s.withCrowd : s.againstCrowd;
        g.picks++; if (hit) g.hits++;
      }

      const wName = f.weight ? f.weight.replace(/\s*(Title\s+)?Bout\s*$/i, '').trim() : null;
      if (wName) {
        const w = weights.get(wName) || { name: wName, picks: 0, hits: 0 };
        w.picks++; if (hit) w.hits++;
        weights.set(wName, w);
      }
      const pickedName = (mine.side === 'A' ? f.a : f.b).name;
      if (pickedName) {
        const p = fighters.get(pickedName) || { name: pickedName, picks: 0, hits: 0 };
        p.picks++; if (hit) p.hits++;
        fighters.set(pickedName, p);
      }

      if (run.type === (hit ? 'win' : 'loss')) run.n++; else run = { type: hit ? 'win' : 'loss', n: 1 };
      if (run.type === 'win') s.streak.bestWin = Math.max(s.streak.bestWin, run.n);
      else s.streak.worstLoss = Math.max(s.streak.worstLoss, run.n);
      s.recent.push(hit ? 'h' : 'm');

      const ev = events.get(e.slug) || { slug: e.slug, title: e.title, starts_at: e.starts_at, points: 0, correct: 0, decided: 0 };
      ev.decided++; if (hit) { ev.correct++; ev.points += f.points || 1; }
      events.set(e.slug, ev);
    });

    s.streak.current = run;
    s.recent = s.recent.slice(-10);
    s.pct = pct(s.hits, s.picks);
    s.events = events.size;
    s.byEvent = [...events.values()].sort((a, b) => timeOf(b) - timeOf(a));
    const favPicks = s.fav.picks + s.dog.picks;
    s.favShare = favPicks ? Math.round((s.fav.picks / favPicks) * 100) : null;

    s.weight = [...weights.values()].map((w) => ({ ...w, pct: pct(w.hits, w.picks) }))
      .sort((a, b) => b.pct - a.pct || b.picks - a.picks);
    const wEnough = s.weight.filter((w) => w.picks >= MIN_GROUP);
    if (wEnough.length >= 2) { s.bestWeight = wEnough[0]; s.worstWeight = wEnough[wEnough.length - 1]; }
    else if (wEnough.length === 1) s.bestWeight = wEnough[0];

    s.fighters = [...fighters.values()].map((p) => ({ ...p, pct: pct(p.hits, p.picks) }));
    const loved = s.fighters.filter((p) => p.picks >= 2 && p.hits > 0).sort((a, b) => b.hits - a.hits || b.pct - a.pct)[0];
    const unlucky = s.fighters.filter((p) => p.picks >= 2 && p.hits < p.picks).sort((a, b) => (b.picks - b.hits) - (a.picks - a.hits) || a.pct - b.pct)[0];
    s.favFighter = loved || null;
    s.nemesis = unlucky || null;
    return s;
  }

  // Mindenki egy sorban (a százalék-táblához)
  function overview(history) {
    return nicks(history).map((n) => playerStats(history, n))
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.hits - a.hits || byNick(a.nick, b.nick));
  }

  // ---------------------------------------------------------------- díjak

  function awards(history) {
    const all = overview(history).filter((s) => s.picks >= MIN_PICKS);
    if (all.length < 2) return [];
    const best = (list, fn) => list.slice().sort((a, b) => fn(b) - fn(a) || b.picks - a.picks || byNick(a.nick, b.nick))[0];
    const out = [];
    const add = (key, title, desc, s, value) => { if (s) out.push({ key, title, desc, nick: s.nick, value }); };

    const top = best(all, (s) => s.pct);
    add('prophet', 'Legjobb jós', 'A legmagasabb találati arány', top, top.pct + '%');
    const pts = best(all, (s) => s.points);
    add('points', 'Pontgyáros', 'A legtöbb pont összesen', pts, pts.points + ' pont');
    const streak = best(all, (s) => s.streak.bestWin);
    if (streak.streak.bestWin >= 3) add('streak', 'Széria-király', 'A leghosszabb nyerő sorozat', streak, streak.streak.bestWin + ' talált egymás után');
    const favs = all.filter((s) => s.fav.picks + s.dog.picks >= MIN_PICKS);
    if (favs.length >= 2) {
      const f = best(favs, (s) => s.favShare);
      if (f.favShare >= 60) add('fav', 'Favorit-hívő', 'Leggyakrabban a favoritra tippel', f, f.favShare + '% favorit');
      const d = best(favs, (s) => -s.favShare);
      if (d.favShare <= 50 && d.dog.picks >= 3) add('dog', 'Esélytelenek barátja', 'Leggyakrabban az esélytelenre tippel', d, (100 - d.favShare) + '% esélytelen');
    }
    const brave = best(all.filter((s) => s.againstCrowd.picks >= 3), (s) => s.againstCrowd.picks);
    add('brave', 'Egyedül a tömeg ellen', 'Legtöbbször megy a többség ellen', brave, brave && brave.againstCrowd.picks + '×');
    const worst = all.slice().sort((a, b) => a.pct - b.pct || b.picks - a.picks || byNick(a.nick, b.nick))[0];
    if (worst && worst.nick !== top.nick) add('unlucky', 'Pechvadász', 'A legalacsonyabb találati arány', worst, worst.pct + '%');
    return out;
  }

  // ---------------------------------------------------------------- fej-fej mellett

  function headToHead(history, nickA, nickB) {
    const ka = low(nickA), kb = low(nickB);
    const r = { a: nickA, b: nickB, common: 0, bothHit: 0, onlyA: 0, onlyB: 0, bothMiss: 0, agree: 0,
                pointsA: 0, pointsB: 0, eventsA: 0, eventsB: 0, eventsTie: 0, events: [] };
    const events = new Map();
    chrono(history).forEach(({ e, f }) => {
      if (!decided(f)) return;
      const pa = (f.picks || []).find((p) => low(p.nick) === ka);
      const pb = (f.picks || []).find((p) => low(p.nick) === kb);
      if (!pa || !pb) return;
      const ha = pa.side === f.winner, hb = pb.side === f.winner;
      r.common++;
      if (pa.side === pb.side) r.agree++;
      if (ha && hb) r.bothHit++; else if (ha) r.onlyA++; else if (hb) r.onlyB++; else r.bothMiss++;
      const ev = events.get(e.slug) || { slug: e.slug, title: e.title, starts_at: e.starts_at, a: 0, b: 0 };
      if (ha) ev.a += f.points || 1;
      if (hb) ev.b += f.points || 1;
      events.set(e.slug, ev);
    });
    events.forEach((ev) => {
      r.pointsA += ev.a; r.pointsB += ev.b;
      if (ev.a > ev.b) r.eventsA++; else if (ev.b > ev.a) r.eventsB++; else r.eventsTie++;
    });
    r.events = [...events.values()].sort((x, y) => timeOf(y) - timeOf(x));
    r.agreePct = pct(r.agree, r.common);
    return r;
  }

  const api = { impliedPct, favoriteSide, decided, crowd, nicks, eventTable, eventComplete, eventWinners, trophies, season,
                playerStats, overview, awards, headToHead, MIN_PICKS };
  root.UfcStats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
