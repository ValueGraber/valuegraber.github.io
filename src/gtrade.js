/* invest → เทรดทอง: short-term XAUUSD trading helper (Mon trades on MT5 / a broker).
   1-hour candles from Binance PAXGUSDT (≈ gold USD/oz; a broker's XAUUSD can differ by a few dollars).
   Chart with EMA 20/50 + RSI 14, buy/sell signals (trend + pullback to EMA 20 + resume, 13:00–24:00 Thai),
   SL 1.5×ATR, TP 2×ATR, a back-test over the loaded bars, a trade journal and a daily P/L calendar.
   Data { tx, set } syncs inside the portfolios doc as `gt`; local key valuegrab-gtrade-v1.
   tx: { id, side: 'buy'|'sell', at, entry, lot, sl, tp, note, sig, exit?, out?, fee?, closedAt? } — P/L in USD.
   Two strategies (`STRATS`): ema = trend + pullback (13:00–24:00 Thai), sweep = liquidity sweep of the previous trading day's
   high/low (day rolls at 05:00 Thai, weekends skipped since XAUUSD is closed; PAXG still trades). Paper trading `paper`:
   { start, lot, be, auto {ema, sweep}, since {k: t}, tx [{id, src: man|ema|sweep, sid?, side, at, entry, lot, sl0, sl, tp, exit?, closedAt?, out?}] }
   settled from closed 1h bars (`settle`, stop checked before target, break-even after +1R when `be`) so it runs 24 h without the page open. */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const API = 'https://data-api.binance.vision/api/v3/', WS = 'wss://data-stream.binance.vision/ws/paxgusdt@kline_1h';
  const KEY = 'valuegrab-gtrade-v1';
  const SLK = 1.5, TPK = 2, MAXH = 48; /* stop and target in ATRs, give up after 48 hours */
  const blank = () => ({ tx: [], set: { lot: 0.01, cs: 100, strat: 'sweep' } });
  const pblank = () => ({ start: 1000, lot: 0.01, be: true, auto: { sweep: true }, since: { sweep: Date.now() }, tx: [] });
  const norm = (j) => { const pp = (j && j.paper) || {};
    return { tx: Array.isArray(j && j.tx) ? j.tx : [], set: { ...blank().set, ...((j && j.set) || {}) },
      paper: { ...pblank(), ...pp, auto: { ...(pp.auto || pblank().auto) }, since: { ...(pp.since || pblank().since) }, tx: Array.isArray(pp.tx) ? pp.tx : [] } }; };
  const P = () => D.paper;
  const SPREAD = 0.3; /* simulated broker spread, USD per ounce */
  let D = norm(null); try { D = norm(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { /* defaults */ }
  try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!raw || !raw.paper) localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* ignore */ } /* pin the bot start time */
  const save = (sync = true) => { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* ignore */ } if (sync && window.VGSync) window.VGSync.push('portfolios'); };

  const fx = () => (window.VG && window.VG.fx) || 33;
  const f2 = (v) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const px = (v) => (v == null || !isFinite(v) ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const usd = (v) => (v == null || !isFinite(v) ? '–' : sgn(v) + '$' + f2(v));
  const thb = (v) => (v == null || !isFinite(v) ? '–' : sgn(v) + '฿' + Math.abs(v * fx()).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const short = (v) => sgn(v) + '$' + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'k' : Math.round(Math.abs(v)));
  const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const bkDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const bkHour = (t) => +new Date(t).toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hourCycle: 'h23' });
  const hm = (t) => new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const hhmm = (t) => new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sideTh = (s) => (s === 'buy' ? 'ซื้อ (Buy)' : 'ขาย (Sell)');

  /* ---------- indicators ---------- */
  const ema = (v, n) => { const k = 2 / (n + 1); const o = []; let e = null; v.forEach((x, i) => { e = e == null ? x : x * k + e * (1 - k); o[i] = i >= n - 1 ? e : null; }); return o; };
  const rsi = (c, n = 14) => { const o = Array(c.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; const up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
      if (i >= n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; };
  const atr = (b, n = 14) => { const o = Array(b.length).fill(null); let a = 0;
    for (let i = 1; i < b.length; i++) { const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
      a = i <= n ? a + tr / n : (a * (n - 1) + tr) / n; if (i >= n) o[i] = a; } return o; };
  const wkend = (t) => { const d = new Date(t + 2 * 3600e3).getUTCDay(); return d === 6 || d === 0; }; /* XAUUSD closed: Sat 05:00 → Mon 05:00 Thai */
  const ind = (b) => { const c = b.map((x) => x.c); const o = { e20: ema(c, 20), e50: ema(c, 50), rsi: rsi(c), atr: atr(b), pdh: [], pdl: [], hiB: [], loB: [] };
    let cur = null, ph = null, pl = null, hh = -Infinity, ll = Infinity;
    b.forEach((x, i) => { o.pdh[i] = o.pdl[i] = null; if (wkend(x.t)) return; const k = Math.floor((x.t + 2 * 3600e3) / 86400e3);
      if (k !== cur) { if (cur != null) { ph = hh; pl = ll; } cur = k; hh = -Infinity; ll = Infinity; }
      o.pdh[i] = ph; o.pdl[i] = pl; o.hiB[i] = hh; o.loB[i] = ll; hh = Math.max(hh, x.h); ll = Math.min(ll, x.l); });
    return o; };

  /* signal on closed bar i: trend by EMA 20 vs 50 (50 sloping the same way), a dip to EMA 20 in the last 2 bars, then a close back past it */
  const sigEma = (b, I, i) => {
    if (i < 60 || wkend(b[i].t)) return null; const { e20, e50, rsi: r, atr: a } = I; const x = b[i], p = b[i - 1];
    const h = bkHour(x.t + 3600e3 - 1); if (h < 13) return null; /* closes between 13:00 and 24:00 Thai: London + New York */
    if (e20[i] > e50[i] && e50[i] > e50[i - 5] && Math.min(x.l, p.l) <= e20[i] && x.c > e20[i] && x.c > x.o && x.c > p.c && r[i] >= 45 && r[i] <= 70)
      return { side: 'buy', entry: x.c, sl: x.c - SLK * a[i], tp: x.c + TPK * a[i] };
    if (e20[i] < e50[i] && e50[i] < e50[i - 5] && Math.max(x.h, p.h) >= e20[i] && x.c < e20[i] && x.c < x.o && x.c < p.c && r[i] <= 55 && r[i] >= 30)
      return { side: 'sell', entry: x.c, sl: x.c + SLK * a[i], tp: x.c - TPK * a[i] };
    return null;
  };
  /* liquidity sweep: the first poke past yesterday's high (low) today, closing back inside in the same bar with a long wick;
     stop just past the wick, target 2× the risk */
  const sigSweep = (b, I, i) => {
    if (i < 30) return null; const x = b[i], H = I.pdh[i], L = I.pdl[i], a = I.atr[i]; if (H == null || L == null || !a) return null;
    const rg = x.h - x.l; if (rg <= 0) return null;
    if (x.h > H && I.hiB[i] <= H && x.c < H && x.c < x.o && x.h - Math.max(x.o, x.c) >= 0.35 * rg) {
      const risk = Math.max(x.h + 0.1 * a - x.c, 0.5 * a); if (risk > 3 * a) return null; return { side: 'sell', entry: x.c, sl: x.c + risk, tp: x.c - 2 * risk, lvl: H }; }
    if (x.l < L && I.loB[i] >= L && x.c > L && x.c > x.o && Math.min(x.o, x.c) - x.l >= 0.35 * rg) {
      const risk = Math.max(x.c - (x.l - 0.1 * a), 0.5 * a); if (risk > 3 * a) return null; return { side: 'buy', entry: x.c, sl: x.c - risk, tp: x.c + 2 * risk, lvl: L }; }
    return null;
  };
  const STRATS = {
    sweep: { name: 'กวาดสต็อป', fn: sigSweep, why: (s) => (s.side === 'buy' ? `ราคาทะลุจุดต่ำของเมื่อวาน (${px(s.lvl)}) ลงไปกวาดสต็อป แล้วดีดกลับขึ้นมาปิดเหนือเส้นในแท่งเดียว` : `ราคาทะลุจุดสูงของเมื่อวาน (${px(s.lvl)}) ขึ้นไปกวาดสต็อป แล้วโดนตบกลับลงมาปิดใต้เส้นในแท่งเดียว`) },
    ema: { name: 'EMA ย่อ', fn: sigEma, why: (s) => (s.side === 'buy' ? 'ขาขึ้น ราคาย่อแตะเส้น EMA 20 แล้วเด้งกลับขึ้น' : 'ขาลง ราคาเด้งแตะเส้น EMA 20 แล้วกลับลง') },
  };
  const strat = () => (STRATS[D.set.strat] ? D.set.strat : 'sweep');
  /* walk the bars: one simulated trade at a time; stop and target hit in the same bar counts as a loss */
  const test = (b, I, fn) => {
    const out = []; let i = 60;
    while (i < b.length) {
      const s = fn(b, I, i); if (!s) { i++; continue; }
      const r = { ...s, i, t: b[i].t + 3600e3, out: null, exitI: null, exit: null }; const risk = Math.abs(s.entry - s.sl);
      for (let j = i + 1; j < b.length && j <= i + MAXH; j++) {
        const y = b[j]; const hitSL = s.side === 'buy' ? y.l <= s.sl : y.h >= s.sl; const hitTP = s.side === 'buy' ? y.h >= s.tp : y.l <= s.tp;
        if (hitSL) { r.out = 'sl'; r.exit = s.sl; r.exitI = j; break; }
        if (hitTP) { r.out = 'tp'; r.exit = s.tp; r.exitI = j; break; }
        if (j === i + MAXH) { r.out = 'time'; r.exit = y.c; r.exitI = j; }
      }
      if (r.out) r.R = ((r.exit - s.entry) * (s.side === 'buy' ? 1 : -1)) / risk;
      out.push(r); i = r.exitI != null ? r.exitI + 1 : b.length;
    }
    return out;
  };

  /* ---------- data ---------- */
  let bars = [], form = null, live = null, I = null, S = [], SS = {}, on = false, ws = null, lastTick = 0, err = '', loaded = false, polling = false;
  const kl = (a) => ({ t: a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4] });
  const get = (u) => fetch(API + u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const recalc = () => { const all = form ? [...bars, form] : bars; I = ind(all); Object.keys(STRATS).forEach((k) => { SS[k] = test(bars, I, STRATS[k].fn); }); S = SS[strat()];
    if (bars.length) { const a = settle(), b = autoTrade(), c = b ? settle() : false; if (a || b || c) save(); } };
  const load = async () => { const k = (await get('klines?symbol=PAXGUSDT&interval=1h&limit=1000')).map(kl); form = k.pop() || null; bars = k; live = form ? form.c : bars[bars.length - 1].c; recalc(); loaded = true; };
  const start = async () => {
    on = true; err = '';
    try {
      await load(); drawAll(); if (!on) return;
      ws = new WebSocket(WS);
      ws.onmessage = (m) => {
        let d; try { d = JSON.parse(m.data); } catch (e) { return; } const k = d && d.k; if (!k) return;
        live = +k.c; lastTick = Date.now(); const b = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c };
        if (k.x) { if (!bars.length || b.t > bars[bars.length - 1].t) { bars.push(b); if (bars.length > 1000) bars.shift(); } form = null; recalc(); drawAll(); return; }
        if (form && b.t > form.t && !bars.some((x) => x.t === form.t)) bars.push(form);
        form = b; later();
      };
      ws.onclose = () => { ws = null; };
    } catch (e) { err = 'โหลดราคาไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต)'; drawAll(); }
  };
  const stop = () => { on = false; if (ws) { ws.onclose = null; ws.close(); ws = null; } };
  const poll = async () => {
    if (!on || !loaded || polling || Date.now() - lastTick < 60e3) return; polling = true;
    try { const k = (await get('klines?symbol=PAXGUSDT&interval=1h&limit=3')).map(kl); const f = k.pop();
      k.forEach((b) => { if (b.t > bars[bars.length - 1].t) bars.push(b); }); form = f; live = f.c; lastTick = Date.now() - 30e3; recalc(); drawAll(); } catch (e) { /* next round */ }
    polling = false;
  };
  let tm = null; const later = () => { if (!tm) tm = setTimeout(() => { tm = null; recalc(); drawChart(); drawNow(); drawOpen(); drawPaper(); drawDash(); }, 1200); };

  /* ---------- trades ---------- */
  const plOf = (x, exit) => { const p = exit ?? x.exit; if (p == null) return null; return (p - x.entry) * (x.side === 'buy' ? 1 : -1) * x.lot * (D.set.cs || 100) - (x.fee || 0); };
  const openTx = () => D.tx.filter((x) => x.exit == null).sort((a, b) => b.at - a.at);
  const closedTx = () => D.tx.filter((x) => x.exit != null).sort((a, b) => b.closedAt - a.closedAt);
  const hit = (x) => { if (live == null) return null; if (x.tp && (x.side === 'buy' ? live >= x.tp : live <= x.tp)) return 'tp'; if (x.sl && (x.side === 'buy' ? live <= x.sl : live >= x.sl)) return 'sl'; return null; };

  /* ---------- paper trading ---------- */
  const atrNow = () => (I && I.atr[bars.length - 1]) || 5;
  const paperOpen = (side, o = {}) => {
    const base = o.entry ?? live; if (base == null) return null; const dir = side === 'buy' ? 1 : -1, a = atrNow();
    const entry = base + (dir * SPREAD) / 2, sl = o.sl ?? entry - dir * SLK * a, tp = o.tp ?? entry + dir * TPK * a;
    const x = { id: uid(), src: o.src || 'man', side, at: o.at || Date.now(), entry, lot: o.lot || P().lot, sl0: sl, sl, tp }; if (o.sid) x.sid = o.sid;
    P().tx.push(x); return x;
  };
  /* replay closed bars after the entry: stop first, then target; break-even after +1R; bot trades give up after 48 h */
  const settle = () => {
    let ch = false;
    P().tx.forEach((x) => {
      if (x.exit != null) return; const dir = x.side === 'buy' ? 1 : -1, risk = Math.abs(x.entry - x.sl0); let sl = x.sl0;
      const close = (p, t, out) => { x.exit = p; x.closedAt = t; x.out = out; ch = true; };
      for (const b of bars) {
        if (b.t < x.at) continue; const end = b.t + 3600e3 - 1;
        if (dir > 0 ? b.l <= sl : b.h >= sl) { close(sl, end, sl === x.sl0 ? 'sl' : 'be'); break; }
        if (dir > 0 ? b.h >= x.tp : b.l <= x.tp) { close(x.tp, end, 'tp'); break; }
        if (x.src !== 'man' && end - x.at >= MAXH * 3600e3) { close(b.c, end, 'time'); break; }
        if (P().be && risk && (dir > 0 ? b.h >= x.entry + risk : b.l <= x.entry - risk)) sl = x.entry;
      }
      if (x.exit == null && live != null) {
        const bid = live - SPREAD / 2, ask = live + SPREAD / 2, q = dir > 0 ? bid : ask; /* a buy closes at the bid, a sell at the ask */
        if (dir > 0 ? q <= sl : q >= sl) close(sl, Date.now(), sl === x.sl0 ? 'sl' : 'be'); else if (dir > 0 ? q >= x.tp : q <= x.tp) close(x.tp, Date.now(), 'tp');
        else if (P().be && risk && (dir > 0 ? q >= x.entry + risk : q <= x.entry - risk)) sl = x.entry;
      }
      if (x.exit == null && x.sl !== sl) { x.sl = sl; ch = true; }
    });
    return ch;
  };
  const autoTrade = () => {
    let ch = false;
    Object.keys(STRATS).forEach((k) => { if (!P().auto[k]) return; const since = P().since[k] || 0;
      (SS[k] || []).forEach((s) => { const sid = k + ':' + s.t; if (s.t <= since || P().tx.some((x) => x.sid === sid)) return;
        paperOpen(s.side, { entry: s.entry, sl: s.sl, tp: s.tp, src: k, sid, at: s.t }); ch = true; }); });
    return ch;
  };
  const srcName = (k) => (k === 'man' ? 'คุณ' : STRATS[k] ? 'บอท ' + STRATS[k].name : k);
  const pOpen = () => P().tx.filter((x) => x.exit == null).sort((a, b) => b.at - a.at);
  const pClosed = () => P().tx.filter((x) => x.exit != null).sort((a, b) => b.closedAt - a.closedAt);
  const qtyFloat = (x) => { const q = x.side === 'buy' ? live - SPREAD / 2 : live + SPREAD / 2; return live == null ? null : plOf(x, q); };

  /* ---------- chart ---------- */
  let span = 72;
  const drawChart = () => {
    const box = $('gt-chart'); if (!box) return;
    const all = form ? [...bars, form] : bars;
    if (!all.length || !I) { box.innerHTML = ''; return; }
    const W = Math.max(300, box.clientWidth || 600), R = 58, H1 = 250, H2 = 74, GAP = 22, H = H1 + GAP + H2 + 18;
    const n = Math.min(span, all.length), s0 = all.length - n, v = all.slice(s0);
    const opens = [...openTx(), ...pOpen()], sw = strat() === 'sweep';
    let lo = Infinity, hi = -Infinity;
    v.forEach((b, k) => { lo = Math.min(lo, b.l, I.e50[s0 + k] ?? b.l); hi = Math.max(hi, b.h, I.e50[s0 + k] ?? b.h); });
    const rng0 = hi - lo; if (sw) v.forEach((b, k) => [I.pdh[s0 + k], I.pdl[s0 + k]].forEach((p) => { if (p != null && p > lo - rng0 * 0.5 && p < hi + rng0 * 0.5) { lo = Math.min(lo, p); hi = Math.max(hi, p); } }));
    opens.forEach((x) => [x.entry, x.sl, x.tp].forEach((p) => { if (p && p > lo - rng0 && p < hi + rng0) { lo = Math.min(lo, p); hi = Math.max(hi, p); } }));
    const padP = (hi - lo) * 0.06 || 1; lo -= padP; hi += padP;
    const cw = (W - R) / n, y = (p) => 8 + ((hi - p) / (hi - lo)) * (H1 - 16), xi = (k) => k * cw + cw / 2;
    const yr = (r) => H1 + GAP + ((100 - r) / 100) * H2;
    const o = [];
    /* grid + price labels */
    const step = (() => { const raw = (hi - lo) / 5; const m = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map((q) => q * m).find((q) => q >= raw); })();
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) o.push(`<line x1="0" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" class="gt-grid"/><text x="${W - R + 6}" y="${y(p) + 4}" class="gt-ax">${p.toFixed(0)}</text>`);
    /* day lines */
    v.forEach((b, k) => { if (bkHour(b.t) === 0) { const xx = k * cw; o.push(`<line x1="${xx}" x2="${xx}" y1="0" y2="${H - 18}" class="gt-grid"/><text x="${xx + 3}" y="${H - 4}" class="gt-ax">${new Date(b.t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })}</text>`); } });
    /* candles */
    const bw = Math.max(1, Math.min(10, cw * 0.62));
    v.forEach((b, k) => { const up = b.c >= b.o, c = up ? 'u' : 'd', x = xi(k);
      o.push(`<line x1="${x}" x2="${x}" y1="${y(b.h)}" y2="${y(b.l)}" class="gt-w ${c}"/><rect x="${x - bw / 2}" y="${y(Math.max(b.o, b.c))}" width="${bw}" height="${Math.max(1, Math.abs(y(b.o) - y(b.c)))}" class="gt-b ${c}"/>`); });
    /* EMAs */
    const line = (arr, cls, yy) => { const pts = []; v.forEach((b, k) => { const z = arr[s0 + k]; if (z != null) pts.push(`${xi(k).toFixed(1)},${yy(z).toFixed(1)}`); }); return pts.length > 1 ? `<polyline points="${pts.join(' ')}" class="${cls}"/>` : ''; };
    o.push(line(I.e20, 'gt-e20', y), line(I.e50, 'gt-e50', y));
    if (sw) v.forEach((b, k) => { [[I.pdh[s0 + k], 'gt-pdh'], [I.pdl[s0 + k], 'gt-pdl']].forEach(([p, c]) => { if (p != null && p > lo && p < hi) o.push(`<line x1="${k * cw}" x2="${(k + 1) * cw}" y1="${y(p)}" y2="${y(p)}" class="${c}"/>`); }); });
    /* signals */
    const t0 = v[0].t;
    S.forEach((s) => { const k = s.i - s0; if (k < 0 || s.t - 3600e3 < t0) return; const x = xi(k), b = all[s.i];
      if (s.side === 'buy') { const yy = y(b.l) + 6; o.push(`<path d="M${x} ${yy} l6 10 h-12 z" class="gt-sb"/>`); } else { const yy = y(b.h) - 6; o.push(`<path d="M${x} ${yy} l6 -10 h-12 z" class="gt-ss"/>`); } });
    /* open trades */
    opens.forEach((x) => { [['entry', 'gt-le'], ['sl', 'gt-lsl'], ['tp', 'gt-ltp']].forEach(([k, c]) => { const p = x[k]; if (p && p > lo && p < hi) o.push(`<line x1="0" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" class="${c}"/>`); }); });
    /* last price */
    if (live != null && live > lo && live < hi) o.push(`<line x1="0" x2="${W - R}" y1="${y(live)}" y2="${y(live)}" class="gt-last"/><rect x="${W - R + 1}" y="${y(live) - 9}" width="${R - 2}" height="18" rx="3" class="gt-lastb"/><text x="${W - R + 5}" y="${y(live) + 4}" class="gt-lastt">${live.toFixed(1)}</text>`);
    /* RSI */
    [30, 50, 70].forEach((r) => o.push(`<line x1="0" x2="${W - R}" y1="${yr(r)}" y2="${yr(r)}" class="gt-grid${r === 50 ? '' : ' gt-rg'}"/><text x="${W - R + 6}" y="${yr(r) + 4}" class="gt-ax">${r}</text>`));
    o.push(line(I.rsi, 'gt-rsi', yr), `<text x="4" y="${H1 + GAP - 6}" class="gt-ax">RSI 14</text>`);
    o.push(`<line x1="0" x2="0" y1="0" y2="${H - 18}" class="gt-cross" visibility="hidden"/>`);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="กราฟทอง 1 ชั่วโมง">${o.join('')}<rect x="0" y="0" width="${W - R}" height="${H}" fill="transparent" class="gt-hit"/></svg>`;
    const hitR = box.querySelector('.gt-hit'), cross = box.querySelector('.gt-cross');
    const show = (k) => { const b = v[k], gi = s0 + k;
      $('gt-read').textContent = `${hm(b.t)} · เปิด ${px(b.o)} สูง ${px(b.h)} ต่ำ ${px(b.l)} ปิด ${px(b.c)} · EMA20 ${px(I.e20[gi])} EMA50 ${px(I.e50[gi])} · RSI ${I.rsi[gi] != null ? I.rsi[gi].toFixed(0) : '–'}`; };
    const read = (ev) => { const r = box.getBoundingClientRect(); const k = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) / r.width) * W / cw)));
      cross.setAttribute('x1', xi(k)); cross.setAttribute('x2', xi(k)); cross.setAttribute('visibility', 'visible'); show(k); };
    hitR.addEventListener('pointermove', read); hitR.addEventListener('pointerdown', read);
    hitR.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); show(n - 1); });
    show(n - 1);
  };

  /* ---------- signal card ---------- */
  const lastSig = () => { const s = S[S.length - 1]; if (!s) return null; const age = bars.length - 1 - s.i; return age <= 2 && !s.out ? s : null; };
  const trendNow = () => { const i = bars.length - 1; if (!I || i < 60) return null; const up = I.e20[i] > I.e50[i]; const j = all1(); return { up, rsi: I.rsi[i], atr: I.atr[i], pdh: I.pdh[j], pdl: I.pdl[j], wk: wkend(Date.now()) }; };
  const all1 = () => (form ? bars.length : bars.length - 1); /* index of the newest bar in I */
  const drawNow = () => {
    const st = $('gt-status'), box = $('gt-now'); if (!st || !box) return;
    st.textContent = err || (!loaded ? 'กำลังโหลดกราฟ…' : `ราคาตอนนี้ $${px(live)} ต่อออนซ์ · อัปเดต ${hhmm(lastTick || Date.now())} น.`);
    box.replaceChildren(); if (!loaded) return;
    const s = lastSig(), tr = trendNow();
    const card = el('div', 'gt-sig' + (s ? ' ' + s.side : ''));
    if (s) {
      card.append(el('b', null, s.side === 'buy' ? 'สัญญาณซื้อ (Buy)' : 'สัญญาณขาย (Sell)'),
        el('p', null, `${STRATS[strat()].name} · แท่งปิด ${hm(s.t)} · ${STRATS[strat()].why(s)}`));
      const g = el('div', 'gt-lv'); [['เข้า', s.entry], ['ตัดขาดทุน (SL)', s.sl], ['ทำกำไร (TP)', s.tp]].forEach(([k, p]) => { const d = el('div'); d.append(el('small', null, k), el('span', null, px(p))); g.append(d); });
      const risk = Math.abs(s.entry - s.sl) * D.set.lot * D.set.cs, rr = Math.abs(s.tp - s.entry) / Math.abs(s.entry - s.sl);
      card.append(g, el('p', 'pf-hint', `ถ้าเข้า ${D.set.lot} lot: เสี่ยงราว ${usd(-risk)} (${thb(-risk)}) ถ้าถึง TP ได้ราว ${usd(risk * rr)}`));
      const bx = el('div', 'gt-act'); const b = el('button', 'btn-solid', 'เข้าไม้นี้ (จริง)'); b.type = 'button'; b.addEventListener('click', () => prefill(s));
      const b2 = el('button', 'btn-line', 'เทรดกระดาษไม้นี้'); b2.type = 'button';
      b2.addEventListener('click', () => { const x = paperOpen(s.side, { sl: s.sl, tp: s.tp }); if (x) { save(); drawAll(); if (window.VGNav) window.VGNav.go('scan', 'gtp'); } });
      bx.append(b, b2); card.append(bx);
    } else {
      card.append(el('b', null, 'ยังไม่มีสัญญาณ รอก่อน'));
      if (tr && tr.wk) card.append(el('p', null, 'วันเสาร์-อาทิตย์ ตลาดทองจริงปิด ราคา PAXG ยังขยับได้ แต่ระบบไม่ให้สัญญาณ'));
      else if (tr && strat() === 'sweep') card.append(el('p', null, tr.pdh != null ? `จุดสูงของเมื่อวาน ${px(tr.pdh)} · จุดต่ำ ${px(tr.pdl)} (เส้นประสีทองบนกราฟ) รอให้ราคาทะลุเส้นใดเส้นหนึ่งแล้วกลับเข้ามาปิดในแท่งเดียว ขึ้นไปกวาดแล้วกลับลง = ขาย ลงไปกวาดแล้วดีดขึ้น = ซื้อ` : 'กำลังรอข้อมูลของวันก่อน'));
      else if (tr) card.append(el('p', null, `${tr.up ? 'ตอนนี้เป็นขาขึ้น (EMA 20 อยู่เหนือ EMA 50) รอราคาย่อลงมาแตะ EMA 20 แล้วเด้งขึ้น' : 'ตอนนี้เป็นขาลง (EMA 20 อยู่ใต้ EMA 50) รอราคาเด้งขึ้นไปแตะ EMA 20 แล้วกลับลง'} · RSI ${tr.rsi.toFixed(0)} · แกว่งเฉลี่ยแท่งละ $${px(tr.atr)}`));
      const prev = S[S.length - 1]; if (prev) card.append(el('p', 'pf-hint', `สัญญาณล่าสุด: ${prev.side === 'buy' ? 'ซื้อ' : 'ขาย'} ${hm(prev.t)} ที่ ${px(prev.entry)} → ${prev.out === 'tp' ? 'ถึง TP' : prev.out === 'sl' ? 'โดน SL' : prev.out === 'time' ? 'ปิดเพราะครบ 48 ชม.' : 'ยังไม่จบ'}`));
      const b = el('button', 'btn-line', 'จดไม้เอง'); b.type = 'button'; b.addEventListener('click', () => prefill(null)); card.append(b);
    }
    box.append(card);
    /* back-test */
    const done = S.filter((x) => x.out), w = done.filter((x) => x.R > 0), gw = w.reduce((a, x) => a + x.R, 0), gl = -done.filter((x) => x.R <= 0).reduce((a, x) => a + x.R, 0);
    const days = bars.length ? Math.round((bars[bars.length - 1].t - bars[0].t) / 86400e3) : 0;
    $('gt-bt').textContent = STRATS[strat()].name + ': ' + (done.length ? `ย้อนหลัง ${days} วัน ระบบนี้ให้สัญญาณ ${done.length} ครั้ง ชนะ ${w.length} (${Math.round((w.length / done.length) * 100)}%) · กำไรรวม ${sgn(gw - gl)}${Math.abs(gw - gl).toFixed(1)} เท่าของความเสี่ยงต่อไม้ · Profit factor ${gl ? (gw / gl).toFixed(2) : '–'}` : `ย้อนหลัง ${days} วัน ยังไม่มีสัญญาณที่จบแล้ว`);
  };

  /* ---------- journal ---------- */
  const prefill = (s) => {
    $('gt-side').value = s ? s.side : 'buy'; $('gt-entry').value = s ? s.entry.toFixed(2) : live != null ? live.toFixed(2) : '';
    $('gt-sl').value = s ? s.sl.toFixed(2) : ''; $('gt-tp').value = s ? s.tp.toFixed(2) : ''; $('gt-at').value = ''; $('gt-note').value = s ? 'ตามสัญญาณระบบ' : '';
    $('gt-form').dataset.sig = s ? '1' : ''; $('gt-msg').textContent = 'แก้ราคาเข้าให้ตรงกับใน MT5 แล้วกดบันทึก';
    if (window.VGNav) window.VGNav.go('scan', 'gtj');
    setTimeout(() => { const f = $('gt-form'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('gt-entry').focus(); } }, 120);
  };
  const add = () => {
    const entry = +$('gt-entry').value, lot = +$('gt-lot').value, sl = +$('gt-sl').value || null, tp = +$('gt-tp').value || null, side = $('gt-side').value;
    if (!(entry > 0) || !(lot > 0)) { $('gt-msg').textContent = 'ใส่ราคาเข้าและขนาด lot ก่อน'; return; }
    if (sl && (side === 'buy' ? sl >= entry : sl <= entry)) { $('gt-msg').textContent = side === 'buy' ? 'ซื้อ: SL ต้องต่ำกว่าราคาเข้า' : 'ขาย: SL ต้องสูงกว่าราคาเข้า'; return; }
    const at = $('gt-at').value ? new Date($('gt-at').value).getTime() : Date.now();
    D.tx.push({ id: uid(), side, at, entry, lot, sl, tp, note: $('gt-note').value.trim(), sig: $('gt-form').dataset.sig === '1' });
    D.set.lot = lot; save(); $('gt-form').dataset.sig = ''; ['gt-entry', 'gt-sl', 'gt-tp', 'gt-at', 'gt-note'].forEach((k) => { $(k).value = ''; });
    $('gt-msg').textContent = 'บันทึกแล้ว'; drawAll();
  };
  const closeRow = (x, row) => {
    if (row.querySelector('.gt-close')) return;
    const h = hit(x), f = el('div', 'gt-close pf-form f2');
    const l1 = el('label', null, 'ราคาปิด '), i1 = el('input', 'inp'); i1.type = 'number'; i1.step = 'any'; i1.inputMode = 'decimal'; i1.value = (h === 'tp' ? x.tp : h === 'sl' ? x.sl : live ?? x.entry).toFixed(2); l1.append(i1);
    const l2 = el('label', null, 'ค่าคอม + สวอป (USD, ไม่ใส่ก็ได้) '), i2 = el('input', 'inp'); i2.type = 'number'; i2.step = 'any'; i2.inputMode = 'decimal'; l2.append(i2);
    const l3 = el('label', null, 'เวลาปิด (ว่าง = ตอนนี้) '), i3 = el('input', 'inp'); i3.type = 'datetime-local'; l3.append(i3);
    const pv = el('span', 'pf-hint'); const upd = () => { const p = plOf({ ...x, fee: +i2.value || 0 }, +i1.value); pv.textContent = `ผล ${usd(p)} (${thb(p)})`; pv.className = 'pf-hint ' + tone(p); };
    i1.addEventListener('input', upd); i2.addEventListener('input', upd); upd();
    const ok = el('button', 'btn-solid', 'ยืนยันปิดไม้'); ok.type = 'button';
    ok.addEventListener('click', () => { const p = +i1.value; if (!(p > 0)) return; x.exit = p; x.fee = +i2.value || 0; x.closedAt = i3.value ? new Date(i3.value).getTime() : Date.now();
      x.out = x.tp && Math.abs(p - x.tp) < 0.01 ? 'tp' : x.sl && Math.abs(p - x.sl) < 0.01 ? 'sl' : 'man'; save(); drawAll(); });
    const act = el('div', 'pf-actions wide'); act.append(ok, pv); f.append(l1, l2, l3, act); row.append(f);
  };
  const row = (x, isOpen, paper) => {
    const r = el('div', 'gt-row'); const top = el('div', 'gt-rt');
    const left = el('div'); left.append(el('b', x.side === 'buy' ? 'pos' : 'neg', sideTh(x.side)), el('span', null, ` ${x.lot} lot @ ${px(x.entry)}`));
    const OUT = { tp: ' (TP)', sl: ' (SL)', be: ' (SL ที่จุดเข้า)', time: ' (ครบ 48 ชม.)' };
    left.append(el('small', null, isOpen ? `เข้า ${hm(x.at)}${x.sl ? ' · SL ' + px(x.sl) + (x.sl0 != null && x.sl !== x.sl0 ? ' (เลื่อนมาจุดเข้าแล้ว)' : '') : ''}${x.tp ? ' · TP ' + px(x.tp) : ''}` : `${hm(x.at)} → ${hm(x.closedAt)} · ปิด ${px(x.exit)}${OUT[x.out] || ''}${x.fee ? ' · คอม $' + f2(x.fee) : ''}`));
    if (paper) left.append(el('small', 'gt-note', srcName(x.src)));
    if (x.note) left.append(el('small', 'gt-note', x.note));
    const p = isOpen ? (paper ? qtyFloat(x) : plOf(x, live)) : plOf(x); const right = el('div', 'gt-pl ' + tone(p)); right.append(el('b', null, usd(p)), el('small', null, thb(p) + (isOpen ? ' ยังไม่ปิด' : '')));
    top.append(left, right); r.append(top);
    const act = el('div', 'gt-act');
    if (paper) { if (isOpen) { const c = el('button', 'btn-line', 'ปิดตอนนี้'); c.type = 'button';
        c.addEventListener('click', () => { if (live == null) return; x.exit = x.side === 'buy' ? live - SPREAD / 2 : live + SPREAD / 2; x.closedAt = Date.now(); x.out = 'man'; save(); drawAll(); }); act.append(c); } }
    else if (isOpen) { const h = hit(x); if (h) act.append(el('span', 'gt-flag ' + (h === 'tp' ? 'pos' : 'neg'), h === 'tp' ? 'ราคาถึง TP แล้ว' : 'ราคาถึง SL แล้ว'));
      const c = el('button', 'btn-line', 'ปิดไม้'); c.type = 'button'; c.addEventListener('click', () => closeRow(x, r)); act.append(c); }
    else { const u = el('button', 'btn-line', 'เปิดกลับ'); u.type = 'button'; u.addEventListener('click', () => { delete x.exit; delete x.closedAt; delete x.out; delete x.fee; save(); drawAll(); }); act.append(u); }
    const d = el('button', 'btn-line', 'ลบ'); d.type = 'button'; d.addEventListener('click', () => { if (!confirm('ลบไม้นี้?')) return; if (paper) P().tx = P().tx.filter((y) => y.id !== x.id); else D.tx = D.tx.filter((y) => y.id !== x.id); save(); drawAll(); }); act.append(d);
    r.append(act); return r;
  };
  const drawOpen = () => {
    const box = $('gt-open'); if (!box) return; if (box.querySelector('.gt-close input:focus')) return;
    const o = openTx(); box.replaceChildren();
    if (!o.length) { box.append(el('div', 'empty', 'ไม่มีไม้ที่เปิดอยู่')); return; }
    const tot = o.reduce((a, x) => a + (plOf(x, live) || 0), 0);
    box.append(el('p', 'pf-hint ' + tone(tot), `กำไร/ขาดทุนที่ยังไม่ปิดรวม ${usd(tot)} (${thb(tot)}) ตามราคา PAXG`));
    o.forEach((x) => box.append(row(x, true)));
  };
  const drawClosed = () => {
    const box = $('gt-closed'); if (!box) return; box.replaceChildren(); const c = closedTx();
    if (!c.length) { box.append(el('div', 'empty', 'ยังไม่มีไม้ที่ปิดแล้ว')); return; }
    c.slice(0, 30).forEach((x) => box.append(row(x, false)));
    if (c.length > 30) box.append(el('p', 'pf-hint', `แสดง 30 ไม้ล่าสุดจาก ${c.length} ไม้ ดูรายวันได้ที่ปฏิทินด้านล่าง`));
  };

  const drawPaper = () => {
    const box = $('gp-open'); if (!box) return;
    const o = pOpen(), c = pClosed(), st = stats(c), fl = o.reduce((a, x) => a + (qtyFloat(x) || 0), 0), bal = P().start + st.net;
    const tile = (k, v, h, cl) => { const d = el('div'); d.append(el('div', 'k', k), el('div', 'v ' + (cl || ''), v), el('div', 'h', h)); return d; };
    $('gp-strip').replaceChildren(
      tile('เงินปลอมในพอร์ต', '$' + f2(bal), `เริ่ม $${f2(P().start)} · ${sgn(bal - P().start)}${Math.abs(((bal - P().start) / P().start) * 100).toFixed(1)}%`, tone(bal - P().start)),
      tile('ยังไม่ปิด', usd(fl), `${o.length} ไม้`, tone(fl)),
      tile('ชนะ', st.win == null ? '–' : Math.round(st.win * 100) + '%', `${st.n} ไม้ที่ปิดแล้ว`),
      tile('ราคาตอนนี้', live == null ? '–' : px(live), live == null ? '' : `ซื้อ ${px(live + SPREAD / 2)} · ขาย ${px(live - SPREAD / 2)}`));
    $('gp-buy').textContent = live == null ? 'Buy' : `Buy ${px(live + SPREAD / 2)}`; $('gp-sell').textContent = live == null ? 'Sell' : `Sell ${px(live - SPREAD / 2)}`;
    if (!box.contains(document.activeElement)) { box.replaceChildren(); if (!o.length) box.append(el('div', 'empty', 'ไม่มีไม้กระดาษที่เปิดอยู่')); o.forEach((x) => box.append(row(x, true, true))); }
    const cb = $('gp-closed'); cb.replaceChildren(); if (!c.length) cb.append(el('div', 'empty', 'ยังไม่มีไม้กระดาษที่ปิดแล้ว'));
    c.slice(0, 20).forEach((x) => cb.append(row(x, false, true))); if (c.length > 20) cb.append(el('p', 'pf-hint', `แสดง 20 ไม้ล่าสุดจาก ${c.length} ไม้ ดูรายวันได้ที่ปฏิทิน (เลือก "กระดาษ")`));
    /* leaderboard */
    const tb = el('table', 'tr-table'), hd = el('tr'); ['ใคร', 'ไม้', 'ชนะ', 'กำไร', 'ย้อนหลัง ~40 วัน'].forEach((x) => hd.append(el('th', null, x)));
    const th = el('thead'); th.append(hd); tb.append(th); const bd = el('tbody');
    ['man', ...Object.keys(STRATS)].forEach((k) => {
      const s2 = stats(c.filter((x) => x.src === k)), tr = el('tr'); const td = (v, cl) => tr.append(el('td', cl || null, v));
      td(srcName(k) + (k !== 'man' && !P().auto[k] ? ' (ปิดอยู่)' : '')); td(String(s2.n)); td(s2.win == null ? '–' : Math.round(s2.win * 100) + '%'); td(usd(s2.net), tone(s2.net));
      if (k === 'man') td('–'); else { const d = (SS[k] || []).filter((x) => x.out), w = d.filter((x) => x.R > 0).length, r = d.reduce((a, x) => a + x.R, 0); td(d.length ? `ชนะ ${Math.round((w / d.length) * 100)}% · ${sgn(r)}${Math.abs(r).toFixed(1)}R` : '–', tone(r)); }
      bd.append(tr); });
    tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); $('gp-board').replaceChildren(w);
  };

  /* ---------- dashboard ---------- */
  let ym = bkDay(Date.now()).slice(0, 7), selDay = null, dsrc = 'real';
  const stats = (list) => { const p = list.map((x) => plOf(x)); const w = p.filter((v) => v > 0), l = p.filter((v) => v <= 0);
    const gw = w.reduce((a, v) => a + v, 0), gl = -l.reduce((a, v) => a + v, 0);
    return { n: p.length, net: gw - gl, win: p.length ? w.length / p.length : null, pf: gl ? gw / gl : null, aw: w.length ? gw / w.length : null, al: l.length ? -gl / l.length : null }; };
  const drawDash = () => {
    const box = $('gt-cal'); if (!box) return;
    const pp = dsrc === 'paper', c = pp ? pClosed() : closedTx(), m = c.filter((x) => bkDay(x.closedAt).startsWith(ym)), s = stats(m), all = stats(c);
    const [Y, M] = ym.split('-').map(Number);
    $('gt-ym').textContent = new Date(Y, M - 1, 15).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
    const tile = (k, v, h, cl) => { const d = el('div'); d.append(el('div', 'k', k), el('div', 'v ' + (cl || ''), v), el('div', 'h', h)); return d; };
    $('gt-strip').replaceChildren(
      tile(pp ? 'กำไรกระดาษเดือนนี้' : 'กำไรขาดทุนเดือนนี้', usd(s.net), thb(s.net), tone(s.net)),
      tile('ชนะ', s.win == null ? '–' : Math.round(s.win * 100) + '%', `${s.n} ไม้`),
      tile('เฉลี่ยไม้ชนะ / แพ้', s.aw == null && s.al == null ? '–' : `${s.aw == null ? '–' : '$' + f2(s.aw)} / ${s.al == null ? '–' : '$' + f2(s.al)}`, `Profit factor ${s.pf == null ? '–' : s.pf.toFixed(2)}`),
      tile('รวมทั้งหมด', usd(all.net), `${thb(all.net)} · ${all.n} ไม้`, tone(all.net)));
    const byDay = {}; m.forEach((x) => { const d = bkDay(x.closedAt); (byDay[d] = byDay[d] || []).push(x); });
    const g = el('div', 'mc-grid gt-grid'); const first = new Date(Y, M - 1, 1).getDay(), nd = new Date(Y, M, 0).getDate(), today = bkDay(Date.now());
    for (let i = 0; i < first; i++) g.append(el('div', 'mc-d pad'));
    for (let d = 1; d <= nd; d++) {
      const key = `${ym}-${String(d).padStart(2, '0')}`, list = byDay[key] || [], net = list.reduce((a, x) => a + plOf(x), 0);
      const b = el('button', 'mc-d' + (key === today ? ' today' : '') + (key === selDay ? ' sel' : '') + (list.length ? ' gt-' + (net > 0 ? 'up' : net < 0 ? 'dn' : 'eq') : '')); b.type = 'button';
      b.append(el('span', 'n', String(d))); if (list.length) b.append(el('span', 'a ' + tone(net), short(net)), el('span', 'a v', `${list.length} ไม้`));
      b.addEventListener('click', () => { selDay = selDay === key ? null : key; drawDash(); }); g.append(b);
    }
    const wd = el('div', 'mc-wd'); ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].forEach((x) => wd.append(el('span', null, x)));
    box.replaceChildren(wd, g);
    const dl = $('gt-day'); dl.replaceChildren();
    if (selDay) { const list = byDay[selDay] || []; const net = list.reduce((a, x) => a + plOf(x), 0);
      dl.append(el('h4', null, `${new Date(selDay + 'T12:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })} · ${usd(net)} (${thb(net)})`));
      if (!list.length) dl.append(el('div', 'empty', 'วันนี้ไม่มีไม้ที่ปิด')); list.forEach((x) => dl.append(row(x, false, pp))); }
  };
  const drawAll = () => { drawChart(); drawNow(); drawOpen(); drawClosed(); drawPaper(); drawDash(); };

  /* ---------- wiring ---------- */
  const SUBS = ['gtc', 'gtp', 'gtj', 'gtd'];
  const visible = () => { const v = $('view-scan'); return v && !v.hidden && document.body.dataset.tab === 'invest' && SUBS.some((k) => { const s = $(k); return s && !s.classList.contains('sub-off'); }) && document.visibilityState === 'visible'; };
  const csv = () => {
    const rows = [['เข้า', 'ปิด', 'ฝั่ง', 'lot', 'ราคาเข้า', 'SL', 'TP', 'ราคาปิด', 'ค่าคอม USD', 'กำไร USD', 'บันทึก']];
    [...D.tx].sort((a, b) => a.at - b.at).forEach((x) => rows.push([new Date(x.at).toISOString(), x.closedAt ? new Date(x.closedAt).toISOString() : '', x.side, x.lot, x.entry, x.sl ?? '', x.tp ?? '', x.exit ?? '', x.fee ?? '', x.exit != null ? plOf(x).toFixed(2) : '', x.note || '']));
    const b = new Blob(['﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'valuegrab-gold-trades.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const setup = () => {
    if (!$('gt-chart')) return;
    $('gt-lot').value = D.set.lot; $('gt-cs').value = D.set.cs;
    $('gt-cs').addEventListener('change', () => { const v = +$('gt-cs').value; if (v > 0) { D.set.cs = v; save(); drawAll(); } else $('gt-cs').value = D.set.cs; });
    $('gt-add').addEventListener('click', add); $('gt-csv').addEventListener('click', csv);
    document.querySelectorAll('#gt-span button').forEach((b) => b.addEventListener('click', () => { span = +b.dataset.n; document.querySelectorAll('#gt-span button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawChart(); }));
    $('gt-prev').addEventListener('click', () => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; selDay = null; drawDash(); });
    $('gt-next').addEventListener('click', () => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m, 1); ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; selDay = null; drawDash(); });
    const segOn = (id, v) => document.querySelectorAll(`#${id} button`).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === v)));
    segOn('gt-strat', strat());
    document.querySelectorAll('#gt-strat button').forEach((b) => b.addEventListener('click', () => { D.set.strat = b.dataset.k; segOn('gt-strat', b.dataset.k); S = SS[strat()] || []; save(); drawChart(); drawNow(); }));
    document.querySelectorAll('#gt-src button').forEach((b) => b.addEventListener('click', () => { dsrc = b.dataset.k; segOn('gt-src', dsrc); selDay = null; drawDash(); }));
    const pset = () => { $('gp-lot').value = P().lot; $('gp-start').value = P().start; $('gp-be').checked = !!P().be; Object.keys(STRATS).forEach((k) => { $('gp-a-' + k).checked = !!P().auto[k]; }); };
    pset();
    const trade = (side) => {
      const lot = +$('gp-lot').value, sl = +$('gp-sl').value || null, tp = +$('gp-tp').value || null; const m = $('gp-msg');
      if (live == null) { m.textContent = 'ยังโหลดราคาไม่เสร็จ'; return; } if (!(lot > 0)) { m.textContent = 'ใส่ขนาด lot ก่อน'; return; }
      const e = live + (side === 'buy' ? SPREAD / 2 : -SPREAD / 2);
      if (sl && (side === 'buy' ? sl >= e : sl <= e)) { m.textContent = side === 'buy' ? 'Buy: SL ต้องต่ำกว่าราคาตอนนี้' : 'Sell: SL ต้องสูงกว่าราคาตอนนี้'; return; }
      if (tp && (side === 'buy' ? tp <= e : tp >= e)) { m.textContent = side === 'buy' ? 'Buy: TP ต้องสูงกว่าราคาตอนนี้' : 'Sell: TP ต้องต่ำกว่าราคาตอนนี้'; return; }
      P().lot = lot; const x = paperOpen(side, { sl: sl ?? undefined, tp: tp ?? undefined, lot }); $('gp-sl').value = ''; $('gp-tp').value = '';
      m.textContent = `เปิด ${side === 'buy' ? 'Buy' : 'Sell'} ${lot} lot ที่ ${px(x.entry)} · SL ${px(x.sl)} · TP ${px(x.tp)}`; save(); drawAll();
    };
    $('gp-buy').addEventListener('click', () => trade('buy')); $('gp-sell').addEventListener('click', () => trade('sell'));
    Object.keys(STRATS).forEach((k) => $('gp-a-' + k).addEventListener('change', (ev) => { P().auto[k] = ev.target.checked; if (ev.target.checked) P().since[k] = Date.now(); save(); drawPaper(); }));
    $('gp-be').addEventListener('change', (ev) => { P().be = ev.target.checked; save(); });
    $('gp-start').addEventListener('change', () => { const v = +$('gp-start').value; if (v > 0) { P().start = v; save(); drawPaper(); } else $('gp-start').value = P().start; });
    $('gp-reset').addEventListener('click', () => { if (!confirm('ลบไม้กระดาษทั้งหมดแล้วเริ่มใหม่?')) return; P().tx = []; Object.keys(P().auto).forEach((k) => { P().since[k] = Date.now(); }); save(); drawAll(); });
    let rw = null; window.addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(drawChart, 200); });
    setInterval(() => { const v = visible(); if (v && !on) start(); else if (!v && on) stop(); if (v) { poll(); if (loaded && !$('gt-chart').firstChild) drawChart(); } }, 2000);
    drawAll();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.VGGT = {
    get: () => D,
    replace: (c) => { D = norm(c); save(false); if ($('gt-lot')) { $('gt-lot').value = D.set.lot; $('gt-cs').value = D.set.cs; $('gp-lot').value = P().lot; $('gp-start').value = P().start; } if (bars.length) recalc(); drawAll(); },
    merge: (c) => { const by = (a, b) => { const ids = new Set(a.map((x) => x.id)); return [...a, ...b.filter((x) => !ids.has(x.id))]; };
      const tx = by(c.tx || [], D.tx), cp = (c.paper || {}), ptx = by(cp.tx || [], P().tx);
      return { extra: tx.length - (c.tx || []).length + ptx.length - (cp.tx || []).length,
        doc: { tx, set: { ...D.set, ...(c.set || {}) }, paper: { ...P(), ...cp, auto: { ...P().auto, ...(cp.auto || {}) }, since: { ...P().since, ...(cp.since || {}) }, tx: ptx } } }; },
    _test: { ind, sigEma, sigSweep, test, settle: () => settle(), D: () => D },
  };
})();
