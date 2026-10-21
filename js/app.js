(() => {
  'use strict';

  const cfg = window.UFCTIPP_CONFIG;
  const TZ = 'Europe/Budapest';
  const POLL_MS = 15000;

  const state = {
    data: null,      // data/<event>.json: esemény, meccsek, versenyzők (UFC.com)
    api: null,
    me: null,        // { nick, pin }
    picks: {},       // { fightId: 'A' | 'B' }
    board: null,     // get_board: meccsállapotok, ranglista
    adminPin: null,
    sheetFight: null,
    busy: new Set(),
    history: null,   // get_history: a lejátszott gálák meccsei a tippekkel (Történet, Statisztika, Szezon)
    historyAt: 0,
    historyTxt: '',
    hKind: null,     // Történet szűrő: null | 'numbered' | 'fightnight'
    statNick: null,  // Statisztika: a kiválasztott játékos
    h2h: { a: null, b: null },
  };
  const ST = window.UfcStats;

  // ------------------------------------------------------------ segédek

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, session) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(k)); } catch (e) { return null; } },
    set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch (e) { /* privát mód */ } },
    del(k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch (e) { /* privát mód */ } },
  };
  // A játékos minden gálán ugyanaz (a régi, gálánkénti kulcsot is elfogadjuk: ufctipp-me-ufc-333)
  const ME_KEY = 'ufctipp-me';
  const ADMIN_KEY = 'ufctipp-admin';

  const fmtTime = (ts) => new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(ts);
  const fmtDay = (ts) => new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(ts);

  const WEIGHT = {
    'Women\'s Strawweight': 'Női szalmasúly', 'Women\'s Flyweight': 'Női légsúly', 'Women\'s Bantamweight': 'Női harmatsúly',
    'Women\'s Featherweight': 'Női pehelysúly', 'Flyweight': 'Légsúly', 'Bantamweight': 'Harmatsúly', 'Featherweight': 'Pehelysúly',
    'Lightweight': 'Könnyűsúly', 'Welterweight': 'Váltósúly', 'Middleweight': 'Középsúly', 'Light Heavyweight': 'Félnehézsúly',
    'Heavyweight': 'Nehézsúly', 'Catchweight': 'Megegyezéses súly',
  };
  function weightName(cls) {
    const base = cls.replace(/\s*(Title\s+)?Bout\s*$/i, '').trim();
    return WEIGHT[base] || base;
  }
  const COUNTRY = {
    Australia: 'Ausztrália', Russia: 'Oroszország', Georgia: 'Grúzia', England: 'Anglia', Uzbekistan: 'Üzbegisztán',
    'United States': 'Egyesült Államok', Belgium: 'Belgium', 'Türkiye': 'Törökország', Germany: 'Németország',
    Tajikistan: 'Tádzsikisztán', Brazil: 'Brazília', France: 'Franciaország', Ireland: 'Írország', Poland: 'Lengyelország',
    Mexico: 'Mexikó', Canada: 'Kanada', China: 'Kína', Japan: 'Japán', Kazakhstan: 'Kazahsztán', Dagestan: 'Dagesztán',
    'New Zealand': 'Új-Zéland', Nigeria: 'Nigéria', Sweden: 'Svédország', Spain: 'Spanyolország', Hungary: 'Magyarország',
  };
  const countryHu = (c) => (c ? COUNTRY[c] || c : '');
  const CARD_NAME ={ main: 'Fő kártya', prelims: 'Előmeccsek', early: 'Korai előmeccsek' };
  const METHODS = ['KO/TKO', 'Feladás', 'Pontozás (egyhangú)', 'Pontozás (megosztott)', 'Pontozás (többségi)', 'Orvosi leállítás', 'Kizárás', 'Egyéb'];
  function methodHu(m) {
    if (!m) return '';
    const t = m.toLowerCase();
    if (t.includes('ko')) return 'KO/TKO';
    if (t.includes('sub')) return 'Feladás';
    if (t.includes('unanimous')) return 'Pontozás (egyhangú)';
    if (t.includes('split')) return 'Pontozás (megosztott)';
    if (t.includes('majority')) return 'Pontozás (többségi)';
    if (t.includes('decision')) return 'Pontozás';
    if (t.includes('dq')) return 'Kizárás';
    if (t.includes('overturned') || t.includes('no contest')) return 'Nem értékelt';
    return m;
  }
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11 };
  function dateHu(s) {
    const m = /^(\w+)\.?\s+(\d+),\s+(\d{4})$/.exec(s || '');
    if (!m || MONTHS[m[1]] === undefined) return s || '';
    return new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(+m[3], MONTHS[m[1]], +m[2]));
  }
  function impliedPct(odds) {
    const o = parseInt(String(odds).replace('+', ''), 10);
    if (!o || Number.isNaN(o)) return null;
    return Math.round(o < 0 ? (-o / (-o + 100)) * 100 : (100 / (o + 100)) * 100);
  }
  const lastName = (n) => { const p = String(n).trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : n; };
  const firstNames = (n) => { const p = String(n).trim().split(/\s+/); return p.slice(0, -1).join(' '); };
  const rec = (a) => (a && a.record ? `${a.record.w}–${a.record.l}–${a.record.d}` : '');
  const athlete = (slug) => state.data.athletes[slug] || {};
  // A kártya képei fejtetőtől talpig vágottak, így a kép magassága = a versenyző magassága.
  // A magasabbik tölti ki a helyet (1), a másik a valós magassága arányában kisebb, közös talpvonalon.
  const heightOf = (c) => athlete(c.slug).heightCm || null;
  function figureHeights(f) {
    const ha = heightOf(f.a) || heightOf(f.b) || 175;
    const hb = heightOf(f.b) || heightOf(f.a) || 175;
    const max = Math.max(ha, hb);
    return { a: (ha / max).toFixed(3), b: (hb / max).toFixed(3) };
  }
  const fightState = (id) => (state.board ? state.board.fights.find((f) => f.id === id) : null);

  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast is-on' + (kind ? ' toast--' + kind : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  // ------------------------------------------------------------ indulás

  // Az aktuális gála az adatbázisból (élesben a gépen futó szinkron tölti fel, lásd tools/sync.php)
  async function loadEvent() {
    const ev = await state.api.event();
    if (!ev || !ev.data) { state.event = null; state.data = null; return; }
    state.event = ev;
    state.data = ev.data;
    $('#eventName').textContent = ev.data.event.title.split(':')[0];
    $('#eventSub').textContent = ev.data.event.title.split(':').slice(1).join(':').trim();
  }
  const loadBoard = () => state.api.board(state.event.slug);

  async function start() {
    state.api = window.createApi(cfg);
    $('#demoBanner').hidden = state.api.mode !== 'demo';
    try {
      await loadEvent();
    } catch (e) {
      $('#view').innerHTML = `<div class="empty">Nem töltődött be a gála adata: ${esc(e.message)} Frissítsd az oldalt.</div>`;
      return;
    }
    if (!state.data) {
      $('#view').innerHTML = '<div class="empty">A következő gála még nincs kiírva. Amint a UFC kiírja, itt megjelenik, és lehet tippelni.</div>';
      return;
    }
    state.me = store.get(ME_KEY) || store.get(ME_KEY + '-ufc-333');
    if (state.me) store.set(ME_KEY, state.me);
    state.adminPin = store.get(ADMIN_KEY, true);

    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
    window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
    document.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-h2h]');
      if (sel) { state.h2h[sel.dataset.h2h] = sel.value; render(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

    if (state.me) {
      try {
        state.picks = await state.api.myPicks(state.me.nick, state.me.pin);
      } catch (e) {
        // törölt játékos vagy megváltozott PIN: újra be kell lépni
        if (/becenév|PIN/i.test(e.message)) { state.me = null; store.del(ME_KEY); store.del(ME_KEY + '-ufc-333'); }
      }
    }
    await refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  }

  async function refresh() {
    // a kártya (beugró, sorrend) ritkábban változik: kb. másfél percenként nézzük, frissült-e
    refresh.n = (refresh.n || 0) + 1;
    if (refresh.n % 6 === 0) {
      try {
        const ev = await state.api.event();
        if (ev && ev.data && (ev.slug !== state.event.slug || ev.last_sync_at !== state.event.last_sync_at)) {
          state.event = ev;
          state.data = ev.data;
        }
      } catch (e) { /* a következő körben újra */ }
    }
    try {
      state.board = await loadBoard();
    } catch (e) {
      if (!state.board) toast(e.message, 'err');
    }
    // a saját tippeket is újraolvassuk: beugrónál a szerver törli, sarokcserénél átfordítja őket
    if (state.me && !state.busy.size) {
      try { state.picks = await state.api.myPicks(state.me.nick, state.me.pin); } catch (e) { /* a következő körben újra */ }
    }
    if (currentRoute() === 'ranglista' && state.lbTab === 'ossz') loadOverall(state.lbKind || null);
    // Űrlapos nézetet (belépés, admin) nem rajzolunk újra, mert elveszne a félig beírt adat;
    // a Történetet / Statisztikát sem (nyitott részletek, kiválasztott játékos): azok maguktól frissülnek, ha változott az adat
    const shown = $('#view').dataset.route;
    const needsHistory = HISTORY_ROUTES.includes(shown) || (shown === 'ranglista' && state.lbTab === 'szezon');
    if (needsHistory && Date.now() - state.historyAt > 60000) loadHistory();
    if (shown === 'admin') renderAdminStatusOnly();
    else if (HISTORY_ROUTES.includes(shown)) { /* a loadHistory rajzol újra, ha kell */ }
    else if (shown !== 'join') render();
    if (state.sheetFight) renderSheet(state.sheetFight, true);
  }

  const HISTORY_ROUTES = ['tortenet', 'statisztika'];

  // #tortenet/<gála-slug>: a második rész a részletes nézet argumentuma
  function routeParts() {
    const [name, arg] = location.hash.replace('#', '').split('/');
    return {
      name: ['kartya', 'ranglista', 'tortenet', 'statisztika', 'admin'].includes(name) ? name : 'kartya',
      arg: arg ? decodeURIComponent(arg) : null,
    };
  }
  const currentRoute = () => routeParts().name;

  // Az előzmények (lejátszott gálák) betöltése; újrarajzol, ha ilyen nézeten vagyunk és változott az adat
  async function loadHistory() {
    if (loadHistory.busy) return;
    loadHistory.busy = true;
    try {
      const h = await state.api.history();
      state.historyAt = Date.now();
      const txt = JSON.stringify(h.events);
      const changed = txt !== state.historyTxt;
      state.history = h;
      state.historyTxt = txt;
      const shown = $('#view').dataset.route;
      const wants = HISTORY_ROUTES.includes(shown) || (shown === 'ranglista' && state.lbTab === 'szezon');
      if (wants && (changed || !loadHistory.drawn)) render();
      loadHistory.drawn = true;
    } catch (e) {
      state.historyAt = Date.now();
      if (!state.history) { state.history = { events: [], failed: e.message }; if ($('#view').dataset.route !== 'join') render(); }
      toast(e.message, 'err');
    } finally {
      loadHistory.busy = false;
    }
  }

  // ------------------------------------------------------------ nézetek

  function render() {
    const route = currentRoute();
    const view = $('#view');
    $('#meBtn').hidden = !state.me;
    $('#meBtn').textContent = state.me ? state.me.nick : '';
    $('#adminTab').hidden = !state.adminPin;

    if (route === 'admin') {
      $('#tabs').hidden = !state.me && !state.adminPin;
      view.dataset.route = 'admin';
      view.innerHTML = state.adminPin ? adminView() : adminLoginView();
    } else if (!state.me) {
      $('#tabs').hidden = true;
      view.dataset.route = 'join';
      view.innerHTML = joinView();
    } else {
      $('#tabs').hidden = false;
      view.dataset.route = route;
      view.innerHTML = route === 'ranglista' ? leaderboardView()
        : route === 'tortenet' ? historyView()
        : route === 'statisztika' ? statsView()
        : cardView();
    }
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('is-active', a.dataset.tab === route));
  }

  function sectionStart(key) {
    const s = state.data.event.sections.find((x) => x.key === key);
    return s && s.start ? s.start * 1000 : null;
  }

  function joinView() {
    const ev = state.data.event;
    const main = sectionStart('main');
    const early = sectionStart('early');
    const [num, ...rest] = ev.title.split(':');
    const headliners = rest.join(':').trim().split(/\s+vs\.?\s+/i);
    return `
      <section class="join">
        <div class="poster">
          <div class="poster__num">${esc(num)}</div>
          <div class="poster__names">
            <span class="poster__a">${esc(headliners[0] || '')}</span>
            <span class="poster__vs">vs</span>
            <span class="poster__b">${esc(headliners[1] || '')}</span>
          </div>
          ${main ? `<p class="poster__when">${esc(fmtDay(main))}, korai előmeccsek ${esc(fmtTime(early))}, fő kártya ${esc(fmtTime(main))}</p>` : ''}
        </div>
        <form class="join__form" data-form="join" autocomplete="on">
          <label class="field">
            <span>Becenév</span>
            <input name="nick" required minlength="2" maxlength="20" autocomplete="nickname" autocapitalize="words" placeholder="pl. Gergő">
          </label>
          <label class="field">
            <span>PIN-kód (4 számjegy)</span>
            <input name="pin" required inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" placeholder="••••">
          </label>
          <button class="btn btn--primary" type="submit">Belépek</button>
          <p class="hint">Új becenévvel most csatlakozol. Ha már játszottál, ugyanazzal a PIN-nel jössz vissza, akár másik telefonról is.</p>
        </form>
        <div class="rules">
          <h2>Így megy</h2>
          <ul>
            <li>Minden meccsnél koppints arra, akit győztesnek tippelsz. Amíg a meccset le nem zárják, átírhatod.</li>
            <li>A tippelést az admin zárja le közvetlenül a meccs előtt.</li>
            <li>Eltalált győztes: 1 pont, címmeccsen 2 pont.</li>
            <li>Hogy ki kire tippelt, az a meccs végén, az eredménnyel együtt derül ki.</li>
          </ul>
        </div>
      </section>`;
  }

  function myStats() {
    const lb = state.board ? state.board.leaderboard : [];
    const i = lb.findIndex((r) => state.me && r.nick.toLowerCase() === state.me.nick.toLowerCase());
    return { row: i >= 0 ? lb[i] : null, place: i + 1, total: lb.length };
  }

  function cardView() {
    const fights = state.data.fights;
    const openCount = fights.filter((f) => { const s = fightState(f.id); return !s || s.open; }).length;
    const picked = fights.filter((f) => state.picks[f.id]).length;
    const { row, place, total } = myStats();
    const missing = fights.filter((f) => { const s = fightState(f.id); return (!s || s.open) && !state.picks[f.id]; }).length;
    const redo = fights.filter((f) => { const s = fightState(f.id); return s && s.changed && s.open && !state.picks[f.id]; }).length;
    let html = `
      <div class="summary">
        <div><b>${picked}/${fights.length}</b><span>tipped</span></div>
        <div><b>${row ? row.points : 0}</b><span>pontod</span></div>
        <div><b>${place > 0 ? place + '.' : '–'}</b><span>helyezés (${total} játékos)</span></div>
      </div>
      ${countdownHtml()}
      ${redo ? `<p class="nudge nudge--changed">${redo} meccs megváltozott (beugró), tippelj rá újra!</p>` : ''}
      ${missing && openCount ? `<p class="nudge">Még ${missing} nyitott meccsre nem tippeltél.</p>` : ''}`;
    ['main', 'prelims', 'early'].forEach((key) => {
      const list = fights.filter((f) => f.card === key);
      if (!list.length) return;
      const st = sectionStart(key);
      html += `<h2 class="section-h"><span>${CARD_NAME[key]}</span>${st ? `<time>${esc(fmtTime(st))}</time>` : ''}</h2>`;
      html += list.map(fightRow).join('');
    });
    return html;
  }

  function statusLabel(s) {
    if (!s) return { cls: 'open', text: 'Tippelhető' };
    if (s.status === 'done') return { cls: 'done', text: 'Vége' };
    if (!s.open) return { cls: 'locked', text: 'Lezárva' };
    if (s.lock_at) return { cls: 'open', text: `Tippelhető ${fmtTime(Date.parse(s.lock_at))}-ig` };
    return { cls: 'open', text: 'Tippelhető' };
  }

  function cornerHtml(f, side, s) {
    const c = side === 'A' ? f.a : f.b;
    const a = athlete(c.slug);
    const mine = state.picks[f.id] === side;
    const open = !s || s.open;
    const done = s && s.status === 'done';
    const won = done && s.winner === side;
    const lost = done && (s.winner === 'A' || s.winner === 'B') && s.winner !== side;
    const cls = ['corner', side === 'A' ? 'corner--a' : 'corner--b', mine ? 'is-picked' : '', won ? 'is-winner' : '', lost ? 'is-loser' : ''].join(' ');
    const label = `${c.name}${mine ? ', a tipped' : ''}${won ? ', győztes' : ''}`;
    return `
      <button class="${cls}" type="button" data-pick="${side}" data-fight="${f.id}" ${open ? '' : 'aria-disabled="true"'} aria-pressed="${mine}" aria-label="${esc(label)}">
        ${c.image ? `<img class="corner__img" src="${esc(c.image)}" alt="" loading="lazy" style="--fh:${figureHeights(f)[side === 'A' ? 'a' : 'b']}">` : ''}
        <span class="corner__text">
          ${mine || won ? `<span class="corner__badges" aria-hidden="true">${won ? '<span class="corner__win">Győztes</span>' : ''}${mine ? '<span class="corner__tick">Tipped</span>' : ''}</span>` : ''}
          ${c.rank ? `<span class="corner__rank">${c.rank === 'C' ? 'Bajnok' : esc(c.rank)}</span>` : ''}
          <span class="corner__first">${esc(firstNames(c.name))}</span>
          <span class="corner__last ${lastName(c.name).length > 10 ? 'is-long' : lastName(c.name).length > 8 ? 'is-mid' : ''}">${esc(lastName(c.name))}</span>
          <span class="corner__rec">${esc(rec(a))}</span>
        </span>
      </button>`;
  }

  function fightRow(f) {
    const s = fightState(f.id);
    const st = statusLabel(s);
    const pts = s ? s.points : (f.titleBout ? 2 : 1);
    const mine = state.picks[f.id];
    let result = '';
    if (s && s.status === 'done') {
      if (s.winner === 'draw' || s.winner === 'nc') result = `<span class="res res--none">${s.winner === 'draw' ? 'Döntetlen' : 'Nem értékelt'}, nincs pont</span>`;
      else if (!mine) result = '<span class="res res--none">Nem tippeltél</span>';
      else result = mine === s.winner ? `<span class="res res--hit">Talált, +${pts} pont</span>` : '<span class="res res--miss">Nem talált</span>';
    }
    const total = s ? s.count_total || 0 : 0;
    const split = s && s.status === 'done' && total
      ? `<div class="crowd" aria-label="A társaság tippjei: ${s.count_a} – ${s.count_b}">${s.count_a ? `<span class="crowd__a" style="flex-grow:${s.count_a}">${s.count_a}</span>` : ''}${s.count_b ? `<span class="crowd__b" style="flex-grow:${s.count_b}">${s.count_b}</span>` : ''}</div>`
      : `<span class="count">${total ? `${total} tipp eddig` : ''}</span>`;
    const how = s && s.status === 'done' && s.method ? `<span class="how">${esc(s.method)}${s.round ? `, ${s.round}. menet` : ''}${s.time ? ` ${esc(s.time)}` : ''}</span>` : '';
    return `
      <article class="fight ${f.titleBout ? 'fight--title' : ''} fight--${st.cls}" id="f${f.id}">
        <div class="fight__meta">
          <span class="fight__class">${esc(weightName(f.weightClass))}${f.titleBout ? ', <b class="belt">címmeccs</b>' : ''}</span>
          <span class="fight__pts">${pts} pont</span>
          <span class="fight__state fight__state--${st.cls}">${esc(st.text)}</span>
        </div>
        ${s && s.changed && s.open ? `<p class="changed">Megváltozott a meccs${mine ? '' : ' — tippelj újra!'}</p>` : ''}
        <div class="fight__split">
          ${cornerHtml(f, 'A', s)}
          <span class="fight__vs" aria-hidden="true">vs</span>
          ${cornerHtml(f, 'B', s)}
        </div>
        <div class="fight__foot">
          ${result}${how}
          ${split}
          <button class="link" type="button" data-detail="${f.id}">Összevetés</button>
        </div>
      </article>`;
  }

  // Ranglista: „Ez a gála” vagy „Összesített” (minden gála; szűrhető számozott / Fight Night gálákra)
  const LB_KINDS = [[null, 'Mind'], ['numbered', 'Számozott'], ['fightnight', 'Fight Night']];

  function lbRows(lb, sub, crown) {
    let place = 0, prev = null;
    return lb.map((r, i) => {
      if (r.points !== prev) { place = i + 1; prev = r.points; }
      const me = state.me && r.nick.toLowerCase() === state.me.nick.toLowerCase();
      return `
        <li class="lb__row ${me ? 'is-me' : ''} ${place === 1 && crown ? 'is-first' : ''}">
          <span class="lb__place">${place}.</span>
          <span class="lb__nick">${esc(r.nick)}</span>
          <span class="lb__sub">${esc(sub(r))}</span>
          <span class="lb__pts">${r.points}<small> p</small></span>
        </li>`;
    }).join('');
  }

  function leaderboardView() {
    const tab = state.lbTab || 'gala';
    const tabs = `
      <div class="seg" role="tablist">
        <button type="button" role="tab" data-lb-tab="gala" aria-selected="${tab === 'gala'}">Ez a gála</button>
        <button type="button" role="tab" data-lb-tab="szezon" aria-selected="${tab === 'szezon'}">Szezon</button>
        <button type="button" role="tab" data-lb-tab="ossz" aria-selected="${tab === 'ossz'}">Összesített</button>
      </div>`;
    if (tab === 'szezon') return `${tabs}${seasonBody()}`;
    if (tab === 'ossz') {
      const kind = state.lbKind || null;
      const chips = `<div class="chips">${LB_KINDS.map(([k, label]) =>
        `<button type="button" class="chip-btn ${kind === k ? 'is-on' : ''}" data-lb-kind="${k || ''}">${label}</button>`).join('')}</div>`;
      const lb = state.overall && state.overall.kind === kind ? state.overall.rows : null;
      if (!lb) loadOverall(kind);
      const body = !lb ? '<div class="empty">Betöltés…</div>'
        : lb.length ? `<ol class="lb">${lbRows(lb, (r) => `${r.correct}/${r.decided} talált, ${r.events} gála`, lb.some((r) => r.decided))}</ol>`
        : '<div class="empty">Még senki nem csatlakozott.</div>';
      return `${tabs}${chips}${body}
        <p class="hint">Az összes eddigi gála pontjai együtt. Holtversenyben a több talált tipp dönt.</p>`;
    }
    const lb = state.board ? state.board.leaderboard : [];
    const done = state.board ? state.board.fights.filter((f) => f.status === 'done').length : 0;
    if (!lb.length) return `${tabs}<div class="empty">Még senki nem csatlakozott.</div>`;
    return `${tabs}
      <h2 class="section-h"><span>${esc(state.data.event.title.split(':')[0])}</span><time>${done}/${state.data.fights.length} meccs lement</time></h2>
      <ol class="lb">${lbRows(lb, (r) => `${r.correct}/${r.decided} talált, ${r.picks} tipp`, done)}</ol>
      ${done ? `<button class="btn btn--share" type="button" data-share="current">Ranglista megosztása képként</button>` : ''}
      <p class="hint">Holtversenyben a több talált tipp dönt; a sorrend minden eredmény után frissül.</p>`;
  }

  // Szezon: naptári évenként a gálák pontjai (az előzményekből számolva)
  function seasonBody() {
    if (!state.history) { loadHistory(); return '<div class="empty">Betöltés…</div>'; }
    const seasons = ST.season(state.history);
    const years = Object.keys(seasons);
    if (!years.length) return '<div class="empty">Még nincs lejátszott gála. Az első után itt jelenik meg az évi összesítés.</div>';
    const year = years.includes(String(state.seasonYear)) ? String(state.seasonYear) : years[0];
    const chips = years.length > 1 ? `<div class="chips">${years.map((y) =>
      `<button type="button" class="chip-btn ${y === year ? 'is-on' : ''}" data-season-year="${y}">${y}</button>`).join('')}</div>` : '';
    const rows = seasons[year];
    const gala = new Set(state.history.events.filter((e) => String(ST_year(e)) === year).map((e) => e.slug)).size;
    return `${chips}
      <h2 class="section-h"><span>${year}-es szezon</span><time>${gala} gála</time></h2>
      <ol class="lb">${lbRows(rows, (r) => `${r.correct}/${r.decided} talált, ${r.events} gála`, true)}</ol>
      <p class="hint">A naptári év gáláinak pontjai együtt. Holtversenyben a több talált tipp dönt.</p>`;
  }
  const ST_year = (e) => (e.starts_at ? +new Intl.DateTimeFormat('en', { timeZone: TZ, year: 'numeric' }).format(new Date(e.starts_at)) : null);

  async function loadOverall(kind) {
    if (loadOverall.busy === kind) return;
    loadOverall.busy = kind;
    try {
      const rows = await state.api.overall(kind);
      state.overall = { kind, rows };
      if (currentRoute() === 'ranglista') render();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      loadOverall.busy = undefined;
    }
  }

  // ------------------------------------------------------------ történet

  const KIND_NAME = { numbered: 'Számozott', fightnight: 'Fight Night' };
  const fmtDate = (iso) => (iso ? new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso)) : '');
  const isMe = (nick) => !!state.me && String(nick).toLowerCase() === state.me.nick.toLowerCase();
  const nickList = (nicks) => nicks.map(esc).join(', ');
  const rate = (g) => (g.picks ? `${Math.round((g.hits / g.picks) * 100)}% <small>(${g.hits}/${g.picks})</small>` : '–');

  function historyGate(render) {
    if (!state.history) { loadHistory(); return '<div class="empty">Betöltés…</div>'; }
    if (state.history.failed) return `<div class="empty">Nem sikerült betölteni az előzményeket: ${esc(state.history.failed)} Újra próbáljuk.</div>`;
    return render(state.history);
  }

  function historyView() {
    return historyGate((h) => {
      const { arg } = routeParts();
      if (arg) return historyEventView(arg);
      if (!h.events.length) return '<div class="empty">Még nincs lejátszott meccs. Az első gála után itt találod az összes korábbi estét: eredményeket, tippeket, győzteseket.</div>';
      const chips = `<div class="chips">${LB_KINDS.map(([k, label]) =>
        `<button type="button" class="chip-btn ${state.hKind === k ? 'is-on' : ''}" data-hist-kind="${k || ''}">${label}</button>`).join('')}</div>`;
      const list = h.events.filter((e) => !state.hKind || e.kind === state.hKind);
      return `<h2 class="section-h"><span>Korábbi gálák</span><time>${list.length} gála</time></h2>${chips}
        ${list.length ? list.map(histCard).join('') : '<div class="empty">Ebből a fajtából még nincs lejátszott gála.</div>'}`;
    });
  }

  function histCard(e) {
    const done = e.fights.filter((f) => f.status === 'done').length;
    const w = ST.eventWinners(e);
    const mine = ST.eventTable(e).find((r) => isMe(r.nick));
    const [num, ...rest] = e.title.split(':');
    return `
      <a class="hist" href="#tortenet/${encodeURIComponent(e.slug)}">
        <div class="hist__top"><b>${esc(num)}</b><time>${esc(fmtDate(e.starts_at))}</time></div>
        <div class="hist__sub">${esc(rest.join(':').trim())}</div>
        <div class="hist__meta">${esc(KIND_NAME[e.kind] || '')} · ${done}/${e.fights.length} meccs lement${w.complete ? '' : ' · folyamatban'}</div>
        ${w.nicks.length ? `<div class="hist__win"><span class="crown">${w.complete ? 'Győztes' : 'Éllovas'}</span><b>${nickList(w.nicks)}</b><span>${w.points} pont</span></div>` : ''}
        <div class="hist__me ${mine ? '' : 'is-none'}">${mine ? `Te: ${mine.place}. hely, ${mine.points} pont, ${mine.correct}/${mine.decided} talált` : 'Ezen a gálán nem tippeltél'}</div>
      </a>`;
  }

  function historyEventView(slug) {
    const e = state.history.events.find((x) => x.slug === slug);
    const back = '<a class="back" href="#tortenet">← Összes gála</a>';
    if (!e) return `${back}<div class="empty">Ez a gála nem található az előzmények között.</div>`;
    const table = ST.eventTable(e);
    const w = ST.eventWinners(e);
    const done = e.fights.filter((f) => f.status === 'done').length;
    const wrong = e.fights.filter((f) => ST.crowd(f).crowdWrong);
    const lone = e.fights.filter((f) => {
      const c = ST.crowd(f);
      return ST.decided(f) && c.total >= 3 && c.majority && c.majority !== f.winner && (f.winner === 'A' ? c.a : c.b) === 1;
    });
    const vs = (f) => `${lastName(f.a.name)} – ${lastName(f.b.name)}`;
    const insights = [
      ...wrong.slice(0, 4).map((f) => { const c = ST.crowd(f); return `A társaság tévedett: <b>${esc(vs(f))}</b> (${c.a}–${c.b}, ${f.winner === 'A' ? esc(lastName(f.a.name)) : esc(lastName(f.b.name))} nyert)`; }),
      ...lone.slice(0, 4).map((f) => `Egyedül eltalálta: <b>${esc(f.picks.find((p) => p.side === f.winner).nick)}</b> — ${esc(vs(f))}`),
    ];
    let html = `${back}
      <h2 class="section-h"><span>${esc(e.title.split(':')[0])}</span><time>${esc(fmtDate(e.starts_at))}</time></h2>
      <p class="hint">${esc(e.title.split(':').slice(1).join(':').trim())} · ${esc(KIND_NAME[e.kind] || '')} · ${done}/${e.fights.length} meccs lement${w.complete ? '' : ' (folyamatban)'}</p>`;
    if (table.length) {
      html += `<ol class="lb">${lbRows(table, (r) => `${r.correct}/${r.decided} talált`, done > 0)}</ol>
        ${done ? `<button class="btn btn--share" type="button" data-share="event:${esc(e.slug)}">Ranglista megosztása képként</button>` : ''}`;
    } else {
      html += '<div class="empty">Ezen a gálán senki nem tippelt.</div>';
    }
    if (insights.length) html += `<h3 class="tape__group">Érdekességek</h3><ul class="insights">${insights.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    ['main', 'prelims', 'early'].forEach((key) => {
      const list = e.fights.filter((f) => f.card === key).sort((x, y) => x.ord - y.ord);
      if (!list.length) return;
      html += `<h2 class="section-h"><span>${CARD_NAME[key]}</span></h2>` + list.map(histFight).join('');
    });
    return html;
  }

  function histFight(f) {
    const done = f.status === 'done';
    const none = f.winner === 'draw' || f.winner === 'nc';
    const mine = (f.picks || []).find((p) => isMe(p.nick));
    const c = ST.crowd(f);
    let res;
    if (!done) res = '<span class="res res--none">Nem dőlt el</span>';
    else if (none) res = `<span class="res res--none">${f.winner === 'draw' ? 'Döntetlen' : 'Nem értékelt'}, nincs pont</span>`;
    else if (!mine) res = '<span class="res res--none">Nem tippeltél</span>';
    else res = mine.side === f.winner ? `<span class="res res--hit">Talált, +${f.points} pont</span>` : '<span class="res res--miss">Nem talált</span>';
    const how = done && f.method ? `<span class="how">${esc(methodHu(f.method))}${f.round ? `, ${f.round}. menet` : ''}${f.time ? ` ${esc(f.time)}` : ''}</span>` : '';
    const side = (s) => {
      const x = s === 'A' ? f.a : f.b;
      const won = done && f.winner === s;
      const lost = done && !none && f.winner !== s;
      const pickedByMe = mine && mine.side === s;
      return `<div class="hf__side hf__side--${s.toLowerCase()} ${won ? 'is-winner' : ''} ${lost ? 'is-loser' : ''}">
          ${won ? '<span class="corner__win">Győztes</span>' : ''}${pickedByMe ? '<span class="corner__tick">Tipped</span>' : ''}
          <span class="hf__name">${esc(x.name || '?')}</span>
          ${x.rank ? `<span class="hf__rank">${x.rank === 'C' ? 'Bajnok' : esc('#' + x.rank)}</span>` : ''}
        </div>`;
    };
    const split = done && c.total
      ? `<div class="crowd" aria-label="A társaság tippjei: ${c.a} – ${c.b}">${c.a ? `<span class="crowd__a" style="flex-grow:${c.a}">${c.a}</span>` : ''}${c.b ? `<span class="crowd__b" style="flex-grow:${c.b}">${c.b}</span>` : ''}</div>` : '';
    const who = done && f.picks && f.picks.length ? `
      <details class="hf__who"><summary>Ki kire tippelt</summary>
        <div class="who">
          <ul class="who__a">${f.picks.filter((p) => p.side === 'A').map((p) => `<li class="${f.winner === 'A' ? 'is-hit' : ''}">${esc(p.nick)}</li>`).join('') || '<li class="muted">senki</li>'}</ul>
          <ul class="who__b">${f.picks.filter((p) => p.side === 'B').map((p) => `<li class="${f.winner === 'B' ? 'is-hit' : ''}">${esc(p.nick)}</li>`).join('') || '<li class="muted">senki</li>'}</ul>
        </div></details>` : '';
    return `
      <article class="hf ${f.title_bout ? 'hf--title' : ''}">
        <div class="fight__meta"><span class="fight__class">${esc(weightName(f.weight || ''))}${f.title_bout ? ', <b class="belt">címmeccs</b>' : ''}</span><span class="fight__pts">${f.points} pont</span></div>
        <div class="hf__split">${side('A')}${side('B')}</div>
        <div class="fight__foot">${res}${how}${split}</div>
        ${who}
      </article>`;
  }

  // ------------------------------------------------------------ statisztika

  const bar = (hit, miss) => {
    const n = hit + miss;
    return `<span class="bar" aria-hidden="true"><i class="bar__hit" style="width:${n ? (hit / n) * 100 : 0}%"></i></span>`;
  };
  const kv = (label, value) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;

  function statsView() {
    return historyGate((h) => {
      const ov = ST.overview(h);
      if (!ov.some((s) => s.picks)) return '<div class="empty">Még nincs eldőlt meccs. Az első gála után itt látod, ki hány százalékban talál, ki miben jó, és kinek mekkora a szériája.</div>';
      const selNick = state.statNick || (state.me && ov.find((s) => isMe(s.nick)) ? state.me.nick : ov[0].nick);
      const sel = ov.find((s) => s.nick.toLowerCase() === selNick.toLowerCase()) || ov[0];
      let html = `<h2 class="section-h"><span>Ki hány százalékot talál?</span></h2>
        <div class="srows">${ov.map((s) => `
          <button class="srow ${s.nick === sel.nick ? 'is-sel' : ''} ${isMe(s.nick) ? 'is-me' : ''}" type="button" data-stat-player="${esc(s.nick)}" aria-pressed="${s.nick === sel.nick}">
            <span class="srow__nick">${esc(s.nick)}</span>
            <span class="srow__pct">${s.pct == null ? '–' : s.pct + '%'}</span>
            ${bar(s.hits, s.misses)}
            <span class="srow__sub">${s.hits} talált · ${s.misses} nem talált · ${s.points} pont</span>
          </button>`).join('')}</div>
        <p class="hint">Koppints egy névre a részletekért. Csak az eldőlt meccsek számítanak (döntetlen és „nem értékelt" nem).</p>`;
      html += playerCard(sel);
      const aw = ST.awards(h);
      if (aw.length) {
        html += `<h2 class="section-h"><span>Díjak</span></h2><div class="awards">${aw.map((a) => `
          <div class="award ${isMe(a.nick) ? 'is-me' : ''}"><span class="award__t">${esc(a.title)}</span><b class="award__n">${esc(a.nick)}</b><span class="award__v">${esc(a.value)}</span><span class="award__d">${esc(a.desc)}</span></div>`).join('')}</div>
          <p class="hint">Díj csak legalább ${ST.MIN_PICKS} eldőlt tipp után jár.</p>`;
      }
      html += trophyBlock(h) + h2hBlock(h, ov);
      return html;
    });
  }

  function playerCard(s) {
    const cur = s.streak.current;
    const dots = s.recent.length ? `<span class="dots" aria-label="Utolsó ${s.recent.length} tipp">${s.recent.map((r) => `<i class="dot dot--${r}"></i>`).join('')}</span>` : '–';
    const favLine = s.fav.picks + s.dog.picks
      ? kv('Favoritra tippel', `${s.favShare}% <small>(${s.fav.picks}/${s.fav.picks + s.dog.picks} meccs)</small>`)
        + kv('Talál a favoriton', rate(s.fav)) + kv('Talál az esélytelenen', rate(s.dog))
      : '';
    const w = (x) => (x ? `${esc(weightName(x.name))} · ${x.pct}% <small>(${x.hits}/${x.picks})</small>` : '–');
    return `
      <section class="pcard" aria-label="${esc(s.nick)} részletei">
        <div class="pcard__head">
          <div class="pcard__pct">${s.pct == null ? '–' : s.pct}<small>${s.pct == null ? '' : '%'}</small></div>
          <div class="pcard__who"><b>${esc(s.nick)}</b><span>${s.hits} talált, ${s.misses} nem talált</span><span>${s.points} pont · ${s.events} gála</span></div>
        </div>
        ${kv('Utolsó tippek', dots)}
        ${kv('Jelenlegi széria', cur.n ? `${cur.n} ${cur.type === 'win' ? 'talált egymás után' : 'tévedés egymás után'}` : '–')}
        ${kv('Leghosszabb nyerő széria', s.streak.bestWin || '–')}
        ${kv('Leghosszabb rossz széria', s.streak.worstLoss || '–')}
        ${favLine}
        ${kv('Címmeccsek', rate(s.title))}
        ${kv('A többséggel tippel', rate(s.withCrowd))}
        ${kv('A tömeg ellen tippel', rate(s.againstCrowd))}
        ${kv('Legjobb súlycsoport', w(s.bestWeight))}
        ${kv('Leggyengébb súlycsoport', w(s.worstWeight))}
        ${kv('Rá szokott jól tippelni', s.favFighter ? `${esc(s.favFighter.name)} <small>(${s.favFighter.hits}×)</small>` : '–')}
        ${kv('Rá szokott tévedni', s.nemesis ? `${esc(s.nemesis.name)} <small>(${s.nemesis.picks - s.nemesis.hits}×)</small>` : '–')}
        ${s.byEvent.length ? `<h3 class="tape__group">Gálánként</h3>${s.byEvent.map((ev) => `
          <a class="kv kv--link" href="#tortenet/${encodeURIComponent(ev.slug)}"><span>${esc(ev.title.split(':')[0])}</span><b>${ev.points} pont <small>(${ev.correct}/${ev.decided})</small></b></a>`).join('')}` : ''}
      </section>`;
  }

  function trophyBlock(h) {
    const t = ST.trophies(h);
    if (!t.table.length) return '';
    const wins = t.events.filter((e) => e.complete && e.nicks.length);
    return `<h2 class="section-h"><span>Bajnokok</span></h2>
      <div class="trophies">${t.table.map((r) => `<div class="trophy ${isMe(r.nick) ? 'is-me' : ''}"><b>${esc(r.nick)}</b><span>${r.n} gála</span></div>`).join('')}</div>
      <ul class="champs">${wins.map((e) => `<li><a href="#tortenet/${encodeURIComponent(e.slug)}"><span>${esc(e.title.split(':')[0])}</span><b>${nickList(e.nicks)}</b><small>${e.points} pont</small></a></li>`).join('')}</ul>`;
  }

  function h2hBlock(h, ov) {
    if (ov.length < 2) return '';
    const nicks = ov.map((s) => s.nick).sort((a, b) => a.localeCompare(b, 'hu'));
    const me = state.me && nicks.find((n) => isMe(n));
    const a = nicks.includes(state.h2h.a) ? state.h2h.a : (me || nicks[0]);
    const b = nicks.includes(state.h2h.b) && state.h2h.b !== a ? state.h2h.b : nicks.find((n) => n !== a);
    const opts = (cur) => nicks.map((n) => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const r = ST.headToHead(h, a, b);
    let body = '<p class="hint">Nincs olyan meccs, amire mindketten tippeltek.</p>';
    if (r.common) {
      body = `
        <div class="h2h__score"><span class="h2h__a">${r.pointsA}</span><small>pont a közös meccseken</small><span class="h2h__b">${r.pointsB}</span></div>
        ${kv('Közös meccs', r.common)}
        ${kv('Egyetértés', `${r.agreePct}% <small>(${r.agree}/${r.common} meccsen ugyanarra tippeltek)</small>`)}
        ${kv('Mindketten eltalálták', r.bothHit)}
        ${kv(`Csak ${esc(a)} találta el`, r.onlyA)}
        ${kv(`Csak ${esc(b)} találta el`, r.onlyB)}
        ${kv('Egyikük sem', r.bothMiss)}
        ${kv('Gálák', `${esc(a)} ${r.eventsA} · ${esc(b)} ${r.eventsB} · döntetlen ${r.eventsTie}`)}`;
    }
    return `<h2 class="section-h"><span>Fej-fej mellett</span></h2>
      <div class="h2h">
        <div class="h2h__pick"><select data-h2h="a" aria-label="Első játékos">${opts(a)}</select><span>vs</span><select data-h2h="b" aria-label="Második játékos">${opts(b)}</select></div>
        ${body}
      </div>`;
  }

  // ------------------------------------------------------------ megosztás képként, emlékeztető

  // A ranglista képe (1080 px széles): Web Share, ha a telefon tudja, különben letöltés
  async function shareImage(title, sub, rows) {
    try { await Promise.all([document.fonts.load('900 80px "Big Shoulders Display"'), document.fonts.load('600 32px Barlow')]); } catch (e) { /* alapbetű */ }
    const show = rows.slice(0, 10);
    const W = 1080, rowH = 112, top = 330;
    const H = top + show.length * rowH + 150;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#151a22'; g.fillRect(0, 0, W, H);
    // plakát-sáv: piros és kék oldal, mint a belépő képernyőn
    g.fillStyle = '#7c1f22'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W / 2 + 40, 0); g.lineTo(W / 2 - 40, 270); g.lineTo(0, 270); g.fill();
    g.fillStyle = '#1a3c78'; g.beginPath(); g.moveTo(W / 2 + 46, 0); g.lineTo(W, 0); g.lineTo(W, 270); g.lineTo(W / 2 - 34, 270); g.fill();
    g.fillStyle = '#eef1f5'; g.textBaseline = 'alphabetic';
    g.font = '900 104px "Big Shoulders Display", "Arial Narrow", sans-serif';
    g.fillText(title.toUpperCase(), 54, 140, W - 108);
    g.font = '600 34px Barlow, system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillText(sub, 54, 200, W - 108);
    g.font = '700 30px Barlow, system-ui, sans-serif'; g.fillStyle = '#e0b04a';
    g.fillText('RANGLISTA', 54, 250);
    show.forEach((r, i) => {
      const y = top + i * rowH;
      g.fillStyle = i === 0 ? '#2a2616' : '#1d2430'; g.beginPath(); g.roundRect(40, y, W - 80, rowH - 14, 16); g.fill();
      g.fillStyle = i === 0 ? '#e0b04a' : '#98a4b6'; g.font = '800 54px "Big Shoulders Display", sans-serif';
      g.fillText(r.place + '.', 70, y + 68);
      g.fillStyle = '#eef1f5'; g.font = '700 40px Barlow, system-ui, sans-serif';
      g.fillText(r.nick, 170, y + 56, 520);
      g.fillStyle = '#98a4b6'; g.font = '500 26px Barlow, system-ui, sans-serif';
      g.fillText(r.sub, 170, y + 88, 520);
      g.textAlign = 'right'; g.fillStyle = i === 0 ? '#e0b04a' : '#eef1f5'; g.font = '900 64px "Big Shoulders Display", sans-serif';
      g.fillText(r.points + ' p', W - 70, y + 70);
      g.textAlign = 'left';
    });
    g.fillStyle = '#98a4b6'; g.font = '500 26px Barlow, system-ui, sans-serif';
    g.fillText('UFC Tipp · ' + location.host + location.pathname.replace(/index\.html$/, ''), 54, H - 56);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('A kép elkészítése nem sikerült.');
    const name = 'ufc-tipp-ranglista.png';
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `${title} ranglista` }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  }

  async function onShare(which) {
    let title, sub, rows;
    if (which === 'current') {
      const lb = state.board ? state.board.leaderboard.filter((r) => r.picks) : [];
      let place = 0, prev = null;
      title = state.data.event.title.split(':')[0];
      sub = state.data.event.title.split(':').slice(1).join(':').trim();
      rows = lb.map((r, i) => { if (r.points !== prev) { place = i + 1; prev = r.points; } return { place, nick: r.nick, points: r.points, sub: `${r.correct}/${r.decided} talált` }; });
    } else {
      const e = state.history && state.history.events.find((x) => x.slug === which.replace('event:', ''));
      if (!e) return;
      title = e.title.split(':')[0];
      sub = `${e.title.split(':').slice(1).join(':').trim()} · ${fmtDate(e.starts_at)}`;
      rows = ST.eventTable(e).map((r) => ({ place: r.place, nick: r.nick, points: r.points, sub: `${r.correct}/${r.decided} talált` }));
    }
    if (!rows.length) { toast('Még nincs mit megosztani.', 'err'); return; }
    const r = await shareImage(title, sub, rows);
    if (r === 'saved') toast('A kép letöltődött — küldd el a csoportba', 'ok');
  }

  // Naptár-emlékeztető (.ics): a kártya három kezdési ideje, mindegyik előtt 30 perccel jelzéssel
  function downloadIcs() {
    const ev = state.data.event;
    const stamp = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const fold = (s) => s.replace(/[,;\\]/g, (c) => '\\' + c);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UfcTipp//HU', 'CALSCALE:GREGORIAN'];
    ev.sections.filter((s) => s.start).forEach((s) => {
      lines.push('BEGIN:VEVENT', `UID:${ev.slug}-${s.key}@ufctipp`, `DTSTAMP:${stamp(Date.now())}`,
        `DTSTART:${stamp(s.start * 1000)}`, `DTEND:${stamp((s.start + (s.key === 'main' ? 3.5 : 2) * 3600) * 1000)}`,
        `SUMMARY:${fold(`${ev.title.split(':')[0]} — ${CARD_NAME[s.key]}`)}`,
        `DESCRIPTION:${fold('Tippelj, mielőtt a meccs elindul: ' + location.href.split('#')[0])}`,
        'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${fold('Mindjárt kezdődik, tippeltél már?')}`, 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ufc-tipp-${ev.slug}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Naptár-fájl letöltve — nyisd meg, és mentsd a naptáradba', 'ok');
  }

  // „Még N nap M óra" a gála kezdetéig (csak a kezdés előtt látszik)
  function countdownHtml() {
    const starts = state.data.event.sections.map((s) => s.start).filter(Boolean).map((s) => s * 1000);
    if (!starts.length) return '';
    const first = Math.min(...starts);
    const left = first - Date.now();
    if (left <= 0) return '';
    const min = Math.floor(left / 60000);
    const d = Math.floor(min / 1440), hr = Math.floor((min % 1440) / 60), m = min % 60;
    const txt = d ? `${d} nap ${hr} óra` : hr ? `${hr} óra ${m} perc` : `${m} perc`;
    return `
      <div class="remind">
        <div><b>Még ${txt}</b> a gála kezdetéig <small>(${esc(fmtDay(first))}, ${esc(fmtTime(first))})</small></div>
        <p>A tippelés meccsenként zár, amikor az adott meccs elindul.</p>
        <button class="btn" type="button" data-ics>Emlékeztető a naptárba</button>
      </div>`;
  }

  // ------------------------------------------------------------ összevetés (alsó panel)

  const n = (v) => { const x = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(x) ? null : x; };
  const mmss = (v) => { const m = /^(\d+):(\d+)$/.exec(String(v || '')); return m ? +m[1] * 60 + +m[2] : null; };

  // [címke, érték(a, oldal), összehasonlítás: 1 = a nagyobb jobb, -1 = a kisebb jobb, 0 = nincs]
  const TAPE = [
    ['Alapadatok'],
    ['Rekord', (a) => rec(a), 0],
    ['Rangsor', (a, c) => (c.rank === 'C' ? 'Bajnok' : c.rank || '–'), 0],
    ['Fogadóirodai esély', (a, c) => { const p = impliedPct(c.odds); return p == null ? '–' : p + '%'; }, 1],
    ['Kor', (a) => a.age ?? '–', 0],
    ['Magasság', (a) => (a.heightCm ? a.heightCm + ' cm' : '–'), 0],
    ['Karfesztáv', (a) => (a.reachCm ? a.reachCm + ' cm' : '–'), 1],
    ['Lábhossz', (a) => (a.legReachCm ? a.legReachCm + ' cm' : '–'), 0],
    ['Ország', (a, c) => countryHu(c.country) || '–', 0],
    ['Edzőterem', (a) => (a.bio && a.bio['Trains at']) || '–', 0],
    ['Harcstílus', (a) => (a.bio && a.bio['Fighting style']) || '–', 0],
    ['UFC-debüt', (a) => dateHu(a.bio && a.bio['Octagon Debut']) || '–', 0],
    ['Állóharc'],
    ['Bevitt ütés / perc', (a) => a.rates?.['Sig. Str. Landed'] ?? '–', 1],
    ['Kapott ütés / perc', (a) => a.rates?.['Sig. Str. Absorbed'] ?? '–', -1],
    ['Ütéspontosság', (a) => (a.accuracy?.striking != null ? a.accuracy.striking + '%' : '–'), 1],
    ['Ütésvédekezés', (a) => a.rates?.['Sig. Str. Defense'] ?? '–', 1],
    ['Leütés / 15 perc', (a) => a.rates?.['Knockdown Avg'] ?? '–', 1],
    ['Birkózás'],
    ['Levitel / 15 perc', (a) => a.rates?.['Takedown avg'] ?? '–', 1],
    ['Levitel-pontosság', (a) => (a.accuracy?.takedown != null ? a.accuracy.takedown + '%' : '–'), 1],
    ['Levitel-védekezés', (a) => a.rates?.['Takedown Defense'] ?? '–', 1],
    ['Feladási kísérlet / 15 perc', (a) => a.rates?.['Submission avg'] ?? '–', 1],
    ['Győzelmek'],
    ['KO/TKO-val', (a) => a.hero?.['Wins by Knockout'] ?? '–', 1],
    ['Feladással', (a) => a.hero?.['Wins by Submission'] ?? '–', 1],
    ['Pontozással', (a) => a.bars?.DEC?.n ?? '–', 0],
    ['Első menetben', (a) => a.hero?.['First Round Finishes'] ?? '–', 1],
    ['Átlagos meccsidő', (a) => a.rates?.['Average fight time'] ?? '–', 0],
    ['Hova üt'],
    ['Fejre', (a) => (a.target?.head ? a.target.head.pct + '%' : '–'), 0],
    ['Testre', (a) => (a.target?.body ? a.target.body.pct + '%' : '–'), 0],
    ['Lábra', (a) => (a.target?.leg ? a.target.leg.pct + '%' : '–'), 0],
    ['Állva', (a) => (a.bars?.Standing ? a.bars.Standing.pct + '%' : '–'), 0],
    ['Klincsben', (a) => (a.bars?.Clinch ? a.bars.Clinch.pct + '%' : '–'), 0],
    ['Földön', (a) => (a.bars?.Ground ? a.bars.Ground.pct + '%' : '–'), 0],
  ];

  function tapeHtml(f) {
    const A = athlete(f.a.slug), B = athlete(f.b.slug);
    return TAPE.map(([label, get, dir]) => {
      if (!get) return `<h3 class="tape__group">${esc(label)}</h3>`;
      const va = get(A, f.a), vb = get(B, f.b);
      let ca = '', cb = '';
      if (dir) {
        const x = mmss(va) ?? n(va), y = mmss(vb) ?? n(vb);
        if (x != null && y != null && x !== y) {
          const aBetter = dir > 0 ? x > y : x < y;
          ca = aBetter ? 'is-better' : ''; cb = aBetter ? '' : 'is-better';
        }
      }
      return `<div class="tape__row"><span class="tape__a ${ca}">${esc(va)}</span><span class="tape__label">${esc(label)}</span><span class="tape__b ${cb}">${esc(vb)}</span></div>`;
    }).join('');
  }

  function lastFightsHtml(a) {
    if (!a.lastFights || !a.lastFights.length) return '<p class="hint">Első UFC-meccse lesz, még nincs UFC-s előzménye.</p>';
    return `<ul class="last">${a.lastFights.map((l) => `
      <li class="last__item last__item--${l.result}">
        <span class="last__res">${l.result === 'win' ? 'GY' : l.result === 'loss' ? 'V' : '–'}</span>
        <span class="last__opp">${esc(l.opponent || '?')}</span>
        <span class="last__how">${esc(methodHu(l.method))}${l.round ? `, ${esc(l.round)}. menet` : ''}</span>
        <span class="last__date">${esc(dateHu(l.date))}</span>
      </li>`).join('')}</ul>`;
  }

  function sheetHtml(f) {
    const s = fightState(f.id);
    const st = statusLabel(s);
    const A = athlete(f.a.slug), B = athlete(f.b.slug);
    const open = !s || s.open;
    const mine = state.picks[f.id];
    const fh = figureHeights(f);
    const fig = (c, side) => `
      <div class="vs__fig vs__fig--${side}">
        ${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" style="--fh:${fh[side]}">` : ''}
        ${heightOf(c) ? `<span class="vs__cm">${heightOf(c)} cm</span>` : ''}
      </div>`;
    const head = (c, a, side) => `
      <div class="vs__side vs__side--${side}">
        <div class="vs__name">${esc(c.name)}</div>
        ${a.nickname ? `<div class="vs__nick">„${esc(a.nickname)}”</div>` : ''}
        <div class="vs__country">${c.flag ? `<img src="${esc(c.flag)}" alt="">` : ''}${esc(countryHu(c.country))}</div>
      </div>`;
    let picksHtml = '';
    if (s && s.status === 'done' && s.picks) {
      const col = (side) => s.picks.filter((p) => p.side === side).map((p) => `<li>${esc(p.nick)}</li>`).join('') || '<li class="muted">senki</li>';
      picksHtml = `
        <h3 class="tape__group">Ki kire tippelt</h3>
        <div class="who"><ul class="who__a">${col('A')}</ul><ul class="who__b">${col('B')}</ul></div>`;
    } else if (s) {
      picksHtml = `<p class="hint">${s.count_total || 0} tipp érkezett eddig. Hogy ki kire tippelt, az a meccs végén derül ki.</p>`;
    }
    return `
      <h2 class="sheet__title" id="sheetTitle">${esc(weightName(f.weightClass))}${f.titleBout ? ', címmeccs' : ''}</h2>
      <p class="sheet__state fight__state--${st.cls}">${esc(st.text)}</p>
      <div class="vs__figs">${fig(f.a, 'a')}${fig(f.b, 'b')}</div>
      <div class="vs">${head(f.a, A, 'a')}<span class="vs__x">vs</span>${head(f.b, B, 'b')}</div>
      ${state.me && open ? `
        <div class="pickbar">
          <button class="btn btn--a ${mine === 'A' ? 'is-picked' : ''}" type="button" data-pick="A" data-fight="${f.id}">${mine === 'A' ? 'Tipped: ' : 'Tippelek: '}${esc(lastName(f.a.name))}</button>
          <button class="btn btn--b ${mine === 'B' ? 'is-picked' : ''}" type="button" data-pick="B" data-fight="${f.id}">${mine === 'B' ? 'Tipped: ' : 'Tippelek: '}${esc(lastName(f.b.name))}</button>
        </div>` : ''}
      <div class="tape">${tapeHtml(f)}</div>
      ${picksHtml}
      <h3 class="tape__group">Utolsó UFC-meccsek</h3>
      <div class="lasts">
        <div><h4>${esc(lastName(f.a.name))}</h4>${lastFightsHtml(A)}</div>
        <div><h4>${esc(lastName(f.b.name))}</h4>${lastFightsHtml(B)}</div>
      </div>
      <p class="source">Forrás: UFC.com, <a href="${esc(A.url)}" target="_blank" rel="noopener">${esc(A.name)}</a> és <a href="${esc(B.url)}" target="_blank" rel="noopener">${esc(B.name)}</a> profilja. Az esély a fogadóirodai szorzóból számolt százalék.</p>`;
  }

  function renderSheet(id, keepScroll) {
    const f = state.data.fights.find((x) => x.id === id);
    if (!f) return;
    const panel = $('.sheet__panel');
    const top = panel.scrollTop;
    $('#sheetBody').innerHTML = sheetHtml(f);
    if (keepScroll) panel.scrollTop = top;
  }

  function openSheet(id) {
    state.sheetFight = id;
    renderSheet(id);
    $('#sheet').hidden = false;
    document.body.classList.add('no-scroll');
    $('.sheet__panel').scrollTop = 0;
    $('.sheet__close').focus();
  }

  function closeSheet() {
    if ($('#sheet').hidden) return;
    $('#sheet').hidden = true;
    document.body.classList.remove('no-scroll');
    const back = state.sheetFight ? document.querySelector(`[data-detail="${state.sheetFight}"]`) : null;
    state.sheetFight = null;
    if (back) back.focus();
  }

  function meSheet() {
    state.sheetFight = null;
    const link = location.href.split('#')[0];
    $('#sheetBody').innerHTML = `
      <h2 class="sheet__title" id="sheetTitle">${esc(state.me.nick)}</h2>
      <p class="hint">Hívd meg a barátaidat ezzel a linkkel:</p>
      <div class="invite"><input readonly value="${esc(link)}" aria-label="Meghívó link"><button class="btn" type="button" data-copy="${esc(link)}">Másolás</button></div>
      <button class="btn btn--ghost" type="button" data-logout>Kijelentkezés ezen a telefonon</button>
      <p class="hint">Kijelentkezés után a becenévvel és a PIN-nel bármikor visszajöhetsz; a tippjeid megmaradnak.</p>`;
    $('#sheet').hidden = false;
    document.body.classList.add('no-scroll');
  }

  // ------------------------------------------------------------ admin

  function adminLoginView() {
    return `
      <section class="join">
        <h2 class="section-h"><span>Admin</span></h2>
        <form class="join__form" data-form="admin">
          <label class="field"><span>Admin-PIN</span><input name="pin" type="password" required autocomplete="current-password"></label>
          <button class="btn btn--primary" type="submit">Belépés adminként</button>
          ${state.api.mode === 'demo' ? '<p class="hint">Demó módban az admin-PIN: 0000.</p>' : ''}
        </form>
      </section>`;
  }

  function adminFight(f) {
    const s = fightState(f.id) || {};
    const st = statusLabel(fightState(f.id));
    const lockLocal = s.lock_at ? toLocalInput(Date.parse(s.lock_at)) : '';
    const radio = (v, label) => `<label class="chip"><input type="radio" name="w${f.id}" value="${v}" ${s.winner === v ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    return `
      <article class="adm" id="adm${f.id}" data-fight="${f.id}">
        <div class="adm__head">
          <b>${esc(lastName(f.a.name))} – ${esc(lastName(f.b.name))}</b>
          <span class="fight__state fight__state--${st.cls}" data-adm-state>${esc(st.text)}</span>
          <span class="count" data-adm-count>${s.count_total ?? 0} tipp</span>
        </div>
        <div class="adm__row">
          ${s.open !== false ? `<button class="btn btn--lock" type="button" data-adm="lock">Tippelés lezárása</button>`
            : `<button class="btn btn--ghost" type="button" data-adm="open">Újranyitás</button>`}
        </div>
        <div class="adm__row adm__wrap">
          ${radio('A', lastName(f.a.name))}${radio('B', lastName(f.b.name))}${radio('draw', 'Döntetlen')}${radio('nc', 'Nem értékelt')}
        </div>
        <div class="adm__row adm__wrap">
          <select name="method" aria-label="Győzelem módja"><option value="">Mód…</option>${METHODS.map((m) => `<option ${s.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
          <select name="round" aria-label="Menet"><option value="">Menet…</option>${[1, 2, 3, 4, 5].map((r) => `<option value="${r}" ${s.round === r ? 'selected' : ''}>${r}. menet</option>`).join('')}</select>
          <input name="time" placeholder="idő, pl. 3:21" value="${esc(s.time || '')}" aria-label="Idő a menetben" size="8">
        </div>
        <div class="adm__row">
          <button class="btn btn--primary" type="button" data-adm="result">Eredmény mentése</button>
          ${s.status === 'done' ? '<button class="btn btn--ghost" type="button" data-adm="unresult">Eredmény törlése</button>' : ''}
        </div>
        <details class="adm__more">
          <summary>Tartalék automatikus zárás</summary>
          <div class="adm__row adm__wrap">
            <input type="datetime-local" name="lock_at" value="${lockLocal}" aria-label="Automatikus zárás ideje">
            <button class="btn" type="button" data-adm="lockat">Mentés</button>
            ${s.lock_at ? '<button class="btn btn--ghost" type="button" data-adm="nolockat">Kikapcsolás</button>' : ''}
          </div>
          <p class="hint">Ha az admin addig nem zárja le, ekkor magától lezárul.</p>
        </details>
      </article>`;
  }

  function toLocalInput(ts) {
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function adminView() {
    const link = location.href.split('#')[0];
    let html = `
      <h2 class="section-h"><span>Admin</span><button class="link" type="button" data-adm-logout>Kilépés</button></h2>
      <div class="invite"><input readonly value="${esc(link)}" aria-label="Meghívó link"><button class="btn" type="button" data-copy="${esc(link)}">Link másolása</button></div>
      <p class="hint">Az automata magától zárja a meccseket a kezdéskor, és rögzíti a győztest. Itt csak akkor kell bármit tenned, ha valami nem stimmel: a kézi döntésedet az automata nem írja felül.</p>
      <p class="sync">Utolsó automatikus frissítés: ${state.event && state.event.last_sync_at
        ? esc(new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(Date.parse(state.event.last_sync_at)))
        : 'még nem volt'}${state.event && state.event.sync_note ? ` (${esc(state.event.sync_note)})` : ''}</p>`;
    ['main', 'prelims', 'early'].forEach((key) => {
      const list = state.data.fights.filter((f) => f.card === key);
      html += `<h2 class="section-h"><span>${CARD_NAME[key]}</span></h2>` + list.map(adminFight).join('');
    });
    html += `<h2 class="section-h"><span>Játékosok</span><button class="link" type="button" data-adm-players>Betöltés</button></h2><div id="admPlayers"></div>`;
    return html;
  }

  // Lekérdezéskor az admin-űrlapokat nem rajzoljuk újra (elveszne a félig kitöltött eredmény), csak az állapotot
  function renderAdminStatusOnly() {
    if (!state.board || !state.adminPin) return;
    state.board.fights.forEach((s) => {
      const box = document.getElementById('adm' + s.id);
      if (!box) return;
      const st = statusLabel(s);
      const el = box.querySelector('[data-adm-state]');
      el.textContent = st.text;
      el.className = 'fight__state fight__state--' + st.cls;
      box.querySelector('[data-adm-count]').textContent = `${s.count_total} tipp`;
    });
  }

  async function adminAction(btn) {
    const box = btn.closest('[data-fight]');
    const id = +box.dataset.fight;
    const act = btn.dataset.adm;
    const pin = state.adminPin;
    const api = state.api;
    btn.disabled = true;
    try {
      if (act === 'lock') await api.adminSetFight(pin, id, 'locked');
      else if (act === 'open') await api.adminSetFight(pin, id, 'open');
      else if (act === 'unresult') await api.adminSetFight(pin, id, 'locked');
      else if (act === 'result') {
        const w = box.querySelector(`input[name="w${id}"]:checked`);
        if (!w) throw new Error('Jelöld be a győztest (vagy a döntetlent).');
        await api.adminSetFight(pin, id, 'done', {
          winner: w.value,
          method: box.querySelector('[name="method"]').value,
          round: +box.querySelector('[name="round"]').value || null,
          time: box.querySelector('[name="time"]').value.trim(),
        });
      } else if (act === 'lockat') {
        const v = box.querySelector('[name="lock_at"]').value;
        if (!v) throw new Error('Adj meg időpontot.');
        await api.adminSetLockAt(pin, id, new Date(v).toISOString());
      } else if (act === 'nolockat') await api.adminSetLockAt(pin, id, null);
      const done = { lock: 'Lezárva', open: 'Újranyitva', unresult: 'Eredmény törölve', result: 'Eredmény mentve', lockat: 'Időpont mentve', nolockat: 'Időzítés kikapcsolva' };
      toast(done[act], 'ok');
      state.board = await loadBoard();
      const scroll = window.scrollY;
      box.outerHTML = adminFight(state.data.fights.find((f) => f.id === id));
      window.scrollTo(0, scroll);
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false;
      if (/admin-PIN/.test(e.message)) { state.adminPin = null; store.del(ADMIN_KEY, true); render(); }
    }
  }

  async function loadPlayers() {
    const box = $('#admPlayers');
    try {
      const list = await state.api.adminPlayers(state.adminPin);
      box.innerHTML = list.length ? `<ul class="players">${list.map((p) => `
        <li data-nick="${esc(p.nick)}">
          <b>${esc(p.nick)}</b><span class="count">${p.picks} tipp</span>
          <input name="newpin" inputmode="numeric" maxlength="4" placeholder="új PIN" aria-label="Új PIN ${esc(p.nick)} számára">
          <button class="btn" type="button" data-adm-pin>PIN csere</button>
          <button class="btn btn--ghost" type="button" data-adm-del>Törlés</button>
        </li>`).join('')}</ul>` : '<p class="hint">Még nincs játékos.</p>';
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  // ------------------------------------------------------------ események

  async function pick(id, side) {
    const s = fightState(id);
    if (s && !s.open) { toast('Ez a meccs már le van zárva.', 'err'); return; }
    if (state.busy.has(id)) return;
    const prev = state.picks[id];
    const next = prev === side ? null : side;
    state.busy.add(id);
    if (next) state.picks[id] = next; else delete state.picks[id];
    rerenderFight(id);
    try {
      await state.api.pick(state.me.nick, state.me.pin, id, next);
      const f = state.data.fights.find((x) => x.id === id);
      toast(next ? `Tipped: ${(next === 'A' ? f.a : f.b).name}` : 'Tipp visszavonva', 'ok');
      state.board = await loadBoard().catch(() => state.board);
    } catch (e) {
      if (prev) state.picks[id] = prev; else delete state.picks[id];
      toast(e.message, 'err');
      state.board = await loadBoard().catch(() => state.board);
    } finally {
      state.busy.delete(id);
      rerenderFight(id);
    }
  }

  function rerenderFight(id) {
    const el = document.getElementById('f' + id);
    const f = state.data.fights.find((x) => x.id === id);
    if (el && f) el.outerHTML = fightRow(f);
    const sum = $('.summary');
    if (sum && currentRoute() === 'kartya') {
      const tmp = document.createElement('div');
      tmp.innerHTML = cardView();
      sum.replaceWith(tmp.querySelector('.summary'));
      const nudge = $('.nudge'), newNudge = tmp.querySelector('.nudge');
      if (nudge && newNudge) nudge.replaceWith(newNudge);
      else if (nudge) nudge.remove();
      else if (newNudge) $('.summary').after(newNudge);
    }
    if (state.sheetFight === id) renderSheet(id, true);
  }

  function onClick(e) {
    const t = e.target;
    const pickBtn = t.closest('[data-pick]');
    if (pickBtn) {
      if (pickBtn.getAttribute('aria-disabled') === 'true') { openSheet(+pickBtn.dataset.fight); return; }
      pick(+pickBtn.dataset.fight, pickBtn.dataset.pick);
      return;
    }
    const lbTab = t.closest('[data-lb-tab]');
    if (lbTab) { state.lbTab = lbTab.dataset.lbTab; render(); return; }
    const lbKind = t.closest('[data-lb-kind]');
    if (lbKind) { state.lbKind = lbKind.dataset.lbKind || null; render(); return; }
    const hKind = t.closest('[data-hist-kind]');
    if (hKind) { state.hKind = hKind.dataset.histKind || null; render(); return; }
    const statPlayer = t.closest('[data-stat-player]');
    if (statPlayer) { state.statNick = statPlayer.dataset.statPlayer; render(); return; }
    const seasonYear = t.closest('[data-season-year]');
    if (seasonYear) { state.seasonYear = seasonYear.dataset.seasonYear; render(); return; }
    const share = t.closest('[data-share]');
    if (share) {
      share.disabled = true;
      onShare(share.dataset.share).catch((er) => toast(er.message || 'A megosztás nem sikerült.', 'err')).finally(() => { share.disabled = false; });
      return;
    }
    if (t.closest('[data-ics]')) { downloadIcs(); return; }
    const detail = t.closest('[data-detail]');
    if (detail) { openSheet(+detail.dataset.detail); return; }
    if (t.closest('[data-close]')) { closeSheet(); return; }
    if (t.closest('#meBtn')) { meSheet(); return; }
    const copy = t.closest('[data-copy]');
    if (copy) {
      const text = copy.dataset.copy;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(() => toast('Link kimásolva', 'ok'))
        .catch(() => { const inp = copy.parentElement.querySelector('input'); inp.select(); toast('Jelöld ki és másold ki a linket.'); });
      return;
    }
    if (t.closest('[data-logout]')) {
      store.del(ME_KEY); store.del(ME_KEY + '-ufc-333'); state.me = null; state.picks = {}; closeSheet(); render(); return;
    }
    const adm = t.closest('[data-adm]');
    if (adm) { adminAction(adm); return; }
    if (t.closest('[data-adm-logout]')) { state.adminPin = null; store.del(ADMIN_KEY, true); location.hash = '#kartya'; render(); return; }
    if (t.closest('[data-adm-players]')) { loadPlayers(); return; }
    const del = t.closest('[data-adm-del]');
    if (del) {
      const nick = del.closest('[data-nick]').dataset.nick;
      if (!del.classList.contains('is-armed')) { del.classList.add('is-armed'); del.textContent = `Biztos? ${nick} tippjei is törlődnek`; return; }
      state.api.adminDeletePlayer(state.adminPin, nick).then(() => { toast(`${nick} törölve`, 'ok'); loadPlayers(); }).catch((er) => toast(er.message, 'err'));
      return;
    }
    const pinBtn = t.closest('[data-adm-pin]');
    if (pinBtn) {
      const li = pinBtn.closest('[data-nick]');
      const np = li.querySelector('[name="newpin"]').value.trim();
      state.api.adminResetPin(state.adminPin, li.dataset.nick, np).then(() => toast(`${li.dataset.nick} új PIN-je: ${np}`, 'ok')).catch((er) => toast(er.message, 'err'));
    }
  }

  async function onSubmit(e) {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      if (form.dataset.form === 'join') {
        const nick = form.nick.value.trim();
        const pin = form.pin.value.trim();
        const r = await state.api.join(nick, pin);
        state.me = { nick: r.nick, pin };
        store.set(ME_KEY, state.me);
        state.picks = await state.api.myPicks(r.nick, pin);
        toast(r.created ? `Üdv a játékban, ${r.nick}!` : `Üdv újra, ${r.nick}!`, 'ok');
        state.board = await loadBoard().catch(() => state.board);
        location.hash = '#kartya';
        render();
      } else if (form.dataset.form === 'admin') {
        const pin = form.pin.value;
        await state.api.adminCheck(pin);
        state.adminPin = pin;
        store.set(ADMIN_KEY, pin, true);
        state.board = await loadBoard().catch(() => state.board);
        render();
      }
    } catch (er) {
      toast(er.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  start();
})();
