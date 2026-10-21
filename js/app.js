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
  };

  // ------------------------------------------------------------ segédek

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, session) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(k)); } catch (e) { return null; } },
    set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch (e) { /* privát mód */ } },
    del(k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch (e) { /* privát mód */ } },
  };
  const ME_KEY = 'ufctipp-me-' + cfg.event;
  const ADMIN_KEY = 'ufctipp-admin-' + cfg.event;

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

  async function start() {
    try {
      const res = await fetch(`data/${cfg.event}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.data = await res.json();
    } catch (e) {
      $('#view').innerHTML = `<div class="empty">Nem töltődött be az est adata (data/${esc(cfg.event)}.json). Frissítsd az oldalt.</div>`;
      return;
    }
    state.api = window.createApi(cfg, state.data);
    $('#demoBanner').hidden = state.api.mode !== 'demo';
    $('#eventName').textContent = state.data.event.title.split(':')[0];
    $('#eventSub').textContent = state.data.event.title.split(':').slice(1).join(':').trim();
    state.me = store.get(ME_KEY);
    state.adminPin = store.get(ADMIN_KEY, true);

    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
    window.addEventListener('hashchange', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

    if (state.me) {
      try {
        state.picks = await state.api.myPicks(state.me.nick, state.me.pin);
      } catch (e) {
        // törölt játékos vagy megváltozott PIN: újra be kell lépni
        if (/becenév|PIN/i.test(e.message)) { state.me = null; store.del(ME_KEY); }
      }
    }
    await refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  }

  async function refresh() {
    try {
      state.board = await state.api.board();
    } catch (e) {
      if (!state.board) toast(e.message, 'err');
    }
    // Űrlapos nézetet (belépés, admin) nem rajzolunk újra, mert elveszne a félig beírt adat
    const shown = $('#view').dataset.route;
    if (shown === 'admin') renderAdminStatusOnly();
    else if (shown !== 'join') render();
    if (state.sheetFight) renderSheet(state.sheetFight, true);
  }

  function currentRoute() {
    const h = location.hash.replace('#', '');
    return ['kartya', 'ranglista', 'admin'].includes(h) ? h : 'kartya';
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
      view.innerHTML = route === 'ranglista' ? leaderboardView() : cardView();
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
    let html = `
      <div class="summary">
        <div><b>${picked}/${fights.length}</b><span>tipped</span></div>
        <div><b>${row ? row.points : 0}</b><span>pontod</span></div>
        <div><b>${place > 0 ? place + '.' : '–'}</b><span>helyezés (${total} játékos)</span></div>
      </div>
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

  function leaderboardView() {
    const lb = state.board ? state.board.leaderboard : [];
    const done = state.board ? state.board.fights.filter((f) => f.status === 'done').length : 0;
    if (!lb.length) return '<div class="empty">Még senki nem csatlakozott.</div>';
    let place = 0, prev = null;
    const rows = lb.map((r, i) => {
      if (r.points !== prev) { place = i + 1; prev = r.points; }
      const me = state.me && r.nick.toLowerCase() === state.me.nick.toLowerCase();
      return `
        <li class="lb__row ${me ? 'is-me' : ''} ${place === 1 && done ? 'is-first' : ''}">
          <span class="lb__place">${place}.</span>
          <span class="lb__nick">${esc(r.nick)}</span>
          <span class="lb__sub">${r.correct}/${r.decided} talált, ${r.picks} tipp</span>
          <span class="lb__pts">${r.points}<small> p</small></span>
        </li>`;
    }).join('');
    return `
      <h2 class="section-h"><span>Ranglista</span><time>${done}/${state.data.fights.length} meccs lement</time></h2>
      <ol class="lb">${rows}</ol>
      <p class="hint">Holtversenyben a több talált tipp dönt; a sorrend minden eredmény után frissül.</p>`;
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
      <p class="hint">A meccs kezdetekor nyomd meg a „Tippelés lezárása” gombot, a végén pedig rögzítsd a győztest. A pontok azonnal frissülnek.</p>`;
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
      state.board = await api.board();
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
      state.board = await state.api.board().catch(() => state.board);
    } catch (e) {
      if (prev) state.picks[id] = prev; else delete state.picks[id];
      toast(e.message, 'err');
      state.board = await state.api.board().catch(() => state.board);
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
      store.del(ME_KEY); state.me = null; state.picks = {}; closeSheet(); render(); return;
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
        state.board = await state.api.board().catch(() => state.board);
        location.hash = '#kartya';
        render();
      } else if (form.dataset.form === 'admin') {
        const pin = form.pin.value;
        await state.api.adminCheck(pin);
        state.adminPin = pin;
        store.set(ADMIN_KEY, pin, true);
        state.board = await state.api.board().catch(() => state.board);
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
