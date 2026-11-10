/* short-term signals page (invest → เก็งกำไร): crypto live from Binance, US stocks from docs/swing.json (every 30 min while NYSE is open).
   Settings, held positions and the crypto signal log stay in localStorage 'valuegrab-swing-v1' (not synced). */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const KEY = 'valuegrab-swing-v1';
  const API = 'https://data-api.binance.vision/api/v3/', WS = 'wss://data-stream.binance.vision/stream?streams=';
  const STABLE = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'EUR', 'AEUR', 'USD1', 'EURI', 'XUSD', 'USDE', 'BFUSD', 'PYUSD', 'RLUSD', 'WBTC', 'WBETH']);
  const N = 40, KIND = { pb: 'ย่อในขาขึ้น', brk: 'ทะลุกรอบ' };
  let S = { cap: 20000, risk: 1, good: true, pos: [], log: [], done: [] };
  try { S = { ...S, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch (e) { /* defaults */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };

  const bars = {}, live = {}; let uni = [], ws = null, on = false, stocks = null, slog = null, lastTick = 0, err = '';
  const fx = () => (window.VG && window.VG.fx) || 33;
  const usd = (v) => (v == null || !isFinite(v) ? '–' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 6 : v < 10 ? 4 : 2 }));
  const thb = (v) => (v == null || !isFinite(v) ? '–' : '฿' + Math.round(v).toLocaleString('en-US'));
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
  const hm = (t) => new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const isCrypto = (s) => s.endsWith('USDT');
  const name = (s) => (isCrypto(s) ? (s === 'PAXGUSDT' ? 'ทอง (PAXG)' : s.replace(/USDT$/, '')) : s);
  const chart = (s) => 'https://www.tradingview.com/chart/?interval=60&symbol=' + encodeURIComponent(isCrypto(s) ? 'BINANCE:' + s : s.replace('.', '-'));
  const kl = (a) => ({ t: a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4], v: +a[5] });
  const get = (u) => fetch(API + u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

  /* ---------- data ---------- */
  const pickUniverse = async () => {
    const t = await get('ticker/24hr?type=MINI');
    const ok = t.filter((x) => x.symbol.endsWith('USDT')).map((x) => ({ s: x.symbol, b: x.symbol.slice(0, -4), q: +x.quoteVolume }))
      .filter((x) => !STABLE.has(x.b) && !/(UP|DOWN|BULL|BEAR)$/.test(x.b)).sort((a, b) => b.q - a.q).slice(0, N).map((x) => x.s);
    if (!ok.includes('PAXGUSDT')) ok.push('PAXGUSDT');
    S.pos.filter((p) => isCrypto(p.s) && !ok.includes(p.s)).forEach((p) => ok.push(p.s));
    return ok;
  };
  const loadBars = async (s) => {
    const a = (await get(`klines?symbol=${s}&interval=1h&limit=200`)).map(kl);
    const f = a.pop(); bars[s] = a; live[s] = f ? f.c : a[a.length - 1].c;
  };
  const start = async () => {
    on = true; err = '';
    try {
      uni = await pickUniverse();
      for (let i = 0; i < uni.length; i += 8) await Promise.all(uni.slice(i, i + 8).map((s) => loadBars(s).catch(() => {})));
      resolveLog(); draw();
      if (!on) return;
      ws = new WebSocket(WS + uni.map((s) => s.toLowerCase() + '@kline_1h').join('/'));
      ws.onmessage = (m) => {
        let d; try { d = JSON.parse(m.data).data; } catch (e) { return; }
        if (!d || !d.k) return; const k = d.k, s = d.s; live[s] = +k.c; lastTick = Date.now();
        if (k.x && bars[s]) { const b = bars[s]; if (!b.length || k.t > b[b.length - 1].t) { b.push({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }); if (b.length > 260) b.shift(); } resolveLog(); }
        later();
      };
      ws.onerror = () => { err = 'เชื่อมต่อราคาสดไม่ได้ จะลองใหม่'; };
      ws.onclose = () => { ws = null; if (on) setTimeout(() => { if (on && !ws) { stop(); start(); } }, 15000); };
    } catch (e) { err = 'โหลดราคาคริปโตไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต)'; draw(); }
  };
  /* fallback when the WebSocket is blocked: prices every minute, bars again after each hour closes */
  let polling = false;
  const poll = async () => {
    if (!on || !uni.length || polling || Date.now() - lastTick < 60e3) return; polling = true;
    try {
      const t = await get('ticker/price?symbols=' + encodeURIComponent(JSON.stringify(uni)));
      t.forEach((x) => { live[x.symbol] = +x.price; }); lastPoll = Date.now();
      const b = bars[uni[0]];
      if (b && b.length && Date.now() - b[b.length - 1].t > 2 * 3600e3 + 60e3) { for (let i = 0; i < uni.length; i += 8) await Promise.all(uni.slice(i, i + 8).map((s) => loadBars(s).catch(() => {}))); resolveLog(); }
      draw();
    } catch (e) { /* try again next round */ }
    polling = false;
  };
  let lastPoll = 0;
  const stop = () => { on = false; if (ws) { ws.onclose = null; ws.close(); ws = null; } };
  let tm = null; const later = () => { if (!tm) tm = setTimeout(() => { tm = null; draw(); }, 1000); };

  const loadStocks = () => {
    fetch('swing.json?v=' + Date.now()).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((j) => { stocks = j; draw(); }).catch(() => { stocks = null; });
    fetch('swing-log.json?v=' + Date.now()).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((j) => { slog = j; drawLog(); }).catch(() => { slog = null; });
  };

  /* ---------- signals ---------- */
  const quality = (s) => { const r = window.VG && window.VG.scan && window.VG.scan.find((x) => x.symbol === s); return r ? r : null; };
  const signals = () => {
    const out = [];
    uni.forEach((s) => { const r = SWC.scan(bars[s], live[s]); if (r) out.push({ s, ...r, crypto: true }); });
    if (stocks && stocks.sig) stocks.sig.forEach((g) => {
      const q = quality(g.s); if (S.good && (!q || (q.quality ?? 0) < 50 || q.signal === 'ระวังกับดักมูลค่า')) return;
      out.push({ ...g, crypto: false, q, closed: !stocks.open || Date.now() - new Date(stocks.updated) > 90 * 60e3 });
    });
    return out.sort((a, b) => (a.closed - b.closed) || b.score - a.score);
  };
  const logNew = (sigs) => {
    let ch = false; const have = new Set(S.log.map((x) => x.s + x.t));
    sigs.filter((g) => g.crypto && g.age === 0 && !have.has(g.s + g.t)).forEach((g) => { S.log.push({ s: g.s, kind: g.kind, t: g.t, entry: g.entry, sl: g.sl, tp1: g.tp1, tp2: g.tp2, R: g.R, score: g.score }); ch = true; });
    if (ch) { S.log = S.log.slice(-300); save(); }
  };
  const resolveLog = async () => {
    let ch = false;
    for (const x of S.log.filter((y) => !y.res)) {
      let b = bars[x.s];
      if (!b || !b.length || b[0].t > x.t) { try { b = (await get(`klines?symbol=${x.s}&interval=1h&startTime=${x.t + 1}&limit=100`)).map(kl); b.pop(); } catch (e) { continue; } }
      const f = SWC.follow(x, b.filter((y) => y.t > x.t));
      if (f.done) { Object.assign(x, { res: f.res, r: Math.round(f.r * 100) / 100, bars: f.bars }); ch = true; }
    }
    if (ch) { save(); drawLog(); }
  };

  /* ---------- sizing + view ---------- */
  const size = (g) => {
    const risk = S.cap * S.risk / 100, rTHB = g.R * fx(); if (!(rTHB > 0)) return null;
    let u = risk / rTHB; const cost = u * g.price * fx(); if (cost > S.cap) u = S.cap / (g.price * fx());
    if (!g.crypto && u >= 1) u = Math.floor(u * 100) / 100;
    return { u, cost: u * g.price * fx(), loss: u * g.R * fx() };
  };
  const why = (g) => (g.kind === 'pb'
    ? `กราฟ 1 ชม. เป็นขาขึ้น (EMA20 อยู่เหนือ EMA50) ราคาย่อมาแตะเส้น EMA20 แล้วปิดเด้งขึ้น RSI ${Math.round(g.rsi)}`
    : `ราคาปิดทะลุจุดสูงสุดของ 20 ชม. ก่อนหน้า วอลุ่ม ${g.vr.toFixed(1)} เท่าของปกติ RSI ${Math.round(g.rsi)}`);
  const level = (k, v, sub, cls) => { const d = el('div', 'sw-lv' + (cls ? ' ' + cls : '')); d.append(el('small', null, k), el('b', null, usd(v)), el('small', null, sub)); return d; };
  const card = (g, i) => {
    const c = el('div', 'panel sw-card');
    const h = el('div', 'sw-h'); h.append(el('span', 'sw-rank', '#' + (i + 1)), el('b', 'sw-sym', name(g.s)), el('span', 'tag ' + (g.kind === 'pb' ? 'buy' : 'watch'), KIND[g.kind]),
      el('span', 'tag', g.crypto ? 'คริปโต · สด' : 'หุ้น US'), el('span', 'sw-score', 'คะแนน ' + g.score));
    if (g.q) h.append(el('span', 'tag', 'VI ' + Math.round(g.q.vi)));
    const px = el('div', 'sw-px'); px.append(el('b', null, usd(g.price)), el('small', null, g.closed ? 'ตลาดหุ้นปิดอยู่ ใช้ได้ตอนตลาดเปิดถ้าราคายังไม่หนีจุดเข้า' : `สัญญาณจากแท่ง ${hm(g.t)} น.`));
    const lv = el('div', 'sw-lvs');
    lv.append(level('เข้าซื้อแถว', g.entry, 'ไม่ไล่ซื้อเกิน ' + usd(g.entry + 0.5 * g.R)), level('ตัดขาดทุน', g.sl, pct(g.sl / g.entry - 1), 'neg'),
      level('เป้าแรก ขายครึ่ง', g.tp1, pct(g.tp1 / g.entry - 1), 'pos'), level('เป้าสอง ขายที่เหลือ', g.tp2, pct(g.tp2 / g.entry - 1), 'pos'));
    const z = size(g);
    const sz = el('p', 'sw-size', z ? `ซื้อประมาณ ${z.u < 1 ? z.u.toPrecision(3) : z.u.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${g.crypto ? 'เหรียญ' : 'หุ้น'} ≈ ${thb(z.cost)} ถ้าโดนตัดขาดทุนจะเสียราว ${thb(z.loss)} (${S.risk}% ของเงินเทรด)` : '');
    const act = el('div', 'sw-act');
    const a = el('a', 'btn ghost sm', 'กราฟ'); a.href = chart(g.s); a.target = '_blank'; a.rel = 'noopener noreferrer';
    const b = el('button', 'btn-line sm', 'เข้าซื้อแล้ว'); b.type = 'button';
    b.addEventListener('click', () => { S.pos.push({ s: g.s, entry: +g.price.toPrecision(6), units: z ? +z.u.toPrecision(4) : 0, sl: g.sl, tp1: g.tp1, tp2: g.tp2, R: g.R, kind: g.kind, at: Date.now(), half: false }); save(); draw(); $('sw-pos').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    act.append(a, b);
    c.append(h, px, el('p', 'sw-why', why(g)), lv, sz, act); return c;
  };
  const priceOf = (s) => (isCrypto(s) ? live[s] : stocks && stocks.px && stocks.px[s] ? stocks.px[s][0] : null);
  const e20Of = (s) => { if (isCrypto(s)) { const b = bars[s]; return b && b.length > 20 ? SWC.ema(b.map((x) => x.c), 20).pop() : null; } return stocks && stocks.px && stocks.px[s] ? stocks.px[s][1] : null; };
  const drawPos = () => {
    const box = $('sw-pos'); if (!box) return; box.replaceChildren();
    if (!S.pos.length) { box.append(el('div', 'empty', 'ยังไม่มีไม้ที่ถืออยู่ กด "เข้าซื้อแล้ว" ที่สัญญาณด้านบน ระบบจะบอกว่าเมื่อไหร่ควรขาย')); return; }
    S.pos.forEach((p, i) => {
      const px = priceOf(p.s), a = SWC.advise(p, px, e20Of(p.s));
      const r = el('div', 'sw-row');
      const who = el('div', 'sw-who'); who.append(el('b', null, name(p.s)), el('small', null, `${KIND[p.kind] || ''} · ซื้อ ${hm(p.at)}`));
      const inp = (lab, k) => { const l = el('label', 'mini', lab); const x = el('input', 'inp'); x.type = 'number'; x.step = 'any'; x.inputMode = 'decimal'; x.value = p[k];
        x.addEventListener('change', () => { const v = +x.value; if (v > 0) { p[k] = v; if (k === 'entry' && !p.half) { p.tp1 = v + 1.5 * (v - p.sl); p.tp2 = v + 3 * (v - p.sl); } save(); drawPos(); } }); l.append(x); return l; };
      const pl = px != null ? (px - p.entry) * p.units * (p.half ? 0.5 : 1) * fx() : null;
      const now = el('div', 'sw-now'); now.append(el('b', null, usd(px)), px == null ? el('small', null, 'ยังไม่มีราคาล่าสุด') : el('small', px >= p.entry ? 'pos' : 'neg', `${pct(px / p.entry - 1)} · ${thb(pl)}${p.half ? ' (ครึ่งที่เหลือ)' : ''}`));
      const lv = el('small', 'sw-lvl', `ตัดขาดทุน ${usd(p.half ? p.entry : p.sl)} · เป้าแรก ${usd(p.tp1)} · เป้าสอง ${usd(p.tp2)}`);
      const adv = el('div', 'sw-adv sw-' + a.k, a.t);
      const act = el('div', 'sw-act');
      if (!p.half) { const h = el('button', 'btn-line sm', 'ขายครึ่งแล้ว'); h.type = 'button'; h.addEventListener('click', () => { p.half = true; p.sl = p.entry; save(); drawPos(); }); act.append(h); }
      const x = el('button', 'btn ghost sm', 'ปิดไม้'); x.type = 'button';
      x.addEventListener('click', () => { S.done.push({ s: p.s, entry: p.entry, exit: px, units: p.units, half: p.half, tp1: p.tp1, at: p.at, end: Date.now() }); S.done = S.done.slice(-200); S.pos.splice(i, 1); save(); draw(); });
      act.append(x);
      const ed = el('div', 'sw-ed'); ed.append(inp('ราคาที่ซื้อ ($)', 'entry'), inp('จำนวน', 'units'));
      r.append(who, now, adv, lv, ed, act); box.append(r);
    });
  };
  const draw = () => {
    const box = $('sw-top'); if (!box) return;
    const sigs = signals(); logNew(sigs);
    const open = sigs.filter((g) => !g.closed);
    box.replaceChildren();
    if (!open.length) box.append(el('div', 'empty', uni.length ? 'ตอนนี้ยังไม่มีจังหวะเข้าที่ผ่านเกณฑ์ ไม่ต้องรีบ รอสัญญาณใหม่ (คำนวณใหม่ทุกครั้งที่แท่ง 1 ชม. ปิด)' : err || 'กำลังโหลดราคา…'));
    open.slice(0, 3).forEach((g, i) => box.append(card(g, i)));
    const more = $('sw-more'); more.replaceChildren();
    sigs.filter((g) => !open.slice(0, 3).includes(g)).slice(0, 12).forEach((g) => {
      const b = el('button', 'td-sym', name(g.s)); b.type = 'button'; b.append(el('small', null, `${KIND[g.kind]} · ${g.score}${g.closed ? ' · ตลาดปิด' : ''}`));
      b.addEventListener('click', () => { const w = el('div'); w.append(card(g, sigs.indexOf(g))); more.after(w); b.disabled = true; }); more.append(b);
    });
    $('sw-more-h').hidden = !more.children.length;
    const cs = uni.length ? `คริปโต ${uni.length} ตัว: ${Date.now() - lastTick < 60000 ? 'ราคาสด' : on && Date.now() - lastPoll < 120000 ? 'อัปเดตทุก 1 นาที' : on ? 'กำลังเชื่อมต่อ' : 'หยุดอัปเดต (เปิดหน้านี้เพื่อดูสด)'}` : err || 'คริปโต: กำลังโหลด';
    const ss = stocks ? `หุ้น US ${stocks.n} ตัว: ${stocks.open ? 'ตลาดเปิด' : 'ตลาดปิด'} คำนวณล่าสุด ${hm(stocks.updated)} น. (อัปเดตทุก 30 นาทีช่วงตลาดเปิด)` : 'หุ้น US: ยังไม่มีข้อมูล จะมาหลังตลาดสหรัฐเปิดรอบถัดไป';
    $('sw-status').textContent = cs + ' · ' + ss;
    drawPos();
  };
  const stats = (rows) => {
    const d = rows.filter((x) => x.res && x.res !== 'old'); if (!d.length) return null;
    const w = d.filter((x) => x.r > 0).length, sum = d.reduce((a, x) => a + x.r, 0);
    return { n: d.length, open: rows.filter((x) => !x.res).length, win: w / d.length, avg: sum / d.length, sum };
  };
  const RES = { sl: 'โดนตัดขาดทุน', be: 'ถึงเป้าแรก แล้วกลับมาที่ทุน', tp2: 'ถึงเป้าสอง', time: 'ครบเวลา ปิดที่ราคาตลาด' };
  const drawLog = () => {
    const box = $('sw-log'); if (!box) return; box.replaceChildren();
    [['คริปโต (จดในเครื่องนี้ตอนเปิดหน้านี้)', S.log], ['หุ้น US (ระบบจดอัตโนมัติ)', slog || []]].forEach(([t, rows]) => {
      const p = el('div', 'panel sw-stat'); p.append(el('h3', null, t)); const s = stats(rows);
      if (!s) { p.append(el('p', 'pf-hint', rows.length ? `รอผล ${rows.length} สัญญาณ` : 'ยังไม่มีสัญญาณที่จบแล้ว')); box.append(p); return; }
      const g = el('div', 'sw-lvs');
      [['สัญญาณที่จบแล้ว', s.n + ' ครั้ง', `รอผลอีก ${s.open}`], ['อัตราชนะ', Math.round(s.win * 100) + '%', 'ไม้ที่จบด้วยกำไร'], ['เฉลี่ยต่อไม้', (s.avg >= 0 ? '+' : '') + s.avg.toFixed(2) + 'R', 'R = เงินที่ยอมเสียต่อไม้'], ['รวม', (s.sum >= 0 ? '+' : '') + s.sum.toFixed(1) + 'R', `ถ้าเสี่ยงไม้ละ ${thb(S.cap * S.risk / 100)} ≈ ${thb(s.sum * S.cap * S.risk / 100)}`]]
        .forEach(([k, v, sub]) => { const d = el('div', 'sw-lv'); d.append(el('small', null, k), el('b', null, v), el('small', null, sub)); g.append(d); });
      p.append(g);
      const ul = el('ul', 'sw-hist'); rows.filter((x) => x.res && x.res !== 'old').slice(-8).reverse().forEach((x) => { const li = el('li'); li.append(el('b', null, name(x.s)), el('span', null, ` ${hm(x.t)} · ${KIND[x.kind]} · ${RES[x.res]} `), el('b', x.r > 0 ? 'pos' : x.r < 0 ? 'neg' : null, (x.r > 0 ? '+' : '') + x.r + 'R')); ul.append(li); });
      p.append(ul); box.append(p);
    });
    if (S.done.length) {
      const p = el('div', 'panel sw-stat'); p.append(el('h3', null, 'ไม้จริงของฉันที่ปิดแล้ว'));
      let tot = 0; const ul = el('ul', 'sw-hist');
      S.done.slice().reverse().slice(0, 10).forEach((d) => { const v = d.exit != null ? (d.half ? ((d.tp1 - d.entry) * 0.5 + (d.exit - d.entry) * 0.5) : (d.exit - d.entry)) * d.units * fx() : 0; tot += v; const li = el('li'); li.append(el('b', null, name(d.s)), el('span', null, ` ${hm(d.end)} ซื้อ ${usd(d.entry)} ขาย ${usd(d.exit)} `), el('b', v >= 0 ? 'pos' : 'neg', thb(v))); ul.append(li); });
      p.append(el('p', 'pf-hint', `10 ไม้ล่าสุดรวม ${thb(tot)} (ประมาณ ยังไม่หักค่าธรรมเนียม)`), ul); box.append(p);
    }
  };

  /* ---------- wiring ---------- */
  const visible = () => { const s = $('swing'), v = $('view-scan'); return s && v && !v.hidden && !s.classList.contains('sub-off') && document.visibilityState === 'visible'; };
  const setup = () => {
    const cap = $('sw-cap'), risk = $('sw-risk'), good = $('sw-good'); if (!cap) return;
    cap.value = S.cap; risk.value = S.risk; good.checked = S.good;
    cap.addEventListener('change', () => { const v = +cap.value; if (v > 0) { S.cap = v; save(); draw(); drawLog(); } });
    risk.addEventListener('change', () => { const v = +risk.value; if (v > 0 && v <= 10) { S.risk = v; save(); draw(); drawLog(); } else risk.value = S.risk; });
    good.addEventListener('change', () => { S.good = good.checked; save(); draw(); });
    document.addEventListener('vg:ready', draw);
    let seenAt = 0;
    setInterval(() => {
      const v = visible();
      if (v && !on) { start(); if (Date.now() - seenAt > 10 * 60e3) loadStocks(); seenAt = Date.now(); }
      else if (!v && on) stop();
      else if (v && Date.now() - seenAt > 10 * 60e3) { loadStocks(); seenAt = Date.now(); }
      if (v && Date.now() - lastPoll > 60e3) poll();
    }, 2000);
    loadStocks(); drawLog(); draw();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.VGSwing = { get: () => S, signals };
})();
