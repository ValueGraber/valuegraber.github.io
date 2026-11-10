/* swing core: short-term signal engine (1-hour bars). Same rules as tools/swing.py — keep the two in step.
   bars: [{t, o, h, l, c, v}] oldest first, closed bars only. */
const SWC = (() => {
  const ema = (a, n) => { const k = 2 / (n + 1); const o = []; let e = null; a.forEach((x, i) => { e = i === 0 ? x : x * k + e * (1 - k); o.push(e); }); return o; };
  const rsi = (c, n = 14) => {
    const o = new Array(c.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up / n; l += dn / n; if (i === n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); continue; }
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return o;
  };
  const atr = (b, n = 14) => {
    const o = new Array(b.length).fill(null); let a = 0;
    for (let i = 1; i < b.length; i++) {
      const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
      if (i <= n) { a += tr / n; if (i === n) o[i] = a; } else { a = (a * (n - 1) + tr) / n; o[i] = a; }
    }
    return o;
  };
  const ind = (b) => {
    const c = b.map((x) => x.c);
    return { e20: ema(c, 20), e50: ema(c, 50), rsi: rsi(c), atr: atr(b) };
  };
  const clamp = (x, a, z) => Math.max(a, Math.min(z, x));

  /* does closed bar i give a buy setup? returns null or the plan */
  const setupAt = (b, I, i) => {
    if (i < 60) return null;
    const x = b[i], A = I.atr[i], r = I.rsi[i], e20 = I.e20[i], e50 = I.e50[i];
    if (!A || r == null) return null;
    const trend = e20 > e50 && x.c > e50 && e50 > I.e50[i - 5];
    if (!trend) return null;
    let vs = 0; for (let k = i - 20; k < i; k++) vs += b[k].v; const va = vs / 20; const vr = va > 0 ? x.v / va : 1;
    let hh = -Infinity; for (let k = i - 20; k < i; k++) hh = Math.max(hh, b[k].h);
    let lo = Infinity; for (let k = i - 4; k <= i; k++) lo = Math.min(lo, b[k].l);
    const touched = [i - 2, i - 1, i].some((k) => b[k].l <= I.e20[k] + 0.25 * I.atr[k]);
    let kind = null;
    if (x.c > hh && vr >= 1.5 && r < 78 && x.c - x.l >= 0.6 * (x.h - x.l)) kind = 'brk';
    else if (touched && x.c > e20 && x.c > x.o && x.c > b[i - 1].c && r >= 40 && r <= 65 && r > I.rsi[i - 1]) kind = 'pb';
    if (!kind) return null;
    const entry = x.c;
    const sl = Math.min(entry - 0.8 * A, Math.max(entry - 1.5 * A, lo - 0.1 * A));
    const R = entry - sl;
    const strength = clamp((e20 - e50) / A, 0, 3) / 3;
    const rsiFit = kind === 'pb' ? 1 - Math.min(Math.abs(r - 52) / 13, 1) : 1 - Math.min(Math.abs(r - 64) / 14, 1);
    const volFit = clamp((vr - 0.8) / 1.7, 0, 1);
    const roomTo = (entry - sl) / A;
    const score = Math.round(100 * (0.35 * strength + 0.25 * rsiFit + 0.25 * volFit + 0.15 * clamp(1.6 - roomTo / 1.5, 0, 1)) + (kind === 'pb' ? 5 : 0));
    return { kind, t: x.t, entry, sl, tp1: entry + 1.5 * R, tp2: entry + 3 * R, R, rsi: r, atr: A, vr, score: clamp(score, 0, 100) };
  };

  /* newest valid setup in the last 3 closed bars, judged against the live price */
  const scan = (b, live) => {
    if (!b || b.length < 70) return null;
    const I = ind(b); const n = b.length - 1; const px = live ?? b[n].c;
    for (let i = n; i >= n - 2; i--) {
      const s = setupAt(b, I, i); if (!s) continue;
      const age = n - i;
      let hit = false; for (let k = i + 1; k <= n; k++) if (b[k].l <= s.sl || b[k].h >= s.tp1) hit = true;
      if (hit || px <= s.sl || px >= s.tp1 || px > s.entry + 0.5 * s.R) return null;
      return { ...s, age, price: px, score: Math.max(0, s.score - age * 8 - Math.round(Math.max(0, px - s.entry) / s.R * 20)) };
    }
    return null;
  };

  /* follow a trade on later bars: half off at TP1 (stop to entry), rest at TP2; time stop after maxBars */
  const follow = (s, later, maxBars = 72) => {
    let half = false; let n = 0;
    for (const x of later) {
      n++;
      if (!half) {
        if (x.l <= s.sl) return { done: true, res: 'sl', r: -1, bars: n };
        if (x.h >= s.tp1) { half = true; if (x.h >= s.tp2) return { done: true, res: 'tp2', r: 2.25, bars: n }; continue; }
      } else {
        if (x.l <= s.entry) return { done: true, res: 'be', r: 0.75, bars: n };
        if (x.h >= s.tp2) return { done: true, res: 'tp2', r: 2.25, bars: n };
      }
      if (n >= maxBars) { const r = (x.c - s.entry) / s.R; return { done: true, res: 'time', r: half ? 0.75 + r / 2 : r, bars: n }; }
    }
    return { done: false, half, bars: n };
  };

  /* advice for a position I hold, from the live price and the last closed bar's EMA20 */
  const advise = (p, px, e20) => {
    if (px == null) return { k: 'wait', t: 'รอราคา' };
    if (!p.half && px <= p.sl) return { k: 'out', t: 'หลุดจุดตัดขาดทุน ขายทั้งหมดตอนนี้' };
    if (p.half && px <= p.entry) return { k: 'out', t: 'ราคากลับมาที่ทุน ขายส่วนที่เหลือ (ไม้นี้ยังกำไรจากครึ่งแรก)' };
    if (px >= p.tp2) return { k: 'win', t: 'ถึงเป้าสองแล้ว ขายส่วนที่เหลือ' };
    if (!p.half && px >= p.tp1) return { k: 'tp1', t: 'ถึงเป้าแรก ขายครึ่งหนึ่ง แล้วกด "ขายครึ่งแล้ว" เพื่อเลื่อนจุดตัดขาดทุนมาที่ทุน' };
    if (p.half && e20 != null && px < e20) return { k: 'out', t: 'ราคาหลุดเส้น EMA20 เทรนด์เริ่มอ่อน ขายส่วนที่เหลือได้' };
    const hrs = (Date.now() - p.at) / 3600e3;
    if (hrs > 72 && !p.half) return { k: 'slow', t: 'ถือมาเกิน 3 วันแล้วยังไม่ถึงเป้า พิจารณาออกแล้วหาไม้ใหม่' };
    return { k: 'hold', t: p.half ? 'ถือส่วนที่เหลือต่อ จุดตัดขาดทุนอยู่ที่ทุน' : 'ถือต่อ รอเป้าแรก ถ้าหลุดจุดตัดขาดทุนให้ขายทันที' };
  };

  return { ema, rsi, atr, ind, setupAt, scan, follow, advise };
})();
if (typeof module !== 'undefined') module.exports = SWC;
