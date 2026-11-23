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
      paper: (() => { const q = { ...pblank(), ...pp, auto: { ...(pp.auto || pblank().auto) }, since: { ...(pp.since || pblank().since) }, tx: Array.isArray(pp.tx) ? pp.tx : [] };
        if (q.auto.asia === undefined) { q.auto.asia = true; q.since.asia = Date.now(); } return q; })() }; };
  const P = () => D.paper;
  const SPREAD = 0.3; /* simulated broker spread, USD per ounce */
  let D = norm(null); try { D = norm(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { /* defaults */ }
  try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!raw || !raw.paper || !raw.paper.auto || raw.paper.auto.asia === undefined) localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* ignore */ } /* pin the bot start time */
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
  const ind = (b) => { const c = b.map((x) => x.c); const o = { e20: ema(c, 20), e50: ema(c, 50), rsi: rsi(c), atr: atr(b), pdh: [], pdl: [], hiB: [], loB: [], ah: [], al: [], ab: [] };
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
  /* Asian range breakout: the first 1h close outside today's 07:00–14:00 range, from 14:00 to 22:00 Thai (London + early New York);
     stop at the middle of the range (at least 0.5 ATR), target 2× the risk; skip ranges wider than 4 ATR */
  const sigAsia = (b, I, i) => {
    const x = b[i], H = I.ah[i], L = I.al[i], a = I.atr[i]; if (H == null || !a || I.ab[i] || wkend(x.t)) return null;
    if (new Date(x.t + 7 * 3600e3).getUTCHours() > 21) return null; const w = H - L; if (w <= 0 || w > 4 * a) return null; const mid = (H + L) / 2;
    if (x.c > H) { const risk = Math.max(x.c - mid, 0.5 * a); return { side: 'buy', entry: x.c, sl: x.c - risk, tp: x.c + 2 * risk, lvl: H, w }; }
    if (x.c < L) { const risk = Math.max(mid - x.c, 0.5 * a); return { side: 'sell', entry: x.c, sl: x.c + risk, tp: x.c - 2 * risk, lvl: L, w }; }
    return null;
  };
  const STRATS = {
    asia: { name: 'เบรกกรอบเอเชีย', fn: sigAsia, lines: (I) => [I.ah, I.al], why: (s) => `กรอบเอเชียวันนี้กว้าง $${px(s.w)} ราคาปิด${s.side === 'buy' ? 'เหนือขอบบน' : 'ใต้ขอบล่าง'} (${px(s.lvl)}) หลังตลาดลอนดอนเปิด ${s.side === 'buy' ? 'แรงซื้อพาเบรกขึ้น' : 'แรงขายพาเบรกลง'}` },
    sweep: { name: 'กวาดสต็อป', fn: sigSweep, lines: (I) => [I.pdh, I.pdl], why: (s) => (s.side === 'buy' ? `ราคาทะลุจุดต่ำของเมื่อวาน (${px(s.lvl)}) ลงไปกวาดสต็อป แล้วดีดกลับขึ้นมาปิดเหนือเส้นในแท่งเดียว` : `ราคาทะลุจุดสูงของเมื่อวาน (${px(s.lvl)}) ขึ้นไปกวาดสต็อป แล้วโดนตบกลับลงมาปิดใต้เส้นในแท่งเดียว`) },
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
  /* ---------- risk rules, position size and the time machine
     (ideas from github.com/Jakeschincariol/day-trader-skill, MIT: trader-budget, trader-risk, trader-timemachine) ---------- */
  const RULES = { maxLoss: 20, maxDay: 50, maxTrades: 3, minRR: 1.3 }; /* 0.01 lot of gold moves $1 per $1, and a normal 1h stop is $10–20 */
  const rules = () => ({ ...RULES, ...(D.set.rules || {}) });
  /* the stop decides the size: lot = money you accept to lose ÷ (stop distance × ounces per lot), rounded down to 0.01 */
  const sizeLot = (risk) => (risk > 0 ? Math.floor((rules().maxLoss / (risk * D.set.cs)) * 100 + 1e-9) / 100 : null);
  const riskOf = (x) => (x.sl ? Math.max(0, (x.entry - x.sl) * (x.side === 'buy' ? 1 : -1)) * x.lot * D.set.cs : 0);
  const dayState = (list) => { const t = bkDay(Date.now());
    return { n: list.filter((x) => bkDay(x.at) === t).length, pl: list.filter((x) => x.exit != null && bkDay(x.closedAt) === t).reduce((a, x) => a + plOf(x), 0),
      open: list.filter((x) => x.exit == null).reduce((a, x) => a + riskOf(x), 0) }; };
  /* every rule that fails is listed; paper entries are blocked, real ones are saved with a warning */
  const check = (o, list) => {
    const r = rules(), bl = [], wn = [], dir = o.side === 'buy' ? 1 : -1, risk = o.sl ? Math.abs(o.entry - o.sl) : 0, loss = risk * o.lot * D.set.cs;
    if (!o.sl) bl.push('ไม่มี SL'); else if ((o.entry - o.sl) * dir <= 0) bl.push(o.side === 'buy' ? 'SL ต้องต่ำกว่าราคาเข้า' : 'SL ต้องสูงกว่าราคาเข้า');
    else if (loss > r.maxLoss * 1.05 + 0.01) bl.push(`ถ้าโดน SL จะเสีย $${f2(loss)} เกินที่ตั้งไว้ไม้ละ $${f2(r.maxLoss)}`);
    if (!o.tp) wn.push('ไม่มี TP'); else if ((o.tp - o.entry) * dir <= 0) bl.push('TP อยู่ผิดฝั่ง');
    else if (risk && Math.abs(o.tp - o.entry) / risk < r.minRR - 1e-9) bl.push(`TP:SL = ${(Math.abs(o.tp - o.entry) / risk).toFixed(2)} ต่ำกว่าขั้นต่ำ ${r.minRR}`);
    const d = dayState(list); if (d.n >= r.maxTrades) bl.push(`วันนี้เข้าไปแล้ว ${d.n} ไม้ ครบโควตา ${r.maxTrades} ไม้ต่อวัน`);
    const worst = Math.max(0, -d.pl) + d.open + loss; if (worst > r.maxDay + 0.01) bl.push(`ถ้าไม้นี้โดน SL วันนี้อาจเสียรวม $${f2(worst)} เกินเพดาน $${f2(r.maxDay)} ต่อวัน`);
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
    const side = $('tm-side').value, dir = side === 'buy' ? 1 : -1, a = atrNow(), entry = +$('tm-entry').value || live + (dir * SPREAD) / 2;
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
    box.replaceChildren(line('ไม้จริงวันนี้:', D.tx), line('ไม้กระดาษของคุณวันนี้:', P().tx.filter((x) => x.src === 'man')));
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
  const readOut = (b, J, k) => { const x = b[k]; if (!x) return; const r = J.rsi[k];
    $('gt-read').textContent = `${hm(x.t)} · เปิด ${px(x.o)} สูง ${px(x.h)} ต่ำ ${px(x.l)} ปิด ${px(x.c)} · EMA20 ${px(J.e20[k])} EMA50 ${px(J.e50[k])} · RSI ${r != null ? r.toFixed(0) : '–'}`; };
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
    const e20 = ch.addLineSeries({ color: cssv('--ochre'), lineWidth: 2, ...quiet }), e50 = ch.addLineSeries({ color: cssv('--cover'), lineWidth: 2, ...quiet });
    const lvO = { color: cssv('--foil'), lineWidth: 2, lineStyle: L.LineStyle.Dashed, lineType: L.LineType.WithSteps, ...quiet }; const lh = ch.addLineSeries(lvO), ll = ch.addLineSeries(lvO);
    const rs = rc.addLineSeries({ color: cssv('--cover'), lineWidth: 2, priceLineVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    rc.priceScale('right').applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } });
    [30, 70].forEach((v) => rs.createPriceLine({ price: v, color: cssv('--ink-3'), lineWidth: 1, lineStyle: L.LineStyle.Dashed, axisLabelVisible: true }));
    let sync = false; const link = (a, b2) => a.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (sync || !r) return; sync = true; b2.timeScale().setVisibleLogicalRange(r); sync = false; });
    link(ch, rc); link(rc, ch);
    const cross = (prm) => { if (!LW || !LW.d) return; const k = prm && prm.time != null ? LW.idx.get(prm.time) : undefined; readOut(LW.d.b, LW.d.I, k ?? LW.d.b.length - 1); };
    ch.subscribeCrosshairMove(cross); rc.subscribeCrosshairMove(cross);
    LW = { L, ch, rc, cs, e20, e50, lh, ll, rs, pls: [], key: '', idx: new Map(), d: null, up, dn };
  };
  const lwDraw = () => {
    const d = tfData(); if (!d || !d.b.length || !d.I) return; if (!LW) lwBuild();
    const { b, I: J } = d, key = tf + ':' + strat(); LW.d = d; LW.idx = new Map(b.map((x, i) => [ts(x.t), i]));
    const toL = (arr) => b.map((x, i) => (arr[i] == null ? { time: ts(x.t) } : { time: ts(x.t), value: arr[i] }));
    LW.cs.setData(b.map((x) => ({ time: ts(x.t), open: x.o, high: x.h, low: x.l, close: x.c })));
    LW.e20.setData(toL(J.e20)); LW.e50.setData(toL(J.e50)); LW.rs.setData(toL(J.rsi));
    const LV = TFH[tf] <= 1 && STRATS[strat()].lines ? STRATS[strat()].lines(J) : null; LW.lh.setData(LV ? toL(LV[0]) : []); LW.ll.setData(LV ? toL(LV[1]) : []);
    const dur = TFH[tf] * 3600e3, mk = [], seen = new Set();
    if (tf !== '1d') S.forEach((sg) => { const t = sg.t - 1; let lo = 0, hi = b.length - 1, j = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m].t <= t) { j = m; lo = m + 1; } else hi = m - 1; }
      if (j < 0 || t >= b[j].t + dur || seen.has(j)) return; seen.add(j);
      mk.push({ time: ts(b[j].t), position: sg.side === 'buy' ? 'belowBar' : 'aboveBar', color: sg.side === 'buy' ? LW.up : LW.dn, shape: sg.side === 'buy' ? 'arrowUp' : 'arrowDown', text: sg.side === 'buy' ? 'Buy' : 'Sell' }); });
    LW.cs.setMarkers(mk);
    LW.pls.forEach((p) => LW.cs.removePriceLine(p)); LW.pls = [];
    [...openTx(), ...pOpen()].forEach((x) => [['entry', cssv('--ink'), x.src ? 'กระดาษ' : 'เข้า'], ['sl', LW.dn, 'SL'], ['tp', LW.up, 'TP']].forEach(([k, c, tl]) => { if (x[k]) LW.pls.push(LW.cs.createPriceLine({ price: x[k], color: c, lineWidth: 1, lineStyle: LW.L.LineStyle.Dashed, axisLabelVisible: true, title: tl })); }));
    if (LW.key !== key) { LW.key = key; lwSpan(); }
    readOut(b, J, b.length - 1);
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

  /* ---------- signal card ---------- */
  const lastSig = () => { const s = S[S.length - 1]; if (!s) return null; const age = bars.length - 1 - s.i; return age <= 2 && !s.out ? s : null; };
  const trendNow = () => { const i = bars.length - 1; if (!I || i < 60) return null; const up = I.e20[i] > I.e50[i]; const j = all1(); return { up, rsi: I.rsi[i], atr: I.atr[i], pdh: I.pdh[j], pdl: I.pdl[j], wk: wkend(Date.now()) }; };
  const asiaNow = () => {
    const all = form ? [...bars, form] : bars, now = Date.now() + 7 * 3600e3, k = Math.floor(now / 86400e3), h = new Date(now).getUTCHours();
    const td = all.filter((x) => Math.floor((x.t + 7 * 3600e3) / 86400e3) === k && (() => { const q = new Date(x.t + 7 * 3600e3).getUTCHours(); return q >= 7 && q < 14; })());
    const hi = td.length ? Math.max(...td.map((x) => x.h)) : null, lo = td.length ? Math.min(...td.map((x) => x.l)) : null;
    if (h < 7) return 'รอเก็บกรอบเอเชียของวันนี้ ช่วง 07:00–14:00 น. แล้วค่อยดูว่าราคาจะเบรกออกทางไหน';
    if (h < 14) return `กำลังเก็บกรอบเอเชีย ตอนนี้สูงสุด ${px(hi)} ต่ำสุด ${px(lo)} เบรกนับได้หลัง 14:00 น.`;
    const j = bars.length - 1; if (I.ah[j] != null && (I.ab[j] || bars[j].c > I.ah[j] || bars[j].c < I.al[j])) return `วันนี้ราคาเบรกกรอบ ${px(hi)}–${px(lo)} ไปแล้ว หรือเลยเวลา รอกรอบใหม่พรุ่งนี้ 07:00 น.`;
    if (h >= 22) return 'เลย 22:00 น. แล้ว วันนี้ไม่มีการเบรก รอกรอบใหม่พรุ่งนี้';
    return `กรอบเอเชียวันนี้ ${px(lo)}–${px(hi)} (เส้นประสีทอง) รอแท่ง 1 ชม. ปิดเหนือ ${px(hi)} = ซื้อ หรือปิดใต้ ${px(lo)} = ขาย ถึง 22:00 น.`;
  };
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
      const lot = sizeLot(Math.abs(s.entry - s.sl)), rr = Math.abs(s.tp - s.entry) / Math.abs(s.entry - s.sl), risk = Math.abs(s.entry - s.sl) * (lot || 0) * D.set.cs;
      card.append(g, el('p', 'pf-hint', lot >= 0.01 ? `lot ที่เหมาะ ${lot} (ยอมเสียไม้ละ $${f2(rules().maxLoss)}): ถ้าโดน SL เสีย ${usd(-risk)} (${thb(-risk)}) ถ้าถึง TP ได้ ${usd(risk * rr)} · TP:SL = ${rr.toFixed(2)}` : `SL ไกลเกินไปสำหรับเงินที่ยอมเสียไม้ละ $${f2(rules().maxLoss)} แม้ 0.01 lot ก็เสียเกิน`));
      const bx = el('div', 'gt-act'); const b = el('button', 'btn-solid', 'เข้าไม้นี้ (จริง)'); b.type = 'button'; b.addEventListener('click', () => prefill(s));
      const b2 = el('button', 'btn-line', 'เทรดกระดาษไม้นี้'); b2.type = 'button';
      const warn = el('p', 'gt-block'); warn.hidden = true;
      b2.addEventListener('click', () => { if (live == null) return; const e = live + ((s.side === 'buy' ? 1 : -1) * SPREAD) / 2, lt = P().autoLot !== false ? sizeLot(Math.abs(e - s.sl)) : P().lot;
        const c = check({ side: s.side, entry: e, sl: s.sl, tp: s.tp, lot: lt || 0 }, P().tx.filter((x) => x.src === 'man'));
        if (!(lt >= 0.01) || !c.ok) { warn.hidden = false; warn.textContent = 'ไม่ผ่านด่านตรวจ: ' + (lt >= 0.01 ? c.bl : ['SL ไกลเกินเงินที่ยอมเสีย']).join(' · '); return; }
        const x = paperOpen(s.side, { sl: s.sl, tp: s.tp, lot: lt }); if (x) { save(); drawAll(); if (window.VGNav) window.VGNav.go('scan', 'gtp'); } });
      const b3 = el('button', 'btn-line', 'ไทม์แมชชีน'); b3.type = 'button'; b3.addEventListener('click', () => tmFill(s, strat()));
      bx.append(b, b2, b3); card.append(bx, warn);
    } else {
      card.append(el('b', null, 'ยังไม่มีสัญญาณ รอก่อน'));
      if (tr && tr.wk) card.append(el('p', null, 'วันเสาร์-อาทิตย์ ตลาดทองจริงปิด ราคา PAXG ยังขยับได้ แต่ระบบไม่ให้สัญญาณ'));
      else if (tr && strat() === 'asia') card.append(el('p', null, asiaNow()));
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
    $('gt-sl').value = s ? s.sl.toFixed(2) : ''; $('gt-tp').value = s ? s.tp.toFixed(2) : ''; if (s) { const lt = sizeLot(Math.abs(s.entry - s.sl)); if (lt >= 0.01) $('gt-lot').value = lt; } sizeHint(); $('gt-at').value = ''; $('gt-note').value = s ? 'ตามสัญญาณระบบ' : '';
    $('gt-form').dataset.sig = s ? '1' : ''; $('gt-msg').textContent = 'แก้ราคาเข้าให้ตรงกับใน MT5 แล้วกดบันทึก';
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
    const c = check({ side, entry, sl, tp, lot }, D.tx), x = { id: uid(), side, at, entry, lot, sl, tp, note: $('gt-note').value.trim(), sig: $('gt-form').dataset.sig === '1' };
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
  const drawAll = () => { drawChart(); drawNow(); drawOpen(); drawClosed(); drawPaper(); drawDash(); drawRules(); };

  /* ---------- wiring ---------- */
  const SUBS = ['gtc', 'gttm', 'gtp', 'gtj', 'gtd', 'gtr'];
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
    document.querySelectorAll('#gt-span button').forEach((b) => b.addEventListener('click', () => { span = +b.dataset.n; document.querySelectorAll('#gt-span button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); if (LW) lwSpan(); else drawChart(); }));
    document.querySelectorAll('#gt-tf button').forEach((b) => b.addEventListener('click', () => { tf = b.dataset.tf; document.querySelectorAll('#gt-tf button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawChart(); }));
    document.querySelectorAll('#gt-mode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
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
      const e = live + (side === 'buy' ? SPREAD / 2 : -SPREAD / 2), dir = side === 'buy' ? 1 : -1, a = atrNow(), sl = sl0 ?? e - dir * SLK * a, tp = tp0 ?? e + dir * TPK * a;
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
    const rk = [['rk-loss', 'maxLoss'], ['rk-day', 'maxDay'], ['rk-n', 'maxTrades'], ['rk-rr', 'minRR']];
    rk.forEach(([id, k]) => { $(id).value = rules()[k]; $(id).addEventListener('change', () => { const v = +$(id).value; if (v > 0) { D.set.rules = { ...(D.set.rules || {}), [k]: k === 'maxTrades' ? Math.round(v) : v }; save(); drawAll(); } else $(id).value = rules()[k]; }); });
    ['gt-entry', 'gt-sl'].forEach((k) => $(k).addEventListener('input', sizeHint)); sizeHint();
    $('tm-run').addEventListener('click', () => { tmFrom = null; tmGo(); });
    $('gp-buy').addEventListener('click', () => trade('buy')); $('gp-sell').addEventListener('click', () => trade('sell'));
    Object.keys(STRATS).forEach((k) => $('gp-a-' + k).addEventListener('change', (ev) => { P().auto[k] = ev.target.checked; if (ev.target.checked) P().since[k] = Date.now(); save(); drawPaper(); }));
    $('gp-be').addEventListener('change', (ev) => { P().be = ev.target.checked; save(); });
    $('gp-start').addEventListener('change', () => { const v = +$('gp-start').value; if (v > 0) { P().start = v; save(); drawPaper(); } else $('gp-start').value = P().start; });
    $('gp-reset').addEventListener('click', () => { if (!confirm('ลบไม้กระดาษทั้งหมดแล้วเริ่มใหม่?')) return; P().tx = []; Object.keys(P().auto).forEach((k) => { P().since[k] = Date.now(); }); save(); drawAll(); });
    let rw = null; window.addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(drawChart, 200); });
    setInterval(() => { const v = visible(); if (v && !on) start(); else if (!v && on) stop(); if (v) { poll(); if (loaded && !$('gt-chart').firstChild) drawChart(); const c = tfc[tf]; if (tf !== '1h' && c && c.b && Date.now() - c.at > 30e3) tfLoad(tf); } }, 2000);
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
    _test: { tmRun, check, sizeLot, ind, sigEma, sigSweep, test, settle: () => settle(), D: () => D },
  };
})();
