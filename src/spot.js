/* invest → คริปโตและทอง: buy-and-hold timing for 12 crypto majors + gold (PAXG price = gold USD/oz), spot only.
   Daily bars from Binance public market data (data-api.binance.vision), live price by WebSocket with a REST poll fallback;
   runs only while one of its sub-pages is visible. Crypto shown in baht (USDT × VG.fx), gold in USD per ounce. */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const API = 'https://data-api.binance.vision/api/v3/', WS = 'wss://data-stream.binance.vision/stream?streams=';
  /* gold only (crypto removed 2026-11): crypto names stay in NAMES so old journal entries still read well */
  const ASSETS = [['GOLD', 'ทองคำ']];
  const NAMES = [['BTC', 'บิตคอยน์'], ['ETH', 'อีเธอเรียม'], ['BNB', 'BNB'], ['SOL', 'โซลานา'], ['XRP', 'XRP'], ['ADA', 'คาร์ดาโน'], ['DOGE', 'ดอจคอยน์'],
    ['TRX', 'ทรอน'], ['LINK', 'เชนลิงก์'], ['AVAX', 'อวาแลนช์'], ['DOT', 'โพลคาดอต'], ['LTC', 'ไลต์คอยน์']];
  const KEY = 'valuegrab-spotset-v1';
  const pair = (a) => (a === 'GOLD' ? 'PAXGUSDT' : a + 'USDT');
  const isGold = (a) => a === 'GOLD';
  const unit = (a) => (isGold(a) ? 'ออนซ์' : 'เหรียญ');
  const G = { buy: ['buy', 'ราคาดี ทยอยซื้อได้'], knife: ['watch', 'ถูกแต่ยังร่วง แบ่งซื้อทีละน้อย'], dca: ['', 'ราคาปกติ ซื้อสะสมตามแผน'], wait: ['watch', 'แพงขึ้นมาแล้ว ซื้อน้อยลง รอย่อ'], hot: ['trap', 'ร้อนแรง ไม่ควรซื้อเพิ่ม'] };
  const H = { good: ['buy', 'ควรถือรอ'], ok: ['', 'ถือได้ ยังไม่ชัด'], weak: ['trap', 'ไม่ควรถือรอ'] };
  let set = { week: 1000 }; try { set = { ...set, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch (e) { /* defaults */ }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch (e) { /* ignore */ } };

  const bars = {}, live = {}, tt = {}; let ws = null, on = false, lastTick = 0, lastPoll = 0, err = '', loaded = false;
  const fx = () => (window.VG && window.VG.fx) || 33;
  const thb = (v) => (v == null || !isFinite(v) ? '–' : '฿' + v.toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 4 : v < 100 ? 2 : 0 }));
  const usd = (v, d) => (v == null || !isFinite(v) ? '–' : '$' + v.toLocaleString('en-US', d != null ? { minimumFractionDigits: d, maximumFractionDigits: d } : { maximumFractionDigits: v < 1 ? 5 : v < 100 ? 3 : 0 }));
  const money = (a, v) => (isGold(a) ? usd(v, 2) : thb(v == null ? null : v * fx()));
  const pct = (v, d = 0) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
  const day = (t) => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  const get = (u) => fetch(API + u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const kl = (a) => ({ t: a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4], v: +a[5] });
  const chart = (a) => 'https://www.tradingview.com/chart/?interval=1D&symbol=' + encodeURIComponent(isGold(a) ? 'OANDA:XAUUSD' : 'BINANCE:' + pair(a));
  const nameOf = (a) => { const x = [...ASSETS, ...NAMES].find((y) => y[0] === a); return x ? (isGold(a) ? x[1] : `${a} · ${x[1]}`) : a; };

  /* ---------- data ---------- */
  const loadBars = async (a) => { const k = (await get(`klines?symbol=${pair(a)}&interval=1d&limit=1000`)).map(kl); const f = k.pop(); bars[a] = k; live[a] = f ? f.c : k[k.length - 1].c; tt[a] = SPC.timingTest(k, isGold(a)); };
  const loadAll = async () => { for (let i = 0; i < ASSETS.length; i += 5) await Promise.all(ASSETS.slice(i, i + 5).map(([a]) => loadBars(a).catch(() => {}))); loaded = true; };
  const start = async () => {
    on = true; err = '';
    try {
      await loadAll(); draw(); drawTest();
      if (!Object.keys(bars).length) throw new Error('no data');
      if (!on) return;
      ws = new WebSocket(WS + ASSETS.map(([a]) => pair(a).toLowerCase() + '@kline_1d').join('/'));
      ws.onmessage = (m) => {
        let d; try { d = JSON.parse(m.data).data; } catch (e) { return; }
        if (!d || !d.k) return; const a = d.s === 'PAXGUSDT' ? 'GOLD' : d.s.replace(/USDT$/, ''); const k = d.k; live[a] = +k.c; lastTick = Date.now();
        if (k.x && bars[a]) { const b = bars[a]; if (k.t > b[b.length - 1].t) { b.push(kl([k.t, k.o, k.h, k.l, k.c, k.v])); b.shift(); tt[a] = SPC.timingTest(b, isGold(a)); drawTest(); } }
        later();
      };
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
      const b = bars.GOLD; if (b && Date.now() - b[b.length - 1].t > 2 * 86400e3 + 60e3) await loadAll();
      draw();
    } catch (e) { /* next round */ }
    polling = false;
  };
  let tm = null; const later = () => { if (!tm) tm = setTimeout(() => { tm = null; draw(); }, 1500); };

  /* ---------- view ---------- */
  const stat = (a) => SPC.status(bars[a], live[a], isGold(a), null);
  const amountFor = (s) => Math.round(set.week * SPC.W[s.g] / 10) * 10;
  const timingWhy = (a, s) => {
    const mm = `ราคาอยู่ ${s.mm.toFixed(2)} เท่าของเส้นเฉลี่ย 200 วัน`;
    return { buy: s.mm <= 1 ? `${mm} (ต่ำกว่าค่าเฉลี่ยระยะยาว) และเริ่มยืนเหนือเส้น 20 วันได้` : `ขาขึ้นใหญ่ ราคาย่อมาแถวเส้น 50 วัน RSI ${Math.round(s.rsi)} เป็นจังหวะย่อที่ดีในขาขึ้น`,
      knife: `${mm} ถูกกว่าค่าเฉลี่ยระยะยาว แต่ราคายังร่วงอยู่ ซื้อทีละน้อยแล้วซื้อเพิ่มเมื่อหยุดลง`,
      dca: `${mm} อยู่ในช่วงปกติ ไม่ถูกไม่แพง ซื้อสะสมตามงบปกติได้`,
      wait: `${mm} แพงขึ้นมากกว่าปกติ หรือ RSI ${Math.round(s.rsi)} สูง ซื้อน้อยลงแล้วรอให้ย่อ`,
      hot: `${mm} หรือ RSI ${Math.round(s.rsi)} สูงมาก ราคาวิ่งเร็วเกินไป ไม่ควรซื้อเพิ่ม ถ้ามีกำไรเยอะพิจารณาแบ่งขายบางส่วน` }[s.g];
  };
  const holdWhy = (a, s) => {
    const y = s.ret1y != null ? `ปีที่ผ่านมา ${pct(s.ret1y)}` : '';
    const rel = !isGold(a) && a !== 'BTC' && s.rel != null ? ` (เทียบ BTC ${pct(s.rel)})` : '';
    return { good: `ราคาอยู่เหนือเส้น 200 วัน และเส้นยังชี้ขึ้น เทรนด์ระยะยาวเป็นขาขึ้น ${y}${rel}`,
      ok: `เทรนด์ระยะยาวยังไม่ชัด ${y}${rel}`,
      weak: `ราคาต่ำกว่าเส้น 200 วัน และเส้นชี้ลง เทรนด์ระยะยาวเป็นขาลง ${y}${rel}` }[s.h];
  };
  const card = (a, s, i) => {
    const c = el('div', 'panel sw-card');
    const h = el('div', 'sw-h'); h.append(el('b', 'sw-sym', nameOf(a)), el('span', 'tag ' + G[s.g][0], G[s.g][1]), el('span', 'tag ' + H[s.h][0], H[s.h][1]));
    const px = el('div', 'sw-px'); px.append(el('b', null, money(a, s.px)), el('small', null, isGold(a) ? `USD ต่อออนซ์ · ≈ ${thb(s.px * fx())}` : usd(s.px)));
    const amt = amountFor(s);
    const meta = el('small', 'pf-hint sw-meta', `ราคา ÷ เส้น 200 วัน ${s.mm.toFixed(2)} · RSI ${Math.round(s.rsi)} · ต่ำกว่าจุดสูงสุด ${Math.round(s.dd * 100)}%${s.ret1y != null ? ' · 1 ปี ' + pct(s.ret1y) : ''}${s.better ? ' · ราคาที่น่ารอ ≈ ' + money(a, s.better) : ''}`);
    c.append(h, px, meta, el('p', 'sw-why', 'จังหวะ: ' + timingWhy(a, s)), el('p', 'sw-why', 'ถือยาว: ' + holdWhy(a, s)),
      el('p', 'sw-size', amt ? `ครั้งนี้ซื้อได้ราว ${thb(amt)} (งบปกติ ${thb(set.week)} × ${SPC.W[s.g]})` : 'ครั้งนี้ยังไม่ต้องซื้อ'));
    const t = tt[a]; if (t) c.append(el('p', 'pf-hint', `ตั้งแต่ ${day(t.from)} ถ้าซื้อตามจังหวะนี้ ต้นทุนเฉลี่ย${t.better >= 0 ? 'ถูกกว่า' : 'แพงกว่า'}ซื้อเท่ากันทุกวัน ${Math.abs(t.better * 100).toFixed(1)}%`));
    const act = el('div', 'sw-act');
    const l = el('a', 'btn ghost sm', 'กราฟ'); l.href = chart(a); l.target = '_blank'; l.rel = 'noopener noreferrer';
    const b = el('button', amt ? 'btn-solid sm' : 'btn-line sm', 'จดการซื้อ'); b.type = 'button';
    b.addEventListener('click', () => { if (window.VGTrade) window.VGTrade.prefill({ type: 'buy', s: a, amt: amt || set.week, pxUsd: s.px }); });
    act.append(l, b); c.append(act); return c;
  };
  const draw = () => {
    const box = $('sw-top'); if (!box) return; box.replaceChildren();
    const all = ASSETS.map(([a]) => [a, stat(a)]).filter((x) => x[1]);
    /* gold only: always show its card, whatever the grade */
    if (!all.length) box.append(el('div', 'empty', err || 'กำลังโหลดราคา…'));
    all.forEach(([a, s], i) => box.append(card(a, s, i)));
    $('sw-status').textContent = loaded ? `ทองคำ: ${Date.now() - lastTick < 60000 ? 'ราคาสด' : on && Date.now() - lastPoll < 120000 ? 'ราคาอัปเดตทุก 1 นาที' : on ? 'กำลังเชื่อมต่อ' : 'หยุดอัปเดต (เปิดหน้านี้เพื่อดูสด)'} · ราคาเป็น USD ต่อออนซ์ (จาก PAXG) ราคาในแอปจะต่างเล็กน้อย` : err || 'กำลังโหลด…';
    document.dispatchEvent(new Event('vg:spot'));
  };
  const drawTest = () => {
    const box = $('sw-log'); if (!box) return; box.replaceChildren();
    if (!Object.keys(tt).length) { box.append(el('div', 'empty', 'จะคำนวณเมื่อเปิดหน้า "ซื้อสะสมทอง" และโหลดราคาได้')); return; }
    const tb = el('table', 'tr-table'); const hd = el('tr');
    ['ตัว', 'ซื้อเท่ากันทุกวัน', 'ซื้อตามจังหวะ', 'ต้นทุนถูกกว่า', 'ถือเฉยๆ ได้', 'ตั้งแต่'].forEach((x) => hd.append(el('th', null, x)));
    const th = el('thead'); th.append(hd); tb.append(th); const bd = el('tbody');
    ASSETS.forEach(([a]) => { const t = tt[a]; if (!t) return; const tr = el('tr'); const td = (v, c) => tr.append(el('td', c || null, v));
      td(nameOf(a)); td(money(a, t.dca)); td(money(a, t.tim)); td(pct(t.better, 1), t.better > 0 ? 'pos' : t.better < 0 ? 'neg' : null); td(pct(t.hold)); td(day(t.from)); bd.append(tr); });
    tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); box.append(w);
  };

  /* ---------- wiring ---------- */
  const visible = () => { const v = $('view-scan'); return v && !v.hidden && document.body.dataset.tab === 'invest' && ['swing', 'tport', 'swlog'].some((k) => { const s = $(k); return s && !s.classList.contains('sub-off'); }) && document.visibilityState === 'visible'; };
  const setup = () => {
    const w = $('sw-week'); if (!w) return; w.value = set.week;
    w.addEventListener('change', () => { const v = +w.value; if (v >= 0) { set.week = v; keep(); draw(); } else w.value = set.week; });
    document.addEventListener('vg:ready', draw);
    setInterval(() => { const v = visible(); if (v && !on) start(); else if (!v && on) stop(); if (v) poll(); }, 2000);
    draw(); drawTest();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.VGSpot = {
    assets: ASSETS, unit, nameOf, isGold, G, H,
    usd: (a) => live[a] ?? null,
    price: (a) => (live[a] == null ? null : live[a] * fx()), /* baht per coin or per ounce */
    status: (a) => stat(a), fx,
  };
})();
