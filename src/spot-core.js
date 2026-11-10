/* spot core: long-term entry timing for crypto majors and gold on daily bars (spot, no leverage).
   bars: [{t, o, h, l, c, v}] oldest first, closed bars only. opt.gold = true uses gold thresholds. */
const SPC = (() => {
  const sma = (a, n) => { const o = new Array(a.length).fill(null); let s = 0; a.forEach((x, i) => { s += x; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; }); return o; };
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
    const c = b.map((x) => x.c); const ath = []; let m = -Infinity; b.forEach((x) => { m = Math.max(m, x.h); ath.push(m); });
    return { s50: sma(c, 50), s200: sma(c, 200), e20: ema(c, 20), rsi: rsi(c), atr: atr(b), vol: sma(b.map((x) => x.v), 20), ath };
  };
  const clamp = (x, a, z) => Math.max(a, Math.min(z, x));
  const lowest = (b, a, z) => { let m = Infinity; for (let k = Math.max(0, a); k <= z; k++) m = Math.min(m, b[k].l); return m; };
  const highest = (b, a, z) => { let m = -Infinity; for (let k = Math.max(0, a); k <= z; k++) m = Math.max(m, b[k].h); return m; };

  /* what the market looks like at closed bar i (no setup needed) */
  const regime = (b, I, i, gold) => {
    const x = b[i], s50 = I.s50[i], s200 = I.s200[i], A = I.atr[i], r = I.rsi[i];
    if (s200 == null) return null;
    const dd = 1 - x.c / I.ath[i];
    const hot = r >= 72 || x.c - s50 > 3 * A || x.c > s200 * (gold ? 1.25 : 1.7);
    const trend = x.c > s200 && s50 > s200 ? 'bull' : x.c < s200 && s50 < s200 ? 'bear' : 'turn';
    return { trend, hot, dd, rsi: r, s50, s200, atr: A, zone: [Math.max(s200, s50 - A), s50 + 0.5 * A] };
  };

  /* buy setup at closed bar i, or null. kinds: pb = pullback in an uptrend, rc = back above the 200-day, dv = deep discount and steadying */
  const setupAt = (b, I, i, gold) => {
    if (i < 210) return null;
    const g = regime(b, I, i, gold); if (!g || g.hot) return null;
    const x = b[i], A = g.atr; const maxStop = gold ? 0.12 : 0.25;
    let kind = null;
    if (g.trend === 'bull' && lowest(b, i - 4, i) <= g.s50 + 0.5 * A && x.c >= g.s50 - 1.5 * A && g.rsi <= 55 && x.c > x.o && x.c > b[i - 1].h) kind = 'pb';
    else if (x.c > g.s200 && x.c > g.s50 && I.s200[i] >= I.s200[i - 10] * 0.995 && [...Array(10).keys()].some((k) => b[i - 1 - k].c < I.s200[i - 1 - k])) kind = 'rc';
    else if (x.c < g.s200 && g.dd >= (gold ? 0.15 : 0.55) && x.c > I.e20[i] && g.rsi >= 40 && g.rsi <= 60) kind = 'dv';
    if (!kind) return null;
    const base = kind === 'dv' ? lowest(b, i - 60, i) : kind === 'rc' ? Math.min(lowest(b, i - 20, i), g.s200) : lowest(b, i - 20, i);
    const entry = x.c;
    const sl = Math.min(entry - A, Math.max(base - 1.0 * A, entry * (1 - maxStop)));
    const R = entry - sl;
    const vr = I.vol[i] ? x.v / I.vol[i] : 1;
    const score = (kind === 'pb' ? 60 : kind === 'rc' ? 55 : 42) + 15 * clamp((g.s50 / g.s200 - 1) / 0.2, 0, 1) * (kind === 'dv' ? 0 : 1)
      + 15 * (1 - clamp(Math.abs(g.rsi - 47) / 20, 0, 1)) + 10 * clamp((vr - 0.8) / 1.2, 0, 1) - 10 * clamp((R / entry) / maxStop - 0.5, 0, 1);
    return { kind, t: x.t, i, entry, sl, tp1: entry + 1.5 * R, tp2: entry + 3 * R, R, rsi: g.rsi, vr, dd: g.dd, score: Math.round(clamp(score, 0, 100)) };
  };

  /* thirds: 1/3 at TP1 (+1.5R) then stop to entry, 1/3 at TP2 (+3R), last third rides until a close below the 50-day. */
  const followIdx = (b, I, s, maxBars = 365) => {
    let stage = 0, r = 0, n = 0;
    for (let k = s.i + 1; k < b.length; k++) {
      const x = b[k]; n++;
      if (stage === 0) {
        if (x.l <= s.sl) return { done: true, res: 'sl', r: -1, bars: n, k };
        if (x.h >= s.tp1) { r += 0.5; stage = 1; if (x.h >= s.tp2) { r += 1; stage = 2; } continue; }
      }
      if (stage === 1) {
        if (x.l <= s.entry) return { done: true, res: 'be', r, bars: n, k };
        if (x.h >= s.tp2) { r += 1; stage = 2; continue; }
      }
      if (stage === 2) {
        if (x.l <= s.entry) return { done: true, res: 'tp2', r, bars: n, k };
        if (I.s50[k] != null && x.c < I.s50[k]) return { done: true, res: 'trail', r: r + (x.c - s.entry) / s.R / 3, bars: n, k };
      }
      if (n >= maxBars) return { done: true, res: 'time', r: r + (x.c - s.entry) / s.R * (stage === 0 ? 1 : stage === 1 ? 2 / 3 : 1 / 3), bars: n, k };
    }
    return { done: false, stage, r, bars: n };
  };

  /* newest valid setup in the last 5 closed bars, judged against the live price */
  const scan = (b, live, gold) => {
    if (!b || b.length < 220) return null;
    const I = ind(b); const n = b.length - 1; const px = live ?? b[n].c;
    for (let i = n; i >= n - 4; i--) {
      const s = setupAt(b, I, i, gold); if (!s) continue;
      let hit = false; for (let k = i + 1; k <= n; k++) if (b[k].l <= s.sl || b[k].h >= s.tp1) hit = true;
      if (hit || px <= s.sl || px >= s.tp1 || px > s.entry + 0.5 * s.R) return null;
      const age = n - i;
      return { ...s, age, price: px, score: Math.max(0, s.score - age * 3 - Math.round(Math.max(0, px - s.entry) / s.R * 20)) };
    }
    return null;
  };

  /* the rule replayed over all history: one trade at a time */
  const backtest = (b, gold) => {
    if (!b || b.length < 260) return null;
    const I = ind(b); const out = []; let i = 210;
    while (i < b.length - 1) {
      const s = setupAt(b, I, i, gold);
      if (!s) { i++; continue; }
      const f = followIdx(b, I, s);
      out.push({ t: s.t, kind: s.kind, entry: s.entry, ...f });
      if (!f.done) break; i = f.k + 1;
    }
    const d = out.filter((x) => x.done);
    const hold = b[b.length - 1].c / b[210].c - 1;
    return { trades: out, n: d.length, open: out.length - d.length, win: d.length ? d.filter((x) => x.r > 0).length / d.length : null,
      avg: d.length ? d.reduce((a, x) => a + x.r, 0) / d.length : null, sum: d.reduce((a, x) => a + x.r, 0), from: b[210].t, hold };
  };

  /* a plain label for any asset right now */
  const status = (b, live, gold) => {
    if (!b || b.length < 220) return null;
    const I = ind(b); const n = b.length - 1; const g = regime(b, I, n, gold); const px = live ?? b[n].c;
    let k = 'wait', t;
    if (g.hot) { k = 'hot'; t = 'ร้อนแรง ราคาวิ่งเร็วเกินไป อย่าไล่ซื้อ รอย่อ'; }
    else if (g.trend === 'bull') { k = px > g.zone[1] ? 'up' : px >= g.zone[0] ? 'zone' : 'deep'; t = k === 'up' ? 'ขาขึ้น รอราคาย่อลงมาในโซนซื้อ' : k === 'zone' ? 'ขาขึ้น ราคาอยู่ในโซนซื้อ รอแท่งวันปิดเด้งยืนยัน' : 'ขาขึ้นแต่ย่อลึกใกล้เส้น 200 วัน ถ้าหลุดเส้นนี้จะเสียทรง รอดูก่อน'; }
    else if (g.trend === 'bear') { k = 'down'; t = g.dd >= (gold ? 0.15 : 0.55) ? 'ขาลง แต่ลงมาลึกแล้ว รอให้ราคาหยุดลงก่อน' : 'ขาลง ยังไม่ควรรับ'; }
    else { k = 'turn'; t = 'ไซด์เวย์ กำลังเปลี่ยนทิศ รอให้ชัดก่อน'; }
    return { k, t, ...g, px, s50: I.s50[n] };
  };

  /* advice for a holding with a plan {entry, sl, tp1, tp2, stage} */
  const advise = (p, px, s50) => {
    if (px == null) return { k: 'wait', t: 'รอราคา' };
    const stage = p.stage || 0;
    if (stage === 0 && px <= p.sl) return { k: 'out', t: 'หลุดจุดยอมรับว่าผิด ขายตัดขาดทุนทั้งหมด' };
    if (stage >= 1 && px <= p.entry) return { k: 'out', t: 'ราคากลับมาที่ทุน ขายส่วนที่เหลือ ไม้นี้ยังมีกำไรจากที่ขายไปก่อน' };
    if (stage < 2 && px >= p.tp2) return { k: 'tp', t: 'ถึงเป้าสองแล้ว ขายอีก 1/3 ที่เหลือถือจนราคาปิดหลุดเส้น 50 วัน' };
    if (stage < 1 && px >= p.tp1) return { k: 'tp', t: 'ถึงเป้าแรก ขาย 1/3 แล้วจุดตัดขาดทุนจะเลื่อนมาที่ทุน' };
    if (stage >= 2 && s50 != null && px < s50) return { k: 'out', t: 'ราคาหลุดเส้น 50 วัน ขายส่วนสุดท้าย' };
    return { k: 'hold', t: stage === 0 ? 'ถือต่อ รอเป้าแรก ถ้าราคาปิดต่ำกว่าจุดตัดขาดทุนให้ขาย' : stage === 1 ? 'ถือต่อ จุดตัดขาดทุนอยู่ที่ทุนแล้ว รอเป้าสอง' : 'ถือส่วนสุดท้ายตามเทรนด์ ขายเมื่อปิดหลุดเส้น 50 วัน' };
  };

  return { sma, ema, rsi, atr, ind, regime, setupAt, followIdx, scan, backtest, status, advise };
})();
if (typeof module !== 'undefined') module.exports = SPC;
