// Háttér-elérés: élesben a Supabase RPC-függvényei (supabase/schema.sql), helyben demó (localStorage).
// Mindkét háttér ugyanazt a felületet adja; hiba esetén Error-t dob olvasható üzenettel.

window.createApi = function createApi(cfg) {
  // ?demo a címben: kipróbálás az éles adatbázis érintése nélkül
  const forceDemo = new URLSearchParams(location.search).has('demo');
  if (cfg.supabaseUrl && cfg.supabaseKey && !forceDemo) return supabaseApi(cfg);
  return demoApi(cfg);
};

function supabaseApi(cfg) {
  const base = cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/';
  const headers = { apikey: cfg.supabaseKey, 'Content-Type': 'application/json' };
  // A régi (JWT) anon kulcs az Authorization fejlécbe is mehet; az új sb_publishable_ kulcs csak az apikey-be
  if (!cfg.supabaseKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + cfg.supabaseKey;

  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(base + fn, { method: 'POST', headers, body: JSON.stringify(args) });
    } catch (e) {
      throw new Error('Nincs kapcsolat a szerverrel. Ellenőrizd a netet, és próbáld újra.');
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.message) || `Szerverhiba (${res.status}).`);
    if (body && body.error) throw new Error(body.error);
    return body;
  }

  return {
    mode: 'live',
    join: (nick, pin) => rpc('join_game', { p_nick: nick, p_pin: pin }),
    myPicks: (nick, pin) => rpc('my_picks', { p_nick: nick, p_pin: pin }).then((r) => r.picks),
    pick: (nick, pin, fight, side) => rpc('place_pick', { p_nick: nick, p_pin: pin, p_fight: fight, p_side: side }),
    event: () => rpc('get_event', {}),
    board: (slug) => rpc('get_board', { p_event: slug }),
    overall: (kind) => rpc('get_overall', { p_kind: kind || null }),
    adminCheck: (pin) => rpc('admin_check', { p_pin: pin }),
    adminSetFight: (pin, fight, status, r = {}) => rpc('admin_set_fight', {
      p_pin: pin, p_fight: fight, p_status: status, p_winner: r.winner || null,
      p_method: r.method || null, p_round: r.round || null, p_time: r.time || null,
    }),
    adminSetLockAt: (pin, fight, iso) => rpc('admin_set_lock_at', { p_pin: pin, p_fight: fight, p_lock_at: iso }),
    adminPlayers: (pin) => rpc('admin_players', { p_pin: pin }).then((r) => r.players),
    adminDeletePlayer: (pin, nick) => rpc('admin_delete_player', { p_pin: pin, p_nick: nick }),
    adminResetPin: (pin, nick, newPin) => rpc('admin_reset_pin', { p_pin: pin, p_nick: nick, p_new_pin: newPin }),
  };
}

