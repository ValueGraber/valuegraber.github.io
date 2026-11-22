/* invest → ออปชั่น: options scanner + trade planner (window.VGOpt).
   Reads docs/options.json written by options_scan.py (20 liquid names with a strike ladder + the rest of the S&P 500 once a day).
   Checklist per stock = the 4 entry steps: trend + position vs support/resistance, IV (IV Rank once 20 days of history exist,
   else IV ÷ HV20), liquidity (ATM bid-ask spread, open interest), earnings before expiry. Planner = long call/put sized by
   1–2% risk with a −50% premium stop, target at resistance/support, time stop at 21 days left. Black-Scholes as in the scanner. */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const fx = () => (window.VG && window.VG.fx) || 33;
  const usd = (v, d = 2) => (v == null || !isFinite(v) ? '–' : '$' + (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const thb = (v) => (v == null || !isFinite(v) ? '–' : '฿' + Math.round(v).toLocaleString('en-US'));
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + (+v).toFixed(d) + '%');
  const dth = (s) => { if (!s) return '–'; const d = new Date(s + 'T12:00:00Z'); return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }); };

  /* ---------- Black-Scholes ---------- */
  const N = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
  const bs = (S, K, T, sig, call, r = 0.04) => {
    if (T <= 0 || sig <= 0) return Math.max(0, call ? S - K : K - S);
    const sq = sig * Math.sqrt(T); const d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / sq; const d2 = d1 - sq;
    return call ? S * N(d1) - K * Math.exp(-r * T) * N(d2) : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
  };
  const delta = (S, K, T, sig, call, r = 0.04) => { if (T <= 0) return call ? +(S > K) : -(S < K); const d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / (sig * Math.sqrt(T)); return call ? N(d1) : N(d1) - 1; };

  /* ---------- state ---------- */
  let D = null, loadedAt = 0, err = '', mode = 'mine', plan = { s: null, dir: null };
  const P = () => ({ cap: 100000, risk: 1.5, ...(window.VGPrefs ? window.VGPrefs.get('opt', {}) || {} : {}) });
  const setP = (k, v) => { if (!window.VGPrefs) return; const p = P(); p[k] = v; window.VGPrefs.set('opt', p); };
  const extras = () => (P().w || []).filter((s) => typeof s === 'string');
  const rowOf = (s) => (D ? D.rows.find((r) => r.s === s) : null);
  const earnOf = (s) => (window.VG && window.VG.raw && window.VG.raw[s] ? window.VG.raw[s].earningsDate : null);

  /* ---------- the checklist ---------- */
  const judge = (r) => {
    const j = { trend: 'side', pos: 'mid', iv: null, liq: 'na', setup: 'none', why: [] };
    if (r.px == null) return j;
    if (r.ma50 != null) {
      if (r.px > r.ma50 && (r.ma200 == null || r.ma50 > r.ma200)) j.trend = 'up';
      else if (r.px < r.ma50 && (r.ma200 == null || r.ma50 < r.ma200)) j.trend = 'down';
    }
    const atr = r.atr || r.px * 0.02;
    if (r.bo === 1) j.pos = 'breakout'; else if (r.bo === -1) j.pos = 'breakdown';
    else if (r.sup != null && r.px - r.sup <= atr) j.pos = 'sup'; else if (r.res != null && r.res - r.px <= atr) j.pos = 'res';
    if (r.iv != null) {
      if (r.ivr != null) j.iv = r.ivr < 30 ? 'cheap' : r.ivr > 60 ? 'rich' : 'fair';
      else if (r.hv) { const q = r.iv / r.hv; j.iv = q <= 1.0 ? 'cheap' : q >= 1.35 ? 'rich' : 'fair'; }
    }
    if (r.spr != null) j.liq = r.spr <= 5 && (r.oiAtm || 0) >= 500 ? 'good' : r.spr <= 12 ? 'ok' : 'bad';
    else if (r.oi != null) j.liq = r.oi >= 20000 ? 'ok' : 'bad';
    const e = earnOf(r.s); j.earn = !!(e && r.exp && e >= (D && D.asOf || '') && e <= r.exp); j.earnDate = e;
    const bull = j.trend === 'up' && (j.pos === 'sup' || j.pos === 'breakout');
    const bear = j.trend === 'down' && (j.pos === 'res' || j.pos === 'breakdown');
    if (bull) j.setup = j.iv === 'rich' ? 'bullput' : 'call';
    else if (bear) j.setup = j.iv === 'rich' ? 'bearcall' : 'put';
    else j.why.push(j.trend === 'side' ? 'แนวโน้มยังไม่ชัด' : j.trend === 'up' ? 'ขาขึ้น รอย่อถึงแนวรับ' : 'ขาลง รอเด้งชนแนวต้าน');
    if (j.liq === 'bad') j.why.push('สภาพคล่องต่ำ');
    if (r.iv == null) j.why.push('ยังไม่มีข้อมูลออปชั่น');
    return j;
  };
  const SETUP = {
    call: ['buy', 'เข้าทางซื้อ Call'], put: ['buy', 'เข้าทางซื้อ Put'],
    bullput: ['watch', 'ขาขึ้นแต่ IV แพง: Bull put spread'], bearcall: ['watch', 'ขาลงแต่ IV แพง: Bear call spread'], none: ['skip', 'รอจังหวะ'],
  };
  const TREND = { up: ['pos', 'ขาขึ้น'], down: ['neg', 'ขาลง'], side: ['', 'ไม่ชัด'] };
  const POS = { sup: 'ใกล้แนวรับ', res: 'ใกล้แนวต้าน', breakout: 'ทะลุแนวต้าน', breakdown: 'หลุดแนวรับ', mid: 'กลางกรอบ' };
  const IVT = { cheap: ['pos', 'ถูก'], fair: ['', 'ปกติ'], rich: ['neg', 'แพง'] };
  const LIQ = { good: ['pos', 'ดี'], ok: ['', 'พอใช้'], bad: ['neg', 'ต่ำ'], na: ['', '–'] };
  const score = (r, j) => (j.setup === 'call' || j.setup === 'put' ? 30 : j.setup === 'none' ? 0 : 20) + (j.liq === 'good' ? 10 : j.liq === 'ok' ? 5 : -40) - (j.earn ? 8 : 0) + (r.base ? 3 : 0);

  /* ---------- load ---------- */
  const load = (force) => {
    if (!force && D && Date.now() - loadedAt < 10 * 60e3) return;
    loadedAt = Date.now();
    fetch('options.json?t=' + Math.floor(Date.now() / 60e3), { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((j) => { D = j; err = ''; draw(); }).catch(() => { err = 'ยังไม่มีข้อมูลออปชั่น ระบบจะสร้างให้ในรอบอัปเดตถัดไป'; draw(); });
  };

  /* ---------- scanner ---------- */
  const drawHead = () => {
    const st = $('op-strip'); if (!st) return; st.replaceChildren();
    const cell = (k, v, h, c) => { const d = el('div'); d.append(el('div', 'k', k), el('div', 'v' + (c ? ' ' + c : ''), v), el('div', 'h', h || '')); st.append(d); };
    const vx = D && D.vix;
    const vxL = !vx ? '' : vx.v >= 30 ? 'กลัวมาก' : vx.v >= 22 ? 'กังวล' : vx.v >= 15 ? 'ปกติ' : 'สงบ';
    cell('VIX ความกลัวของตลาด', vx ? vx.v.toFixed(1) : '–', vx ? `${vxL} · ${vx.chg > 0 ? '+' : ''}${vx.chg} จากวันก่อน` : '', vx && vx.v >= 22 ? 'neg' : '');
    const mine = D ? rowsFor('mine') : [];
    const n = mine.filter((r) => ['call', 'put'].includes(judge(r).setup)).length;
    cell('เข้าเงื่อนไขซื้อ (รายการของฉัน)', D ? `${n} ตัว` : '–', D ? `จาก ${mine.length} ตัว` : '');
    cell('ข้อมูล ณ', D ? dth(D.asOf) : '–', D ? (D.live ? 'ระหว่างวัน (ตลาดเปิดอยู่)' : 'ราคาปิด') : '');
    cell('เงินบาทต่อ USD', fx().toFixed(2), 'ใช้แปลงค่าสัญญาเป็นบาท');
    const al = $('op-alert');
    if (al) {
      al.hidden = !(vx && vx.v >= 22);
      if (!al.hidden) al.innerHTML = `<b>ตอนนี้ตลาดกลัว (VIX ${vx.v.toFixed(1)})</b> ออปชั่นแทบทุกตัวแพงกว่าปกติ ซื้อ Call/Put ตอนนี้ต้องให้ราคาวิ่งไกลกว่าปกติถึงจะคุ้ม และถ้าตลาดสงบลง IV จะร่วงทำให้ขาดทุนได้แม้เดาทิศถูก ช่วงนี้ไม้เล็กลง หรือใช้ spread ที่จำกัดความเสี่ยง`;
    }
  };
  const rowsFor = (m) => {
    if (!D) return [];
    if (m === 'mine') { const w = new Set([...(D.base || []), ...extras()]); return D.rows.filter((r) => w.has(r.s)); }
    return D.rows.map((r) => [r, judge(r)]).filter(([, j]) => j.setup !== 'none' && j.liq !== 'bad').sort((a, b) => score(b[0], b[1]) - score(a[0], a[1])).slice(0, 40).map(([r]) => r);
  };
  const drawExtras = () => {
    const box = $('op-extras'); if (!box) return; box.replaceChildren();
    extras().forEach((s) => { const b = el('button', 'chip', s + ' ×'); b.type = 'button'; b.title = 'เอาออกจากรายการ'; b.addEventListener('click', () => { setP('w', extras().filter((x) => x !== s)); draw(); }); box.append(b); });
  };
  const addExtra = () => {
    const i = $('op-add'); const s = (i.value || '').trim().toUpperCase().replace('-', '.'); const msg = $('op-msg');
    if (!s) return;
    if (!D) { msg.textContent = 'รอโหลดข้อมูลก่อน'; return; }
    if (!rowOf(s)) { msg.textContent = `ไม่พบ ${s} (ใส่ได้เฉพาะหุ้นใน S&P 500)`; return; }
    if ((D.base || []).includes(s) || extras().includes(s)) { msg.textContent = `${s} อยู่ในรายการแล้ว`; return; }
    setP('w', [...extras(), s]); i.value = ''; msg.textContent = `เพิ่ม ${s} แล้ว`; mode = 'mine'; draw();
  };
  const drawTable = () => {
    const box = $('op-table'); if (!box) return; box.replaceChildren();
    if (!D) { box.append(el('div', 'empty', err || 'กำลังโหลด…')); return; }
    const rows = rowsFor(mode);
    if (!rows.length) { box.append(el('div', 'empty', mode === 'mine' ? 'ยังไม่มีหุ้นในรายการ' : 'ตอนนี้ไม่มีหุ้นที่เข้าเงื่อนไข')); return; }
    const tb = el('table', 'tbl op-tbl'); const hr = el('tr');
    ['หุ้น', 'ราคา', 'แนวโน้ม', 'รับ / ต้าน', 'IV', 'สภาพคล่อง', 'แนวทาง', ''].forEach((h, k) => hr.append(el('th', k === 0 || k === 6 ? 'l' : null, h)));
    const th = el('thead'); th.append(hr); tb.append(th); const bd = el('tbody');
    rows.forEach((r) => {
      const j = judge(r); const tr = el('tr'); const td = (c) => { const x = el('td', c || null); tr.append(x); return x; };
      const a = td('l'); const sym = el('span', 'sym', r.s); if (window.VG && window.VG.raw && window.VG.raw[r.s]) { sym.title = 'ดูรายละเอียดหุ้น'; sym.addEventListener('click', () => document.dispatchEvent(new CustomEvent('vg:open', { detail: r.s }))); } else sym.style.cursor = 'default'; a.append(sym);
      if (r.t && D.asOf && r.t < D.asOf) a.append(el('small', 'sub', 'ข้อมูล ' + dth(r.t)));
      const p = td(); p.append(document.createTextNode(usd(r.px))); p.append(el('small', 'sub ' + (r.chg >= 0 ? 'pos' : 'neg'), pct(r.chg)));
      const tn = td(TREND[j.trend][0]); tn.append(document.createTextNode(TREND[j.trend][1])); tn.append(el('small', 'sub', POS[j.pos]));
      const sr = td(); sr.append(document.createTextNode(usd(r.sup, 0))); sr.append(el('small', 'sub', usd(r.res, 0)));
      const iv = td(j.iv ? IVT[j.iv][0] : null); iv.append(document.createTextNode(r.iv != null ? `${r.iv.toFixed(0)}% ${j.iv ? IVT[j.iv][1] : ''}` : '–'));
      iv.append(el('small', 'sub', r.ivr != null ? `IV Rank ${r.ivr}` : r.hv && r.iv != null ? `IV/HV ${(r.iv / r.hv).toFixed(2)}` : ''));
      const lq = td(LIQ[j.liq][0]); lq.append(document.createTextNode(LIQ[j.liq][1])); lq.append(el('small', 'sub', r.spr != null ? `ต่าง ${r.spr}%` : r.q === 'last' ? 'ไม่มี bid/ask' : ''));
      const g = td('l'); g.append(el('span', 'tag ' + SETUP[j.setup][0], SETUP[j.setup][1]));
      if (j.earn) g.append(el('small', 'sub neg', `ประกาศงบ ${dth(j.earnDate)} ก่อนหมดอายุ`)); else if (j.why[0] && j.setup === 'none') g.append(el('small', 'sub', j.why[0]));
      const b = el('button', 'btn-line op-go', 'วางแผน'); b.type = 'button'; b.disabled = r.iv == null;
      b.addEventListener('click', () => { plan = { s: r.s, dir: j.setup === 'put' || j.setup === 'bearcall' || (j.setup === 'none' && j.trend === 'down') ? 'put' : 'call' }; if (window.VGNav) window.VGNav.go('invest', 'opt'); openPlan(); });
      td().append(b);
      bd.append(tr);
    });
    tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); box.append(w);
  };

  /* ---------- planner ---------- */
  const openPlan = () => {
    const h = [...document.querySelectorAll('.acc-h')].find((x) => /วางแผนเทรด/.test(x.textContent));
    if (h && h.getAttribute('aria-expanded') === 'false') h.click();
    drawPlan(); const t = $('optplan'); if (t) setTimeout(() => t.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
  };
  const strikes = (r) => {
    if (r.lad && r.lad.length) return r.lad.map((x) => x[0]);
    const inc = r.px < 30 ? 0.5 : r.px < 100 ? 1 : r.px < 250 ? 2.5 : r.px < 600 ? 5 : 10; const out = [];
    for (let k = Math.round(r.px * 0.8 / inc) * inc; k <= r.px * 1.2; k += inc) out.push(+k.toFixed(2));
    return out;
  };
  const quote = (r, K, call, T, sig) => {
    const row = r.lad && r.lad.find((x) => x[0] === K);
    if (row) {
      const [b, a, l] = call ? row.slice(1, 4) : row.slice(5, 8);
      if (b > 0 && a >= b) return { px: (a + b) / 2, src: `ราคากลาง bid ${usd(b)} / ask ${usd(a)}`, bid: b, ask: a, oi: call ? row[4] : row[8] };
      if (l > 0) return { px: l, src: 'ราคาซื้อขายล่าสุด (ตอนตลาดปิดไม่มี bid/ask)', oi: call ? row[4] : row[8] };
    }
    return { px: bs(r.px, K, T, sig, call, D.r), src: 'ประมาณจาก IV (ไม่มีราคาจริงของ strike นี้)', est: true };
  };
  const drawPlan = () => {
    const sel = $('op-sym'), out = $('op-out'); if (!sel || !out) return;
    const p = P(); $('op-cap').value = p.cap; $('op-risk').value = p.risk;
    const list = D ? D.rows.filter((r) => r.iv != null && ((D.base || []).includes(r.s) || extras().includes(r.s) || r.s === plan.s)) : [];
    sel.replaceChildren(...list.map((r) => { const o = el('option', null, r.s); o.value = r.s; return o; }));
    out.replaceChildren();
    if (!list.length) { out.append(el('div', 'empty', D ? 'ยังไม่มีหุ้นที่มีข้อมูลออปชั่น' : err || 'กำลังโหลด…')); return; }
    if (!plan.s || !list.some((r) => r.s === plan.s)) plan.s = list[0].s;
    sel.value = plan.s;
    const r = rowOf(plan.s); const j = judge(r);
    if (!plan.dir) plan.dir = j.trend === 'down' ? 'put' : 'call';
    document.querySelectorAll('#op-dir button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.d === plan.dir)));
    const call = plan.dir === 'call', sig = r.iv / 100, T = Math.max(r.dte, 1) / 365;

    /* strike with |delta| nearest 0.6 (a little in the money) */
    let K = r.k, best = 9;
    strikes(r).forEach((k) => { const d = Math.abs(Math.abs(delta(r.px, k, T, sig, call, D.r)) - 0.6); if (d < best) { best = d; K = k; } });
    const q = quote(r, K, call, T, sig); const prem = q.px;
    const dl = delta(r.px, K, T, sig, call, D.r);

    /* target and stop on the stock, value of the option there after about a third of the time */
    const em = r.em || r.px * sig * Math.sqrt(T);
    let tgt = call ? r.res : r.sup;
    if (call ? !(tgt > r.px * 1.01) : !(tgt < r.px * 0.99)) tgt = call ? r.px + em * 0.6 : r.px - em * 0.6;
    const stopS = call ? Math.min(r.sup, r.px - (r.atr || 0)) : Math.max(r.res, r.px + (r.atr || 0));
    const t1 = Math.max(T - Math.min(T / 3, 14 / 365), 1 / 365);
    const atT = bs(tgt, K, t1, sig, call, D.r);
    const stopO = prem * 0.5;
    const rr = (atT - prem) / (prem - stopO);
    const be = call ? K + prem : K - prem;
    const timeStop = (() => { const d = new Date(r.exp + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 21); return d.toISOString().slice(0, 10); })();
    const budget = p.cap * p.risk / 100; const lossPer = (prem - stopO) * 100 * fx(); const n = Math.floor(budget / lossPer);

    const head = el('div', 'op-head');
    head.append(el('b', null, `${call ? 'ซื้อ Call' : 'ซื้อ Put'} ${r.s} strike ${usd(K, K % 1 ? 2 : 0)} หมดอายุ ${dth(r.exp)} (อีก ${r.dte} วัน)`),
      el('span', 'pf-hint', `ราคาหุ้น ${usd(r.px)} · Delta ${dl.toFixed(2)} · IV ${r.iv.toFixed(0)}% · คาดว่าแกว่ง ±${usd(em)} ถึงวันหมดอายุ`));
    out.append(head);

    const grid = el('div', 'op-grid');
    const box = (title, cls, lines) => { const b = el('div', 'op-box ' + (cls || '')); b.append(el('h4', null, title)); lines.forEach(([k, v, s]) => { const row = el('div', 'op-row'); row.append(el('span', null, k), el('b', null, v)); b.append(row); if (s) b.append(el('small', 'pf-hint', s)); }); grid.append(b); };
    box('จุดเข้า', '', [
      ['ค่าพรีเมียม', usd(prem), q.src],
      ['ต่อ 1 สัญญา (100 หุ้น)', `${usd(prem * 100, 0)} ≈ ${thb(prem * 100 * fx())}`],
      ['จุดคุ้มทุน ณ วันหมดอายุ', usd(be), `หุ้นต้อง${call ? 'ขึ้น' : 'ลง'}เกิน ${pct((be / r.px - 1) * 100)}`],
    ]);
    box('ทำกำไร', 'good', [
      ['เป้าราคาหุ้น', usd(tgt), call ? (tgt === r.res ? 'แนวต้าน 20 วัน' : 'ราว 0.6 เท่าของช่วงแกว่งที่คาด') : (tgt === r.sup ? 'แนวรับ 20 วัน' : 'ราว 0.6 เท่าของช่วงแกว่งที่คาด')],
      ['ออปชั่นน่าจะมีค่าราว', `${usd(atT)} (${pct((atT / prem - 1) * 100, 0)})`, 'ถ้าถึงเป้าในราว 1/3 ของเวลาที่เหลือ IV เท่าเดิม'],
    ]);
    box('ตัดขาดทุน', 'bad', [
      ['หุ้นปิด' + (call ? 'ต่ำกว่า' : 'สูงกว่า'), usd(stopS), call ? 'แนวรับหลุด เหตุผลที่เข้าไม่จริงแล้ว' : 'แนวต้านแตก เหตุผลที่เข้าไม่จริงแล้ว'],
      ['หรือออปชั่นเหลือ', `${usd(stopO)} (−50%)`, 'อะไรถึงก่อนออกก่อน'],
    ]);
    box('หมดเวลา', '', [['ออกภายในวันที่', dth(timeStop), 'เหลือ 21 วันแล้วหุ้นยังไม่ไปไหน ให้ออก เพราะค่าเวลาจะหายเร็วขึ้นมาก']]);
    out.append(grid);

    const sz = el('div', 'op-size');
    sz.append(el('h4', null, 'ขนาดไม้'));
    sz.append(el('p', null, n >= 1
      ? `เสี่ยงได้ ${p.risk}% ของ ${thb(p.cap)} = ${thb(budget)} · ถ้าโดนตัดขาดทุนเสียสัญญาละราว ${thb(lossPer)} → ซื้อได้ไม่เกิน ${n} สัญญา (ใช้เงิน ${thb(n * prem * 100 * fx())})`
      : `งบเสี่ยง ${thb(budget)} ไม่พอแม้ 1 สัญญา (เสียได้ถึง ${thb(lossPer)} ต่อสัญญา) ข้ามตัวนี้ หรือเลือกหุ้นที่ราคาต่ำกว่า`));
    sz.append(el('p', null, `กำไรต่อความเสี่ยง ≈ 1 : ${isFinite(rr) ? rr.toFixed(1) : '–'} ${rr >= 2 ? '(ผ่านขั้นต่ำ 1:2)' : '(ต่ำกว่า 1:2 ไม่คุ้มเสี่ยง)'}`));
    out.append(sz);

    const ck = el('ul', 'op-chk');
    const item = (ok, t) => { const li = el('li', ok === true ? 'pos' : ok === false ? 'neg' : null); li.textContent = (ok === true ? '✓ ' : ok === false ? '✗ ' : '• ') + t; ck.append(li); };
    const dirOk = call ? j.trend === 'up' : j.trend === 'down';
    const posOk = call ? ['sup', 'breakout'].includes(j.pos) : ['res', 'breakdown'].includes(j.pos);
    item(dirOk, `แนวโน้ม: ${TREND[j.trend][1]}${dirOk ? '' : ` ไม่ตรงกับการซื้อ ${call ? 'Call' : 'Put'}`}`);
    item(posOk, `จุดเข้า: ${POS[j.pos]}${posOk ? '' : ' ยังไม่ใช่จุดเข้าที่ดี'}`);
    item(j.iv === 'rich' ? false : j.iv ? true : null, `IV ${j.iv ? IVT[j.iv][1] : 'ไม่ทราบ'}${j.iv === 'rich' ? ' ซื้อแล้วเสียเปรียบ ลองใช้ spread หรือรอ' : ''}${r.ivr == null ? ` (เทียบ HV เพราะเก็บประวัติ IV ได้ ${r.n || 0}/20 วัน)` : ''}`);
    item(j.liq === 'bad' ? false : j.liq === 'na' ? null : true, `สภาพคล่อง: ${LIQ[j.liq][1]}${r.spr != null ? ` ส่วนต่าง ${r.spr}%` : ''}${q.oi != null ? ` · OI strike นี้ ${q.oi.toLocaleString()}` : ''}`);
    if (j.earnDate) item(!j.earn, j.earn ? `ประกาศงบ ${dth(j.earnDate)} ก่อนหมดอายุ ระวัง IV ร่วงหลังข่าว` : `ประกาศงบครั้งถัดไป ${dth(j.earnDate)} หลังหมดอายุ`);
    item(rr >= 2, `กำไรต่อความเสี่ยง 1:${isFinite(rr) ? rr.toFixed(1) : '–'}`);
    out.append(el('h4', 'op-ckh', 'เช็กลิสต์ก่อนกดเข้า'), ck);
    if (q.est) out.append(el('p', 'pf-hint', 'ราคาพรีเมียมเป็นค่าประมาณ ดูราคาจริงในแอปโบรกเกอร์ก่อนเข้าเสมอ'));
  };

  /* ---------- wiring ---------- */
  const draw = () => { drawHead(); drawExtras(); drawTable(); drawPlan(); document.querySelectorAll('#op-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === mode))); };
  const visible = () => { const v = $('view-scan'); return v && !v.hidden && document.body.dataset.tab === 'invest' && ['opt', 'optplan', 'optlearn'].some((k) => { const s = $(k); return s && !s.classList.contains('sub-off'); }) && document.visibilityState === 'visible'; };
  const setup = () => {
    if (!$('opt')) return;
    document.querySelectorAll('#op-mode button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
    document.querySelectorAll('#op-dir button').forEach((b) => b.addEventListener('click', () => { plan.dir = b.dataset.d; drawPlan(); }));
    $('op-sym').addEventListener('change', (e) => { plan.s = e.target.value; plan.dir = null; drawPlan(); });
    $('op-cap').addEventListener('change', (e) => { const v = +e.target.value; if (v > 0) { setP('cap', v); drawPlan(); } });
    $('op-risk').addEventListener('change', (e) => { const v = +e.target.value; if (v > 0 && v <= 10) { setP('risk', v); drawPlan(); } else e.target.value = P().risk; });
    $('op-addb').addEventListener('click', addExtra);
    $('op-add').addEventListener('keydown', (e) => { if (e.key === 'Enter') addExtra(); });
    document.addEventListener('vg:ready', () => { if (D) draw(); });
    document.addEventListener('vg:prefs', () => { if (D) draw(); });
    setInterval(() => { if (visible()) load(); }, 3000);
    if (visible()) load();
    draw();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.VGOpt = { bs, delta, judge, load: () => load(true), data: () => D };
})();
