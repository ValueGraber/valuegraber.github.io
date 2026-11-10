/* spot core: buy-and-hold timing for crypto majors and gold on daily bars (no stop-loss / take-profit trading).
   Two questions per asset: is it worth holding (long trend), and is now a good price to add (timing).
   bars: [{t, o, h, l, c, v}] oldest first, closed bars only. gold = true uses gold thresholds. */
const SPC = (() => {
  const sma = (a, n) => { const o = new Array(a.length).fill(null); let s = 0; a.forEach((x, i) => { s += x; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; }); return o; };
  const ema = (a, n) => { const k = 2 / (n + 1); let e = null; return a.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); };
  const rsi = (c, n = 14) => {
    const o = new Array(c.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up / n; l += dn / n; if (i === n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); continue; }
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return o;
  };
  const ind = (b) => { const c = b.map((x) => x.c); const ath = []; let m = -Infinity; b.forEach((x) => { m = Math.max(m, x.h); ath.push(m); }); return { c, s50: sma(c, 50), s200: sma(c, 200), e20: ema(c, 20), rsi: rsi(c), ath }; };
  /* price ÷ 200-day average: normal top and "too hot" line */
  const LIM = (gold) => (gold ? { norm: 1.08, hot: 1.15 } : { norm: 1.35, hot: 1.6 });
  const W = { buy: 2, knife: 1.5, dca: 1, wait: 0.5, hot: 0 };

  /* timing grade at bar i (px = live price for the last bar) */
  const gradeAt = (b, I, i, gold, px) => {
    const c = px ?? I.c[i], s50 = I.s50[i], s200 = I.s200[i], r = I.rsi[i]; if (s200 == null) return null;
    const mm = c / s200, L = LIM(gold); let lo5 = Infinity; for (let k = i - 4; k <= i; k++) lo5 = Math.min(lo5, b[k].l);
    let g;
    if (mm > L.hot || r >= 72) g = 'hot';
    else if (mm <= 1) g = c > I.e20[i] ? 'buy' : 'knife';
    else if (c > s200 && s50 > s200 && lo5 <= s50 * 1.02 && r <= 50) g = 'buy';
    else if (mm <= L.norm && r < 65) g = 'dca';
    else g = 'wait';
    return { g, mm, rsi: r, dd: 1 - c / I.ath[i], s50, s200 };
  };
  /* worth holding: long trend from the 200-day line and the past year, against BTC for other coins */
  const holdAt = (I, i, ret1yBtc) => {
    const s = I.s200[i], s0 = I.s200[i - 60]; if (s == null || s0 == null) return null;
    const c = I.c[i], slope = s / s0 - 1, ret1y = i >= 365 ? c / I.c[i - 365] - 1 : null;
    const rel = ret1y != null && ret1yBtc != null ? (1 + ret1y) / (1 + ret1yBtc) - 1 : null;
    let h = 'ok';
    if (c > s && slope > 0) h = 'good';
    else if (c < s && slope < 0 && (rel == null || rel < -0.2)) h = 'weak';
    return { h, slope, ret1y, rel };
  };
  const status = (b, live, gold, btcRet1y) => {
    if (!b || b.length < 270) return null;
    const I = ind(b), n = b.length - 1; const t = gradeAt(b, I, n, gold, live); const h = holdAt(I, n, gold ? null : btcRet1y);
    const px = live ?? I.c[n];
    const score = (t.g === 'buy' ? 3 : t.g === 'knife' ? 2 : t.g === 'dca' ? 1.5 : t.g === 'wait' ? 0 : -1) + (h.h === 'good' ? 2 : h.h === 'ok' ? 1 : -2) + Math.max(-1, Math.min(1, (1.2 - t.mm) * 2));
    /* a better price to wait for: the 200-day line, or the 50-day line in an uptrend */
    const better = t.g === 'hot' || t.g === 'wait' ? (t.s50 > t.s200 && t.s50 < px ? t.s50 : t.s200) : null;
    return { ...t, ...h, px, score, better, ret1y: h.ret1y };
  };
  const ret1y = (b) => (b && b.length > 366 ? b[b.length - 1].c / b[b.length - 366].c - 1 : null);

  /* buying more on good days and less on hot days vs the same amount every day: how much cheaper is the average cost? */
  const timingTest = (b, gold) => {
    if (!b || b.length < 300) return null;
    const I = ind(b); let A = 0, B = 0, Aw = 0, Bw = 0; const cnt = {};
    for (let i = 210; i < b.length; i++) { const t = gradeAt(b, I, i, gold); const w = W[t.g]; cnt[t.g] = (cnt[t.g] || 0) + 1; A += 1; B += 1 / I.c[i]; Aw += w; Bw += w / I.c[i]; }
    const dca = A / B, tim = Aw / Bw;
    return { from: b[210].t, days: A, dca, tim, better: 1 - tim / dca, cnt, hold: I.c[I.c.length - 1] / I.c[210] - 1 };
  };
  return { sma, ema, rsi, ind, gradeAt, holdAt, status, ret1y, timingTest, W, LIM };
})();
if (typeof module !== 'undefined') module.exports = SPC;
