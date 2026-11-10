/* invest → คริปโตและทอง: long-term entry timing for crypto majors + gold (PAXG as the gold price), spot only.
   Daily bars from Binance public market data (data-api.binance.vision), live price by WebSocket with a REST poll fallback;
   runs only while the page is visible. Prices shown in baht = USDT price × VG.fx. Gold shown in USD per troy ounce (money()); portfolio keeps baht, gold counted in ounces. */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const API = 'https://data-api.binance.vision/api/v3/', WS = 'wss://data-stream.binance.vision/stream?streams=';
  const ASSETS = [['BTC', 'บิตคอยน์'], ['ETH', 'อีเธอเรียม'], ['BNB', 'BNB'], ['SOL', 'โซลานา'], ['XRP', 'XRP'], ['ADA', 'คาร์ดาโน'], ['DOGE', 'ดอจคอยน์'],
    ['TRX', 'ทรอน'], ['LINK', 'เชนลิงก์'], ['AVAX', 'อวาแลนช์'], ['DOT', 'โพลคาดอต'], ['LTC', 'ไลต์คอยน์'], ['GOLD', 'ทองคำ']];
  const KEY = 'valuegrab-spotset-v1';
  const pair = (a) => (a === 'GOLD' ? 'PAXGUSDT' : a + 'USDT');
  const isGold = (a) => a === 'GOLD';
  const unit = (a) => (isGold(a) ? 'ออนซ์' : 'เหรียญ');
  const KIND = { pb: 'ย่อในขาขึ้น', rc: 'กลับเป็นขาขึ้น', dv: 'ทยอยสะสมช่วงถูก' };
  const ST = { hot: ['trap', 'ร้อนแรง'], up: ['watch', 'ขาขึ้น รอย่อ'], zone: ['buy', 'ในโซนซื้อ'], deep: ['watch', 'ย่อลึก'], down: ['trap', 'ขาลง'], turn: ['', 'ไซด์เวย์'] };
  let set = { cap: 50000, risk: 2 }; try { set = { ...set, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch (e) { /* defaults */ }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch (e) { /* ignore */ } };

  const bars = {}, live = {}, bt = {}; let ws = null, on = false, lastTick = 0, lastPoll = 0, err = '', loaded = false;
  const fx = () => (window.VG && window.VG.fx) || 33;
  const toTHB = (a, usd) => (usd == null ? null : usd * fx());
  /* gold is shown in USD per troy ounce, crypto in baht */
  const money = (a, v) => (isGold(a) ? (v == null || !isFinite(v) ? '–' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : thb(toTHB(a, v)));
  const thb = (v) => (v == null || !isFinite(v) ? '–' : '฿' + v.toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 4 : v < 100 ? 2 : 0 }));
  const usd = (v) => (v == null || !isFinite(v) ? '–' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 5 : v < 100 ? 3 : 0 }));
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
  const day = (t) => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  const get = (u) => fetch(API + u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const kl = (a) => ({ t: a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4], v: +a[5] });
  const chart = (a) => 'https://www.tradingview.com/chart/?interval=1D&symbol=' + encodeURIComponent(isGold(a) ? 'OANDA:XAUUSD' : 'BINANCE:' + pair(a));
  const nameOf = (a) => { const x = ASSETS.find((y) => y[0] === a); return x ? (isGold(a) ? x[1] : `${a} · ${x[1]}`) : a; };

  /* ---------- data ---------- */
  const loadBars = async (a) => {
    const k = (await get(`klines?symbol=${pair(a)}&interval=1d&limit=1000`)).map(kl);
    const f = k.pop(); bars[a] = k; live[a] = f ? f.c : k[k.length - 1].c; bt[a] = SPC.backtest(k, isGold(a));
  };
  const loadAll = async () => { for (let i = 0; i < ASSETS.length; i += 5) await Promise.all(ASSETS.slice(i, i + 5).map(([a]) => loadBars(a).catch(() => {}))); loaded = true; };
  const start = async () => {
    on = true; err = '';
    try {
      await loadAll(); draw(); drawBt();
      if (!Object.keys(bars).length) throw new Error('no data');
      if (!on) return;
      ws = new WebSocket(WS + ASSETS.map(([a]) => pair(a).toLowerCase() + '@kline_1d').join('/'));
      ws.onmessage = (m) => {
        let d; try { d = JSON.parse(m.data).data; } catch (e) { return; }
        if (!d || !d.k) return; const a = d.s === 'PAXGUSDT' ? 'GOLD' : d.s.replace(/USDT$/, ''); const k = d.k; live[a] = +k.c; lastTick = Date.now();
        if (k.x && bars[a]) { const b = bars[a]; if (k.t > b[b.length - 1].t) { b.push(kl([k.t, k.o, k.h, k.l, k.c, k.v])); b.shift(); bt[a] = SPC.backtest(b, isGold(a)); drawBt(); } }
        later();
      };
      ws.onerror = () => { /* the poll below takes over */ };
      ws.onclose = () => { ws = null; };
    } catch (e) { err = 'โหลดราคาไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต)'; draw(); }
  };
  const stop = () => { on = false; if (ws) { ws.onclose = null; ws.close(); ws = null; } };
  let polling = false;
  const poll = async () => {
    if (!on || !loaded || polling || Date.now() - lastTick < 60e3) return; polling = true;
    try {
      const t = await get('ticker/price?symbols=' + encodeURIComponent(JSON.stringify(ASSETS.map(([a]) => pair(a)))));
      t.forEach((x) => { live[x.symbol === 'PAXGUSDT' ? 'GOLD' : x.symbol.replace(/USDT$/, '')] = +x.price; }); lastPoll = Date.now();
      const b = bars.BTC; if (b && Date.now() - b[b.length - 1].t > 2 * 86400e3 + 60e3) await loadAll();
      draw();
    } catch (e) { /* next round */ }
    polling = false;
  };
  let tm = null; const later = () => { if (!tm) tm = setTimeout(() => { tm = null; draw(); }, 1500); };

  /* ---------- view ---------- */
  const signals = () => ASSETS.map(([a]) => { const s = SPC.scan(bars[a], live[a], isGold(a)); return s ? { a, ...s } : null; }).filter(Boolean).sort((x, y) => y.score - x.score);
  const cap = () => (window.VGTrade && window.VGTrade.equityTHB()) || set.cap;
  const size = (g) => {
    const c = cap(), R = toTHB(g.a, g.R), px = toTHB(g.a, g.price); if (!(R > 0)) return null;
    let q = c * set.risk / 100 / R; if (q * px > c * 0.3) q = c * 0.3 / px;
    return { q, cost: q * px, loss: q * R };
  };
  const why = (g) => (g.kind === 'pb' ? `กราฟรายวันเป็นขาขึ้น (เส้น 50 วันอยู่เหนือ 200 วัน) ราคาย่อมาแถวเส้น 50 วันแล้วปิดเด้งเหนือแท่งก่อนหน้า RSI ${Math.round(g.rsi)}`
    : g.kind === 'rc' ? `ราคาปิดกลับขึ้นเหนือเส้น 200 วันหลังจากอยู่ใต้เส้นมา เส้น 200 วันเริ่มหยุดลง เป็นสัญญาณเปลี่ยนเป็นขาขึ้นช่วงแรก RSI ${Math.round(g.rsi)}`
      : `ราคาต่ำกว่าจุดสูงสุดเดิม ${Math.round(g.dd * 100)}% และเริ่มยืนเหนือเส้น 20 วันได้ เหมาะทยอยสะสมทีละน้อย ความเสี่ยงสูงกว่าแบบอื่นเพราะยังเป็นขาลง`);
  const level = (k, v, sub, cls) => { const d = el('div', 'sw-lv' + (cls ? ' ' + cls : '')); d.append(el('small', null, k), el('b', null, v), el('small', null, sub)); return d; };
  const btLine = (a) => { const r = bt[a]; if (!r || !r.n) return ''; return `กติกานี้ย้อนหลังตั้งแต่ ${day(r.from)}: ${r.n} ไม้ ชนะ ${Math.round(r.win * 100)}% เฉลี่ย ${r.avg >= 0 ? '+' : ''}${r.avg.toFixed(2)}R ต่อไม้ (ซื้อถือเฉยๆ ช่วงเดียวกัน ${pct(r.hold, 0)})`; };
  const card = (g, i) => {
    const c = el('div', 'panel sw-card'); const P = (v) => toTHB(g.a, v);
    const h = el('div', 'sw-h'); h.append(el('span', 'sw-rank', '#' + (i + 1)), el('b', 'sw-sym', nameOf(g.a)), el('span', 'tag ' + (g.kind === 'dv' ? 'watch' : 'buy'), KIND[g.kind]), el('span', 'sw-score', 'คะแนน ' + g.score));
    const px = el('div', 'sw-px'); px.append(el('b', null, money(g.a, g.price)), el('small', null, `${isGold(g.a) ? 'USD ต่อออนซ์' : usd(g.price)} · สัญญาณจากแท่งวันที่ ${day(g.t)}`));
    const lv = el('div', 'sw-lvs');
    lv.append(level('เข้าซื้อแถว', money(g.a, g.entry), 'ไม่ไล่ซื้อเกิน ' + money(g.a, g.entry + 0.5 * g.R)), level('จุดยอมรับว่าผิด', money(g.a, g.sl), pct(g.sl / g.entry - 1) + ' ปิดต่ำกว่านี้ขาย', 'neg'),
      level('เป้าแรก ขาย 1/3', money(g.a, g.tp1), pct(g.tp1 / g.entry - 1), 'pos'), level('เป้าสอง ขายอีก 1/3', money(g.a, g.tp2), pct(g.tp2 / g.entry - 1) + ' ที่เหลือถือตามเทรนด์', 'pos'));
    const z = size(g);
    const sz = el('p', 'sw-size', z ? `${window.VGTrade && window.VGTrade.equityTHB() ? 'จากพอร์ต: ' : ''}ซื้อประมาณ ${z.q < 1 ? +z.q.toPrecision(3) : z.q.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit(g.a)} ≈ ${thb(z.cost)} ถ้าผิดทางจะเสียราว ${thb(z.loss)} (${set.risk}% ของเงินลงทุน) ยังไม่รวมค่าธรรมเนียม` : '');
    const act = el('div', 'sw-act');
    const a = el('a', 'btn ghost sm', 'กราฟ'); a.href = chart(g.a); a.target = '_blank'; a.rel = 'noopener noreferrer';
    const b = el('button', 'btn-line sm', 'ซื้อแล้ว'); b.type = 'button';
    b.addEventListener('click', () => { if (window.VGTrade) window.VGTrade.prefill({ type: 'buy', s: g.a, q: z ? z.q : null, px: P(g.price), plan: { s: g.a, sl: P(g.sl), kind: g.kind } }); });
    act.append(a, b);
    c.append(h, px, el('p', 'sw-why', why(g)), lv, sz, el('p', 'pf-hint', btLine(g.a)), act); return c;
  };
  const draw = () => {
    const box = $('sw-top'); if (!box) return;
    const sigs = signals(); box.replaceChildren();
    if (!sigs.length) box.append(el('div', 'empty', loaded ? 'ตอนนี้ยังไม่มีตัวไหนถึงจังหวะเข้าซื้อตามกติกา ไม่ต้องรีบ ดูสถานะแต่ละตัวด้านล่าง (คำนวณใหม่ทุกวันตอน 07:00 น. เมื่อแท่งวันปิด)' : err || 'กำลังโหลดราคา…'));
    sigs.slice(0, 3).forEach((g, i) => box.append(card(g, i)));
    /* every asset right now */
    const list = $('sw-all'); list.replaceChildren();
    ASSETS.forEach(([a]) => {
      const s = SPC.status(bars[a], live[a], isGold(a)); const sig = sigs.find((x) => x.a === a);
      const r = el('div', 'sw-arow');
      const who = el('div', 'sw-who'); who.append(el('b', null, nameOf(a)), el('small', null, s ? (isGold(a) ? `${money(a, s.px)} ต่อออนซ์ · ≈ ${thb(toTHB(a, s.px))}` : `${thb(toTHB(a, s.px))} · ${usd(s.px)}`) : 'กำลังโหลด'));
      const st = el('div', 'sw-ast');
      if (s) {
        const [cls, lab] = sig ? ['buy', 'ถึงจังหวะ: ' + KIND[sig.kind]] : ST[s.k];
        st.append(el('span', 'tag ' + cls, lab), el('small', null, sig ? `อันดับ ${sigs.indexOf(sig) + 1} ดูด้านบน` : s.t));
        const zone = s.trend === 'bull' && !sig ? ` · โซนซื้อ ${money(a, s.zone[0])}–${money(a, s.zone[1])}` : '';
        st.append(el('small', 'sw-meta', `RSI ${Math.round(s.rsi)} · ต่ำกว่าจุดสูงสุด ${Math.round(s.dd * 100)}%${zone}`));
      }
      r.append(who, st); list.append(r);
    });
    $('sw-status').textContent = loaded ? `${ASSETS.length} ตัว: ${Date.now() - lastTick < 60000 ? 'ราคาสด' : on && Date.now() - lastPoll < 120000 ? 'ราคาอัปเดตทุก 1 นาที' : on ? 'กำลังเชื่อมต่อ' : 'หยุดอัปเดต (เปิดหน้านี้เพื่อดูสด)'} · ราคาบาทคิดจากราคาดอลลาร์ × ${fx().toFixed(2)} ราคาในแอปจะต่างเล็กน้อย` : err || 'กำลังโหลด…';
    document.dispatchEvent(new Event('vg:spot'));
  };
  const RES = { sl: 'ตัดขาดทุน', be: 'ได้เป้าแรกแล้วกลับมาที่ทุน', tp2: 'ได้เป้าสองแล้วกลับมาที่ทุน', trail: 'ขายส่วนสุดท้ายตอนหลุดเส้น 50 วัน', time: 'ครบ 1 ปี' };
  const drawBt = () => {
    const box = $('sw-log'); if (!box) return; box.replaceChildren();
    if (!Object.keys(bt).length) { box.append(el('div', 'empty', 'จะคำนวณเมื่อเปิดหน้า "คริปโตและทอง" และโหลดราคาได้')); return; }
    const tb = el('table', 'tr-table'); const hd = el('tr');
    ['ตัว', 'ไม้', 'ชนะ', 'เฉลี่ยต่อไม้', 'รวม', 'ซื้อถือเฉยๆ', 'ตั้งแต่'].forEach((x) => hd.append(el('th', null, x)));
    const th = el('thead'); th.append(hd); tb.append(th); const bd = el('tbody'); let N = 0, W = 0, SUM = 0;
    ASSETS.forEach(([a]) => {
      const r = bt[a]; if (!r) return; const tr = el('tr'); const td = (v, c) => tr.append(el('td', c, v));
      N += r.n; W += r.win != null ? r.win * r.n : 0; SUM += r.sum;
      td(nameOf(a)); td(String(r.n) + (r.open ? ` (+${r.open} ค้าง)` : '')); td(r.win != null ? Math.round(r.win * 100) + '%' : '–'); td(r.avg != null ? (r.avg >= 0 ? '+' : '') + r.avg.toFixed(2) + 'R' : '–', r.avg > 0 ? 'pos' : r.avg < 0 ? 'neg' : null);
      td((r.sum >= 0 ? '+' : '') + r.sum.toFixed(1) + 'R', r.sum > 0 ? 'pos' : r.sum < 0 ? 'neg' : null); td(pct(r.hold, 0)); td(day(r.from)); bd.append(tr);
    });
    tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); box.append(w);
    box.append(el('p', 'pf-hint', `รวมทุกตัว ${N} ไม้ ชนะ ${N ? Math.round(W / N * 100) : 0}% รวม ${SUM >= 0 ? '+' : ''}${SUM.toFixed(1)}R · ถ้าเสี่ยงไม้ละ ${set.risk}% ของ ${thb(cap())} 1R ≈ ${thb(cap() * set.risk / 100)}`));
    const recent = []; ASSETS.forEach(([a]) => (bt[a] ? bt[a].trades : []).forEach((x) => recent.push({ a, ...x })));
    const ul = el('ul', 'sw-hist');
    recent.sort((x, y) => y.t - x.t).slice(0, 12).forEach((x) => { const li = el('li'); li.append(el('b', null, nameOf(x.a)), el('span', null, ` ${day(x.t)} · ${KIND[x.kind]} · ${x.done ? RES[x.res] : 'ยังถืออยู่'} `), el('b', x.r > 0 ? 'pos' : x.r < 0 ? 'neg' : null, (x.r >= 0 ? '+' : '') + x.r.toFixed(2) + 'R')); ul.append(li); });
    box.append(el('h3', 'sw-h3', 'ไม้ล่าสุดตามกติกา'), ul);
  };

  /* ---------- wiring ---------- */
  const visible = () => { const v = $('view-scan'); return v && !v.hidden && document.body.dataset.tab === 'invest' && ['swing', 'tport', 'tday', 'swlog'].some((k) => { const s = $(k); return s && !s.classList.contains('sub-off'); }) && document.visibilityState === 'visible'; };
  const setup = () => {
    const c = $('sw-cap'), r = $('sw-risk'); if (!c) return;
    c.value = set.cap; r.value = set.risk;
    c.addEventListener('change', () => { const v = +c.value; if (v > 0) { set.cap = v; keep(); draw(); drawBt(); } else c.value = set.cap; });
    r.addEventListener('change', () => { const v = +r.value; if (v > 0 && v <= 10) { set.risk = v; keep(); draw(); drawBt(); } else r.value = set.risk; });
    document.addEventListener('vg:ready', draw);
    setInterval(() => { const v = visible(); if (v && !on) start(); else if (!v && on) stop(); if (v) poll(); }, 2000);
    draw(); drawBt();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.VGSpot = {
    assets: ASSETS, unit, nameOf, isGold,
    price: (a) => toTHB(a, live[a] ?? null),
    s50: (a) => { const b = bars[a]; if (!b || b.length < 50) return null; return toTHB(a, SPC.sma(b.map((x) => x.c), 50).pop()); },
    status: (a) => SPC.status(bars[a], live[a], isGold(a)),
  };
})();