// Demó: ugyanazok a szabályok, a böngésző localStorage-ában, a data/<event>.json gálával. Admin-PIN demóban: 0000.
function demoApi(cfg) {
  const KEY = 'ufctipp-demo-' + cfg.event;
  const DEMO_ADMIN_PIN = '0000';
  let data = null;

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* üres vagy tiltott tároló */ }
    if (!s) {
      s = { players: [], picks: {}, fights: {} };
      data.fights.forEach((f) => {
        s.fights[f.id] = { status: 'open', lock_at: null, winner: null, method: null, round: null, time: null, points: f.titleBout ? 2 : 1 };
      });
    }
    return s;
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* demóban nem baj */ }
  }
  const isOpen = (f) => f.status === 'open' && (!f.lock_at || Date.now() < Date.parse(f.lock_at));
  const later = (v) => new Promise((ok) => setTimeout(() => ok(v), 120));
  const fail = (msg) => Promise.reject(new Error(msg));

  function auth(s, nick, pin) {
    const p = s.players.find((x) => x.nick.toLowerCase() === String(nick).trim().toLowerCase());
    if (!p) throw new Error('Nincs ilyen becenév.');
    if (p.pin !== pin) throw new Error('Hibás PIN.');
    return p;
  }
  function admin(pin) {
    if (pin !== DEMO_ADMIN_PIN) throw new Error('Hibás admin-PIN. (Demó módban: 0000)');
  }
  const wrap = (fn) => (...args) => { try { return later(fn(...args)); } catch (e) { return fail(e.message); } };

  const demo = {
    mode: 'demo',
    join: wrap((nick, pin) => {
      const s = load();
      const n = String(nick).trim();
      if (!/^[\p{L}\p{N} _.\-]{2,20}$/u.test(n)) throw new Error('A becenév 2–20 karakter legyen (betű, szám, szóköz, _ . -).');
      if (!/^\d{4}$/.test(pin)) throw new Error('A PIN 4 számjegy legyen.');
      let p = s.players.find((x) => x.nick.toLowerCase() === n.toLowerCase());
      let created = false;
      if (!p) { p = { nick: n, pin, created_at: new Date().toISOString() }; s.players.push(p); created = true; save(s); }
      if (p.pin !== pin) throw new Error('Ez a becenév már foglalt, és a PIN nem egyezik. Ha a tiéd, írd be a régi PIN-edet.');
      return { nick: p.nick, created };
    }),
    myPicks: wrap((nick, pin) => {
      const s = load();
      const p = auth(s, nick, pin);
      return s.picks[p.nick.toLowerCase()] || {};
    }),
    pick: wrap((nick, pin, fight, side) => {
      const s = load();
      const p = auth(s, nick, pin);
      const f = s.fights[fight];
      if (!f) throw new Error('Nincs ilyen meccs.');
      if (!isOpen(f)) throw new Error('Erre a meccsre már nem lehet tippelni — lezárták.');
      const k = p.nick.toLowerCase();
      s.picks[k] = s.picks[k] || {};
      if (side) s.picks[k][fight] = side; else delete s.picks[k][fight];
      save(s);
      return { fight, side };
    }),
    event: async () => {
      if (!data) {
        const res = await fetch(`data/${cfg.event}.json`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`data/${cfg.event}.json nem töltődött be.`);
        data = await res.json();
      }
      const starts = data.event.sections.map((x) => x.start).filter(Boolean);
      return { slug: cfg.event, title: data.event.title, kind: /^ufc-\d+$/.test(cfg.event) ? 'numbered' : 'fightnight',
               starts_at: new Date(Math.min(...starts) * 1000).toISOString(), data, last_sync_at: null, sync_note: 'demó' };
    },
    // demóban egyetlen (számozott) gála van: az összesített = ennek a gálának a ranglistája
    overall: async (kind) => {
      const b = await demo.board();
      if (kind === 'fightnight') return b.leaderboard.map((r) => ({ ...r, points: 0, correct: 0, decided: 0, events: 0 }));
      return b.leaderboard.map((r) => ({ nick: r.nick, points: r.points, correct: r.correct, decided: r.decided, events: r.picks ? 1 : 0 }));
    },
    board: wrap(() => {
      const s = load();
      const fights = data.fights.map((df) => {
        const f = s.fights[df.id];
        const all = s.players.map((p) => ({ nick: p.nick, side: (s.picks[p.nick.toLowerCase()] || {})[df.id] })).filter((x) => x.side);
        return {
          id: df.id, status: f.status, open: isOpen(f), lock_at: f.lock_at, winner: f.winner, method: f.method,
          round: f.round, time: f.time, points: f.points, changed: !!f.changed,
          count_total: all.length,
          count_a: f.status === 'done' ? all.filter((x) => x.side === 'A').length : null,
          count_b: f.status === 'done' ? all.filter((x) => x.side === 'B').length : null,
          picks: f.status === 'done' ? all.sort((a, b) => a.nick.localeCompare(b.nick, 'hu')) : null,
        };
      });
      const leaderboard = s.players.map((p) => {
        const my = s.picks[p.nick.toLowerCase()] || {};
        let points = 0, correct = 0, decided = 0, picks = 0;
        Object.entries(my).forEach(([id, side]) => {
          const f = s.fights[id];
          if (!f) return;
          picks++;
          if (f.status === 'done' && (f.winner === 'A' || f.winner === 'B')) decided++;
          if (f.status === 'done' && f.winner === side) { correct++; points += f.points; }
        });
        return { nick: p.nick, points, correct, decided, picks };
      }).sort((a, b) => b.points - a.points || b.correct - a.correct || a.nick.localeCompare(b.nick, 'hu'));
      return { now: new Date().toISOString(), players: s.players.length, fights, leaderboard };
    }),
    adminCheck: wrap((pin) => { admin(pin); return { ok: true }; }),
    adminSetFight: wrap((pin, fight, status, r = {}) => {
      admin(pin);
      const s = load();
      const f = s.fights[fight];
      if (!f) throw new Error('Nincs ilyen meccs.');
      if (status === 'done' && !['A', 'B', 'draw', 'nc'].includes(r.winner)) throw new Error('Eredményhez győztes kell (A, B, döntetlen vagy no contest).');
      f.status = status;
      if (status === 'open' && f.lock_at && Date.parse(f.lock_at) <= Date.now()) f.lock_at = null;
      const done = status === 'done';
      f.winner = done ? r.winner : null;
      f.method = done ? (r.method || null) : null;
      f.round = done ? (r.round || null) : null;
      f.time = done ? (r.time || null) : null;
      save(s);
      return { fight, status };
    }),
    adminSetLockAt: wrap((pin, fight, iso) => {
      admin(pin);
      const s = load();
      s.fights[fight].lock_at = iso;
      save(s);
      return { fight, lock_at: iso };
    }),
    adminPlayers: wrap((pin) => {
      admin(pin);
      const s = load();
      return s.players.map((p) => ({ nick: p.nick, created_at: p.created_at, picks: Object.keys(s.picks[p.nick.toLowerCase()] || {}).length }));
    }),
    adminDeletePlayer: wrap((pin, nick) => {
      admin(pin);
      const s = load();
      s.players = s.players.filter((p) => p.nick.toLowerCase() !== nick.toLowerCase());
      delete s.picks[nick.toLowerCase()];
      save(s);
      return { deleted: nick };
    }),
    adminResetPin: wrap((pin, nick, newPin) => {
      admin(pin);
      if (!/^\d{4}$/.test(newPin)) throw new Error('A PIN 4 számjegy legyen.');
      const s = load();
      const p = s.players.find((x) => x.nick.toLowerCase() === nick.toLowerCase());
      if (p) p.pin = newPin;
      save(s);
      return { reset: nick };
    }),
  };
  return demo;
}
