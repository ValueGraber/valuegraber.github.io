dash.calc('scan', {
  title: 'คะแนน VI รายหุ้น',
  description: 'มูลค่าเหมาะสมแบบ Graham, MOS และคะแนนคุณภาพ ความถูก เติบโต จังหวะ ของหุ้นแต่ละตัว',
  inputs: ['stocks', 'yield'],
  fn: (stocks, yieldRows) => {
    const n = (x) => (x == null || x === '' || isNaN(Number(x)) ? null : Number(x));
    const y10 = n(yieldRows[yieldRows.length - 1]?.yield10y) ?? 4.5;
    const aaa = y10 + 0.8;
    const pct = (key, higherBetter, rows) => {
      const vals = rows.map((r) => r[key]).filter((v) => v != null).sort((a, b) => a - b);
      return (v) => {
        if (v == null || !vals.length) return null;
        let lo = 0, hi = vals.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
        const p = (lo / Math.max(1, vals.length - 1)) * 100;
        return higherBetter ? p : 100 - p;
      };
    };
    const avg = (a) => { const b = a.filter((v) => v != null); return b.length ? b.reduce((s, v) => s + v, 0) / b.length : null; };
    const base = stocks.map((s) => {
      const price = n(s.price), fpe = n(s.forwardPe);
      const g = Math.max(0, Math.min(15, n(s.epsGrowth3y) ?? 0));
      const ttm = n(s.epsTtm);
      const fwdEps = price && fpe && fpe > 0 ? price / fpe : null;
      const eps = fwdEps && ttm > 0 ? Math.min(fwdEps, ttm * 1.3) : null;
      const peak = !!(fwdEps && ttm > 0 && fwdEps > ttm * 1.5);
      const fairPe = Math.min(25, ((8.5 + 2 * g) * 4.4) / aaa);
      const fairValue = eps ? eps * fairPe : null;
      const mos = fairValue ? fairValue / price - 1 : null;
      const tgt = n(s.analystTarget);
      const pfcf = n(s.pfcf), pb = n(s.pb), peg = n(s.peg);
      return {
        symbol: s.symbol, name: s.name, sector: s.sector, price, fairValue, mos, peak,
        analystTarget: tgt, analystUpside: tgt && price ? tgt / price - 1 : null, analystRating: s.analystRating,
        roic: n(s.roic) == null ? null : Math.min(60, n(s.roic)), roe: n(s.roe) == null ? null : Math.min(60, n(s.roe)),
        netMargin: n(s.netMargin), fcfMargin: n(s.fcfMargin), de: n(s.debtToEquity) == null ? null : Math.min(10, n(s.debtToEquity)),
        fpe: fpe && fpe > 0 ? fpe : null, pb: pb && pb > 0 ? Math.min(100, pb) : null, pfcf: pfcf && pfcf > 0 ? pfcf : null, peg: peg && peg > 0 ? peg : null,
        epsG: n(s.epsGrowth3y), revG: n(s.revenueGrowth3y),
        ma50: n(s.ma50), ma200: n(s.ma200), rsi: n(s.rsi), change52w: n(s.change52w),
        pe: n(s.pe), dividendYield: n(s.dividendYield), marketCapB: n(s.marketCapB), beta: n(s.beta),
        roeRaw: n(s.roe), pbRaw: n(s.pb), deRaw: n(s.debtToEquity), earningsDate: s.earningsDate || null,
        trendR: price && n(s.ma200) ? price / n(s.ma200) : null,
      };
    });
    /* money-master 3.2: fair value from 3 methods — FCF DCF, sector-median multiples, Graham; median, outliers (> 3×) dropped */
    const med = (a) => { const b = a.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
    const bySec = {}; base.forEach((r) => { (bySec[r.sector] = bySec[r.sector] || []).push(r); });
    const secMed = {}; Object.entries(bySec).forEach(([k, rs]) => { secMed[k] = { pe: med(rs.map((r) => (r.fpe && r.fpe < 80 ? r.fpe : null))), pf: med(rs.map((r) => (r.pfcf && r.pfcf < 80 ? r.pfcf : null))), n: rs.length }; });
    base.forEach((r) => {
      if (!r.price) return; const fin = (r.sector || '').includes('การเงิน');
      const gs = [r.epsG, r.revG].filter((v) => v != null), g = Math.max(0, Math.min(0.15, (gs.length ? gs.reduce((a, v) => a + v, 0) / gs.length : 5) / 100));
      const ke = Math.max(0.07, Math.min(0.14, y10 / 100 + (r.beta > 0 ? r.beta : 1) * 0.055)), gt = 0.025;
      const fcf = r.pfcf && r.pfcf <= 80 && (r.fcfMargin == null || r.fcfMargin >= 3) && !fin ? r.price / r.pfcf : null; let dcf = null;
      if (fcf) { let v = 0, f = fcf; for (let t = 1; t <= 5; t++) { f *= 1 + (g - (g - gt) * (t - 1) / 5); v += f / (1 + ke) ** t; } dcf = v + (f * (1 + gt)) / (ke - gt) / (1 + ke) ** 5; }
      const sm = secMed[r.sector] || {}, cs = []; if (r.fpe && sm.pe) cs.push((r.price / r.fpe) * sm.pe); if (fcf && sm.pf) cs.push(fcf * sm.pf);
      const comps = cs.length && sm.n >= 5 ? cs.reduce((a, v) => a + v, 0) / cs.length : null;
      let vs = [dcf, comps, r.fairValue].filter((v) => v > 0); if (vs.length === 3) { const m0 = med(vs); vs = vs.filter((v) => Math.max(v / m0, m0 / v) <= 3); }
      r.fair3 = vs.length ? med(vs) : null; r.mos3 = r.fair3 ? r.fair3 / r.price - 1 : null;
      const fl = []; if (r.roeRaw > 60 && r.deRaw > 2) fl.push('ROE สูงเพราะหนี้หรือการซื้อหุ้นคืน'); if (r.pfcf > 80) fl.push('กระแสเงินสดอิสระต่ำผิดปกติ'); if (r.pbRaw > 40) fl.push('ส่วนของผู้ถือหุ้นต่ำมาก ตัวเลขต่อทุนเพี้ยนได้');
      r.flags = fl;
    });
    const P = {};
    [['change52w', 1], ['trendR', 1], ['roic', 1], ['roe', 1], ['netMargin', 1], ['fcfMargin', 1], ['de', 0], ['fpe', 0], ['pb', 0], ['pfcf', 0], ['peg', 0], ['mos', 1], ['epsG', 1], ['revG', 1]]
      .forEach(([k, hb]) => { P[k] = pct(k, hb, base); });
    return base.map((r) => {
      const quality = avg([P.roic(r.roic), P.roe(r.roe), P.netMargin(r.netMargin), P.fcfMargin(r.fcfMargin), P.de(r.de)]);
      const value = avg([P.fpe(r.fpe), P.pb(r.pb), P.pfcf(r.pfcf), P.peg(r.peg), P.mos(r.mos)]);
      const growth = avg([P.epsG(r.epsG), P.revG(r.revG)]);
      let timing = null;
      if (r.price && r.ma200 && r.ma50 && r.rsi != null) {
        timing = (r.price > r.ma200 ? 40 : r.price > r.ma200 * 0.9 ? 20 : 0) + (r.price > r.ma50 ? 20 : 10);
        timing += r.rsi < 30 ? 25 : r.rsi < 45 ? 40 : r.rsi <= 60 ? 30 : r.rsi <= 70 ? 15 : 0;
      }
      /* momentum (money-master: value + quality + momentum beats value alone; cheap-and-falling = value trap) */
      const momentum = avg([P.change52w(r.change52w), P.trendR(r.trendR)]);
      const vi = Math.round((quality ?? 50) * 0.30 + (value ?? 50) * 0.30 + (momentum ?? 50) * 0.20 + (growth ?? 50) * 0.10 + (timing ?? 50) * 0.10);
      const mosUse = r.mos3 ?? r.mos, flagged = (r.flags || []).length > 0;
      const ed = r.earningsDate ? Math.round((new Date(r.earningsDate + 'T12:00:00Z') - Date.now()) / 86400000) : null;
      const nearTrend = r.price && r.ma200 ? r.price >= r.ma200 * 0.9 : true;
      const signal = vi >= 65 && mosUse != null && mosUse > 0 && (quality ?? 0) >= 50 && nearTrend && !r.peak && !flagged && (momentum ?? 50) >= 40 ? 'น่าซื้อสะสม'
        : (quality ?? 0) >= 70 && (value ?? 100) < 35 ? 'หุ้นดีแต่แพง'
        : (value ?? 0) >= 70 && (quality ?? 100) < 35 ? 'ระวังกับดักมูลค่า'
        : vi >= 58 ? 'น่าจับตา' : 'ผ่านไปก่อน';
      const rd = (v) => (v == null ? null : Math.round(v));
      return {
        symbol: r.symbol, name: r.name, sector: r.sector, price: r.price, fairValue: r.fairValue, mos: r.mos, peakEarnings: r.peak ? 'ใช่' : 'ไม่',
        analystTarget: r.analystTarget, analystUpside: r.analystUpside, analystRating: r.analystRating,
        quality: rd(quality), value: rd(value), growth: rd(growth), timing: rd(timing), momentum: rd(momentum), vi, signal,
        fair3: r.fair3, mos3: r.mos3, flags: r.flags || [], earningsDate: r.earningsDate, earnDays: ed != null && ed >= 0 ? ed : null,
        pe: r.pe, forwardPe: r.fpe, pb: r.pb, peg: r.peg, roe: r.roe, roic: r.roic, netMargin: r.netMargin, fcfMargin: r.fcfMargin,
        debtToEquity: r.de, epsGrowth3y: r.epsG, revenueGrowth3y: r.revG, dividendYield: r.dividendYield, rsi: r.rsi,
        ma50: r.ma50, ma200: r.ma200, change52w: r.change52w, marketCapB: r.marketCapB,
      };
    }).sort((a, b) => b.vi - a.vi);
  },
});

dash.calc('market', {
  title: 'ภาวะตลาดรวม',
  description: 'SPY เทียบเส้นค่าเฉลี่ย 40 สัปดาห์, ระยะจากจุดสูงสุด 52 สัปดาห์, สัดส่วนหุ้นเหนือเส้น 200 วัน และดอกเบี้ย 10 ปี',
  inputs: ['spy', 'yield', 'stocks'],
  fn: (spy, yieldRows, stocks) => {
    const c = spy.map((r) => Number(r.close));
    const last = c[c.length - 1];
    const ma40 = c.slice(-40).reduce((s, v) => s + v, 0) / Math.min(40, c.length);
    const hi52 = Math.max(...c.slice(-52));
    const valid = stocks.filter((s) => Number(s.price) > 0 && Number(s.ma200) > 0);
    const breadth200 = valid.filter((s) => Number(s.price) > Number(s.ma200)).length / valid.length;
    const y = yieldRows.map((r) => Number(r.yield10y));
    const yNow = y[y.length - 1];
    const y3m = y[Math.max(0, y.length - 64)];
    const up = last > ma40, broad = breadth200 > 0.5;
    const regime = up && broad ? 'ขาขึ้น' : !up && !broad ? 'ขาลง' : 'ระมัดระวัง';
    return [{ regime, spyClose: last, spyVsMa40: last / ma40 - 1, spyDrawdown: last / hi52 - 1, breadth200, yield10y: yNow, yieldChange3m: yNow - y3m, asOf: spy[spy.length - 1].date }];
  },
});

dash.calc('sectors', {
  title: 'คะแนนรายกลุ่มอุตสาหกรรม',
  description: 'คะแนน VI เฉลี่ยและจำนวนหุ้นน่าซื้อสะสมในแต่ละกลุ่ม',
  inputs: ['scan'],
  fn: (scan) => {
    const m = {};
    scan.forEach((r) => {
      const k = r.sector || 'อื่นๆ';
      m[k] = m[k] || { sector: k, count: 0, sum: 0, buys: 0 };
      m[k].count++; m[k].sum += r.vi; if (r.signal === 'น่าซื้อสะสม') m[k].buys++;
    });
    return Object.values(m).map((s) => ({ sector: s.sector, stocks: s.count, avgVi: Math.round(s.sum / s.count), buys: s.buys })).sort((a, b) => b.avgVi - a.avgVi);
  },
});

