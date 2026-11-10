/* spot portfolio (invest → คริปโตและทอง → พอร์ต): a separate baht ledger for crypto (Binance TH, THB pairs) and gold (Dime 99.99%).
   Data { tx, snaps, fees } syncs inside the portfolios doc as field `spot` (no new Firestore rule). Local key 'valuegrab-spot-v1'.
   Units: coins for crypto, grams for gold; prices in baht per unit. Days are Bangkok dates. */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const KEY = 'valuegrab-spot-v1';
  const FEES = { crypto: 0.25, gold: 0 };
  let T = { tx: [], snaps: {}, fees: { ...FEES } };
  try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j) T = { tx: j.tx || [], snaps: j.snaps || {}, fees: { ...FEES, ...(j.fees || {}) } }; } catch (e) { /* defaults */ }
  const save = (sync = true) => { try { localStorage.setItem(KEY, JSON.stringify(T)); } catch (e) { /* ignore */ } if (sync && window.VGSync) window.VGSync.push('portfolios'); };

  const SP = () => window.VGSpot;
  const isGold = (s) => s === 'GOLD';
  const unit = (s) => (isGold(s) ? 'ออนซ์' : 'เหรียญ');
  const nameOf = (s) => (SP() ? SP().nameOf(s) : s);
  const r2 = (x) => Math.round(x * 100) / 100;
  const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const thb = (v) => (v == null || !isFinite(v) ? '–' : (v < 0 ? '−' : '') + '฿' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 }));
  const pthb = (v) => (v == null || !isFinite(v) ? '–' : sgn(v) + '฿' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 }));
  const pct = (v) => (v == null || !isFinite(v) ? '–' : sgn(v) + Math.abs(v * 100).toFixed(1) + '%');
  const qty = (q) => (+q.toPrecision(8)).toLocaleString('en-US', { maximumFractionDigits: 8 });
  const bkDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const thDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
  const hm = (t) => new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sorted = () => T.tx.map((x, i) => [x, i]).sort((a, b) => a[0].at - b[0].at || a[1] - b[1]).map((x) => x[0]);
  const feeOf = (s, q, px) => r2(q * px * (isGold(s) ? T.fees.gold : T.fees.crypto) / 100);

  /* replay the ledger: cash, holdings (average cost incl. buy fees), realized P/L per sell */
  const book = () => {
    let cash = 0, dep = 0; const h = {}; const real = {};
    sorted().forEach((x) => {
      if (x.type === 'dep') { cash += x.thb; dep += x.thb; }
      else if (x.type === 'wd') { cash -= x.thb; dep -= x.thb; }
      else if (x.type === 'buy') {
        const p = h[x.s] || (h[x.s] = { q: 0, cost: 0, plan: null, at: x.at });
        cash -= x.q * x.px + x.fee; p.q += x.q; p.cost += x.q * x.px + x.fee; if (x.plan) { p.plan = { ...x.plan, stage: 0 }; p.at = x.at; }
      } else if (x.type === 'sell') {
        const p = h[x.s] || { q: 0, cost: 0 }; const avg = p.q > 0 ? p.cost / p.q : x.px; const q = Math.min(x.q, p.q || x.q);
        const pl = x.q * x.px - x.fee - avg * q; cash += x.q * x.px - x.fee; real[x.id] = { pl, avg };
        if (h[x.s]) { p.q -= q; p.cost -= avg * q; if (p.plan && x.stage) p.plan.stage = Math.max(p.plan.stage || 0, x.stage); if (p.q <= 1e-12) delete h[x.s]; }
      }
    });
    return { cash, dep, h, real };
  };
  const priceOf = (s) => (SP() ? SP().price(s) : null);
  const value = (B) => {
    let mv = 0, unreal = 0, miss = 0;
    Object.entries(B.h).forEach(([s, p]) => { const px = priceOf(s); if (px == null) { miss++; mv += p.cost; return; } mv += p.q * px; unreal += p.q * px - feeOf(s, p.q, px) - p.cost; });
    return { mv, unreal, eq: B.cash + mv, miss };
  };

  /* ---------- form ---------- */
  let plan = null, feeTouched = false;
  const F = () => ({ type: $('tr-type').value, at: (() => { const v = $('tr-at').value ? new Date($('tr-at').value).getTime() : NaN; return isFinite(v) && Math.abs(v - Date.now()) > 120e3 ? v : Date.now(); })(),
    s: $('tr-sym').value, amt: +$('tr-q').value, px: +$('tr-px').value, thb: +$('tr-thb').value });
  const qOf = (f) => { if (!(f.amt > 0 && f.px > 0)) return 0; let q = f.amt / f.px; if (f.type === 'sell') { const p = book().h[f.s]; if (p && Math.abs(q - p.q) <= p.q * 0.005) q = p.q; } return q; };
  const preview = () => {
    const f = F(); const trade = f.type === 'buy' || f.type === 'sell';
    ['tr-sym-l', 'tr-q-l', 'tr-px-l', 'tr-fee-l'].forEach((k) => { $(k).hidden = !trade; }); $('tr-thb-l').hidden = trade;
    $('tr-q-lab').textContent = f.type === 'sell' ? 'ขายเป็นเงิน (บาท)' : 'ซื้อเป็นเงิน (บาท)'; $('tr-px-lab').textContent = `ราคาที่ได้ (บาทต่อ${unit(f.s)})`;
    const out = $('tr-prev');
    if (!trade) { out.textContent = f.type === 'dep' ? 'เงินบาทที่โอนเข้า Binance TH หรือ Dime เพื่อลงทุนส่วนนี้' : 'เงินบาทที่ถอนออก'; return; }
    f.q = qOf(f);
    if (!(f.q > 0 && f.px > 0)) { out.textContent = `ค่าธรรมเนียมคิดให้อัตโนมัติ: ${isGold(f.s) ? `ทอง Dime ${T.fees.gold}%` : `Binance TH ${T.fees.crypto}%`} · ใส่จำนวนกับราคาก่อน`; return; }
    if (!feeTouched) $('tr-fee').value = feeOf(f.s, f.q, f.px).toFixed(2);
    const fee = +$('tr-fee').value || 0, v = f.q * f.px; let tail = '';
    if (f.type === 'sell') { const p = book().h[f.s]; if (p) { const avg = p.cost / p.q, pl = v - fee - avg * Math.min(f.q, p.q); tail = ` · กำไรไม้นี้ ${pthb(pl)} (${pct(pl / (avg * Math.min(f.q, p.q)))}) จากทุนเฉลี่ย ${thb(avg)}`; } }
    out.textContent = `ได้ ${qty(f.q)} ${unit(f.s)} · มูลค่า ${thb(v)} ค่าธรรมเนียม ${thb(fee)} · ${f.type === 'buy' ? 'จ่ายรวม ' + thb(v + fee) : 'ได้รับ ' + thb(v - fee)}${tail}`;
  };
  const add = () => {
    const f = F(); const trade = f.type === 'buy' || f.type === 'sell'; const msg = $('tr-msg');
    f.q = qOf(f);
    if (trade && !(f.q > 0 && f.px > 0)) { msg.textContent = 'ใส่จำนวนเงินและราคาให้ครบ'; return; }
    if (!trade && !(f.thb > 0)) { msg.textContent = 'ใส่จำนวนเงินบาท'; return; }
    const x = { id: uid(), type: f.type, at: f.at };
    if (trade) {
      if (f.type === 'sell') { const p = book().h[f.s]; if (!(p && p.q >= f.q - 1e-12)) { msg.textContent = `ในพอร์ตมี ${nameOf(f.s)} ไม่ถึง ${qty(f.q)} ${unit(f.s)}`; return; } }
      Object.assign(x, { s: f.s, q: f.q, px: f.px, fee: +$('tr-fee').value || 0 });
      if (f.type === 'buy' && plan && plan.s === f.s && plan.sl < f.px) { const R = f.px - plan.sl; x.plan = { sl: plan.sl, tp1: f.px + 1.5 * R, tp2: f.px + 3 * R, kind: plan.kind }; }
      if (f.type === 'sell' && plan && plan.s === f.s && plan.stage) x.stage = plan.stage;
    } else x.thb = f.thb;
    T.tx.push(x); plan = null; feeTouched = false; save();
    ['tr-q', 'tr-px', 'tr-fee', 'tr-thb', 'tr-at'].forEach((k) => { $(k).value = ''; }); preview();
    msg.textContent = 'บันทึกแล้ว'; setTimeout(() => { msg.textContent = ''; }, 2500); draw();
  };
  const prefill = (o) => {
    $('tr-type').value = o.type; if (o.s) $('tr-sym').value = o.s;
    $('tr-q').value = o.q != null && o.px != null ? Math.round(o.q * o.px * 100) / 100 : ''; $('tr-px').value = o.px != null ? +(+o.px).toPrecision(7) : ''; $('tr-at').value = '';
    feeTouched = false; plan = o.plan || null; preview();
    if (window.VGNav) window.VGNav.go('scan', 'tport');
    setTimeout(() => { $('tr-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('tr-q').focus({ preventScroll: true }); }, 80);
  };

  /* ---------- views ---------- */
  const card = (k, v, h, cls) => { const d = el('div'); d.append(el('div', 'k', k), el('div', 'v' + (cls ? ' ' + cls : ''), v), el('div', 'h', h || '')); return d; };
  const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const daily = (B) => {
    const days = {}; const D = (d) => days[d] || (days[d] = { d, n: 0, win: 0, loss: 0, pl: 0, fee: 0, flow: 0 });
    sorted().forEach((x) => {
      const r = D(bkDay(x.at));
      if (x.type === 'buy' || x.type === 'sell') { r.n++; r.fee += x.fee; }
      if (x.type === 'sell' && B.real[x.id]) { const pl = B.real[x.id].pl; r.pl += pl; if (pl >= 0) r.win++; else r.loss++; }
      if (x.type === 'dep') r.flow += x.thb; if (x.type === 'wd') r.flow -= x.thb;
    });
    Object.keys(T.snaps).forEach((d) => D(d));
    const list = Object.values(days).sort((a, b) => a.d.localeCompare(b.d)); let prev = null, cum = 0;
    list.forEach((r) => { cum += r.pl; r.cum = cum; const s = T.snaps[r.d]; r.eq = s ? s.eq : null; r.chg = s && prev != null ? s.eq - prev - r.flow : null; if (s) prev = s.eq; });
    return list;
  };
  const draw = () => {
    if (!$('tr-strip')) return;
    const B = book(), V = value(B), today = bkDay(Date.now());
    if (T.tx.length && V.miss === 0) { const s = T.snaps[today], snap = { eq: Math.round(V.eq), cash: Math.round(B.cash), unreal: Math.round(V.unreal) }; if (!s || s.eq !== snap.eq || s.unreal !== snap.unreal) { T.snaps[today] = snap; save(false); } }
    const realAll = Object.values(B.real).reduce((a, x) => a + x.pl, 0), feeAll = T.tx.reduce((a, x) => a + (x.fee || 0), 0);
    const td = daily(B).find((r) => r.d === today);
    $('tr-strip').replaceChildren(
      card('มูลค่าพอร์ต', thb(V.eq), `เงินสด ${thb(B.cash)} · ${V.miss ? 'ราคาบางตัวยังไม่มา ใช้ทุนแทน' : 'ราคาโดยประมาณ'}`),
      card('ยังไม่ได้ขาย', pthb(V.unreal), 'ถ้าขายตอนนี้ หักค่าธรรมเนียมแล้ว', tone(V.unreal)),
      card('กำไรที่ขายแล้วรวม', pthb(realAll), `วันนี้ ${pthb(td ? td.pl : 0)} · ค่าธรรมเนียมรวม ${thb(feeAll)}`, tone(realAll)),
      card('เทียบเงินที่ใส่', B.dep > 0 ? pthb(V.eq - B.dep) : '–', B.dep > 0 ? `ใส่สุทธิ ${thb(B.dep)} · ${pct(V.eq / B.dep - 1)}` : 'บันทึก "ฝากเงิน" ก่อน', B.dep > 0 ? tone(V.eq - B.dep) : ''));
    /* holdings */
    const hb = $('tr-hold'); hb.replaceChildren(); const hs = Object.entries(B.h);
    if (!hs.length) hb.append(el('div', 'empty', T.tx.length ? 'ตอนนี้ไม่ได้ถืออะไร' : 'เริ่มจากบันทึก "ฝากเงิน" ที่ใส่เข้าไปลงทุนส่วนนี้ แล้วกด "ซื้อแล้ว" ที่สัญญาณด้านบน ระบบจะกรอกให้'));
    hs.forEach(([s, p]) => {
      const px = priceOf(s), avg = p.cost / p.q, pl = px != null ? p.q * px - feeOf(s, p.q, px) - p.cost : null;
      const r = el('div', 'sw-row');
      const who = el('div', 'sw-who'); who.append(el('b', null, nameOf(s)), el('small', null, `${qty(p.q)} ${unit(s)} · ทุนเฉลี่ย ${thb(avg)} (รวมค่าธรรมเนียม)`));
      const now = el('div', 'sw-now'); now.append(el('b', null, thb(px)), px == null ? el('small', null, 'ราคาจะมาเมื่อโหลดเสร็จ') : el('small', tone(pl), `${pct(px / avg - 1)} · ${pthb(pl)} ถ้าขายตอนนี้`));
      r.append(who, now);
      if (p.plan) {
        const a = SPC.advise({ ...p.plan, entry: avg }, px, SP() ? SP().s50(s) : null);
        const st = p.plan.stage || 0;
        r.append(el('div', 'sw-adv sw-' + (a.k === 'tp' ? 'tp1' : a.k), a.t), el('small', 'sw-lvl', `จุดตัดขาดทุน ${thb(st ? avg : p.plan.sl)} · เป้าแรก ${thb(p.plan.tp1)}${st >= 1 ? ' ✓' : ''} · เป้าสอง ${thb(p.plan.tp2)}${st >= 2 ? ' ✓' : ''}`));
      } else { const ss = SP() && SP().status(s); r.append(el('small', 'sw-lvl', ss ? 'ไม่ได้ซื้อจากสัญญาณ สถานะตอนนี้: ' + ss.t : 'ไม่ได้ซื้อจากสัญญาณ จึงไม่มีจุดขายที่แนะนำ')); }
      const act = el('div', 'sw-act');
      const sell = (lab, q, stage) => { const b = el('button', 'btn-line sm', lab); b.type = 'button'; b.addEventListener('click', () => prefill({ type: 'sell', s, q, px, plan: stage ? { s, stage } : null })); return b; };
      const st = p.plan ? p.plan.stage || 0 : 0;
      if (p.plan && st < 2) act.append(sell(st === 0 ? 'ขาย 1/3 (เป้าแรก)' : 'ขายอีกครึ่งที่เหลือ (เป้าสอง)', st === 0 ? p.q / 3 : p.q / 2, st + 1));
      act.append(sell('ขายทั้งหมด', p.q, 0)); r.append(act); hb.append(r);
    });
    /* ledger */
    const lb = $('tr-tx'); lb.replaceChildren(); const TY = { buy: 'ซื้อ', sell: 'ขาย', dep: 'ฝากเงิน', wd: 'ถอนเงิน' };
    sorted().reverse().slice(0, 30).forEach((x) => {
      const li = el('li'); const rl = B.real[x.id];
      li.append(el('b', null, TY[x.type] + (x.s ? ' ' + nameOf(x.s) : '')), el('span', null, x.s ? ` ${qty(x.q)} ${unit(x.s)} × ${thb(x.px)} · ค่าธรรมเนียม ${thb(x.fee)} · ${hm(x.at)} ` : ` ${thb(x.thb)} · ${hm(x.at)} `));
      if (rl) li.append(el('b', tone(rl.pl), pthb(rl.pl)));
      const del = el('button', 'tr-del', '×'); del.type = 'button'; del.setAttribute('aria-label', 'ลบรายการนี้');
      del.addEventListener('click', () => { if (del.dataset.ok) { T.tx = T.tx.filter((y) => y.id !== x.id); save(); draw(); } else { del.dataset.ok = '1'; del.textContent = 'ลบ?'; setTimeout(() => { if (del.isConnected) { delete del.dataset.ok; del.textContent = '×'; } }, 3000); } });
      li.append(del); lb.append(li);
    });
    $('tr-tx-h').hidden = !T.tx.length;
    drawDays(B);
  };
  const drawDays = (B) => {
    const box = $('tr-days'); if (!box) return; box.replaceChildren();
    const rows = daily(B).reverse();
    if (!rows.length) { box.append(el('div', 'empty', 'ยังไม่มีรายการในพอร์ตนี้')); return; }
    const tb = el('table', 'tr-table'); const hd = el('tr');
    ['วันที่', 'ซื้อขาย', 'ชนะ/แพ้', 'กำไรที่ขาย', 'ค่าธรรมเนียม', 'สะสม', 'มูลค่าพอร์ต', 'เปลี่ยนจากวันก่อน'].forEach((h) => hd.append(el('th', null, h)));
    const th = el('thead'); th.append(hd); tb.append(th); const bd = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr'); const td = (v, c) => tr.append(el('td', c || null, v));
      td(thDay(r.d)); td(String(r.n)); td(r.win + r.loss ? `${r.win}/${r.loss}` : '–'); td(r.win + r.loss ? pthb(r.pl) : '–', tone(r.pl));
      td(r.fee ? thb(r.fee) : '–'); td(pthb(r.cum)); td(r.eq != null ? thb(r.eq) : '–'); td(r.chg != null ? pthb(r.chg) : '–', tone(r.chg)); bd.append(tr);
    });
    tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); box.append(w);
    const done = rows.reduce((a, r) => a + r.win + r.loss, 0), wins = rows.reduce((a, r) => a + r.win, 0), tot = rows.reduce((a, r) => a + r.pl, 0);
    box.append(el('p', 'pf-hint', `ขายไปแล้ว ${done} ครั้ง ชนะ ${done ? Math.round(wins / done * 100) : 0}% · กำไรที่ขายแล้วรวม ${pthb(tot)} · มูลค่าพอร์ตจดอัตโนมัติวันที่เปิดหน้านี้`));
  };
  const csv = () => {
    const B = book(); const rows = [['date', 'time', 'type', 'asset', 'qty', 'unit', 'price_thb', 'fee_thb', 'realized_thb', 'amount_thb']];
    sorted().forEach((x) => rows.push([bkDay(x.at), new Date(x.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok' }), x.type, x.s || '', x.q ?? '', x.s ? (isGold(x.s) ? 'ounce' : 'coin') : '', x.px ?? '', x.fee ?? '', B.real[x.id] ? r2(B.real[x.id].pl) : '', x.thb ?? '']));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })); a.download = 'valuegrab-crypto-gold.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const setupFees = () => {
    const box = $('tr-fees'); if (!box) return; box.replaceChildren();
    [['crypto', 'คริปโต Binance TH (%)'], ['gold', 'ทอง Dime (%)']].forEach(([k, lab]) => { const l = el('label', null, lab); const x = el('input', 'inp'); x.type = 'number'; x.step = 'any'; x.inputMode = 'decimal'; x.value = T.fees[k];
      x.addEventListener('change', () => { const v = +x.value; if (v >= 0) { T.fees[k] = v; save(); preview(); draw(); } else x.value = T.fees[k]; }); l.append(x); box.append(l); });
  };

  const setup = () => {
    if (!$('tr-form')) return;
    const sel = $('tr-sym'); (SP() ? SP().assets : [['BTC', ''], ['GOLD', 'ทองคำ']]).forEach(([a]) => sel.append(new Option(nameOf(a), a)));
    ['tr-type', 'tr-sym', 'tr-q', 'tr-px', 'tr-at', 'tr-thb'].forEach((k) => $(k).addEventListener('input', preview));
    $('tr-sym').addEventListener('change', () => { feeTouched = false; plan = null; preview(); });
    $('tr-fee').addEventListener('input', () => { feeTouched = true; preview(); });
    $('tr-type').addEventListener('change', () => { feeTouched = false; plan = null; preview(); });
    $('tr-add').addEventListener('click', add); $('tr-csv').addEventListener('click', csv);
    document.addEventListener('vg:spot', draw); document.addEventListener('vg:ready', draw);
    setupFees(); preview(); draw();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();

  window.VGTrade = {
    trade: () => T, prefill,
    equityTHB: () => { if (!T.tx.some((x) => x.type === 'dep')) return 0; return value(book()).eq; },
    replace: (c) => { T = { tx: (c && c.tx) || [], snaps: (c && c.snaps) || {}, fees: { ...FEES, ...((c && c.fees) || {}) } }; save(false); setupFees(); draw(); },
    merge: (c) => { const ids = new Set((c.tx || []).map((x) => x.id)); const tx = [...(c.tx || []), ...T.tx.filter((x) => !ids.has(x.id))];
      return { extra: tx.length - (c.tx || []).length, doc: { tx, snaps: { ...T.snaps, ...(c.snaps || {}) }, fees: { ...T.fees, ...(c.fees || {}) } } }; },
  };
})();
