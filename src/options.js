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
  let D = null, loadedAt = 0, err = '', mode = 'mine', plan = { s: null, dir: null, kind: null };
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
  /* ---------- debit spread: buy K1, sell K2 further out; pay the net debit, that is the most you can lose ---------- */
  const SFEE = 1.3; /* 2 legs × $0.65, each way */
  const legQ = (r, K, call, T, sig) => { const q = quote(r, K, call, T, sig); return { mid: q.px, ask: q.ask > 0 ? q.ask : q.px, bid: q.bid > 0 ? q.bid : q.px, est: !!q.est, oi: q.oi }; };
  /* realistic limit fill for a spread order: mid plus a quarter of the legs' bid-ask gaps (not the full ask-bid, which is what a market order pays) */
  const fillOf = (l, sh) => l.mid - sh.mid + 0.25 * ((l.ask - l.bid) + (sh.ask - sh.bid));
  const spreadVal = (S, K1, K2, t, sig, call) => bs(S, K1, t, sig, call, D.r) - bs(S, K2, t, sig, call, D.r);
  const pickSpread = (r, call, budget, tgt, t1, em, T, sig) => {
    const ks = strikes(r).filter((k) => (call ? k >= r.px * 0.95 && k <= r.px * 1.2 : k <= r.px * 1.05 && k >= r.px * 0.8)).sort((a, b) => (call ? a - b : b - a));
    let best = null, cheapest = null;
    ks.forEach((K1, i) => {
      for (let st = 1; st <= 5 && i + st < ks.length; st++) {
        const K2 = ks[i + st], W = Math.abs(K2 - K1);
        const l = legQ(r, K1, call, T, sig), sh = legQ(r, K2, call, T, sig);
        const debit = fillOf(l, sh), mid = l.mid - sh.mid;
        if (!(debit > 0.02) || debit >= W * 0.95) continue;
        const cost = debit * 100 + SFEE;
        const be = call ? K1 + debit + 2 * SFEE / 100 : K1 - debit - 2 * SFEE / 100; /* incl. commission both ways */
        if (call ? !(tgt > be) : !(tgt < be)) continue;
        if (!cheapest || cost < cheapest.cost) cheapest = { cost, K1, K2 };
        if (cost > budget) continue;
        const atT = spreadVal(tgt, K1, K2, t1, sig, call);
        const ret = ((atT - debit) * 100 - 2 * SFEE) / cost;
        const sc = ret - (Math.abs(be - r.px) > em * 0.6 ? 5 : 0);
        if (!best || sc > best.sc) best = { sc, K1, K2, W, debit, mid, l, sh, be, atT, cost, est: l.est || sh.est };
      }
    });
    return { best, cheapest };
  };
  /* the same plan for a row: target, stop and time on the stock */
  const baseOf = (r, call) => {
    const sig = r.iv / 100, T = Math.max(r.dte, 1) / 365, em = r.em || r.px * sig * Math.sqrt(T);
    let tgt = call ? r.res : r.sup; if (call ? !(tgt > r.px * 1.01) : !(tgt < r.px * 0.99)) tgt = call ? r.px + em * 0.6 : r.px - em * 0.6;
    const t1 = Math.max(T - Math.min(T / 3, 14 / 365), 1 / 365);
    return { sig, T, em, tgt, t1 };
  };
  const fitList = (call, budget, skip) => {
    if (!D) return [];
    return D.rows.filter((x) => x.s !== skip && x.iv != null && x.px != null && x.dte && (call ? judge(x).trend === 'up' : judge(x).trend === 'down') && judge(x).liq !== 'bad')
      .map((x) => { const bb = baseOf(x, call); return [x, pickSpread(x, call, budget, bb.tgt, bb.t1, bb.em, bb.T, bb.sig).best]; })
      .filter(([, bb]) => bb && bb.sc > 0).sort((a, b2) => (b2[0].base ? 1 : 0) - (a[0].base ? 1 : 0) || b2[1].sc - a[1].sc).slice(0, 8);
  };
  const drawSpread = ({ r, j, call, sig, T, tgt, stopS, t1, timeStop, em, p, out }) => {
    const budget = (p.sbud || 1000) / fx();
    const { best, cheapest } = pickSpread(r, call, budget, tgt, t1, em, T, sig);
    if (!best) {
      out.append(el('div', 'empty', cheapest ? `งบ ${thb(budget * fx())} ไม่พอสำหรับ spread ของ ${r.s} ที่มีโอกาสถึงจุดคุ้มทุน ชุดที่ถูกที่สุดใช้ราว ${thb(cheapest.cost * fx())}` : `ไม่พบคู่ strike ที่ใช้ได้สำหรับ ${r.s}`));
      const alt = fitList(call, budget, r.s);
      if (alt.length) {
        const w = el('div', 'op-fit'); w.append(el('p', 'pf-hint', `ตัวที่งบนี้ทำ ${call ? 'Bull call' : 'Bear put'} spread ได้ และแนวโน้มไปทางเดียวกัน (กดเพื่อวางแผน):`));
        const c = el('div', 'hchips'); alt.forEach(([x, bb]) => { const btn = el('button', 'chip', `${x.s} ≈ ${thb(bb.cost * fx())}`); btn.type = 'button'; btn.addEventListener('click', () => { plan.s = x.s; drawPlan(); }); c.append(btn); });
        w.append(c); out.append(w);
      } else out.append(el('p', 'pf-hint', 'ตอนนี้ยังไม่มีตัวที่งบนี้พอและแนวโน้มตรง ลองเพิ่มงบ หรือรอให้ VIX ลดลง (ออปชั่นจะถูกลง)'));
      return;
    }
    const b = best; const name = call ? 'Bull call spread' : 'Bear put spread';
    const maxP = (b.W - b.debit) * 100 - 2 * SFEE, maxL = b.debit * 100 + 2 * SFEE;
    const tpV = b.debit + 0.6 * (b.W - b.debit), slV = b.debit * 0.5;
    const n = Math.max(1, Math.floor(budget / b.cost));
    const kS = (k) => usd(k, k % 1 ? 2 : 0);
    const head = el('div', 'op-head');
    head.append(el('b', null, `${name} ${r.s}: ซื้อ ${call ? 'Call' : 'Put'} ${kS(b.K1)} + ขาย ${call ? 'Call' : 'Put'} ${kS(b.K2)} หมดอายุ ${dth(r.exp)} (อีก ${r.dte} วัน)`),
      el('span', 'pf-hint', `ราคาหุ้น ${usd(r.px)} · กว้าง ${usd(b.W)} · IV ${r.iv.toFixed(0)}% · คาดว่าแกว่ง ±${usd(em)} ถึงวันหมดอายุ`));
    out.append(head);
    const grid = el('div', 'op-grid');
    const box = (title, cls, lines) => { const x = el('div', 'op-box ' + (cls || '')); x.append(el('h4', null, title)); lines.forEach(([k, v, sub]) => { const row = el('div', 'op-row'); row.append(el('span', null, k), el('b', null, v)); x.append(row); if (sub) x.append(el('small', 'pf-hint', sub)); }); grid.append(x); };
    box('จุดเข้า', '', [
      ['จ่ายสุทธิ (debit)', usd(b.debit), `ราคากลาง ${usd(b.mid)} บวกเผื่อส่วนต่าง bid-ask เล็กน้อย ตั้ง limit ราวนี้${b.est ? ' · มีขาที่เป็นราคาประมาณ' : ''}`],
      ['ต่อ 1 ชุด', `${usd(b.debit * 100, 0)} ≈ ${thb(b.debit * 100 * fx())}`, `ค่าคอมเข้า ${usd(SFEE)} ออก ${usd(SFEE)}`],
    ]);
    box('ผลที่เป็นไปได้ (ต่อชุด)', '', [
      ['กำไรสูงสุด', thb(maxP * fx()), `หุ้น${call ? 'อยู่เหนือ' : 'อยู่ต่ำกว่า'} ${kS(b.K2)} ตอนหมดอายุ`],
      ['ขาดทุนสูงสุด', thb(maxL * fx()), `หุ้น${call ? 'อยู่ต่ำกว่า' : 'อยู่เหนือ'} ${kS(b.K1)} ตอนหมดอายุ`],
      ['จุดคุ้มทุน', usd(b.be), `หุ้นต้อง${call ? 'ขึ้น' : 'ลง'} ${pct((b.be / r.px - 1) * 100)}`],
    ]);
    box('ทำกำไร', 'good', [
      ['เมื่อ spread มีค่า', `≥ ${usd(tpV)}`, 'ได้ราว 60% ของกำไรสูงสุด ไม่ต้องรอถึงวันหมดอายุ'],
      ['หรือหุ้นถึง', usd(tgt), `ตอนนั้น spread น่าจะมีค่าราว ${usd(b.atT)}`],
    ]);
    box('ตัดขาดทุน / หมดเวลา', 'bad', [
      ['spread เหลือ', `≤ ${usd(slV)}`, 'ครึ่งหนึ่งของที่จ่าย'],
      ['หรือหุ้นปิด' + (call ? 'ต่ำกว่า' : 'สูงกว่า'), usd(stopS)],
      ['ออกภายใน', dth(timeStop), 'เหลือ 21 วัน'],
    ]);
    out.append(grid);

    /* payoff at expiry */
    const pts = [...new Set([stopS, b.K1, b.be, b.K2, tgt].map((x) => +x.toFixed(2)))].sort((x, y) => x - y);
    const pay = (S) => { const v = Math.min(Math.max(call ? S - b.K1 : b.K1 - S, 0), b.W); return (v - b.debit) * 100 - 2 * SFEE; };
    const tb = el('table', 'tbl op-pay'); const hr = el('tr'); ['ราคาหุ้นตอนหมดอายุ', 'กำไร/ขาดทุนต่อชุด', ''].forEach((h, k) => hr.append(el('th', k === 2 ? 'l' : null, h)));
    const th = el('thead'); th.append(hr); tb.append(th); const bd = el('tbody');
    pts.forEach((S) => { const tr = el('tr'); const v = pay(S); tr.append(el('td', null, usd(S)), el('td', v > 0 ? 'pos' : v < 0 ? 'neg' : null, (v >= 0 ? '+' : '−') + thb(Math.abs(v) * fx())),
      el('td', 'l', S === +b.be.toFixed(2) ? 'จุดคุ้มทุน' : S === b.K2 ? 'กำไรสูงสุดตั้งแต่ตรงนี้' : S === b.K1 ? 'ขาดทุนสูงสุดถ้าไม่ถึงตรงนี้' : S === +tgt.toFixed(2) ? 'เป้าราคา' : S === +stopS.toFixed(2) ? 'จุดตัดขาดทุนของหุ้น' : '')); bd.append(tr); });
    tb.append(bd); const pw = el('div', 'op-size'); pw.append(el('h4', null, 'ถ้าถือจนหมดอายุ'), tb); out.append(pw);

    const sz = el('div', 'op-size'); sz.append(el('h4', null, 'ขนาดไม้'));
    sz.append(el('p', null, `งบต่อไม้ ${thb(budget * fx())} → ${n} ชุด ใช้เงิน ${thb(n * b.cost * fx())} (รวมค่าคอมเข้า) · เสียได้มากสุด ${thb(n * maxL * fx())} = ${pct(n * maxL * fx() / p.cap * 100)} ของเงินทุน ${thb(p.cap)}`));
    sz.append(el('p', null, `กำไรต่อความเสี่ยงที่ดีที่สุด ≈ 1 : ${(maxP / maxL).toFixed(1)} · ถ้าออกตอนถึง 60% ≈ 1 : ${(((tpV - b.debit) * 100 - 2 * SFEE) / ((b.debit - slV) * 100 + 2 * SFEE)).toFixed(1)}`));
    out.append(sz);

    const pb = el('div', 'op-paperbar'); const go = el('button', 'btn-solid', 'เทรดจำลองไม้นี้'); go.type = 'button'; const pm = el('span', 'pf-hint', `ใช้เงินจำลอง ${n} ชุด · ระบบจะปิดให้ตามจุดออกด้านบน`);
    go.addEventListener('click', () => { pm.textContent = paperOpen({ kind: 'spread', s: r.s, dir: plan.dir, K: b.K1, k2: b.K2, exp: r.exp, n, entry: b.debit, S0: r.px, tgt, stopS, stopO: slV, tpV, timeStop, iv0: r.iv, est: b.est, fee: SFEE }); drawPaper(); });
    pb.append(go, pm); out.append(pb);

    const ck = el('ul', 'op-chk'); const item = (ok, t) => { const li = el('li', ok === true ? 'pos' : ok === false ? 'neg' : null); li.textContent = (ok === true ? '✓ ' : ok === false ? '✗ ' : '• ') + t; ck.append(li); };
    const dirOk = call ? j.trend === 'up' : j.trend === 'down'; const posOk = call ? ['sup', 'breakout'].includes(j.pos) : ['res', 'breakdown'].includes(j.pos);
    item(dirOk, `แนวโน้ม: ${TREND[j.trend][1]}${dirOk ? '' : ` ไม่ตรงกับ ${name}`}`);
    item(posOk, `จุดเข้า: ${POS[j.pos]}${posOk ? '' : ' ยังไม่ใช่จุดเข้าที่ดี'}`);
    item(true, `IV ${j.iv ? IVT[j.iv][1] : 'ไม่ทราบ'}${j.iv === 'rich' ? ' แต่ spread รับได้ เพราะขาที่ขายช่วยหักลบ' : ''}`);
    item(j.liq === 'bad' ? false : j.liq === 'na' ? null : true, `สภาพคล่อง: ${LIQ[j.liq][1]}${b.est ? ' (บางขาไม่มีราคาจริง ระวังส่วนต่างตอนส่งคำสั่ง)' : ''}`);
    if (j.earnDate) item(!j.earn, j.earn ? `ประกาศงบ ${dth(j.earnDate)} ก่อนหมดอายุ` : `ประกาศงบครั้งถัดไป ${dth(j.earnDate)} หลังหมดอายุ`);
    item(n * maxL * fx() <= p.cap * 0.02 ? true : false, `เสียได้มากสุด ${pct(n * maxL * fx() / p.cap * 100)} ของเงินทุน (ควรไม่เกิน 2%)`);
    out.append(el('h4', 'op-ckh', 'เช็กลิสต์ก่อนกดเข้า'), ck);
    out.append(el('p', 'pf-hint', 'ส่งคำสั่งเป็น spread ชุดเดียว (เลือกแบบ Vertical / Debit spread ในแอปโบรก) ตั้งราคาแบบ limit ใกล้ราคากลาง อย่าซื้อทีละขา'));
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
    if (!plan.kind) plan.kind = p.kind === 'spread' ? 'spread' : 'single';
    document.querySelectorAll('#op-kind button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === plan.kind)));
    $('op-sbud-l').hidden = plan.kind !== 'spread'; $('op-sbud').value = p.sbud || 1000;
    if (plan.kind === 'spread') { drawSpread({ r, j, call, sig, T, tgt, stopS, t1, timeStop, em, p, out }); return; }
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

    /* paper trade this plan: buy at the ask when there is one, else at the estimate */
    const pb = el('div', 'op-paperbar'); const go = el('button', 'btn-solid', 'เทรดจำลองไม้นี้'); go.type = 'button';
    const pm = el('span', 'pf-hint'); const nP = Math.max(1, n);
    pm.textContent = `ใช้เงินจำลอง ${nP} สัญญา${n < 1 ? ' (งบเสี่ยงจริงไม่พอ แต่ฝึกได้)' : ''} · ระบบจะติดตามและปิดให้ตามจุดออกด้านบน`;
    go.addEventListener('click', () => {
      const fill = q.ask > 0 && q.bid > 0 ? prem + 0.25 * (q.ask - q.bid) : prem;
      const res = paperOpen({ s: r.s, dir: plan.dir, K, exp: r.exp, n: nP, entry: fill, S0: r.px, tgt, stopS, stopO: fill * 0.5, timeStop, iv0: r.iv, est: !!q.est });
      pm.textContent = res; drawPaper();
    });
    pb.append(go, pm); out.append(pb);

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

  /* ---------- paper trading ----------
     Fake money, real prices: open from the planner, then each time the page has data it checks the plan's exits on the latest
     snapshot (target, stop on the stock, −50% on the option, time stop, expiry) and closes at the bid (or the estimate).
     Kept in VGPrefs 'optp' {start (USD), tx: [...]}, so it syncs with the account. Commission FEE per contract per side. */
  const FEE = 0.65;
  const sthb = (v) => (v >= 0 ? '+' : '−') + thb(Math.abs(v));
  const PP = () => { const x = window.VGPrefs ? window.VGPrefs.get('optp', null) : null; return x && Array.isArray(x.tx) ? x : null; };
  const setPP = (x) => { if (window.VGPrefs) window.VGPrefs.set('optp', x); };
  const acct = () => PP() || { start: P().cap / fx(), tx: [] };
  const feeOf = (t) => (t.fee != null ? t.fee : FEE);
  const cashOf = (a) => a.tx.reduce((c, t) => c - (t.entry * 100 + feeOf(t)) * t.n + (t.st === 'closed' ? (t.exit * 100 - feeOf(t)) * t.n : 0), a.start);
  const optNow = (t) => {
    if (t.kind === 'spread') {
      const r = rowOf(t.s); if (!r || r.px == null || !D) return { v: t.last != null ? t.last : t.entry, S: null, est: true };
      const one = (K) => optNow({ ...t, kind: null, K }); const l = one(t.K), sh = one(t.k2);
      /* close = sell the long leg a bit under mid, buy back the short leg a bit over mid */
      const lx = l.bid != null ? l.bid : l.v, sx = sh.bid != null ? 2 * sh.v - sh.bid : sh.v;
      return { v: l.v - sh.v, bid: lx - sx, S: r.px, est: l.est || sh.est };
    }
    const r = rowOf(t.s); const call = t.dir === 'call';
    if (!r || r.px == null || !D) return { v: t.last != null ? t.last : t.entry, S: null, est: true };
    const lr = r.exp === t.exp && r.lad ? r.lad.find((x) => x[0] === t.K) : null;
    if (lr) { const [b, a, l] = call ? lr.slice(1, 4) : lr.slice(5, 8); if (b > 0 && a >= b) return { v: (a + b) / 2, bid: (a + b) / 2 - 0.25 * (a - b), S: r.px }; if (l > 0) return { v: l, S: r.px }; }
    const T = Math.max((Date.parse(t.exp) - Date.parse(D.asOf)) / 864e5, 0) / 365;
    return { v: bs(r.px, t.K, T, (r.iv != null ? r.iv : t.iv0) / 100, call, D.r), S: r.px, est: true };
  };
  const WHY = { tp: ['pos', 'ถึงเป้า'], sl: ['neg', 'ตัดขาดทุน'], time: ['', 'หมดเวลา (เหลือ 21 วัน)'], exp: ['', 'หมดอายุ'], man: ['', 'ปิดเอง'] };
  const settle = () => {
    const a = PP(); if (!a || !D) return; let ch = false;
    a.tx.filter((t) => t.st === 'open' && D.asOf >= t.at).forEach((t) => {
      const q = optNow(t); t.last = q.v; const call = t.dir === 'call'; let why = null, px = q.bid != null && q.bid > 0 ? q.bid : q.v;
      if (D.asOf >= t.exp && q.S != null) { why = 'exp'; px = Math.max(0, call ? q.S - t.K : t.K - q.S); if (t.kind === 'spread') px = Math.min(px, Math.abs(t.k2 - t.K)); }
      else if (t.tpV && D.asOf > t.at && q.v >= t.tpV) why = 'tp';
      else if (q.S != null && D.asOf > t.at && (call ? q.S >= t.tgt : q.S <= t.tgt)) why = 'tp';
      else if (q.S != null && D.asOf > t.at && (call ? q.S < t.stopS : q.S > t.stopS)) why = 'sl';
      else if (D.asOf > t.at && q.v <= t.stopO) why = 'sl';
      else if (D.asOf >= t.timeStop) why = 'time';
      if (why) { px = Math.max(0, px); Object.assign(t, { st: 'closed', exit: +px.toFixed(2), out: D.asOf, why, S1: q.S }); ch = true; }
    });
    if (ch) setPP(a);
  };
  const paperOpen = (o) => {
    if (!D) return 'รอโหลดข้อมูลก่อน';
    const a = acct(); const cost = (o.entry * 100 + (o.fee != null ? o.fee : FEE)) * o.n; const cash = cashOf(a);
    if (cost > cash) return `เงินจำลองไม่พอ ต้องใช้ ${thb(cost * fx())} มีอยู่ ${thb(cash * fx())} ปิดไม้อื่นหรือเริ่มใหม่ด้วยเงินตั้งต้นที่มากขึ้น`;
    a.tx.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), st: 'open', at: D.asOf, ...o,
      entry: +o.entry.toFixed(2), stopO: +o.stopO.toFixed(2), tgt: +o.tgt.toFixed(2), stopS: +o.stopS.toFixed(2), ...(o.tpV ? { tpV: +o.tpV.toFixed(2) } : {}) });
    setPP(a);
    return `เปิดไม้จำลองแล้ว: ${tname({ ...o, exp: o.exp })} ที่ ${usd(o.entry)} (${thb(cost * fx())} รวมค่าคอม) ดูในส่วน "เทรดจำลอง"`;
  };
  const kS2 = (k) => usd(k, k % 1 ? 2 : 0);
  const tname = (t) => (t.kind === 'spread' ? `${t.dir === 'call' ? 'Bull call' : 'Bear put'} spread ${t.s} ${kS2(t.K)}/${kS2(t.k2)}` : `${t.dir === 'call' ? 'Call' : 'Put'} ${t.s} ${kS2(t.K)}`) + ` · ${dth(t.exp)} × ${t.n}`;
  const drawPaper = () => {
    const st = $('pp-strip'); if (!st) return;
    settle();
    const a = acct(), has = !!PP(); const open = a.tx.filter((t) => t.st === 'open'), done = a.tx.filter((t) => t.st === 'closed');
    const cash = cashOf(a); const openV = open.reduce((v, t) => v + optNow(t).v * 100 * t.n, 0); const eq = cash + openV;
    const plOf = (t) => (t.exit * 100 - feeOf(t)) * t.n - (t.entry * 100 + feeOf(t)) * t.n;
    const wins = done.filter((t) => plOf(t) > 0).length;
    const cell = (k, v, h, c) => { const d = el('div'); d.append(el('div', 'k', k), el('div', 'v' + (c ? ' ' + c : ''), v), el('div', 'h', h || '')); return d; };
    const tot = eq - a.start;
    st.replaceChildren(
      cell('มูลค่าบัญชีจำลอง', thb(eq * fx()), `เริ่มต้น ${thb(a.start * fx())}`),
      cell('เงินสดคงเหลือ', thb(cash * fx()), `ไม้ที่เปิดอยู่ ${open.length} ไม้ · ${thb(openV * fx())}`),
      cell('กำไร/ขาดทุนรวม', sthb(tot * fx()), pct(tot / a.start * 100), tot > 0 ? 'pos' : tot < 0 ? 'neg' : ''),
      cell('ชนะ', done.length ? `${wins}/${done.length}` : '–', done.length ? `อัตราชนะ ${Math.round(wins / done.length * 100)}%` : 'ยังไม่มีไม้ที่ปิด'));
    const ob = $('pp-open'); ob.replaceChildren();
    if (!open.length) ob.append(el('div', 'empty', has ? 'ไม่มีไม้ที่เปิดอยู่ เลือกหุ้นในตัววางแผนแล้วกด "เทรดจำลองไม้นี้"' : 'ยังไม่เคยเทรดจำลอง เลือกหุ้นในตัววางแผนด้านบนแล้วกด "เทรดจำลองไม้นี้"'));
    open.forEach((t) => {
      const q = optNow(t); const pl = (q.v - t.entry) * 100 * t.n; const c = el('div', 'panel pp-card');
      const h = el('div', 'pp-h'); h.append(el('b', null, tname(t)), el('span', 'tag ' + (pl >= 0 ? 'buy' : 'trap'), `${sthb(pl * fx())} (${pct((q.v / t.entry - 1) * 100, 0)})`));
      c.append(h, el('p', null, `เข้า ${usd(t.entry)} เมื่อ ${dth(t.at)} · ตอนนี้ ${usd(q.v)}${q.est ? ' (ประมาณ)' : ''} · หุ้น ${usd(t.S0)} → ${q.S != null ? usd(q.S) : '–'}`));
      c.append(el('p', 'pf-hint', `ทำกำไรเมื่อ${t.tpV ? `spread ≥ ${usd(t.tpV)} หรือ` : ''}หุ้น${t.dir === 'call' ? 'ถึง' : 'ลงถึง'} ${usd(t.tgt)} · ตัดขาดทุนเมื่อหุ้น${t.dir === 'call' ? 'ต่ำกว่า' : 'สูงกว่า'} ${usd(t.stopS)} หรือ${t.kind === 'spread' ? ' spread' : 'ออปชั่น'} ≤ ${usd(t.stopO)} · ออกไม่เกิน ${dth(t.timeStop)}`));
      const act = el('div', 'sw-act');
      const cl = el('button', 'btn-line sm', 'ปิดตอนนี้'); cl.type = 'button';
      cl.addEventListener('click', () => { const x = PP(); const y = x && x.tx.find((z) => z.id === t.id); if (!y) return; const qq = optNow(y); Object.assign(y, { st: 'closed', exit: +Math.max(0, qq.bid != null && qq.bid > 0 ? qq.bid : qq.v).toFixed(2), out: D ? D.asOf : y.at, why: 'man', S1: qq.S }); setPP(x); drawPaper(); });
      const del = el('button', 'btn-line sm', 'ลบ (กดผิด)'); del.type = 'button';
      del.addEventListener('click', () => { if (!confirm('ลบไม้นี้ทิ้งเหมือนไม่เคยเปิด?')) return; const x = PP(); x.tx = x.tx.filter((z) => z.id !== t.id); setPP(x); drawPaper(); });
      act.append(cl, del); c.append(act); ob.append(c);
    });
    const cb = $('pp-closed'); cb.replaceChildren(); $('pp-closed-h').hidden = !done.length;
    if (done.length) {
      const tb = el('table', 'tbl pp-tbl'); const hr = el('tr');
      ['สัญญา', 'เข้า', 'ออก', 'ราคาเข้า → ออก', 'กำไร/ขาดทุน', 'เหตุผลที่ออก'].forEach((x, k) => hr.append(el('th', k === 0 || k === 5 ? 'l' : null, x)));
      const th = el('thead'); th.append(hr); tb.append(th); const bd = el('tbody');
      [...done].sort((x, y) => (y.out + y.id).localeCompare(x.out + x.id)).forEach((t) => {
        const tr = el('tr'); const td = (v, c) => { const x = el('td', c || null, v); tr.append(x); return x; }; const pl = plOf(t);
        td(tname(t), 'l'); td(dth(t.at)); td(dth(t.out)); td(`${usd(t.entry)} → ${usd(t.exit)}`);
        const pc = td(null, pl > 0 ? 'pos' : pl < 0 ? 'neg' : null); pc.append(document.createTextNode(`${sthb(pl * fx())}`), el('small', 'sub', pct((t.exit / t.entry - 1) * 100, 0)));
        td(WHY[t.why] ? WHY[t.why][1] : t.why, 'l ' + (WHY[t.why] ? WHY[t.why][0] : '')); bd.append(tr);
      });
      tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); cb.append(w);
    }
    const si = $('pp-start'); if (si && document.activeElement !== si) si.value = Math.round(a.start * fx());
  };

  /* ---------- wiring ---------- */
  const draw = () => { drawHead(); drawExtras(); drawTable(); drawPlan(); drawPaper(); document.querySelectorAll('#op-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === mode))); };
  const visible = () => { const v = $('view-scan'); return v && !v.hidden && document.body.dataset.tab === 'invest' && ['opt', 'optplan', 'optpaper', 'optlearn'].some((k) => { const s = $(k); return s && !s.classList.contains('sub-off'); }) && document.visibilityState === 'visible'; };
  const setup = () => {
    if (!$('opt')) return;
    document.querySelectorAll('#op-mode button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
    document.querySelectorAll('#op-dir button').forEach((b) => b.addEventListener('click', () => { plan.dir = b.dataset.d; drawPlan(); }));
    document.querySelectorAll('#op-kind button').forEach((b) => b.addEventListener('click', () => { plan.kind = b.dataset.k; setP('kind', plan.kind); drawPlan(); }));
    $('op-sbud').addEventListener('change', (e) => { const v = +e.target.value; if (v >= 100) { setP('sbud', v); drawPlan(); } else e.target.value = P().sbud || 1000; });
    $('op-sym').addEventListener('change', (e) => { plan.s = e.target.value; plan.dir = null; drawPlan(); });
    $('op-cap').addEventListener('change', (e) => { const v = +e.target.value; if (v > 0) { setP('cap', v); drawPlan(); } });
    $('op-risk').addEventListener('change', (e) => { const v = +e.target.value; if (v > 0 && v <= 10) { setP('risk', v); drawPlan(); } else e.target.value = P().risk; });
    $('op-addb').addEventListener('click', addExtra);
    $('pp-reset').addEventListener('click', () => {
      const v = +$('pp-start').value; if (!(v > 0)) { $('pp-start').value = Math.round(acct().start * fx()); return; }
      const a = PP(); if (a && a.tx.length && !confirm(`เริ่มบัญชีจำลองใหม่ด้วยเงิน ${thb(v)}? ไม้และประวัติเดิมจะหายทั้งหมด`)) return;
      setPP({ start: v / fx(), tx: [] }); drawPaper();
    });
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
