/* invest → เทรดทอง: short-term XAUUSD trading helper (Mon trades on MT5 / a broker).
   1-hour candles from Binance PAXGUSDT (≈ gold USD/oz; a broker's XAUUSD can differ by a few dollars).
   Chart with EMA 20/50 + RSI 14, buy/sell signals (trend + pullback to EMA 20 + resume, 13:00–24:00 Thai),
   SL 1.5×ATR, TP 2×ATR, a back-test over the loaded bars, a trade journal and a daily P/L calendar.
   Data { tx, set } syncs inside the portfolios doc as `gt`; local key valuegrab-gtrade-v1.
   tx: { id, side: 'buy'|'sell', at, entry, lot, sl, tp, note, sig, exit?, out?, fee?, closedAt? } — P/L in USD.
   Three strategies (`STRATS`, picked 2026-11-23 from a 3-year PAXG 1h test with $0.40 cost per trade — docs/lab.html):
   dip = RSI(2) < 8 / > 92 with the 20-day trend (EMA 480) and EMA 50 vs 200, SL 1.5 ATR, TP 1.5 ATR;
   brk = close past the 20-bar high/low (Donchian) with EMA 50 vs 200, 14:00–01:00 Thai, SL 1.5 ATR, TP 3 ATR;
   st = Supertrend (10, 3) flip in the direction of EMA 480, SL at the line (0.5–3 ATR), TP 2R;
   smc = Smart Money Concepts (2026-11-24, `smc()` inside ind → I.smc): BOS/CHoCH, order block tap in discount/premium, SL past the OB, TP leg extreme or 2R. Weekends skipped. Paper trading `paper`:
   { start, lot, be, auto {dip, brk, st}, since {k: t}, tx [{id, src: man|dip|brk|st (old: asia|sweep|ema), sid?, side, at, entry, lot, sl0, sl, tp, exit?, closedAt?, out?}] }
   settled from closed 1h bars (`settle`, stop checked before target, break-even after +1R when `be`) so it runs 24 h without the page open. */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const API = 'https://data-api.binance.vision/api/v3/', WS = 'wss://data-stream.binance.vision/ws/paxgusdt@kline_1h';
  const KEY = 'valuegrab-gtrade-v1';
  const SLK = 1.5, TPK = 2, MAXH = 48; /* stop and target in ATRs, give up after 48 hours */
  const blank = () => ({ tx: [], set: { lot: 0.01, cs: 100, strat: 'dip', spread: 0.3, slip: 0.1, comm: 0, htf: false, nfp: true } });
  const pblank = () => ({ start: 1000, lot: 0.01, be: true, auto: { dip: true }, since: { dip: Date.now() }, tx: [] });
  const norm = (j) => { const pp = (j && j.paper) || {};
    return { tx: Array.isArray(j && j.tx) ? j.tx : [], del: Array.isArray(j && j.del) ? j.del.slice(-500) : [], su: (j && j.su) || 0, set: { ...blank().set, ...((j && j.set) || {}) },
      paper: (() => { const q = { ...pblank(), ...pp, auto: { ...(pp.auto || pblank().auto) }, since: { ...(pp.since || pblank().since) }, tx: Array.isArray(pp.tx) ? pp.tx : [] };
        if (q.auto.dip === undefined) { ['asia', 'sweep', 'ema'].forEach((k) => delete q.auto[k]); q.auto.dip = true; q.since.dip = Date.now(); } return q; })() }; };
  const P = () => D.paper;
  const OFF = () => (isFinite(D.set.off) ? +D.set.off : 0); /* MT5 price − PAXG price, set by Mon from his broker's quote */
  const SPD = () => (D.set.spread >= 0 ? D.set.spread : 0.3); /* broker spread, USD per ounce (setting) */
  let D = norm(null); try { D = norm(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { /* defaults */ }
  setTimeout(() => prime(), 0); /* prime is defined below */
  try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!raw || !raw.paper || !raw.paper.auto || raw.paper.auto.dip === undefined) localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* ignore */ } /* pin the bot start time */
  /* sync safety (2026-11-24): the account holds one document for all devices, so a save from another open device or tab used to overwrite trades
     logged here. Every trade now carries u (last change time), deletions leave their id in del, and settings carry su / paper.su; copies are merged
     item by item (newest wins) instead of replaced. */
  const seen = new Map();
  const pj = () => { const { tx, su, ...r } = P(); return JSON.stringify(r); };
  const prime = () => { seen.clear(); [...D.tx, ...P().tx].forEach((x) => { const { u, ...r } = x; seen.set(x.id, JSON.stringify(r)); }); seen.set('$set', JSON.stringify(D.set)); seen.set('$p', pj()); };
  const stamp = () => { const now = Date.now();
    [...D.tx, ...P().tx].forEach((x) => { const { u, ...r } = x, j = JSON.stringify(r); if (seen.get(x.id) !== j) { x.u = now; seen.set(x.id, j); } });
    const sj = JSON.stringify(D.set); if (seen.get('$set') !== sj) { D.su = now; seen.set('$set', sj); }
    const q = pj(); if (seen.get('$p') !== q) { P().su = now; seen.set('$p', q); } };
  const gone = (ids) => { D.del = [...D.del, ...ids].slice(-500); };
  const mergeDoc = (r, l) => { r = norm(r); l = norm(l); const del = new Set([...r.del, ...l.del]);
    const pick = (a, b) => { const m = new Map(); [...a, ...b].forEach((x) => { if (!x || !x.id) return; const o = m.get(x.id); if (!o || (x.u || 0) > (o.u || 0)) m.set(x.id, x); });
      return [...m.values()].filter((x) => !del.has(x.id)).sort((x, y) => (x.at || 0) - (y.at || 0)); };
    const rp = r.paper, lp = l.paper, pNew = (lp.su || 0) > (rp.su || 0);
    return { tx: pick(r.tx, l.tx), del: [...del].slice(-500), su: Math.max(r.su, l.su), set: (l.su || 0) > (r.su || 0) ? { ...r.set, ...l.set } : { ...l.set, ...r.set },
      paper: { ...(pNew ? { ...rp, ...lp } : { ...lp, ...rp }), su: Math.max(rp.su || 0, lp.su || 0), tx: pick(rp.tx, lp.tx) } }; };
  const sig = (d) => JSON.stringify([d.tx.map((x) => x.id + ':' + (x.u || 0)), d.paper.tx.map((x) => x.id + ':' + (x.u || 0)), d.del.length, d.su, d.paper.su || 0]);
  const save = (sync = true) => { stamp(); try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* ignore */ } if (sync && window.VGSync) window.VGSync.push('portfolios'); };

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
  /* SMC (Smart Money Concepts), all from closed bars only (no look-ahead):
     swing highs/lows = fractal 3 bars each side (known 3 bars later); close past the last swing = BOS (same way) or CHoCH (trend flips);
     order block = last opposite candle before the leg that broke structure (zone = its high–low, dead once a close goes through it);
     FVG = 3-bar gap ≥ 0.1 ATR (filled when price trades through it); liquidity sweep = wick past the last swing that closes back inside;
     equal highs/lows (within 0.15 ATR) = resting liquidity; premium/discount = above/below 50% of the current leg (leg low → highest high since the break).
     Signal: structure up (after BOS/CHoCH), price taps the fresh bullish OB from that break within 72 bars, closes up (green bar) and still in discount →
     buy; SL under the OB − 0.2 ATR (0.5–3 ATR), TP = the leg high (external liquidity) when that is 1.5–4R, else 2R. Mirror for sells. One entry per OB. */
  const smc = (b, A) => {
    const n = b.length, F = 3, o = { dir: Array(n).fill(0), eq: Array(n).fill(null), rh: Array(n).fill(null), rl: Array(n).fill(null), obT: Array(n).fill(null), obB: Array(n).fill(null), sig: Array(n).fill(null), ev: [], obs: [], fvg: [], liq: [], H: [], L: [] };
    let sh = null, shI = -1, shDone = true, shSw = false, sl = null, slI = -1, slDone = true, slSw = false, dir = 0, act = null; const liveF = [], liveO = [];
    for (let i = 0; i < n; i++) {
      const x = b[i], a = A[i] || 0, j = i - F;
      if (j >= F) { let isH = true, isL = true; for (let k = j - F; k <= j + F; k++) { if (k === j) continue; if (b[k].h >= b[j].h) isH = false; if (b[k].l <= b[j].l) isL = false; }
        if (isH) { const pv = o.H[o.H.length - 1]; if (pv && a && Math.abs(pv.p - b[j].h) <= 0.15 * a && j - pv.i <= 120) o.liq.push({ side: 'h', p: Math.max(pv.p, b[j].h), i0: pv.i, i: j, at: i, end: null });
          o.H.push({ p: b[j].h, i: j, at: i }); sh = b[j].h; shI = j; shDone = false; shSw = false; }
        if (isL) { const pv = o.L[o.L.length - 1]; if (pv && a && Math.abs(pv.p - b[j].l) <= 0.15 * a && j - pv.i <= 120) o.liq.push({ side: 'l', p: Math.min(pv.p, b[j].l), i0: pv.i, i: j, at: i, end: null });
          o.L.push({ p: b[j].l, i: j, at: i }); sl = b[j].l; slI = j; slDone = false; slSw = false; } }
      /* fair value gaps: fill the old ones, then add a new one */
      for (let q = liveF.length - 1; q >= 0; q--) { const f = liveF[q]; if (f.dir === 1 ? x.l <= f.bot : x.h >= f.top) { f.end = i; liveF.splice(q, 1); } }
      if (i >= 2 && a) { const g = b[i - 2];
        if (x.l > g.h && x.l - g.h >= 0.1 * a) { const f = { dir: 1, top: x.l, bot: g.h, i: i - 1, born: i, end: null }; o.fvg.push(f); liveF.push(f); }
        if (x.h < g.l && g.l - x.h >= 0.1 * a) { const f = { dir: -1, top: g.l, bot: x.h, i: i - 1, born: i, end: null }; o.fvg.push(f); liveF.push(f); }
        if (liveF.length > 40) liveF.shift(); }
      /* liquidity: equal highs/lows taken, sweeps of the last swing */
      o.liq.forEach((q) => { if (q.end == null && q.at < i && (q.side === 'h' ? x.h > q.p : x.l < q.p)) { q.end = i; q.swept = q.side === 'h' ? x.c < q.p : x.c > q.p; } });
      if (sh != null && !shDone && !shSw && x.h > sh && x.c <= sh) { shSw = true; o.ev.push({ i, type: 'sweep', dir: -1, lvl: sh }); }
      if (sl != null && !slDone && !slSw && x.l < sl && x.c >= sl) { slSw = true; o.ev.push({ i, type: 'sweep', dir: 1, lvl: sl }); }
      /* order blocks die when a close goes through them */
      for (let q = liveO.length - 1; q >= 0; q--) { const z = liveO[q]; if (z.born < i && (z.dir === 1 ? x.c < z.bot : x.c > z.top)) { z.end = i; liveO.splice(q, 1); } }
      /* structure breaks */
      const brk = (d) => { const lvl = d === 1 ? sh : sl, from = d === 1 ? shI : slI, type = dir === -d ? 'choch' : 'bos'; dir = d;
        let k = from; for (let q = from; q <= i; q++) if (d === 1 ? b[q].l < b[k].l : b[q].h > b[k].h) k = q;
        let ob = k; for (let q = k; q >= Math.max(0, k - 10); q--) if (d === 1 ? b[q].c < b[q].o : b[q].c > b[q].o) { ob = q; break; }
        const ext = d === 1 ? b[k].l : b[k].h, prior = (d === 1 ? o.L : o.H).filter((z) => z.i < k && k - z.i <= 60 && z.at <= k).pop();
        const sweep = !!prior && (d === 1 ? ext < prior.p : ext > prior.p);
        let hi = -Infinity, lo = Infinity; for (let q = k; q <= i; q++) { hi = Math.max(hi, b[q].h); lo = Math.min(lo, b[q].l); }
        const z = { dir: d, top: b[ob].h, bot: b[ob].l, i: ob, born: i, end: null, used: false, ev: type, k, sweep, lo, hi,
          fvg: o.fvg.some((f) => f.dir === d && f.born > ob && f.born <= i) };
        o.obs.push(z); liveO.push(z); if (liveO.length > 30) liveO.shift(); act = z; o.ev.push({ i, type, dir: d, lvl, from }); };
      if (sh != null && !shDone && x.c > sh) { shDone = true; brk(1); }
      else if (sl != null && !slDone && x.c < sl) { slDone = true; brk(-1); }
      if (act) { act.hi = Math.max(act.hi, x.h); act.lo = Math.min(act.lo, x.l); }
      /* entry: first tap of the fresh order block */
      if (act && act.end == null && !act.used && act.born < i && i - act.born <= 72 && a) {
        const z = act, eq = (z.hi + z.lo) / 2, d = z.dir;
        const tap = d === 1 ? x.l <= z.top && x.c > z.bot && x.c > x.o && x.c <= eq : x.h >= z.bot && x.c < z.top && x.c < x.o && x.c >= eq;
        if (tap) { z.used = true; const stop = d === 1 ? z.bot - 0.2 * a : z.top + 0.2 * a, risk = Math.min(Math.max(Math.abs(x.c - stop), 0.5 * a), 3 * a), tgt = d === 1 ? z.hi : z.lo, R0 = Math.abs(tgt - x.c) / risk;
          o.sig[i] = { side: d === 1 ? 'buy' : 'sell', risk, R: R0 >= 1.5 && R0 <= 4 ? R0 : 2, ob: z, eq, liqT: R0 >= 1.5 && R0 <= 4 }; } }
      o.dir[i] = dir; if (act) { o.rh[i] = act.hi; o.rl[i] = act.lo; o.eq[i] = (act.hi + act.lo) / 2; if (act.end == null && !act.used && i - act.born <= 72) { o.obT[i] = act.top; o.obB[i] = act.bot; } }
    }
    return o; };
  const wkend = (t) => { const d = new Date(t + 2 * 3600e3).getUTCDay(); return d === 6 || d === 0; }; /* XAUUSD closed: Sat 05:00 → Mon 05:00 Thai */
  const ind = (b) => { const c = b.map((x) => x.c); const o = { e20: ema(c, 20), e50: ema(c, 50), e200: ema(c, 200), e480: ema(c, 480), rsi: rsi(c), r2: rsi(c, 2), atr: atr(b), pdh: [], pdl: [], hiB: [], loB: [], ah: [], al: [], ab: [], dh: [], dl: [], st: [], sd: [] };
    b.forEach((x, i) => { if (i < 20) { o.dh[i] = o.dl[i] = null; return; } let h = -Infinity, l = Infinity; for (let j = i - 20; j < i; j++) { h = Math.max(h, b[j].h); l = Math.min(l, b[j].l); } o.dh[i] = h; o.dl[i] = l; });
    { const a10 = atr(b, 10); let up = null, dn = null, dir = 1; b.forEach((x, i) => { if (a10[i] == null) { o.st[i] = null; o.sd[i] = 0; return; } const m = (x.h + x.l) / 2, u = m + 3 * a10[i], d = m - 3 * a10[i];
      up = up == null || u < up || b[i - 1].c > up ? u : up; dn = dn == null || d > dn || b[i - 1].c < dn ? d : dn; if (dir === 1 && x.c < dn) dir = -1; else if (dir === -1 && x.c > up) dir = 1; o.st[i] = dir === 1 ? dn : up; o.sd[i] = dir; }); }
    let cur = null, ph = null, pl = null, hh = -Infinity, ll = Infinity;
    b.forEach((x, i) => { o.pdh[i] = o.pdl[i] = null; if (wkend(x.t)) return; const k = Math.floor((x.t + 2 * 3600e3) / 86400e3);
      if (k !== cur) { if (cur != null) { ph = hh; pl = ll; } cur = k; hh = -Infinity; ll = Infinity; }
      o.pdh[i] = ph; o.pdl[i] = pl; o.hiB[i] = hh; o.loB[i] = ll; hh = Math.max(hh, x.h); ll = Math.min(ll, x.l); });
    /* Asian range: high/low of the bars opening 07:00–13:00 Thai; usable from 14:00; ab = a bar already closed outside it today */
    let ak = null, ah = -Infinity, al = Infinity, done = false;
    b.forEach((x, i) => { const tt = x.t + 7 * 3600e3, k = Math.floor(tt / 86400e3), h = new Date(tt).getUTCHours();
      if (k !== ak) { ak = k; ah = -Infinity; al = Infinity; done = false; }
      o.ah[i] = o.al[i] = null; o.ab[i] = done;
      if (h >= 7 && h < 14) { ah = Math.max(ah, x.h); al = Math.min(al, x.l); } else if (h >= 14 && ah > -Infinity) { o.ah[i] = ah; o.al[i] = al; if (x.c > ah || x.c < al) done = true; } });
    o.smc = smc(b, o.atr);
    /* 4h structure (only fully closed 4h bars) → o.smc.h4[i]; used to grade SMC entries, not to block them */
    { const g = [], idx = []; b.forEach((x, i) => { const k = Math.floor(x.t / 14400e3); let L = g[g.length - 1];
        if (!L || L.k !== k) { L = { k, t: k * 14400e3, o: x.o, h: x.h, l: x.l, c: x.c, last: i }; g.push(L); } else { L.h = Math.max(L.h, x.h); L.l = Math.min(L.l, x.l); L.c = x.c; L.last = i; } idx[i] = g.length - 1; });
      const M4 = g.length > 30 ? smc(g, atr(g)) : null; o.smc.h4 = b.map((x, i) => { if (!M4) return 0; const gi = idx[i], j = g[gi].last === i && x.t + 3600e3 === g[gi].t + 14400e3 ? gi : gi - 1; return j >= 0 ? M4.dir[j] : 0; }); }
    return o; };

  /* signals on closed bar i — rules match docs/lab.html, where they were tested on 3 years of 1h bars with costs */
  const mk = (side, e, risk, R, ex) => ({ side, entry: e, sl: side === 'buy' ? e - risk : e + risk, tp: side === 'buy' ? e + R * risk : e - R * risk, ...ex });
  /* dip: short, sharp pullback inside a strong trend (Connors RSI 2) — buy when RSI(2) < 8 with price above the 20-day line (EMA 480) and EMA 50 > 200 */
  const sigDip = (b, I, i) => {
    if (i < 500 || wkend(b[i].t) || I.e480[i] == null) return null; const x = b[i], a = I.atr[i], r = I.r2[i];
    if (x.c > I.e480[i] && I.e50[i] > I.e200[i] && r < 8) return mk('buy', x.c, 1.5 * a, 1, { r });
    if (x.c < I.e480[i] && I.e50[i] < I.e200[i] && r > 92) return mk('sell', x.c, 1.5 * a, 1, { r });
    return null;
  };
  /* brk: first close above the last 20 hours' high (below the low) with EMA 50 above (below) EMA 200, bar closing 14:00–01:00 Thai */
  const sigBrk = (b, I, i) => {
    if (i < 210 || wkend(b[i].t) || I.dh[i] == null) return null; const h = new Date(b[i].t + 8 * 3600e3 - 1).getUTCHours(); if (h < 14 && h > 1) return null; /* Thai hour at bar close (no DST) */
    const x = b[i], p = b[i - 1], a = I.atr[i];
    if (x.c > I.dh[i] && p.c <= I.dh[i - 1] && I.e50[i] > I.e200[i]) return mk('buy', x.c, 1.5 * a, 2, { lvl: I.dh[i] });
    if (x.c < I.dl[i] && p.c >= I.dl[i - 1] && I.e50[i] < I.e200[i]) return mk('sell', x.c, 1.5 * a, 2, { lvl: I.dl[i] });
    return null;
  };
  /* st: Supertrend (ATR 10 × 3) flips in the direction of the 20-day line; stop at the Supertrend line (0.5–3 ATR), target 2R */
  const sigSt = (b, I, i) => {
    if (i < 500 || wkend(b[i].t) || I.e480[i] == null) return null; const x = b[i], a = I.atr[i];
    if (I.sd[i] === 1 && I.sd[i - 1] === -1 && x.c > I.e480[i]) return mk('buy', x.c, Math.min(Math.max(x.c - I.st[i], 0.5 * a), 3 * a), 2, { lvl: I.st[i] });
    if (I.sd[i] === -1 && I.sd[i - 1] === 1 && x.c < I.e480[i]) return mk('sell', x.c, Math.min(Math.max(I.st[i] - x.c, 0.5 * a), 3 * a), 2, { lvl: I.st[i] });
    return null;
  };
  /* smc: Smart Money Concepts — see smc() above */
  /* London 14–18, New York 19–24 Thai (bar close), when gold moves most */
  const kzOf = (t) => { const h = new Date(t + 8 * 3600e3 - 1).getUTCHours(); return h >= 14 && h < 19 ? 'ลอนดอน' : h >= 19 || h === 0 ? 'นิวยอร์ก' : ''; };
  const sigSmc = (b, I, i) => { if (i < 60 || wkend(b[i].t) || !I.smc) return null; const q = I.smc.sig[i]; if (!q) return null;
    const d = q.side === 'buy' ? 1 : -1, h4 = (I.smc.h4 && I.smc.h4[i]) || 0, kz = kzOf(b[i].t), pts = (h4 === d) + !!q.ob.sweep + !!q.ob.fvg + !!kz;
    return mk(q.side, b[i].c, q.risk, q.R, { lvl: q.side === 'buy' ? q.ob.top : q.ob.bot, ob: [q.ob.bot, q.ob.top], ev: q.ob.ev, eq: q.eq, swp: q.ob.sweep, fvg: q.ob.fvg, liqT: q.liqT, h4, kz, grade: pts >= 3 ? 'A' : pts === 2 ? 'B' : 'C' }); };
  const evTh = (e) => (e === 'choch' ? 'CHoCH (เปลี่ยนเทรนด์)' : 'BOS (ไปต่อทางเดิม)');
  const STRATS = {
    dip: { name: 'ย่อในเทรนด์ (RSI 2)', fn: sigDip, why: (s) => (s.side === 'buy' ? `เทรนด์ใหญ่ขาขึ้น ราคาย่อลงแรงจน RSI 2 เหลือ ${Math.round(s.r)} มักเด้งกลับในไม่กี่ชั่วโมง` : `เทรนด์ใหญ่ขาลง ราคาเด้งแรงจน RSI 2 ขึ้นไป ${Math.round(s.r)} มักโดนขายกลับ`),
      wait: (I, i) => { const up = bars[i].c > I.e480[i] && I.e50[i] > I.e200[i], dn = bars[i].c < I.e480[i] && I.e50[i] < I.e200[i], r = Math.round(I.r2[i]);
        return up ? `เทรนด์ใหญ่ขาขึ้น (ราคาเหนือเส้น 20 วัน ${px(I.e480[i])}) รอ RSI 2 ลงต่ำกว่า 8 แล้วซื้อ ตอนนี้ ${r}` : dn ? `เทรนด์ใหญ่ขาลง (ราคาใต้เส้น 20 วัน ${px(I.e480[i])}) รอ RSI 2 ขึ้นเกิน 92 แล้วขาย ตอนนี้ ${r}` : 'เทรนด์ใหญ่ยังไม่ชัด (เส้นสั้นกับเส้นยาวขัดกัน) ระบบนี้งดเทรด'; } },
    brk: { name: 'เบรกกรอบ 20 ชม.', fn: sigBrk, lines: (I) => [I.dh, I.dl], why: (s) => `ราคาปิด${s.side === 'buy' ? 'ทะลุจุดสูงสุด' : 'หลุดจุดต่ำสุด'}ของ 20 ชม. ที่ผ่านมา (${px(s.lvl)}) ไปทางเดียวกับเทรนด์ (EMA 50 ${s.side === 'buy' ? 'เหนือ' : 'ใต้'} EMA 200)`,
      wait: (I, i) => { const up = I.e50[i] > I.e200[i]; return `กรอบ 20 ชม. ${px(I.dl[i])}–${px(I.dh[i])} (เส้นประสีทอง) · เทรนด์${up ? 'ขึ้น รอแท่งปิดเหนือ ' + px(I.dh[i]) + ' แล้วซื้อ' : 'ลง รอแท่งปิดใต้ ' + px(I.dl[i]) + ' แล้วขาย'} · ดูแท่งที่ปิด 14:00–01:00 น.`; } },
    st: { name: 'Supertrend กลับตัว', fn: sigSt, lines: (I) => [I.st.map((v, k) => (I.sd[k] === -1 ? v : null)), I.st.map((v, k) => (I.sd[k] === 1 ? v : null))], why: (s) => `เส้น Supertrend พลิกเป็น${s.side === 'buy' ? 'ขาขึ้น' : 'ขาลง'} (${px(s.lvl)}) ตรงกับเทรนด์ใหญ่ 20 วัน`,
      wait: (I, i) => `Supertrend ตอนนี้${I.sd[i] === 1 ? 'ขาขึ้น' : 'ขาลง'} เส้นอยู่ที่ ${px(I.st[i])} · เทรนด์ใหญ่${bars[i].c > I.e480[i] ? 'ขึ้น รอเส้นพลิกขึ้นแล้วซื้อ' : 'ลง รอเส้นพลิกลงแล้วขาย'}` },
    smc: { name: 'SMC (โครงสร้าง + OB)', fn: sigSmc, lines: (I) => [I.smc.obT, I.smc.obB],
      why: (s) => `หลัง ${evTh(s.ev)} ราคาย่อกลับมาแตะ Order Block ${px(s.ob[0])}–${px(s.ob[1])} แล้วปิด${s.side === 'buy' ? 'เขียวในโซน Discount' : 'แดงในโซน Premium'}`,
      wait: (I, i) => { const M = I.smc, d = M.dir[i], z = M.obs[M.obs.length - 1];
        if (!d) return 'ยังไม่เห็นโครงสร้างตลาดชัด รอให้ราคาเบรกจุดสวิงก่อน';
        const tr = d === 1 ? 'ขาขึ้น' : 'ขาลง';
        if (z && z.end == null && !z.used && i - z.born <= 72) return `โครงสร้าง${tr} หลัง ${z.ev === 'choch' ? 'CHoCH' : 'BOS'} · รอราคา${d === 1 ? 'ย่อลง' : 'เด้งขึ้น'}มาแตะ Order Block ${px(z.bot)}–${px(z.top)} (กล่อง OB${d === 1 ? 'ซื้อสีเขียว' : 'ขายสีแดง'}บนกราฟ) แล้วปิด${d === 1 ? 'เขียว = ซื้อ' : 'แดง = ขาย'}`;
        return `โครงสร้าง${tr} แต่ Order Block ล่าสุดใช้ไปแล้วหรือหมดอายุ · รอ BOS/CHoCH ครั้งใหม่`; } },
  };
  /* which conditions fired, with the numbers, for the signal card */
  const COND = {
    dip: (s, J, i) => { const b = s.side === 'buy'; return [`ราคา ${px(s.entry)} ${b ? 'เหนือ' : 'ใต้'}เส้นเฉลี่ย 20 วัน (${px(J.e480[i])}) = เทรนด์ใหญ่${b ? 'ขึ้น' : 'ลง'}`, `EMA 50 (${px(J.e50[i])}) ${b ? 'เหนือ' : 'ใต้'} EMA 200 (${px(J.e200[i])})`, `RSI 2 = ${Math.round(J.r2[i])} ${b ? 'ต่ำกว่า 8 (ย่อแรง)' : 'สูงกว่า 92 (เด้งแรง)'}`]; },
    brk: (s, J, i) => { const b = s.side === 'buy'; return [`แท่งปิดที่ ${px(s.entry)} ${b ? 'ทะลุจุดสูงสุด' : 'หลุดจุดต่ำสุด'}ของ 20 ชม. (${px(s.lvl)}) เป็นแท่งแรก`, `EMA 50 (${px(J.e50[i])}) ${b ? 'เหนือ' : 'ใต้'} EMA 200 (${px(J.e200[i])}) = เทรนด์${b ? 'ขึ้น' : 'ลง'}`, 'แท่งปิดในช่วง 14:00–01:00 น.']; },
    st: (s, J, i) => { const b = s.side === 'buy'; return [`เส้น Supertrend พลิกเป็น${b ? 'ขาขึ้น' : 'ขาลง'} (${px(s.lvl)})`, `ราคา ${px(s.entry)} ${b ? 'เหนือ' : 'ใต้'}เส้นเฉลี่ย 20 วัน (${px(J.e480[i])})`]; },
    smc: (s, J, i) => { const b = s.side === 'buy', o = [`โครงสร้าง${b ? 'ขาขึ้น' : 'ขาลง'}: ราคาปิด${b ? 'ทะลุจุดสวิงไฮ' : 'หลุดจุดสวิงโลว์'} = ${evTh(s.ev)}`,
      `ย่อกลับมาแตะ Order Block ${px(s.ob[0])}–${px(s.ob[1])} เป็นครั้งแรก`, `ราคาปิด ${px(s.entry)} อยู่โซน ${b ? 'Discount (ต่ำกว่า' : 'Premium (สูงกว่า'} 50% ของขา = ${px(s.eq)})`, `แท่งปิด${b ? 'เขียว (ผู้ซื้อกลับมา)' : 'แดง (ผู้ขายกลับมา)'}`];
      const dd = b ? 1 : -1; o.push({ t: `เกรด ${s.grade || '–'} (นับข้อเสริมด้านล่าง ครบ 3–4 = A, 2 = B, 0–1 = C)`, k: 'h' },
        { t: `กราฟ 4 ชม. ${s.h4 === dd ? 'ไปทางเดียวกัน' : s.h4 ? 'สวนทาง' : 'ยังไม่ชัด'}`, k: s.h4 === dd ? '' : 'no' },
        { t: `ก่อนเบรกกวาดสภาพคล่อง${b ? 'ใต้โลว์เดิม' : 'เหนือไฮเดิม'}`, k: s.swp ? '' : 'no' }, { t: 'ขาที่เบรกทิ้ง FVG (ช่องว่างราคา) ไว้', k: s.fvg ? '' : 'no' },
        { t: s.kz ? `อยู่ในช่วงตลาด${s.kz} (ราคาวิ่งจริง)` : 'นอกช่วงลอนดอน/นิวยอร์ก', k: s.kz ? '' : 'no' });
      o.push(s.liqT ? `TP ที่${b ? 'ยอดไฮ' : 'ก้นโลว์'}ของขา (สภาพคล่องที่รออยู่)` : 'TP 2 เท่าของความเสี่ยง (ยอดขาไกลหรือใกล้เกินไป)'); return o; },
  };
  const TAGS = { dip: 'RSI2', brk: 'เบรก20', st: 'ST', smc: 'SMC' };
  const OLD = { asia: 'เบรกกรอบเอเชีย (เลิกใช้)', sweep: 'กวาดสต็อป (เลิกใช้)', ema: 'EMA ย่อ (เลิกใช้)' };
  /* filters: trade only with the 20-day trend (1h EMA 480), skip the US jobs report window (first Friday, 18:00–22:00 Thai) */
  const nfpBlock = (t) => { const d = new Date(t + 7 * 3600e3), h = d.getUTCHours(); return d.getUTCDay() === 5 && d.getUTCDate() <= 7 && h >= 18 && h <= 21; };
  const filt = (fn) => (b, I, i) => { const x = fn(b, I, i); if (!x) return null;
    if (D.set.htf && I.e480 && I.e480[i] != null && (x.side === 'buy' ? b[i].c < I.e480[i] : b[i].c > I.e480[i])) return null;
    if (D.set.nfp && nfpBlock(b[i].t)) return null; return x; };
  const strat = () => (STRATS[D.set.strat] ? D.set.strat : 'dip');
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
  const recalc = () => { const all = form ? [...bars, form] : bars; I = ind(all); Object.keys(STRATS).forEach((k) => { SS[k] = test(bars, I, filt(STRATS[k].fn)); }); S = SS[strat()];
    if (bars.length) { const a = settle(), b = autoTrade(), c = b ? settle() : false; if (a || b || c) save(); } };
  const load = async () => { const k = (await get('klines?symbol=PAXGUSDT&interval=1h&limit=1000')).map(kl); form = k.pop() || null; bars = k; live = form ? form.c : bars[bars.length - 1].c; recalc(); loaded = true; };
  const start = async () => {
    on = true; err = ''; loadLW();
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
    const entry = base + (dir * SPD()) / 2, sl = o.sl ?? entry - dir * SLK * a, tp = o.tp ?? entry + dir * TPK * a;
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
        const bid = live - SPD() / 2, ask = live + SPD() / 2, q = dir > 0 ? bid : ask; /* a buy closes at the bid, a sell at the ask */
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
      const done = P().tx.filter((x) => x.src === k && x.exit != null), rs = done.map((x) => { const r = Math.abs(x.entry - x.sl0) * x.lot * D.set.cs; return r > 0 ? plOf(x) / r : 0; });
      if (rs.length >= 30 && rs.reduce((a, v) => a + v, 0) / rs.length < 0) { P().auto[k] = false; P().off = { ...(P().off || {}), [k]: Date.now() }; ch = true; return; }
      (SS[k] || []).forEach((s) => { const sid = k + ':' + s.t; if (s.t <= since || P().tx.some((x) => x.sid === sid)) return;
        paperOpen(s.side, { entry: s.entry, sl: s.sl, tp: s.tp, src: k, sid, at: s.t }); ch = true; }); });
    return ch;
  };
  const srcName = (k) => (k === 'man' ? 'คุณ' : STRATS[k] ? 'บอท ' + STRATS[k].name : OLD[k] ? 'บอท ' + OLD[k] : k);
  const pOpen = () => P().tx.filter((x) => x.exit == null).sort((a, b) => b.at - a.at);
  const pClosed = () => P().tx.filter((x) => x.exit != null).sort((a, b) => b.closedAt - a.closedAt);
  const qtyFloat = (x) => { const q = x.side === 'buy' ? live - SPD() / 2 : live + SPD() / 2; return live == null ? null : plOf(x, q); };

  /* ---------- chart ---------- */
  let span = 72;
  /* ---------- risk rules, position size and the time machine
     (ideas from github.com/Jakeschincariol/day-trader-skill, MIT: trader-budget, trader-risk, trader-timemachine) ---------- */
  const RULES = { maxLoss: 20, maxDay: 50, maxTrades: 3, minRR: 1.3, wkLoss: 100, moLoss: 200, streak: 2, revenge: 60 }; /* 0.01 lot of gold moves $1 per $1, and a normal 1h stop is $10–20 */
  const rules = () => ({ ...RULES, ...(D.set.rules || {}) });
  /* the stop decides the size: lot = money you accept to lose ÷ (stop distance × ounces per lot), rounded down to 0.01 */
  const sizeLot = (risk) => (risk > 0 ? Math.floor((rules().maxLoss / (risk * D.set.cs)) * 100 + 1e-9) / 100 : null);
  const riskOf = (x) => (x.sl ? Math.max(0, (x.entry - x.sl) * (x.side === 'buy' ? 1 : -1)) * x.lot * D.set.cs : 0);
  const dayState = (list) => { const t = bkDay(Date.now());
    return { n: list.filter((x) => bkDay(x.at) === t).length, pl: list.filter((x) => x.exit != null && bkDay(x.closedAt) === t).reduce((a, x) => a + plOf(x), 0),
      open: list.filter((x) => x.exit == null).reduce((a, x) => a + riskOf(x), 0) }; };
  /* circuit breaker (money-master 2.5): losing streak → 24 h cooldown, weekly / monthly loss caps, no entry within N minutes of a loss */
  const weekStart = (t) => { const d = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
  const breaker = (list) => {
    const r = rules(), now = Date.now(), out = [], cl = list.filter((x) => x.exit != null).sort((a, b) => a.closedAt - b.closedAt);
    let st = 0; for (let i = cl.length - 1; i >= 0 && plOf(cl[i]) < 0; i--) st++;
    const last = cl[cl.length - 1];
    if (st >= r.streak && last && now - last.closedAt < 24 * 3600e3) out.push({ k: 'cool', msg: `แพ้ติดกัน ${st} ไม้ พักเทรดถึง ${hm(last.closedAt + 24 * 3600e3)}` });
    const wk = cl.filter((x) => x.closedAt >= weekStart(now).getTime()).reduce((a, x) => a + plOf(x), 0);
    if (wk <= -r.wkLoss) out.push({ k: 'week', msg: `สัปดาห์นี้ขาดทุน ${usd(wk)} ถึงเพดาน $${f2(r.wkLoss)} หยุดถึงวันจันทร์หน้า` });
    const mk = bkDay(now).slice(0, 7), mo = cl.filter((x) => bkDay(x.closedAt).startsWith(mk)).reduce((a, x) => a + plOf(x), 0);
    if (mo <= -r.moLoss) out.push({ k: 'month', msg: `เดือนนี้ขาดทุน ${usd(mo)} ถึงเพดาน $${f2(r.moLoss)} หยุดถึงต้นเดือนหน้า` });
    if (last && plOf(last) < 0 && now - last.closedAt < r.revenge * 60e3) out.push({ k: 'revenge', msg: `เพิ่งแพ้เมื่อ ${Math.round((now - last.closedAt) / 60e3)} นาทีก่อน รอให้ครบ ${r.revenge} นาที กันเทรดแก้แค้น` });
    return { out, st, wk, mo, last };
  };
  /* every rule that fails is listed; paper entries are blocked, real ones are saved with a warning */
  const check = (o, list) => {
    const r = rules(), bl = [], wn = [], dir = o.side === 'buy' ? 1 : -1, risk = o.sl ? Math.abs(o.entry - o.sl) : 0, loss = risk * o.lot * D.set.cs;
    if (!o.sl) bl.push('ไม่มี SL'); else if ((o.entry - o.sl) * dir <= 0) bl.push(o.side === 'buy' ? 'SL ต้องต่ำกว่าราคาเข้า' : 'SL ต้องสูงกว่าราคาเข้า');
    else if (loss > r.maxLoss * 1.05 + 0.01) bl.push(`ถ้าโดน SL จะเสีย $${f2(loss)} เกินที่ตั้งไว้ไม้ละ $${f2(r.maxLoss)}`);
    if (!o.tp) wn.push('ไม่มี TP'); else if ((o.tp - o.entry) * dir <= 0) bl.push('TP อยู่ผิดฝั่ง');
    else if (risk && Math.abs(o.tp - o.entry) / risk < r.minRR - 1e-9) bl.push(`TP:SL = ${(Math.abs(o.tp - o.entry) / risk).toFixed(2)} ต่ำกว่าขั้นต่ำ ${r.minRR}`);
    const d = dayState(list); if (d.n >= r.maxTrades) bl.push(`วันนี้เข้าไปแล้ว ${d.n} ไม้ ครบโควตา ${r.maxTrades} ไม้ต่อวัน`);
    const worst = Math.max(0, -d.pl) + d.open + loss; if (worst > r.maxDay + 0.01) bl.push(`ถ้าไม้นี้โดน SL วันนี้อาจเสียรวม $${f2(worst)} เกินเพดาน $${f2(r.maxDay)} ต่อวัน`);
    const br = breaker(list); br.out.forEach((x) => bl.push(x.msg));
    if (br.last && plOf(br.last) < 0 && o.lot > br.last.lot + 1e-9) bl.push(`ไม้ก่อนหน้าแพ้ (${br.last.lot} lot) ห้ามเพิ่มขนาดเป็น ${o.lot} lot`);
    if (wkend(Date.now())) wn.push('เสาร์-อาทิตย์ ตลาดทองจริงปิด');
    return { ok: !bl.length, bl, wn };
  };
  /* time machine: replay the next H hours 10,000 times from gold's own 1h bars at the same hour of day (±1 h, weekdays, ~4 months);
     each bar is its open/high/low/close over the previous close, scaled to the running price; stop checked before target */
  let tmPool = null, tmAt = 0;
  const tmLoad = async () => {
    if (tmPool && Date.now() - tmAt < 3600e3) return tmPool; if (!bars.length) return null;
    let all = bars.slice();
    for (let k = 0; k < 2; k++) { try { const r = (await get(`klines?symbol=PAXGUSDT&interval=1h&limit=1000&endTime=${all[0].t - 1}`)).map(kl); if (!r.length) break; all = [...r, ...all]; } catch (e) { break; } }
    const pool = Array.from({ length: 24 }, () => []);
    for (let i = 1; i < all.length; i++) { const x = all[i], q = all[i - 1]; if (wkend(x.t) || wkend(q.t) || x.t - q.t !== 3600e3) continue;
      pool[(new Date(x.t).getUTCHours() + 7) % 24].push([x.o / q.c, x.h / q.c, x.l / q.c, x.c / q.c]); }
    tmPool = { pool, days: Math.round((all[all.length - 1].t - all[0].t) / 86400e3) }; tmAt = Date.now(); return tmPool;
  };
  const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const tmRun = (T0, plan, H = 24, N = 10000, seed = 19) => {
    const R = rng(seed), dir = plan.side === 'buy' ? 1 : -1, risk = Math.abs(plan.entry - plan.sl), rr = Math.abs(plan.tp - plan.entry) / risk, h0 = (new Date(plan.at || Date.now()).getUTCHours() + 7) % 24;
    let tp = 0, sl = 0, ne = 0, sumR = 0; const ends = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      let p = plan.entry, out = null;
      for (let k = 1; k <= H; k++) { const h = (h0 + k) % 24, w = (h + 23 + Math.floor(R() * 3)) % 24, pl = T0.pool[w].length ? T0.pool[w] : T0.pool[h]; const b = pl[Math.floor(R() * pl.length)];
        const hi = p * b[1], lo = p * b[2]; if (!out) { if (dir > 0 ? lo <= plan.sl : hi >= plan.sl) out = 'sl'; else if (dir > 0 ? hi >= plan.tp : lo <= plan.tp) out = 'tp'; } p *= b[3]; }
      ends[n] = p; if (out === 'tp') { tp++; sumR += rr; } else if (out === 'sl') { sl++; sumR -= 1; } else { ne++; sumR += ((p - plan.entry) * dir) / risk; }
    }
    const e = Array.from(ends).sort((a, b) => a - b), q = (f) => e[Math.min(N - 1, Math.floor(f * N))];
    return { N, H, seed, tp: tp / N, sl: sl / N, ne: ne / N, avgR: sumR / N, rr, p5: q(0.05), p50: q(0.5), p95: q(0.95), days: T0.days };
  };
  const pc1 = (v) => (v * 100).toFixed(1) + '%';
  const verdict = (r) => {
    const hit = r.tp + r.sl; if (!hit) return 'แทบทุกรอบไม่ถึงทั้ง TP และ SL ลองดูไปข้างหน้านานขึ้น';
    const be = 1 / (1 + r.rr), ws = r.tp / hit, d = (ws - be) * 100, a = Math.abs(d), side = d > 0 ? 'TP' : 'SL';
    const head = a < 5 ? (Math.abs(r.rr - 1) < 0.05 ? 'พอๆ กับโยนเหรียญ' : 'ใกล้เคียงเท่าทุน') : a < 15 ? `เอียงไปทาง ${side}` : `เอียงไปทาง ${side} ชัดเจน`;
    return `${head}: ในรอบที่ชนเส้นใดเส้นหนึ่ง ถึง TP ก่อน ${pc1(ws)} ส่วนจุดเท่าทุนของ TP:SL = ${r.rr.toFixed(2)} คือ ${pc1(be)}`;
  };
  let tmFrom = null;
  const tmGo = async () => {
    const m = $('tm-msg'), out = $('tm-out'); if (live == null || !bars.length) { m.textContent = 'ยังโหลดราคาไม่เสร็จ'; return; }
    const side = $('tm-side').value, dir = side === 'buy' ? 1 : -1, a = atrNow(), entry = +$('tm-entry').value || live + (dir * SPD()) / 2;
    const sl = +$('tm-sl').value || entry - dir * SLK * a, tp = +$('tm-tp').value || entry + dir * TPK * a, H = +$('tm-h').value || 24;
    if ((entry - sl) * dir <= 0 || (tp - entry) * dir <= 0) { m.textContent = side === 'buy' ? 'Buy: SL ต้องต่ำกว่าราคาเข้า และ TP สูงกว่า' : 'Sell: SL ต้องสูงกว่าราคาเข้า และ TP ต่ำกว่า'; return; }
    m.textContent = 'กำลังโหลดประวัติราคาและเล่นอนาคต…'; const T0 = await tmLoad(); if (!T0) { m.textContent = 'โหลดประวัติราคาไม่สำเร็จ'; return; }
    const r = tmRun(T0, { side, entry, sl, tp }, H); m.textContent = '';
    const bar = (k, v, c) => { const d = el('div', 'tm-row'); const f = el('i', 'tm-f ' + c); f.style.width = Math.max(1, v * 100) + '%'; const t = el('div', 'tm-t'); t.append(f); d.append(el('span', null, k), t, el('b', null, pc1(v))); return d; };
    const lot = sizeLot(Math.abs(entry - sl));
    out.replaceChildren(
      el('p', 'pf-hint', `${side === 'buy' ? 'Buy' : 'Sell'} ที่ ${px(entry)} · SL ${px(sl)} · TP ${px(tp)} · ดูไป ${H} ชม. · ${r.N.toLocaleString()} รอบ จากแท่งจริงราว ${r.days} วัน · seed ${r.seed}`),
      bar('ถึง TP ก่อน', r.tp, 'pos'), bar('โดน SL ก่อน', r.sl, 'neg'), bar(`ไม่ถึงทั้งคู่ใน ${H} ชม.`, r.ne, 'mid'),
      el('p', null, `ราคาตอนครบ ${H} ชม.: กลางๆ ${px(r.p50)} · 90% ของรอบอยู่ระหว่าง ${px(r.p5)} ถึง ${px(r.p95)} · กำไรเฉลี่ยต่อไม้ ${sgn(r.avgR)}${Math.abs(r.avgR).toFixed(2)}R${lot ? ` (≈ ${usd(r.avgR * rules().maxLoss)} ต่อไม้ ถ้าเสี่ยงไม้ละ $${f2(rules().maxLoss)})` : ''}`));
    const v = el('p', 'tm-v'); v.textContent = verdict(r); out.append(v);
    if (r.ne > 0.4) out.append(el('p', 'pf-hint', `${pc1(r.ne)} ของรอบไม่ถึงทั้ง TP และ SL ราคาตอนจบเป็นตัวตัดสินรอบพวกนั้น`));
    if (tmFrom) { const d = (SS[tmFrom] || []).filter((x) => x.out), w = d.filter((x) => x.R > 0).length, rs = d.reduce((acc, x) => acc + x.R, 0);
      if (d.length) out.append(el('p', 'pf-hint', `ประวัติจริงของ ${STRATS[tmFrom].name} ในกราฟที่โหลดไว้: ให้สัญญาณ ${d.length} ครั้ง ถึง TP ${d.filter((x) => x.out === 'tp').length} โดน SL ${d.filter((x) => x.out === 'sl').length} หมดเวลา ${d.filter((x) => x.out === 'time').length} · ชนะ ${Math.round((w / d.length) * 100)}% · รวม ${sgn(rs)}${Math.abs(rs).toFixed(1)}R`)); }
    out.append(el('p', 'pf-hint', 'เป็นการจำลองจากแท่งราคาในอดีต ไม่ใช่คำทำนาย ข่าวใหญ่ทำให้ราคาวิ่งต่างจากที่เคยเกิดได้'));
  };
  const tmFill = (s, k) => { $('tm-side').value = s.side; $('tm-entry').value = ''; $('tm-sl').value = s.sl.toFixed(2); $('tm-tp').value = s.tp.toFixed(2); tmFrom = k || null;
    if (window.VGNav) window.VGNav.go('scan', 'gttm'); setTimeout(() => { $('gttm').scrollIntoView({ behavior: 'smooth', block: 'start' }); tmGo(); }, 120); };
  const drawRules = () => {
    const box = $('rk-today'); if (!box) return; const r = rules();
    const line = (k, list) => { const d = dayState(list), left = r.maxDay - Math.max(0, -d.pl) - d.open;
      const p = el('p', 'rk-l'); p.append(el('b', null, k), el('span', null, ` เข้าแล้ว ${d.n}/${r.maxTrades} ไม้ · ปิดแล้ว ${usd(d.pl)} · ความเสี่ยงไม้ที่เปิด $${f2(d.open)} · เสียได้อีก `), el('b', left > 0 ? 'pos' : 'neg', '$' + f2(Math.max(0, left)))); return p; };
    const brk = (k, list) => { const b = breaker(list); const p = el('p', 'rk-l ' + (b.out.length ? 'neg' : 'pos'));
      p.append(el('b', null, k), el('span', null, ' ' + (b.out.length ? b.out.map((x) => x.msg).join(' · ') : `พร้อมเทรด · สัปดาห์นี้ ${usd(b.wk)} / เพดาน $${f2(r.wkLoss)} · เดือนนี้ ${usd(b.mo)} / $${f2(r.moLoss)}`))); return p; };
    box.replaceChildren(line('ไม้จริงวันนี้:', D.tx), brk('สถานะไม้จริง:', D.tx), line('ไม้กระดาษของคุณวันนี้:', P().tx.filter((x) => x.src === 'man')), brk('สถานะไม้กระดาษ:', P().tx.filter((x) => x.src === 'man')));
  };

  /* ---------- long back-test (money-master 2.6): years of 1h bars, real costs, yearly split, in/out-of-sample, SL/TP sensitivity ---------- */
  let LB = null, lbBusy = false;
  const lbLoad = async (years, msg) => {
    const need = Math.round(years * 365 * 24); let all = bars.slice(), guard = 0;
    while (all.length < need && guard++ < 80) { const r = (await get(`klines?symbol=PAXGUSDT&interval=1h&limit=1000&endTime=${all[0].t - 1}`)).map(kl); if (!r.length) break; all = [...r, ...all]; msg(`กำลังโหลดกราฟย้อนหลัง ${Math.round((all.length / 24 / 365) * 10) / 10} ปี…`); }
    return all;
  };
  const btRun = (b, I, fn, o) => {
    const cost = (D.set.spread || 0) + (D.set.slip || 0) + (D.set.comm || 0) / (D.set.cs || 100), out = []; let i = 60;
    while (i < b.length) {
      const s0 = fn(b, I, i); if (!s0) { i++; continue; } const dir = s0.side === 'buy' ? 1 : -1, risk = Math.abs(s0.entry - s0.sl) * o.slMul, sl = s0.entry - dir * risk, tp = s0.entry + dir * Math.abs(s0.tp - s0.entry) * o.tpMul;
      let exit = null, j = i + 1;
      for (; j < b.length && j <= i + MAXH; j++) { const y = b[j]; if (dir > 0 ? y.l <= sl : y.h >= sl) { exit = sl; break; } if (dir > 0 ? y.h >= tp : y.l <= tp) { exit = tp; break; } if (j === i + MAXH) { exit = y.c; break; } }
      if (exit == null) break; out.push({ t: b[i].t, R: ((exit - s0.entry) * dir - cost) / risk }); i = j + 1;
    }
    return out;
  };
  const sumR = (xs) => { const n = xs.length, w = xs.filter((x) => x.R > 0), gw = w.reduce((a, x) => a + x.R, 0), gl = -xs.filter((x) => x.R <= 0).reduce((a, x) => a + x.R, 0);
    let eq = 0, pk = 0, dd = 0; xs.forEach((x) => { eq += x.R; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); });
    return { n, win: n ? w.length / n : 0, exp: n ? (gw - gl) / n : 0, pf: gl ? gw / gl : null, dd, tot: gw - gl }; };
  const lbAnalyze = (b, I, k) => {
    const fn = filt(STRATS[k].fn), base = btRun(b, I, fn, { slMul: 1, tpMul: 1 }), S0 = sumR(base);
    const cut = b[Math.floor(b.length * 0.7)].t, IS = sumR(base.filter((x) => x.t < cut)), OOS = sumR(base.filter((x) => x.t >= cut));
    const yrs = {}; base.forEach((x) => { const y = new Date(x.t).getUTCFullYear(); (yrs[y] = yrs[y] || []).push(x); });
    const years = Object.entries(yrs).map(([y, xs]) => ({ y, ...sumR(xs) })), posY = years.filter((y) => y.tot > 0).length;
    const grid = []; [0.75, 1, 1.25].forEach((sm) => [0.8, 1, 1.2].forEach((tm) => grid.push({ sm, tm, exp: sumR(btRun(b, I, fn, { slMul: sm, tpMul: tm })).exp })));
    const plateau = grid.filter((g) => g.exp > 0).length, why = [];
    if (S0.n < 100) why.push(`ไม้น้อย (${S0.n} < 100)`); if (S0.exp <= 0.05) why.push('ค่าคาดหวังหลังหักต้นทุนไม่ถึง +0.05R');
    if (!(OOS.exp > 0 && OOS.exp >= 0.5 * IS.exp)) why.push('ช่วงทดสอบท้าย (30% หลัง) แย่กว่าช่วงแรกมาก');
    if (posY < years.length * 0.6) why.push(`กำไรแค่ ${posY}/${years.length} ปี`); if (plateau < 6) why.push(`ขยับ SL/TP แล้วบวกแค่ ${plateau}/9 แบบ`);
    const verdict = S0.exp <= 0 ? 'ทิ้ง' : why.length === 0 ? 'ใช้ได้' : why.length <= 2 ? 'ต้องปรับ' : 'ทิ้ง';
    return { k, S0, IS, OOS, years, grid, plateau, why, verdict };
  };
  const lbGo = async () => {
    if (lbBusy || !bars.length) return; lbBusy = true; const msg = (t) => { $('lb-msg').textContent = t; };
    try {
      const yrs = +$('lb-years').value || 5; if (!LB || LB.years < yrs) { const b = await lbLoad(yrs, msg); LB = { years: yrs, b, I: null }; }
      msg('กำลังคำนวณ…'); await new Promise((r) => setTimeout(r, 30));
      const b = LB.b; LB.I = LB.I || ind(b); LB.res = Object.keys(STRATS).map((k) => lbAnalyze(b, LB.I, k)); LB.span = [b[0].t, b[b.length - 1].t];
      msg(''); drawLB();
    } catch (e) { msg('โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง'); }
    lbBusy = false;
  };
  const drawLB = () => {
    const box = $('lb-out'); if (!box || !LB || !LB.res) return; box.replaceChildren();
    const f2r = (v) => `${sgn(v)}${Math.abs(v).toFixed(2)}R`, cost = (D.set.spread || 0) + (D.set.slip || 0) + (D.set.comm || 0) / (D.set.cs || 100);
    box.append(el('p', 'pf-hint', `ช่วงข้อมูล ${new Date(LB.span[0]).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' })} – ${new Date(LB.span[1]).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' })} · ต้นทุนต่อไม้ $${cost.toFixed(2)}/ออนซ์ (สเปรด + ราคาคลาด + ค่าคอม) · ${D.set.htf ? 'ตามเทรนด์ 20 วัน · ' : ''}${D.set.nfp ? 'เว้นช่วงข่าวจ้างงานสหรัฐฯ' : 'ไม่เว้นข่าว'}`));
    LB.res.forEach((r) => {
      const c = el('div', 'lb-card ' + (r.verdict === 'ใช้ได้' ? 'ok' : r.verdict === 'ต้องปรับ' ? 'mid' : 'bad'));
      c.append(el('b', null, `${STRATS[r.k].name}: ${r.verdict}`),
        el('p', null, `${r.S0.n} ไม้ · ชนะ ${Math.round(r.S0.win * 100)}% · เฉลี่ย ${f2r(r.S0.exp)} ต่อไม้ · PF ${r.S0.pf == null ? '–' : r.S0.pf.toFixed(2)} · รวม ${f2r(r.S0.tot)} · ติดลบสะสมหนักสุด ${f2r(r.S0.dd)}`),
        el('p', 'pf-hint', `70% แรก ${f2r(r.IS.exp)} ต่อไม้ · 30% หลัง ${f2r(r.OOS.exp)} ต่อไม้ · ขยับ SL/TP 9 แบบ บวก ${r.plateau} แบบ · ปีที่กำไร ${r.years.filter((y) => y.tot > 0).length}/${r.years.length}`));
      if (r.why.length) c.append(el('p', 'pf-hint', 'เหตุผล: ' + r.why.join(' · ')));
      const tb = el('table', 'tr-table'), hd = el('tr'); ['ปี', 'ไม้', 'ชนะ', 'เฉลี่ย', 'รวม'].forEach((h) => hd.append(el('th', null, h))); const th = el('thead'); th.append(hd); tb.append(th);
      const bd = el('tbody'); r.years.forEach((y) => { const tr = el('tr'); [String(+y.y + 543), String(y.n), Math.round(y.win * 100) + '%', f2r(y.exp), f2r(y.tot)].forEach((v, i) => tr.append(el('td', i >= 3 ? tone(i === 3 ? y.exp : y.tot) : null, v))); bd.append(tr); });
      tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); c.append(w); box.append(c);
    });
    box.append(el('p', 'pf-hint', 'ทดสอบด้วยราคา PAXG (ใกล้ XAUUSD) ถ้า SL กับ TP โดนในแท่งเดียวกันนับเป็นแพ้ ครบ 48 ชม. ปิดที่ราคาปิด ผลอดีตไม่รับประกันอนาคต'));
  };
  /* expectancy calculator with a 10,000-month simulation */
  const calcGo = () => {
    const w = (+$('cc-w').value || 0) / 100, aw = +$('cc-aw').value || 0, al = +$('cc-al').value || 0, n = Math.round(+$('cc-n').value || 0), risk = +$('cc-r').value || 0, out = $('cc-out');
    if (!(w > 0 && w < 1 && aw > 0 && al > 0 && n > 0 && risk > 0)) { out.textContent = 'ใส่ตัวเลขให้ครบ'; return; }
    const exp = w * aw - (1 - w) * al, R = rng(19), months = []; let neg = 0;
    for (let m = 0; m < 10000; m++) { let t = 0; for (let i = 0; i < n; i++) t += R() < w ? aw : -al; months.push(t * risk); if (t < 0) neg++; }
    months.sort((a, b) => a - b); const q = (f) => months[Math.floor(f * 9999)];
    out.replaceChildren(el('b', exp > 0 ? 'pos' : 'neg', `ค่าคาดหวัง ${sgn(exp)}${Math.abs(exp).toFixed(2)}R ต่อไม้ → เฉลี่ยเดือนละ ${usd(exp * n * risk)} (${thb(exp * n * risk)})`),
      el('p', null, `จำลอง 10,000 เดือน: เดือนที่ขาดทุน ${Math.round((neg / 100))}% · 90% ของเดือนอยู่ระหว่าง ${usd(q(0.05))} ถึง ${usd(q(0.95))} · จุดเท่าทุนต้องชนะอย่างน้อย ${Math.round((al / (aw + al)) * 100)}%`));
  };

  /* ---------- TradingView-style chart: lightweight-charts 4.2.3 (TradingView's open-source library) loaded on demand;
     pan, pinch/wheel zoom, crosshair, timeframes 15m/1h/4h/1d, RSI pane synced below. The SVG chart below stays as the fallback.
     Mode 'tv' embeds the real TradingView widget (OANDA:XAUUSD, drawing tools) instead. ---------- */
  const LWURL = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';
  let lwState = 'none', LW = null, tf = '1h', mode = 'sys'; const TFH = { '15m': 0.25, '1h': 1, '4h': 4, '1d': 24 }, tfc = {};
  const loadLW = () => {
    if (lwState !== 'none') return; if (window.LightweightCharts) { lwState = 'ok'; $('gt-tf').hidden = mode === 'tv'; return; }
    lwState = 'loading'; const sc = document.createElement('script'); sc.src = LWURL;
    sc.onload = () => { lwState = window.LightweightCharts ? 'ok' : 'fail'; if (lwState === 'ok') $('gt-tf').hidden = mode === 'tv'; drawChart(); };
    sc.onerror = () => { lwState = 'fail'; drawChart(); }; document.head.append(sc);
  };
  const tfLoad = async (k) => {
    const c = (tfc[k] = tfc[k] || {}); if (c.busy) return; c.busy = true;
    try { const r = (await get(`klines?symbol=PAXGUSDT&interval=${k}&limit=${c.b ? 5 : 1000}`)).map(kl);
      if (!c.b) c.b = r; else r.forEach((x) => { const j = c.b.findIndex((y) => y.t === x.t); if (j >= 0) c.b[j] = x; else if (x.t > c.b[c.b.length - 1].t) c.b.push(x); });
      c.I = ind(c.b); } catch (e) { /* retry on the next round */ }
    c.at = Date.now(); c.busy = false; drawChart();
  };
  const tfData = () => {
    if (tf === '1h') return { b: form ? [...bars, form] : bars, I };
    const c = tfc[tf]; if (!c || !c.b) { tfLoad(tf); return null; }
    const b = c.b.slice(), L = b[b.length - 1]; if (live != null && L) b[b.length - 1] = { ...L, c: live, h: Math.max(L.h, live), l: Math.min(L.l, live) };
    return { b, I: c.I };
  };
  const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const ts = (t) => Math.floor(t / 1000) + 7 * 3600; /* shift so the axis reads Thai time */
  const readOut = (b, J, k) => { const x = b[k]; if (!x) return; const r = J.rsi[k], pv = b[k - 1], ch = pv ? ((x.c - pv.c) / pv.c) * 100 : 0, o = $('gt-read'); o.replaceChildren();
    const it = (k2, v, c) => { const sp = el('span', c || null); sp.append(el('small', null, k2), ' ' + v); o.append(sp); };
    o.append(el('b', null, hm(x.t))); it('ปิด', `${px(x.c)} ${ch >= 0 ? '▲' : '▼'}${Math.abs(ch).toFixed(2)}%`, ch > 0 ? 'pos' : ch < 0 ? 'neg' : ''); it('สูง', px(x.h)); it('ต่ำ', px(x.l));
    if (lay().ma) { it('EMA20', px(J.e20[k]), 'gt-k20'); it('EMA50', px(J.e50[k]), 'gt-k50'); } it('RSI', r != null ? r.toFixed(0) : '–', r > 70 ? 'neg' : r < 30 ? 'pos' : ''); };
  /* chart layers Mon can switch off (kept on this device) */
  const LAYK = 'vg-gtlay', lay = () => { try { return { ma: true, zone: true, tag: true, ...JSON.parse(localStorage.getItem(LAYK) || '{}') }; } catch (e) { return { ma: true, zone: true, tag: true }; } };
  const setLay = (k, v) => { const o = lay(); o[k] = v; try { localStorage.setItem(LAYK, JSON.stringify(o)); } catch (e) { /* ignore */ } };
  const drawLeg = () => { const g = $('gt-leg'); if (!g) return; const L = lay(), k = strat(), out = [];
    const sw = (cls, t) => { const sp = el('span'); sp.append(el('i', cls), t); out.push(sp); };
    sw('gt-tri up', 'สัญญาณซื้อ'); sw('gt-tri dn', 'สัญญาณขาย');
    if (L.ma) { sw('gt-ln e20', 'EMA 20'); sw('gt-ln e50', 'EMA 50'); }
    if (L.zone) { if (k === 'smc') { sw('gt-box ob', 'Order Block'); sw('gt-box fvg', 'FVG'); sw('gt-ln eq', 'กึ่งกลางขา (บนแดง = Premium, ล่างเขียว = Discount)'); } else if (k === 'brk') sw('gt-ln pd', 'กรอบ 20 ชม.'); else if (k === 'st') sw('gt-ln pd', 'เส้น Supertrend'); }
    if (L.tag && k === 'smc') { sw('gt-sq', 'BOS / CHoCH'); sw('gt-dot', 'กวาดสภาพคล่อง'); }
    sw('gt-ln le', 'ไม้ที่เปิดอยู่'); sw('gt-ln sl', 'SL'); sw('gt-ln tp', 'TP'); g.replaceChildren(...out); };
  /* SMC zones drawn as boxes on a canvas over the chart: order blocks (solid tint), FVG (light tint, dashed edge), premium/discount of the current leg */
  const zoneDraw = () => {
    if (!LW || !LW.cv) return; const cv = LW.cv, box = $('gt-chart'), dpr = window.devicePixelRatio || 1, W = box.clientWidth, H = box.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const d = LW.d; if (!d || strat() !== 'smc' || !lay().zone || !d.I || !d.I.smc || TFH[tf] > 1) return;
    const { b } = d, M = d.I.smc, tsc = LW.ch.timeScale(), pw = tsc.width(), ph = LW.ch.paneSize ? LW.ch.paneSize().height : H - 28, n = b.length;
    const X = (i) => { const v = tsc.logicalToCoordinate(i); return v == null ? null : v; }, Y = (p) => LW.cs.priceToCoordinate(p);
    const vr = tsc.getVisibleLogicalRange(); if (!vr) return; const lo = Math.max(0, Math.floor(vr.from) - 1), hi = Math.min(n + 4, Math.ceil(vr.to) + 1);
    const tags = []; c.save(); c.beginPath(); c.rect(0, 0, pw, ph); c.clip(); c.font = '600 11px ' + (cssv('--font') || 'sans-serif'); c.textBaseline = 'top';
    const rect = (i0, i1, top, bot, col, a, dash, label, edge = true) => { const x0 = X(Math.max(i0, lo)), x1 = X(Math.min(i1, hi)), y0 = Y(top), y1 = Y(bot); if (x0 == null || x1 == null || y0 == null || y1 == null || x1 <= x0) return;
      c.globalAlpha = a; c.fillStyle = col; c.fillRect(x0, y0, x1 - x0, Math.max(2, y1 - y0));
      if (edge) { c.globalAlpha = 0.85; c.strokeStyle = col; c.lineWidth = 1; c.setLineDash(dash ? [4, 3] : []); c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, Math.max(2, y1 - y0) - 1); c.setLineDash([]); }
      if (label && x1 - x0 > 60 && y1 - y0 > 12) { c.globalAlpha = 1; c.fillStyle = col; const lx = Math.max(x0, 0) + 4, lw = c.measureText(label).width;
        if (!tags.some((q) => lx < q[0] + q[2] + 6 && q[0] < lx + lw + 6 && Math.abs(q[1] - y0) < 14)) { tags.push([lx, y0, lw]); c.fillText(label, lx, y0 + 2); } } c.globalAlpha = 1; };
    const up = cssv('--jade'), dn = cssv('--brick'), p = b[n - 1].c, a = (d.I.atr[n - 1]) || 1;
    /* premium / discount of the current leg: a faint wash, no border */
    const z = M.obs[M.obs.length - 1]; if (z && M.rh[n - 1] != null) { const eq = M.eq[n - 1]; rect(z.k, n + 3, M.rh[n - 1], eq, dn, 0.045, false, '', false); rect(z.k, n + 3, eq, M.rl[n - 1], up, 0.045, false, '', false); }
    /* only the live zones that matter: up to 2 each side of price, nearest first */
    const pickN = (L, k) => [...L.filter((x) => x.bot > p).sort((x, y) => x.bot - y.bot).slice(0, k), ...L.filter((x) => x.bot <= p).sort((x, y) => y.top - x.top).slice(0, k)];
    pickN(M.fvg.filter((f) => f.end == null && f.top - f.bot >= 0.25 * a && n - f.born <= 240), 2).forEach((f) => rect(f.i, n + 3, f.top, f.bot, f.dir === 1 ? up : dn, 0.1, true, 'FVG'));
    pickN(M.obs.filter((o) => o.end == null && n - o.born <= 240), 2).forEach((o) => rect(o.i, n + 3, o.top, o.bot, o.dir === 1 ? up : dn, o.used ? 0.13 : 0.24, false, (o.dir === 1 ? 'OB ซื้อ' : 'OB ขาย') + (o.used ? ' · ใช้แล้ว' : '')));
    c.restore(); };
  const lwSpan = () => { if (!LW || !LW.d) return; const n = LW.d.b.length, k = Math.max(40, Math.round(span / TFH[tf])); LW.ch.timeScale().setVisibleLogicalRange({ from: n - k, to: n + 3 }); };
  const lwBuild = () => {
    const L = window.LightweightCharts, box = $('gt-chart'), rb = $('gt-rsi'); box.innerHTML = ''; box.classList.add('lw'); rb.hidden = false; rb.innerHTML = '';
    const base = () => ({ autoSize: true, layout: { background: { type: 'solid', color: cssv('--surface') || '#fff' }, textColor: cssv('--ink-3') || '#667', fontFamily: 'Chivo Mono, ui-monospace, monospace', fontSize: 11 },
      grid: { vertLines: { color: cssv('--chart-grid') }, horzLines: { color: cssv('--chart-grid') } },
      rightPriceScale: { borderColor: cssv('--line'), minimumWidth: 66 }, timeScale: { borderColor: cssv('--line'), timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: L.CrosshairMode.Normal }, localization: { priceFormatter: (p) => p.toFixed(2) } });
    const ch = L.createChart(box, base()), rc = L.createChart(rb, { ...base(), timeScale: { visible: false, rightOffset: 4 } });
    const up = cssv('--jade'), dn = cssv('--brick'), quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    const cs = ch.addCandlestickSeries({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn, borderVisible: false, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    const e20 = ch.addLineSeries({ color: cssv('--ochre'), lineWidth: 2, ...quiet }), e50 = ch.addLineSeries({ color: cssv('--accent'), lineWidth: 2, ...quiet });
    const lvO = { color: cssv('--foil'), lineWidth: 2, lineStyle: L.LineStyle.Dashed, lineType: L.LineType.WithSteps, ...quiet }; const lh = ch.addLineSeries(lvO), ll = ch.addLineSeries(lvO);
    const eqS = ch.addLineSeries({ color: cssv('--ink-3'), lineWidth: 1, lineStyle: L.LineStyle.Dotted, lineType: L.LineType.WithSteps, ...quiet });
    const rs = rc.addLineSeries({ color: cssv('--accent'), lineWidth: 2, priceLineVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    rc.priceScale('right').applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } });
    [30, 70].forEach((v) => rs.createPriceLine({ price: v, color: cssv('--ink-3'), lineWidth: 1, lineStyle: L.LineStyle.Dashed, axisLabelVisible: true }));
    let sync = false; const link = (a, b2) => a.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (sync || !r) return; sync = true; b2.timeScale().setVisibleLogicalRange(r); sync = false; });
    const cv = el('canvas', 'gt-zones'); box.append(cv); let raf = 0; const zq = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; zoneDraw(); }); };
    ch.timeScale().subscribeVisibleLogicalRangeChange(zq); ch.subscribeCrosshairMove(zq); if (window.ResizeObserver) new ResizeObserver(zq).observe(box);
    link(ch, rc); link(rc, ch);
    const cross = (prm) => { if (!LW || !LW.d) return; const k = prm && prm.time != null ? LW.idx.get(prm.time) : undefined; readOut(LW.d.b, LW.d.I, k ?? LW.d.b.length - 1); };
    ch.subscribeCrosshairMove(cross); rc.subscribeCrosshairMove(cross);
    LW = { L, ch, rc, cs, e20, e50, lh, ll, eqS, rs, cv, zq, pls: [], key: '', idx: new Map(), d: null, up, dn };
  };
  const lwDraw = () => {
    const d = tfData(); if (!d || !d.b.length || !d.I) return; if (!LW) lwBuild();
    const { b, I: J } = d, key = tf + ':' + strat(); LW.d = d; LW.idx = new Map(b.map((x, i) => [ts(x.t), i]));
    const toL = (arr) => b.map((x, i) => (arr[i] == null ? { time: ts(x.t) } : { time: ts(x.t), value: arr[i] }));
    LW.cs.setData(b.map((x) => ({ time: ts(x.t), open: x.o, high: x.h, low: x.l, close: x.c })));
    const LY = lay(); LW.e20.setData(LY.ma ? toL(J.e20) : []); LW.e50.setData(LY.ma ? toL(J.e50) : []); LW.rs.setData(toL(J.rsi));
    const LV = TFH[tf] <= 1 && LY.zone && strat() !== 'smc' && STRATS[strat()].lines ? STRATS[strat()].lines(J) : null; LW.lh.setData(LV ? toL(LV[0]) : []); LW.ll.setData(LV ? toL(LV[1]) : []);
    const isSmc = strat() === 'smc' && J.smc && TFH[tf] <= 1; LW.eqS.setData(isSmc && LY.zone ? toL(J.smc.eq) : []);
    const dur = TFH[tf] * 3600e3, mk = [], seen = new Set();
    if (tf !== '1d') S.forEach((sg) => { const t = sg.t - 1; let lo = 0, hi = b.length - 1, j = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m].t <= t) { j = m; lo = m + 1; } else hi = m - 1; }
      if (j < 0 || t >= b[j].t + dur || seen.has(j)) return; seen.add(j);
      mk.push({ time: ts(b[j].t), position: sg.side === 'buy' ? 'belowBar' : 'aboveBar', color: sg.side === 'buy' ? LW.up : LW.dn, shape: sg.side === 'buy' ? 'arrowUp' : 'arrowDown', text: (sg.side === 'buy' ? 'Buy ' : 'Sell ') + (TAGS[strat()] || '') }); });
    if (isSmc && LY.tag) { const ink = cssv('--ink-2'), lim = Math.max(0, b.length - 400);
      J.smc.ev.forEach((e) => { if (e.i < lim) return; mk.push(e.type === 'sweep' ? { time: ts(b[e.i].t), position: e.dir === 1 ? 'belowBar' : 'aboveBar', color: ink, shape: 'circle', text: '' }
        : { time: ts(b[e.i].t), position: e.dir === 1 ? 'aboveBar' : 'belowBar', color: e.dir === 1 ? LW.up : LW.dn, shape: 'square', text: e.type === 'choch' ? 'CHoCH' : 'BOS' }); });
      mk.sort((p, q) => p.time - q.time); }
    LW.cs.setMarkers(mk);
    LW.pls.forEach((p) => LW.cs.removePriceLine(p)); LW.pls = [];
    [...openTx(), ...pOpen()].forEach((x) => [['entry', cssv('--ink'), x.src ? 'กระดาษ' : 'เข้า'], ['sl', LW.dn, 'SL'], ['tp', LW.up, 'TP']].forEach(([k, c, tl]) => { if (x[k]) LW.pls.push(LW.cs.createPriceLine({ price: x[k], color: c, lineWidth: 1, lineStyle: LW.L.LineStyle.Dashed, axisLabelVisible: true, title: tl })); }));
    if (LW.key !== key) { LW.key = key; lwSpan(); }
    readOut(b, J, b.length - 1); drawLeg(); LW.zq();
  };
  /* the real TradingView widget */
  let tvDone = false;
  const showTV = () => {
    const box = $('gt-tv'); if (tvDone) return; tvDone = true;
    const go = () => { if (!window.TradingView) { tvDone = false; box.textContent = 'โหลด TradingView ไม่สำเร็จ'; return; } box.innerHTML = '<div id="gt-tvw" style="height:100%"></div>';
      new window.TradingView.widget({ autosize: true, symbol: 'OANDA:XAUUSD', interval: '60', timezone: 'Asia/Bangkok', theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', style: '1', locale: 'th_TH',
        allow_symbol_change: true, withdateranges: true, hide_side_toolbar: false, studies: ['MAExp@tv-basicstudies', 'RSI@tv-basicstudies'], container_id: 'gt-tvw' }); };
    if (window.TradingView) go(); else { box.textContent = 'กำลังโหลด TradingView…'; const sc = document.createElement('script'); sc.src = 'https://s3.tradingview.com/tv.js'; sc.onload = go;
      sc.onerror = () => { tvDone = false; box.textContent = 'โหลด TradingView ไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต)'; }; document.head.append(sc); }
  };
  const setMode = (m) => {
    mode = m; const tv = m === 'tv'; $('gt-tv').hidden = !tv; ['gt-chart', 'gt-read', 'gt-span', 'gt-leg'].forEach((k) => { $(k).hidden = tv; });
    $('gt-rsi').hidden = tv || !LW; $('gt-tf').hidden = tv || lwState !== 'ok';
    document.querySelectorAll('#gt-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.m === m)));
    if (tv) showTV(); else drawChart();
  };

  const drawChart = () => {
    const box = $('gt-chart'); if (!box || mode === 'tv') return;
    if (lwState === 'ok' && window.LightweightCharts) { try { lwDraw(); return; } catch (e) { lwState = 'fail'; LW = null; box.classList.remove('lw'); $('gt-rsi').hidden = true; $('gt-tf').hidden = true; tf = '1h'; } }
    if (LW) { LW = null; box.classList.remove('lw'); $('gt-rsi').hidden = true; }
    const all = form ? [...bars, form] : bars;
    if (!all.length || !I) { box.innerHTML = ''; return; }
    const W = Math.max(300, box.clientWidth || 600), R = 58, H1 = 250, H2 = 74, GAP = 22, H = H1 + GAP + H2 + 18;
    const n = Math.min(span, all.length), s0 = all.length - n, v = all.slice(s0);
    const opens = [...openTx(), ...pOpen()], LV = STRATS[strat()].lines ? STRATS[strat()].lines(I) : null;
    let lo = Infinity, hi = -Infinity;
    v.forEach((b, k) => { lo = Math.min(lo, b.l, I.e50[s0 + k] ?? b.l); hi = Math.max(hi, b.h, I.e50[s0 + k] ?? b.h); });
    const rng0 = hi - lo; if (LV) v.forEach((b, k) => [LV[0][s0 + k], LV[1][s0 + k]].forEach((p) => { if (p != null && p > lo - rng0 * 0.5 && p < hi + rng0 * 0.5) { lo = Math.min(lo, p); hi = Math.max(hi, p); } }));
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
    if (LV) v.forEach((b, k) => { [[LV[0][s0 + k], 'gt-pdh'], [LV[1][s0 + k], 'gt-pdl']].forEach(([p, c]) => { if (p != null && p > lo && p < hi) o.push(`<line x1="${k * cw}" x2="${(k + 1) * cw}" y1="${y(p)}" y2="${y(p)}" class="${c}"/>`); }); });
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

  /* ---------- today: open / careful / stop, from the market and Mon's own rules ---------- */
  const sessNow = (t) => { const h = bkHour(t); return h >= 7 && h < 14 ? 'เอเชีย (ช่วงเงียบ)' : h >= 14 && h < 19 ? 'ลอนดอน' : h >= 19 ? 'นิวยอร์ก (แรงสุด)' : h < 4 ? 'ปลายนิวยอร์ก' : 'ตลาดเงียบ'; };
  const posture = () => {
    const now = Date.now(), r = rules(), d = dayState(D.tx), br = breaker(D.tx), stop = [], care = [], i = bars.length - 1;
    if (wkend(now)) stop.push('ตลาดทองปิดเสาร์-อาทิตย์');
    br.out.forEach((x) => stop.push(x.msg));
    if (d.n >= r.maxTrades) stop.push(`เข้าครบ ${r.maxTrades} ไม้แล้ววันนี้`);
    if (d.pl <= -r.maxDay) stop.push(`วันนี้เสียถึงเพดาน $${f2(r.maxDay)} แล้ว`);
    if (nfpBlock(now) || nfpBlock(now + 3 * 3600e3)) care.push('ใกล้ช่วงข่าวจ้างงานสหรัฐ (NFP) ศุกร์แรกของเดือน');
    let vol = null; if (I && i > 500) { const A = I.atr.slice(i - 480, i).filter((v) => v != null).sort((p, q) => p - q), med = A[A.length >> 1]; vol = I.atr[i] / med;
      if (vol > 1.8) care.push(`ผันผวนสูงกว่าปกติ ${vol.toFixed(1)} เท่า SL จะกว้าง ลด lot`); }
    const st = stop.length ? 'stop' : care.length ? 'care' : 'go';
    return { st, why: stop.length ? stop : care, vol, d, r, sess: sessNow(now) };
  };
  const drawDay = (box) => {
    const P0 = posture(), w = el('div', 'gt-day ' + P0.st), top = el('div', 'gt-dayh');
    top.append(el('span', 'gt-stamp', P0.st === 'stop' ? 'พักวันนี้' : P0.st === 'care' ? 'เทรดได้ แต่ระวัง' : 'เทรดได้'), el('span', 'gt-dayw', P0.why.length ? P0.why.join(' · ') : 'ไม่มีอะไรขวาง เข้าได้ตามสัญญาณและแผน'));
    const f = el('dl', 'gt-dayf'), it = (k, v, c) => { const x = el('div'); x.append(el('dt', null, k), el('dd', c || null, v)); f.append(x); };
    it('ช่วงตลาด', P0.sess, 'tx'); it('ความผันผวน', P0.vol == null ? '–' : P0.vol > 1.8 ? 'สูง' : P0.vol < 0.6 ? 'เงียบ' : 'ปกติ', P0.vol > 1.8 ? 'neg tx' : 'tx');
    it('ไม้จริงวันนี้', `${P0.d.n}/${P0.r.maxTrades}`); it('กำไรวันนี้', usd(P0.d.pl), tone(P0.d.pl));
    w.append(top, f);
    const n = el('p', 'pf-hint gt-dayn'); n.append('ระบบรู้แค่ข่าว NFP ก่อนเข้าไม้เช็กข่าวใหญ่ (CPI, FOMC) ใน ');
    const a = el('a', null, 'ปฏิทินข่าว'); a.href = 'https://www.forexfactory.com/calendar'; a.target = '_blank'; a.rel = 'noopener'; n.append(a, ' · หยุด 30 นาทีก่อนและหลังข่าว'); w.append(n);
    box.append(w); };

  /* ---------- SMC overview: structure, premium/discount, order blocks, FVG, liquidity ---------- */
  const smcPanel = () => {
    const wrap = el('div', 'gt-smc'), M = I && I.smc, i = bars.length - 1; wrap.append(el('small', 'gt-ch', 'ภาพรวม SMC ตอนนี้ (แท่ง 1 ชม.)'));
    if (!M || i < 60) { wrap.append(el('p', 'pf-hint', 'ข้อมูลยังไม่พอ')); return wrap; }
    const p = live != null ? live : bars[i].c, a = I.atr[i] || 1, row = (k, v, c) => { const r = el('div', 'gt-orow'); r.append(el('span', null, k), el('span', c || null, v)); wrap.append(r); };
    const ago = (j) => { const h = i - j; return h < 1 ? 'แท่งล่าสุด' : h < 48 ? `${h} ชม.ก่อน` : `${Math.round(h / 24)} วันก่อน`; };
    const E = M.ev.filter((e) => e.type !== 'sweep'), e = E[E.length - 1], d = M.dir[i];
    row('โครงสร้าง', d ? `${d === 1 ? 'ขาขึ้น' : 'ขาลง'} · ล่าสุด ${e.type === 'choch' ? 'CHoCH' : 'BOS'} ที่ ${px(e.lvl)} (${ago(e.i)})` : 'ยังไม่ชัด', d === 1 ? 'pos' : d === -1 ? 'neg' : 'muted');
    const h4 = M.h4 ? M.h4[i] : 0; row('กราฟ 4 ชม.', h4 ? (h4 === 1 ? 'ขาขึ้น' : 'ขาลง') + (d && h4 !== d ? ' · สวนกับ 1 ชม. ระวัง' : ' · ไปทางเดียวกัน') : 'ยังไม่ชัด', h4 === 1 ? 'pos' : h4 === -1 ? 'neg' : 'muted');
    const rh = M.rh[i], rl = M.rl[i];
    if (rh != null && rh > rl) { const f = Math.min(1, Math.max(0, (p - rl) / (rh - rl))), z = f > 0.5 ? 'Premium (ฝั่งแพง)' + (d === -1 ? ' = โซนรอขาย' : ' = อย่าไล่ซื้อ') : 'Discount (ฝั่งถูก)' + (d === 1 ? ' = โซนรอซื้อ' : ' = อย่าไล่ขาย');
      row('โซนราคา', `${z} · อยู่ที่ ${Math.round(f * 100)}% ของขา ${px(rl)}–${px(rh)} · กึ่งกลาง ${px((rh + rl) / 2)}`, f > 0.5 ? 'neg' : 'pos');
      const bar = el('div', 'gt-pdz'), mk1 = el('i'); mk1.style.left = (f * 100).toFixed(1) + '%'; bar.append(mk1); const lb = el('div', 'gt-pdzl'); lb.append(el('span', null, 'Discount ' + px(rl)), el('span', null, 'Premium ' + px(rh))); wrap.append(bar, lb); }
    const near = (list, up) => list.filter((x) => (up ? x.bot > p : x.top < p)).sort((x, y) => (up ? x.bot - y.bot : y.top - x.top))[0];
    const aliveOB = M.obs.filter((z) => z.end == null && i - z.born <= 240), aliveF = M.fvg.filter((f) => f.end == null && i - f.born <= 240);
    const zt = (z, kind) => (z ? `${px(z.bot)}–${px(z.top)} · ห่าง $${f2(Math.min(Math.abs(p - z.top), Math.abs(p - z.bot)))} (${kind} ${ago(z.born)})` : 'ไม่มีในระยะนี้');
    const obB = near(aliveOB.filter((z) => z.dir === 1), false), obS = near(aliveOB.filter((z) => z.dir === -1), true);
    row('OB ฝั่งซื้อ (ใต้ราคา)', zt(obB, obB && obB.used ? 'ใช้แล้ว' : 'เกิด'), obB ? 'pos' : 'muted');
    row('OB ฝั่งขาย (เหนือราคา)', zt(obS, obS && obS.used ? 'ใช้แล้ว' : 'เกิด'), obS ? 'neg' : 'muted');
    const fB = near(aliveF.filter((f) => f.dir === 1), false), fS = near(aliveF.filter((f) => f.dir === -1), true);
    row('FVG ใต้ราคา', zt(fB, 'เกิด'), fB ? 'pos' : 'muted'); row('FVG เหนือราคา', zt(fS, 'เกิด'), fS ? 'neg' : 'muted');
    /* liquidity: untouched swing highs above / lows below, equal highs/lows, previous day */
    const untH = M.H.filter((q) => q.p > p && !bars.slice(q.i + 1, i + 1).some((x) => x.h > q.p)).sort((x, y) => x.p - y.p)[0];
    const untL = M.L.filter((q) => q.p < p && !bars.slice(q.i + 1, i + 1).some((x) => x.l < q.p)).sort((x, y) => y.p - x.p)[0];
    const eqH = M.liq.filter((q) => q.side === 'h' && q.end == null && q.p > p && i - q.i <= 240).sort((x, y) => x.p - y.p)[0], eqL = M.liq.filter((q) => q.side === 'l' && q.end == null && q.p < p && i - q.i <= 240).sort((x, y) => y.p - x.p)[0];
    const j = all1(), up1 = [untH && `สวิงไฮ ${px(untH.p)}`, eqH && `Equal highs ${px(eqH.p)}`, I.pdh[j] > p && `ไฮเมื่อวาน ${px(I.pdh[j])}`].filter(Boolean), dn1 = [untL && `สวิงโลว์ ${px(untL.p)}`, eqL && `Equal lows ${px(eqL.p)}`, I.pdl[j] < p && `โลว์เมื่อวาน ${px(I.pdl[j])}`].filter(Boolean);
    row('สภาพคล่องด้านบน', up1.length ? up1.join(' · ') : 'ไม่มีในระยะนี้'); row('สภาพคล่องด้านล่าง', dn1.length ? dn1.join(' · ') : 'ไม่มีในระยะนี้');
    const sw = M.ev.filter((x) => x.type === 'sweep').pop(); if (sw && i - sw.i <= 24) row('กวาดสภาพคล่องล่าสุด', `${sw.dir === 1 ? 'กวาดโลว์' : 'กวาดไฮ'} ${px(sw.lvl)} แล้วปิดกลับ (${ago(sw.i)}) · มัก${sw.dir === 1 ? 'เด้งขึ้น' : 'ย่อลง'}ต่อ`, sw.dir === 1 ? 'pos' : 'neg');
    const G = (SS.smc || []).filter((x) => x.out); if (G.length) { const gs = ['A', 'B', 'C'].map((g) => { const L = G.filter((x) => x.grade === g); if (!L.length) return `${g} ยังไม่มี`;
        const w = L.filter((x) => x.R > 0).length, sr = L.reduce((q, x) => q + x.R, 0); return `${g} ${L.length} ไม้ ชนะ ${Math.round((w / L.length) * 100)}% รวม ${sgn(sr)}${Math.abs(sr).toFixed(1)}R`; });
      row('ย้อนหลังแยกเกรด', gs.join(' · ') + (G.length < 30 ? ' (ไม้ยังน้อย อย่าเพิ่งเชื่อ)' : '')); }
    wrap.append(el('p', 'pf-hint', `ATR ${px(a)} · บนกราฟ: สี่เหลี่ยม BOS/CHoCH = โครงสร้างเบรก, วงกลม "กวาด" = กวาดสภาพคล่อง, กล่องสี = Order Block (ทึบ) กับ FVG (โปร่ง), เส้นจุด = กึ่งกลางขา (Premium/Discount) · เป็นการประมาณ ไม่ใช่คำแนะนำการลงทุน`));
    return wrap; };

  /* ---------- signal card ---------- */
  const lastSig = () => { const s = S[S.length - 1]; if (!s) return null; const age = bars.length - 1 - s.i; return age <= 2 && !s.out ? s : null; };
  const trendNow = () => { const i = bars.length - 1; if (!I || i < 60) return null; const up = I.e20[i] > I.e50[i]; const j = all1(); return { up, rsi: I.rsi[i], atr: I.atr[i], pdh: I.pdh[j], pdl: I.pdl[j], wk: wkend(Date.now()) }; };
  const all1 = () => (form ? bars.length : bars.length - 1); /* index of the newest bar in I */
  const drawNow = () => {
    const st = $('gt-status'), box = $('gt-now'); if (!st || !box) return;
    st.textContent = err || (!loaded ? 'กำลังโหลดกราฟ…' : `ราคาตอนนี้ $${px(live)} ต่อออนซ์${OFF() ? ` · ใน MT5 ≈ $${px(live + OFF())}` : ''} · อัปเดต ${hhmm(lastTick || Date.now())} น.`);
    drawOff();
    box.replaceChildren(); if (!loaded) return;
    drawDay(box);
    const s = lastSig(), tr = trendNow();
    const card = el('div', 'gt-sig' + (s ? ' ' + s.side : ''));
    if (s) {
      const hd = el('div', 'gt-sh'); hd.append(el('b', null, s.side === 'buy' ? 'สัญญาณซื้อ (Buy)' : 'สัญญาณขาย (Sell)'), el('span', 'gt-chip', 'ท่า: ' + STRATS[strat()].name)); if (s.grade) hd.append(el('span', 'gt-chip gt-g' + s.grade, 'เกรด ' + s.grade));
      card.append(hd, el('p', null, `แท่งปิด ${hm(s.t)}` + (COND[strat()] ? '' : ` · ${STRATS[strat()].why(s)}`)));
      if (COND[strat()] && s.i != null) { const ul = el('ul', 'gt-cond'); COND[strat()](s, I, s.i).forEach((t) => ul.append(typeof t === 'string' ? el('li', null, t) : el('li', t.k || null, t.t))); card.append(el('small', 'gt-ch', 'เข้าเงื่อนไขครบทุกข้อ:'), ul); }
      const g = el('div', 'gt-lv'); [['เข้า', s.entry], ['ตัดขาดทุน (SL)', s.sl], ['ทำกำไร (TP)', s.tp]].forEach(([k, p]) => { const d = el('div'); d.append(el('small', null, k + (OFF() ? ' MT5' : '')), el('span', null, px(p + OFF()))); g.append(d); });
      const lot = sizeLot(Math.abs(s.entry - s.sl)), rr = Math.abs(s.tp - s.entry) / Math.abs(s.entry - s.sl), risk = Math.abs(s.entry - s.sl) * (lot || 0) * D.set.cs;
      card.append(g, el('p', 'pf-hint', lot >= 0.01 ? `lot ที่เหมาะ ${lot} (ยอมเสียไม้ละ $${f2(rules().maxLoss)}): ถ้าโดน SL เสีย ${usd(-risk)} (${thb(-risk)}) ถ้าถึง TP ได้ ${usd(risk * rr)} · TP:SL = ${rr.toFixed(2)}` : `SL ไกลเกินไปสำหรับเงินที่ยอมเสียไม้ละ $${f2(rules().maxLoss)} แม้ 0.01 lot ก็เสียเกิน`));
      const bx = el('div', 'gt-act'); const b = el('button', 'btn-solid', 'เข้าไม้นี้ (จริง)'); b.type = 'button'; b.addEventListener('click', () => prefill(s));
      const b2 = el('button', 'btn-line', 'เทรดกระดาษไม้นี้'); b2.type = 'button';
      const warn = el('p', 'gt-block'); warn.hidden = true;
      b2.addEventListener('click', () => { if (live == null) return; const e = live + ((s.side === 'buy' ? 1 : -1) * SPD()) / 2, lt = P().autoLot !== false ? sizeLot(Math.abs(e - s.sl)) : P().lot;
        const c = check({ side: s.side, entry: e, sl: s.sl, tp: s.tp, lot: lt || 0 }, P().tx.filter((x) => x.src === 'man'));
        if (!(lt >= 0.01) || !c.ok) { warn.hidden = false; warn.textContent = 'ไม่ผ่านด่านตรวจ: ' + (lt >= 0.01 ? c.bl : ['SL ไกลเกินเงินที่ยอมเสีย']).join(' · '); return; }
        const x = paperOpen(s.side, { sl: s.sl, tp: s.tp, lot: lt }); if (x) { save(); drawAll(); if (window.VGNav) window.VGNav.go('scan', 'gtp'); } });
      const b3 = el('button', 'btn-line', 'ไทม์แมชชีน'); b3.type = 'button'; b3.addEventListener('click', () => tmFill(s, strat()));
      bx.append(b, b2, b3); card.append(bx, warn);
    } else {
      card.append(el('b', null, 'ยังไม่มีสัญญาณ รอก่อน'));
      if (tr && tr.wk) card.append(el('p', null, 'วันเสาร์-อาทิตย์ ตลาดทองจริงปิด ราคา PAXG ยังขยับได้ แต่ระบบไม่ให้สัญญาณ'));
      else if (tr) card.append(el('p', null, STRATS[strat()].wait(I, bars.length - 1)));
      const prev = S[S.length - 1]; if (prev) card.append(el('p', 'pf-hint', `สัญญาณล่าสุดของท่า${STRATS[strat()].name}: ${prev.side === 'buy' ? 'ซื้อ' : 'ขาย'} ${hm(prev.t)} ที่ ${px(prev.entry)} → ${prev.out === 'tp' ? 'ถึง TP' : prev.out === 'sl' ? 'โดน SL' : prev.out === 'time' ? 'ปิดเพราะครบ 48 ชม.' : 'ยังไม่จบ'}`));
      const b = el('button', 'btn-line', 'จดไม้เอง'); b.type = 'button'; b.addEventListener('click', () => prefill(null)); card.append(b);
    }
    box.append(card);
    if (strat() === 'smc') box.append(smcPanel());
    /* the other strategies: say which one has a signal so nothing is missed */
    const oth = el('div', 'gt-oth'); oth.append(el('small', 'gt-ch', 'ท่าอื่นตอนนี้'));
    Object.keys(STRATS).filter((k) => k !== strat()).forEach((k) => { const L = SS[k] || [], q = L[L.length - 1], on1 = q && bars.length - 1 - q.i <= 2 && !q.out;
      const r = el('div', 'gt-orow'); r.append(el('span', null, STRATS[k].name), el('span', on1 ? (q.side === 'buy' ? 'pos' : 'neg') : 'muted', on1 ? `มีสัญญาณ${q.side === 'buy' ? 'ซื้อ' : 'ขาย'} (แท่ง ${hm(q.t)})` : 'ไม่มีสัญญาณ'));
      if (on1) { const b = el('button', 'btn-line sm', 'ดูท่านี้'); b.type = 'button'; b.addEventListener('click', () => { D.set.strat = k; document.querySelectorAll('#gt-strat button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === k))); S = SS[k] || []; save(); drawChart(); drawNow(); }); r.append(b); }
      oth.append(r); });
    box.append(oth);
    /* back-test */
    const done = S.filter((x) => x.out), w = done.filter((x) => x.R > 0), gw = w.reduce((a, x) => a + x.R, 0), gl = -done.filter((x) => x.R <= 0).reduce((a, x) => a + x.R, 0);
    const days = bars.length ? Math.round((bars[bars.length - 1].t - bars[0].t) / 86400e3) : 0;
    $('gt-bt').textContent = STRATS[strat()].name + ': ' + (done.length ? `ย้อนหลัง ${days} วัน ระบบนี้ให้สัญญาณ ${done.length} ครั้ง ชนะ ${w.length} (${Math.round((w.length / done.length) * 100)}%) · กำไรรวม ${sgn(gw - gl)}${Math.abs(gw - gl).toFixed(1)} เท่าของความเสี่ยงต่อไม้ · Profit factor ${gl ? (gw / gl).toFixed(2) : '–'}` : `ย้อนหลัง ${days} วัน ยังไม่มีสัญญาณที่จบแล้ว`);
  };

  /* ---------- journal ---------- */
  const drawOff = () => { const m = $('gt-offmsg'); if (!m) return; const o = OFF(), at = D.set.offAt || 0, old = at && Date.now() - at > 12 * 3600e3;
    $('gt-mt5').placeholder = live != null ? 'เช่น ' + px(live + o) : '';
    m.textContent = o ? `ส่วนต่าง ${o > 0 ? '+' : '−'}$${f2(Math.abs(o))} ตั้งเมื่อ ${new Date(at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} น. · จุดเข้า SL TP ในการ์ดเป็นราคา MT5 แล้ว${old ? ' · ตั้งไว้นานแล้ว ควรพิมพ์ราคาใหม่' : ''}` : 'พิมพ์ราคา Bid ใน MT5 ตอนนี้ เว็บจะเลื่อนจุดเข้า SL TP ให้ตรงกับโบรกของคุณ';
    m.classList.toggle('neg', !!old); };
  const setOff = (v) => { if (v > 0 && live != null) { D.set.off = Math.round((v - live) * 100) / 100; D.set.offAt = Date.now(); } else { D.set.off = 0; D.set.offAt = 0; } save(); drawAll(); };
  const prefill = (s) => {
    $('gt-side').value = s ? s.side : 'buy'; $('gt-entry').value = s ? (s.entry + OFF()).toFixed(2) : live != null ? (live + OFF()).toFixed(2) : '';
    $('gt-sl').value = s ? (s.sl + OFF()).toFixed(2) : ''; $('gt-tp').value = s ? (s.tp + OFF()).toFixed(2) : ''; if (s) { const lt = sizeLot(Math.abs(s.entry - s.sl)); if (lt >= 0.01) $('gt-lot').value = lt; } sizeHint(); $('gt-at').value = ''; $('gt-note').value = s ? 'ตามสัญญาณระบบ' : '';
    $('gt-form').dataset.sig = s ? '1' : ''; $('gt-setup').value = s ? strat() : 'man'; $('gt-msg').textContent = 'แก้ราคาเข้าให้ตรงกับใน MT5 แล้วกดบันทึก';
    if (window.VGNav) window.VGNav.go('scan', 'gtj');
    setTimeout(() => { const f = $('gt-form'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('gt-entry').focus(); } }, 120);
  };
  const sizeHint = () => { const h = $('gt-size'); if (!h) return; const e = +$('gt-entry').value, sl = +$('gt-sl').value;
    h.textContent = e > 0 && sl > 0 && e !== sl ? (() => { const lt = sizeLot(Math.abs(e - sl)); return lt >= 0.01 ? `SL ห่าง $${f2(Math.abs(e - sl))} → lot ที่เหมาะ ${lt} (ยอมเสียไม้ละ $${f2(rules().maxLoss)})` : `SL ห่าง $${f2(Math.abs(e - sl))} ไกลเกิน แม้ 0.01 lot ก็เสียเกิน $${f2(rules().maxLoss)}`; })() : 'ใส่ราคาเข้าและ SL แล้วจะบอก lot ที่เหมาะ'; };
  const add = () => {
    const entry = +$('gt-entry').value, lot = +$('gt-lot').value, sl = +$('gt-sl').value || null, tp = +$('gt-tp').value || null, side = $('gt-side').value;
    if (!(entry > 0) || !(lot > 0)) { $('gt-msg').textContent = 'ใส่ราคาเข้าและขนาด lot ก่อน'; return; }
    if (sl && (side === 'buy' ? sl >= entry : sl <= entry)) { $('gt-msg').textContent = side === 'buy' ? 'ซื้อ: SL ต้องต่ำกว่าราคาเข้า' : 'ขาย: SL ต้องสูงกว่าราคาเข้า'; return; }
    const at = $('gt-at').value ? new Date($('gt-at').value).getTime() : Date.now();
    const c = check({ side, entry, sl, tp, lot }, D.tx), x = { id: uid(), side, at, entry, lot, sl, sl0: sl, tp, note: $('gt-note').value.trim(), sig: $('gt-form').dataset.sig === '1', setup: $('gt-setup').value || 'man' };
    if (!c.ok) x.rule = c.bl; D.tx.push(x);
    D.set.lot = lot; save(); $('gt-form').dataset.sig = ''; ['gt-entry', 'gt-sl', 'gt-tp', 'gt-at', 'gt-note'].forEach((k) => { $(k).value = ''; }); sizeHint();
    $('gt-msg').textContent = c.ok ? 'บันทึกแล้ว ผ่านกฎทุกข้อ' : 'บันทึกแล้ว แต่ไม้นี้ผิดกฎ: ' + c.bl.join(' · '); drawAll();
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
    if (x.rule && x.rule.length) left.append(el('small', 'gt-rule', 'ผิดกฎ: ' + x.rule.join(' · ')));
    const p = isOpen ? (paper ? qtyFloat(x) : plOf(x, live)) : plOf(x); const right = el('div', 'gt-pl ' + tone(p)); right.append(el('b', null, usd(p)), el('small', null, thb(p) + (isOpen ? ' ยังไม่ปิด' : '')));
    top.append(left, right); r.append(top);
    const act = el('div', 'gt-act');
    if (paper) { if (isOpen) { const c = el('button', 'btn-line', 'ปิดตอนนี้'); c.type = 'button';
        c.addEventListener('click', () => { if (live == null) return; x.exit = x.side === 'buy' ? live - SPD() / 2 : live + SPD() / 2; x.closedAt = Date.now(); x.out = 'man'; save(); drawAll(); }); act.append(c); } }
    else if (isOpen) { const h = hit(x); if (h) act.append(el('span', 'gt-flag ' + (h === 'tp' ? 'pos' : 'neg'), h === 'tp' ? 'ราคาถึง TP แล้ว' : 'ราคาถึง SL แล้ว'));
      const c = el('button', 'btn-line', 'ปิดไม้'); c.type = 'button'; c.addEventListener('click', () => closeRow(x, r)); act.append(c); }
    else { const u = el('button', 'btn-line', 'เปิดกลับ'); u.type = 'button'; u.addEventListener('click', () => { delete x.exit; delete x.closedAt; delete x.out; delete x.fee; save(); drawAll(); }); act.append(u); }
    const d = el('button', 'btn-line', 'ลบ'); d.type = 'button'; d.addEventListener('click', () => { if (!confirm('ลบไม้นี้?')) return; gone([x.id]); if (paper) P().tx = P().tx.filter((y) => y.id !== x.id); else D.tx = D.tx.filter((y) => y.id !== x.id); save(); drawAll(); }); act.append(d);
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
      tile('ราคาตอนนี้', live == null ? '–' : px(live), live == null ? '' : `ซื้อ ${px(live + SPD() / 2)} · ขาย ${px(live - SPD() / 2)}`));
    $('gp-buy').textContent = live == null ? 'Buy' : `Buy ${px(live + SPD() / 2)}`; $('gp-sell').textContent = live == null ? 'Sell' : `Sell ${px(live - SPD() / 2)}`;
    if (!box.contains(document.activeElement)) { box.replaceChildren(); if (!o.length) box.append(el('div', 'empty', 'ไม่มีไม้กระดาษที่เปิดอยู่')); o.forEach((x) => box.append(row(x, true, true))); }
    const cb = $('gp-closed'); cb.replaceChildren(); if (!c.length) cb.append(el('div', 'empty', 'ยังไม่มีไม้กระดาษที่ปิดแล้ว'));
    c.slice(0, 20).forEach((x) => cb.append(row(x, false, true))); if (c.length > 20) cb.append(el('p', 'pf-hint', `แสดง 20 ไม้ล่าสุดจาก ${c.length} ไม้ ดูรายวันได้ที่ปฏิทิน (เลือก "กระดาษ")`));
    /* leaderboard */
    const tb = el('table', 'tr-table'), hd = el('tr'); ['ใคร', 'ไม้', 'ชนะ', 'กำไร', 'ย้อนหลัง ~40 วัน'].forEach((x) => hd.append(el('th', null, x)));
    const th = el('thead'); th.append(hd); tb.append(th); const bd = el('tbody');
    ['man', ...Object.keys(STRATS)].forEach((k) => {
      const s2 = stats(c.filter((x) => x.src === k)), tr = el('tr'); const td = (v, cl) => tr.append(el('td', cl || null, v));
      td(srcName(k) + (k !== 'man' && !P().auto[k] ? (P().off && P().off[k] ? ' (ระบบปิดให้: 30 ไม้แล้วยังติดลบ)' : ' (ปิดอยู่)') : '')); td(String(s2.n)); td(s2.win == null ? '–' : Math.round(s2.win * 100) + '%'); td(usd(s2.net), tone(s2.net));
      if (k === 'man') td('–'); else { const d = (SS[k] || []).filter((x) => x.out), w = d.filter((x) => x.R > 0).length, r = d.reduce((a, x) => a + x.R, 0); td(d.length ? `ชนะ ${Math.round((w / d.length) * 100)}% · ${sgn(r)}${Math.abs(r).toFixed(1)}R` : '–', tone(r)); }
      bd.append(tr); });
    tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); $('gp-board').replaceChildren(w);
  };

  /* ---------- dashboard ---------- */
  let ym = bkDay(Date.now()).slice(0, 7), selDay = null, dsrc = 'real';
  const stats = (list) => { const p = list.map((x) => plOf(x)); const w = p.filter((v) => v > 0), l = p.filter((v) => v <= 0);
    const gw = w.reduce((a, v) => a + v, 0), gl = -l.reduce((a, v) => a + v, 0);
    return { n: p.length, net: gw - gl, win: p.length ? w.length / p.length : null, pf: gl ? gw / gl : null, aw: w.length ? gw / w.length : null, al: l.length ? -gl / l.length : null }; };
  const r0 = (x) => Math.abs(x.entry - (x.sl0 ?? x.sl ?? x.entry)) * x.lot * D.set.cs; /* money at risk when the trade was opened */
  const rOf = (x) => { const k = r0(x); return k > 0 ? plOf(x) / k : null; };
  const SESS = [['เอเชีย 07–14', 7, 14], ['ลอนดอน 14–19', 14, 19], ['นิวยอร์ก 19–24', 19, 24], ['กลางคืน 00–07', 0, 7]];
  const sessOf = (t) => { const h = bkHour(t); return (SESS.find(([, a, b]) => h >= a && h < b) || SESS[3])[0]; };
  const setupOf = (x, pp) => (pp ? srcName(x.src) : x.setup ? (STRATS[x.setup] ? STRATS[x.setup].name : OLD[x.setup] ? OLD[x.setup] : 'เข้าเอง') : x.sig ? 'ตามสัญญาณ' : 'เข้าเอง');
  const deep = (list) => { const rs = list.map(rOf).filter((v) => v != null); const exp = rs.length ? rs.reduce((a, v) => a + v, 0) / rs.length : null;
    let eq = 0, pk = 0, dd = 0; [...list].sort((a, b) => a.closedAt - b.closedAt).forEach((x) => { eq += plOf(x); pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); });
    return { exp, nR: rs.length, dd }; };
  const groupTable = (list, keyFn, title) => {
    const g = {}; list.forEach((x) => { const k = keyFn(x); (g[k] = g[k] || []).push(x); });
    const tb = el('table', 'tr-table'), hd = el('tr'); [title, 'ไม้', 'ชนะ', 'เฉลี่ย R', 'กำไร'].forEach((h) => hd.append(el('th', null, h)));
    const th = el('thead'); th.append(hd); tb.append(th); const bd = el('tbody');
    Object.entries(g).sort((a, b) => b[1].length - a[1].length).forEach(([k, xs]) => { const s2 = stats(xs), d2 = deep(xs), tr = el('tr'); const td = (v, c) => tr.append(el('td', c || null, v));
      td(k); td(String(s2.n)); td(Math.round(s2.win * 100) + '%'); td(d2.exp == null ? '–' : `${sgn(d2.exp)}${Math.abs(d2.exp).toFixed(2)}R`, tone(d2.exp)); td(usd(s2.net), tone(s2.net)); bd.append(tr); });
    tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); return w;
  };
  const drawStats = (c, pp) => {
    const box = $('gt-stats'); if (!box) return; box.replaceChildren();
    if (!c.length) { box.append(el('div', 'empty', 'ยังไม่มีไม้ที่ปิด สถิติจะขึ้นเมื่อมีไม้')); return; }
    const s = stats(c), d = deep(c);
    box.append(el('p', 'rk-l', `ทั้งหมด ${s.n} ไม้ · ค่าคาดหวัง ${d.exp == null ? '–' : `${sgn(d.exp)}${Math.abs(d.exp).toFixed(2)}R ต่อไม้`} · Profit factor ${s.pf == null ? '–' : s.pf.toFixed(2)} · ลดลงหนักสุดจากจุดสูง ${usd(d.dd)}`));
    if (s.n < 30) box.append(el('p', 'pf-hint', `ตัวอย่างยังน้อย (${s.n}/30 ไม้) ตัวเลขยังเชื่อไม่ได้มาก`));
    box.append(el('h4', null, 'แยกตามท่า'), groupTable(c, (x) => setupOf(x, pp), 'ท่า'), el('h4', null, 'แยกตามช่วงเวลาที่เข้า (เวลาไทย)'), groupTable(c, (x) => sessOf(x.at), 'ช่วง'));
    /* last 7 days review: process first */
    const wk = c.filter((x) => Date.now() - x.closedAt < 7 * 86400e3).sort((a, b) => a.at - b.at), all = [...c].sort((a, b) => a.closedAt - b.closedAt);
    const tags = []; let revenge = 0, creep = 0;
    wk.forEach((x) => { const prev = all.filter((y) => y.closedAt <= x.at).pop(); if (prev && plOf(prev) < 0) { if (x.at - prev.closedAt < rules().revenge * 60e3) revenge++; if (x.lot > prev.lot + 1e-9) creep++; } });
    const broke = wk.filter((x) => x.rule && x.rule.length).length;
    if (revenge) tags.push(`เข้าไม้ใหม่เร็วหลังแพ้ ${revenge} ครั้ง (เสี่ยงเทรดแก้แค้น)`); if (creep) tags.push(`เพิ่มขนาดไม้หลังแพ้ ${creep} ครั้ง`); if (broke) tags.push(`ไม้ผิดกฎ ${broke} ไม้`);
    const ws = stats(wk), wd = deep(wk), next = [];
    if (broke || revenge || creep) next.push('2 ไม้ถัดไปใช้ความเสี่ยงครึ่งเดียว (ตั้ง "ยอมเสียต่อไม้" ลดลงครึ่งหนึ่งชั่วคราว)');
    if (revenge) next.push(`หลังแพ้ รออย่างน้อย ${rules().revenge} นาทีก่อนเข้าไม้ใหม่`);
    if (wd.exp != null && wd.exp < 0 && ws.n >= 5) next.push('ค่าคาดหวังติดลบ: ย้อนดูท่าที่ขาดทุนในตารางด้านบน แล้วเทรดเฉพาะท่าที่เป็นบวกในโหมดกระดาษก่อน');
    if (!next.length) next.push('ทำตามแผนเดิม กระบวนการดีแล้ว ผลแพ้ชนะช่วงสั้นเป็นเรื่องปกติ');
    box.append(el('h4', null, 'ทบทวน 7 วันล่าสุด'), el('p', 'rk-l', wk.length ? `${ws.n} ไม้ · ${usd(ws.net)} · ชนะ ${Math.round(ws.win * 100)}% · ${wd.exp == null ? '' : `${sgn(wd.exp)}${Math.abs(wd.exp).toFixed(2)}R ต่อไม้`}` : 'ไม่มีไม้ที่ปิดใน 7 วัน'));
    box.append(el('p', null, tags.length ? 'สิ่งที่เจอ: ' + tags.join(' · ') : 'ไม่เจอพฤติกรรมเสี่ยงจากข้อมูลที่มี'));
    const ul = el('ul', 'gt-next'); next.forEach((t) => ul.append(el('li', null, t))); box.append(el('b', null, 'กฎชั่วคราวสำหรับรอบหน้า'), ul);
  };
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
    drawStats(c, pp);
  };
  const drawAll = () => { drawChart(); drawNow(); drawOpen(); drawClosed(); drawPaper(); drawDash(); drawRules(); };

  /* ---------- wiring ---------- */
  const SUBS = ['gtc', 'gttm', 'gtp', 'gtj', 'gtd', 'gtbt', 'gtr'];
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
    const mt = () => { const v = +$('gt-mt5').value; if (v > 0) { setOff(v); $('gt-mt5').value = ''; } };
    $('gt-mt5-set').addEventListener('click', mt); $('gt-mt5').addEventListener('keydown', (e) => { if (e.key === 'Enter') mt(); });
    $('gt-mt5-clr').addEventListener('click', () => { $('gt-mt5').value = ''; setOff(0); });
    $('gt-cs').addEventListener('change', () => { const v = +$('gt-cs').value; if (v > 0) { D.set.cs = v; save(); drawAll(); } else $('gt-cs').value = D.set.cs; });
    const syncLine = () => { const e = $('gt-sync'); if (!e) return; const Y = window.VGSync, on = Y && Y.on && Y.on();
      e.textContent = on ? `ซิงค์กับบัญชี ${Y.who()}${Y.id && Y.id() ? ` (รหัสบัญชี ${Y.id()})` : ''} · ไม้จริงในเครื่องนี้ ${D.tx.length} ไม้ · ${Y.state() || 'พร้อม'}` : 'ยังไม่ได้ล็อกอิน ไม้ที่จดอยู่ในเครื่องนี้เท่านั้น ล็อกอินบัญชีเดียวกันทั้งคอมและมือถือ (ปุ่มบนสุดของหน้าแรก)';
      e.classList.toggle('neg', !on); $('gt-pull').hidden = !on; };
    setInterval(() => { if (!document.hidden) syncLine(); }, 2000); syncLine(); /* was gated on the chart's live flag, so the journal tab kept showing 'not signed in' */
    $('gt-pull').addEventListener('click', async () => { const b = $('gt-pull'); b.disabled = true; try { await window.VGSync.pull('portfolios'); } catch (e) { /* status shows it */ } b.disabled = false; syncLine(); });
    $('gt-add').addEventListener('click', add); $('gt-csv').addEventListener('click', csv);
    document.querySelectorAll('#gt-span button').forEach((b) => b.addEventListener('click', () => { span = +b.dataset.n; document.querySelectorAll('#gt-span button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); if (LW) lwSpan(); else drawChart(); }));
    document.querySelectorAll('#gt-tf button').forEach((b) => b.addEventListener('click', () => { tf = b.dataset.tf; document.querySelectorAll('#gt-tf button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawChart(); }));
    document.querySelectorAll('#gt-mode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
    { const L0 = lay(); document.querySelectorAll('#gt-lay button').forEach((b) => { b.setAttribute('aria-pressed', String(!!L0[b.dataset.l]));
      b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); setLay(b.dataset.l, v); drawChart(); drawLeg(); }); }); drawLeg(); }
    const fs = (v) => { const w = $('gt-wrap'), on2 = w.classList.toggle('gt-full', v); $('gt-fs').textContent = on2 ? '✕ ปิดเต็มจอ' : '⛶ เต็มจอ'; document.body.classList.toggle('gt-noscroll', on2); if (!LW) drawChart(); };
    $('gt-fs').addEventListener('click', () => fs()); document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('gt-wrap').classList.contains('gt-full')) fs(false); });
    $('gt-prev').addEventListener('click', () => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; selDay = null; drawDash(); });
    $('gt-next').addEventListener('click', () => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m, 1); ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; selDay = null; drawDash(); });
    const segOn = (id, v) => document.querySelectorAll(`#${id} button`).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === v)));
    segOn('gt-strat', strat());
    document.querySelectorAll('#gt-strat button').forEach((b) => b.addEventListener('click', () => { D.set.strat = b.dataset.k; segOn('gt-strat', b.dataset.k); S = SS[strat()] || []; save(); drawChart(); drawNow(); }));
    document.querySelectorAll('#gt-src button').forEach((b) => b.addEventListener('click', () => { dsrc = b.dataset.k; segOn('gt-src', dsrc); selDay = null; drawDash(); }));
    const pset = () => { $('gp-lot').value = P().lot; $('gp-start').value = P().start; $('gp-be').checked = !!P().be; Object.keys(STRATS).forEach((k) => { $('gp-a-' + k).checked = !!P().auto[k]; }); };
    pset();
    const trade = (side) => {
      const sl0 = +$('gp-sl').value || null, tp0 = +$('gp-tp').value || null, m = $('gp-msg'), auto = $('gp-autolot').checked;
      if (live == null) { m.textContent = 'ยังโหลดราคาไม่เสร็จ'; return; }
      const e = live + (side === 'buy' ? SPD() / 2 : -SPD() / 2), dir = side === 'buy' ? 1 : -1, a = atrNow(), sl = sl0 ?? e - dir * SLK * a, tp = tp0 ?? e + dir * TPK * a;
      const lot = auto ? sizeLot(Math.abs(e - sl)) : +$('gp-lot').value;
      if (!(lot >= 0.01)) { m.textContent = auto ? `SL ห่าง $${f2(Math.abs(e - sl))} ไกลเกิน แม้ 0.01 lot ก็เสียเกินไม้ละ $${f2(rules().maxLoss)} ลองตั้ง SL ใกล้ขึ้น` : 'ใส่ขนาด lot ก่อน'; return; }
      if (sl && (side === 'buy' ? sl >= e : sl <= e)) { m.textContent = side === 'buy' ? 'Buy: SL ต้องต่ำกว่าราคาตอนนี้' : 'Sell: SL ต้องสูงกว่าราคาตอนนี้'; return; }
      if (tp && (side === 'buy' ? tp <= e : tp >= e)) { m.textContent = side === 'buy' ? 'Buy: TP ต้องสูงกว่าราคาตอนนี้' : 'Sell: TP ต้องต่ำกว่าราคาตอนนี้'; return; }
      const c = check({ side, entry: e, sl, tp, lot }, P().tx.filter((x) => x.src === 'man'));
      if (!c.ok) { m.textContent = 'ไม่ผ่านด่านตรวจ: ' + c.bl.join(' · '); m.className = 'pf-hint neg'; return; } m.className = 'pf-hint';
      if (!auto) P().lot = lot; const x = paperOpen(side, { sl, tp, lot }); $('gp-sl').value = ''; $('gp-tp').value = '';
      m.textContent = (c.wn.length ? c.wn.join(' · ') + ' · ' : '') + `เปิด ${side === 'buy' ? 'Buy' : 'Sell'} ${lot} lot ที่ ${px(x.entry)} · SL ${px(x.sl)} · TP ${px(x.tp)}`; save(); drawAll();
    };
    $('gp-autolot').checked = P().autoLot !== false; $('gp-lot').disabled = $('gp-autolot').checked;
    $('gp-autolot').addEventListener('change', (ev) => { P().autoLot = ev.target.checked; $('gp-lot').disabled = ev.target.checked; save(); });
    const rk = [['rk-loss', 'maxLoss'], ['rk-day', 'maxDay'], ['rk-n', 'maxTrades'], ['rk-rr', 'minRR'], ['rk-wk', 'wkLoss'], ['rk-mo', 'moLoss'], ['rk-st', 'streak'], ['rk-rv', 'revenge']];
    rk.forEach(([id, k]) => { $(id).value = rules()[k]; $(id).addEventListener('change', () => { const v = +$(id).value; if (v > 0) { D.set.rules = { ...(D.set.rules || {}), [k]: k === 'maxTrades' || k === 'streak' || k === 'revenge' ? Math.round(v) : v }; save(); drawAll(); } else $(id).value = rules()[k]; }); });
    ['gt-entry', 'gt-sl'].forEach((k) => $(k).addEventListener('input', sizeHint)); sizeHint();
    $('tm-run').addEventListener('click', () => { tmFrom = null; tmGo(); });
    $('lb-run').addEventListener('click', lbGo); $('cc-run').addEventListener('click', calcGo);
    [['cs-spread', 'spread'], ['cs-slip', 'slip'], ['cs-comm', 'comm']].forEach(([id, k]) => { $(id).value = D.set[k] ?? blank().set[k]; $(id).addEventListener('change', () => { const v = +$(id).value; if (v >= 0) { D.set[k] = v; save(); recalc(); drawAll(); drawLB(); } else $(id).value = D.set[k]; }); });
    [['f-htf', 'htf'], ['f-nfp', 'nfp']].forEach(([id, k]) => { $(id).checked = D.set[k] ?? blank().set[k]; $(id).addEventListener('change', () => { D.set[k] = $(id).checked; save(); if (bars.length) recalc(); drawAll(); if (LB && LB.res) lbGo(); }); });
    $('gp-buy').addEventListener('click', () => trade('buy')); $('gp-sell').addEventListener('click', () => trade('sell'));
    Object.keys(STRATS).forEach((k) => $('gp-a-' + k).addEventListener('change', (ev) => { P().auto[k] = ev.target.checked; if (ev.target.checked) P().since[k] = Date.now(); save(); drawPaper(); }));
    $('gp-be').addEventListener('change', (ev) => { P().be = ev.target.checked; save(); });
    $('gp-start').addEventListener('change', () => { const v = +$('gp-start').value; if (v > 0) { P().start = v; save(); drawPaper(); } else $('gp-start').value = P().start; });
    $('gp-reset').addEventListener('click', () => { if (!confirm('ลบไม้กระดาษทั้งหมดแล้วเริ่มใหม่?')) return; gone(P().tx.map((x) => x.id)); P().tx = []; Object.keys(P().auto).forEach((k) => { P().since[k] = Date.now(); }); save(); drawAll(); });
    let rw = null; window.addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(drawChart, 200); });
    setInterval(() => { const v = visible(); if (v && !on) start(); else if (!v && on) stop(); if (v) { poll(); if (loaded && !$('gt-chart').firstChild) drawChart(); const c = tfc[tf]; if (tf !== '1h' && c && c.b && Date.now() - c.at > 30e3) tfLoad(tf); } }, 2000);
    drawAll();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.VGGT = {
    get: () => D,
    _t: { ind, test, sigSmc },
    /* a copy arrived from the account: merge it with this device's copy; push back if this device had something the account lacked */
    sync: (c) => { const r = norm(c), m = norm(mergeDoc(r, D)), push = sig(m) !== sig(r); D = m; prime(); try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* ignore */ }
      if ($('gt-lot')) { $('gt-lot').value = D.set.lot; $('gt-cs').value = D.set.cs; $('gp-lot').value = P().lot; $('gp-start').value = P().start; } if (bars.length) recalc(); drawAll();
      if (push && window.VGSync) window.VGSync.push('portfolios'); },
    replace: (c) => { D = norm(c); prime(); save(false); if ($('gt-lot')) { $('gt-lot').value = D.set.lot; $('gt-cs').value = D.set.cs; $('gp-lot').value = P().lot; $('gp-start').value = P().start; } if (bars.length) recalc(); drawAll(); },
    merge: (c) => { const r = norm(c), m = mergeDoc(r, D); return { extra: Math.max(0, m.tx.length - r.tx.length) + Math.max(0, m.paper.tx.length - r.paper.tx.length), doc: m }; },
    _test: { btRun, sumR, lbAnalyze, nfpBlock, tmRun, check, sizeLot, ind, sigDip, sigBrk, sigSt, test, settle: () => settle(), D: () => D },
  };
})();
