/* trading portfolio (invest → เก็งกำไร → พอร์ตเทรดหุ้น): a separate USD ledger for short-term stock trades, Dime fees, daily P/L.
   Data { tx, snaps, fees } syncs inside the portfolios doc as field `trade` (no new Firestore rule). Local key 'valuegrab-trade-v1'.
   Days are US trading days (New York date), so one night session in Thailand is one day. */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const KEY = 'valuegrab-trade-v1';
  const FEES = { com: 0.15, low: 0.01, lowBelow: 6.67, free: true, vat: 0, sec: 0.00206, taf: 0.000195, tafMax: 9.79, cat: 0.000003 };
  let T = { tx: [], snaps: {}, fees: { ...FEES } };
  try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j) T = { tx: j.tx || [], snaps: j.snaps || {}, fees: { ...FEES, ...(j.fees || {}) } }; } catch (e) { /* defaults */ }
  const save = (sync = true) => { try { localStorage.setItem(KEY, JSON.stringify(T)); } catch (e) { /* ignore */ } if (sync && window.VGSync) window.VGSync.push('portfolios'); };

  const fx = () => (window.VG && window.VG.fx) || 33;
  const r2 = (x) => Math.round(x * 100) / 100;
  const up2 = (x) => (x > 0 ? Math.ceil(x * 100 - 1e-9) / 100 : 0);
  const usd = (v, d = 2) => (v == null || !isFinite(v) ? '–' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, Math.abs(v) < 10 ? 4 : 2) }));
  const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const pusd = (v) => (v == null || !isFinite(v) ? '–' : sgn(v) + '$' + Math.abs(v).toFixed(2));
  const thb = (v) => (v == null || !isFinite(v) ? '–' : sgn(v) + '฿' + Math.abs(Math.round(v)).toLocaleString('en-US'));
  const pct = (v) => (v == null || !isFinite(v) ? '–' : sgn(v) + Math.abs(v * 100).toFixed(1) + '%');
  const nyDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/New_York' });
  const bkMonth = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const thDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
  const hm = (t) => new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sorted = () => [...T.tx].sort((a, b) => a.at - b.at);

  /* Dime US-stock fees for one order (USD). first = first trade this month (free commission) */
  const feeOf = (side, q, px, first) => {
    const F = T.fees; const v = q * px;
    const com = first && F.free ? 0 : px < F.lowBelow ? F.low * q : v * F.com / 100;
    const vat = com * (F.vat || 0) / 100, cat = q * F.cat;
    const sec = side === 'sell' ? up2(v * F.sec / 100) : 0, taf = side === 'sell' ? Math.min(up2(q * F.taf), F.tafMax) : 0;
    return { com, vat, cat, sec, taf, total: r2(com + vat + cat + sec + taf) };
  };
  const firstOfMonth = (at, skipId) => !T.tx.some((x) => x.id !== skipId && (x.type === 'buy' || x.type === 'sell') && bkMonth(x.at) === bkMonth(at) && x.at <= at);

  /* replay the ledger: cash, holdings (average cost incl. buy fees), realized P/L per sell */
  const book = () => {
    let cash = 0, dep = 0, depTHB = 0; const h = {}; const real = {};
    sorted().forEach((x) => {
      if (x.type === 'dep') { cash += x.usd; dep += x.usd; depTHB += x.thb || x.usd * fx(); }
      else if (x.type === 'wd') { cash -= x.usd; dep -= x.usd; depTHB -= x.thb || x.usd * fx(); }
      else if (x.type === 'buy') {
        const p = h[x.s] || (h[x.s] = { q: 0, cost: 0, plan: null, at: x.at });
        cash -= x.q * x.px + x.fee; p.q += x.q; p.cost += x.q * x.px + x.fee; if (x.plan) { p.plan = { ...x.plan }; p.at = x.at; }
      } else if (x.type === 'sell') {
        const p = h[x.s] || { q: 0, cost: 0 }; const avg = p.q > 0 ? p.cost / p.q : x.px; const q = Math.min(x.q, p.q || x.q);
        const pl = x.q * x.px - x.fee - avg * q; cash += x.q * x.px - x.fee;
        real[x.id] = { pl, avg, ret: avg > 0 ? pl / (avg * q) : 0 };
        if (h[x.s]) { p.q -= q; p.cost -= avg * q; if (p.plan && !p.plan.half && x.half) { p.plan.half = true; } if (p.q <= 1e-9) delete h[x.s]; }
      }
    });
    return { cash, dep, depTHB, h, real };
  };
  const priceOf = (s) => (window.VGSwing && window.VGSwing.price(s)) ?? (window.VG && window.VG.raw && window.VG.raw[s] ? +window.VG.raw[s].price : null);
  const value = (B) => {
    let mv = 0, unreal = 0, miss = 0;
    Object.entries(B.h).forEach(([s, p]) => { const px = priceOf(s); if (px == null) { miss++; mv += p.cost; return; } const sellFee = feeOf('sell', p.q, px, false).total; mv += p.q * px; unreal += p.q * px - sellFee - p.cost; });
    return { mv, unreal, eq: B.cash + mv, miss };
  };

  /* ---------- form ---------- */
  let editPlan = null;
  const F = () => ({ type: $('tr-type').value, at: (() => { const v = $('tr-at').value ? new Date($('tr-at').value).getTime() : NaN; return isFinite(v) && Math.abs(v - Date.now()) > 120e3 ? v : Date.now(); })(), s: $('tr-sym').value.trim().toUpperCase(), q: +$('tr-q').value, px: +$('tr-px').value, thb: +$('tr-thb').value, rate: +$('tr-rate').value });
  let feeTouched = false;
  const preview = () => {
    const f = F(); const trade = f.type === 'buy' || f.type === 'sell';
    ['tr-sym-l', 'tr-q-l', 'tr-px-l', 'tr-fee-l'].forEach((k) => { $(k).hidden = !trade; });
    ['tr-thb-l', 'tr-rate-l'].forEach((k) => { $(k).hidden = trade; });
    const out = $('tr-prev');
    if (!trade) { out.textContent = f.thb > 0 && f.rate > 0 ? `= ${usd(f.thb / f.rate)} เข้าพอร์ตเทรด` : 'ใส่จำนวนบาทและเรทที่ได้จริงจาก Dime'; return; }
    if (!(f.q > 0 && f.px > 0)) { out.textContent = 'ค่าธรรมเนียมจะคำนวณให้เมื่อใส่จำนวนและราคา'; return; }
    const first = firstOfMonth(f.at); const z = feeOf(f.type, f.q, f.px, first);
    if (!feeTouched) $('tr-fee').value = z.total.toFixed(2);
    const parts = [`ค่าคอม ${first && T.fees.free ? 'ฟรี (ไม้แรกของเดือน)' : usd(z.com, 2)}`];
    if (z.vat) parts.push(`VAT ${usd(z.vat)}`); if (f.type === 'sell') parts.push(`SEC ${usd(z.sec)}`, `TAF ${usd(z.taf)}`);
    const fee = +$('tr-fee').value || 0; const v = f.q * f.px;
    let tail = '';
    if (f.type === 'sell') { const B = book(); const p = B.h[f.s]; if (p) { const avg = p.cost / p.q; const pl = v - fee - avg * Math.min(f.q, p.q); tail = ` · กำไรไม้นี้ ${pusd(pl)} (${thb(pl * fx())}) จากทุนเฉลี่ย ${usd(avg)}`; } }
    out.textContent = `${parts.join(' + ')} = ${usd(fee)} (${thb(fee * fx()).replace('+', '')}) · ${f.type === 'buy' ? 'จ่ายรวม' : 'ได้รับ'} ${usd(f.type === 'buy' ? v + fee : v - fee)}${tail}`;
  };
  const add = () => {
    const f = F(); const trade = f.type === 'buy' || f.type === 'sell'; const msg = $('tr-msg');
    if (trade && !(f.s && f.q > 0 && f.px > 0)) { msg.textContent = 'ใส่ชื่อหุ้น จำนวน และราคาให้ครบ'; return; }
    if (!trade && !(f.thb > 0 && f.rate > 0)) { msg.textContent = 'ใส่จำนวนบาทและเรทแลกเงิน'; return; }
    const x = { id: uid(), type: f.type, at: f.at };
    if (trade) {
      const B = book();
      if (f.type === 'sell' && !(B.h[f.s] && B.h[f.s].q >= f.q - 1e-9)) { msg.textContent = `ในพอร์ตเทรดมี ${f.s} ไม่ถึง ${f.q} หุ้น`; return; }
      Object.assign(x, { s: f.s, q: f.q, px: f.px, fee: +$('tr-fee').value || 0, first: firstOfMonth(f.at) || undefined });
      if (f.type === 'buy' && editPlan && editPlan.s === f.s) x.plan = { sl: editPlan.sl, tp1: f.px + 1.5 * (f.px - editPlan.sl), tp2: f.px + 3 * (f.px - editPlan.sl), kind: editPlan.kind };
      if (f.type === 'sell' && editPlan && editPlan.half) x.half = true;
    } else Object.assign(x, { usd: r2(f.thb / f.rate), thb: f.thb, rate: f.rate });
    if (!x.first) delete x.first;
    T.tx.push(x); editPlan = null; feeTouched = false; save();
    ['tr-sym', 'tr-q', 'tr-px', 'tr-fee', 'tr-thb'].forEach((k) => { $(k).value = ''; }); $('tr-at').value = '';
    preview(); msg.textContent = 'บันทึกแล้ว'; setTimeout(() => { msg.textContent = ''; }, 2500); draw();
  };
  const prefill = (o) => {
    $('tr-type').value = o.type; $('tr-sym').value = o.s || ''; $('tr-q').value = o.q != null ? +(+o.q).toPrecision(6) : ''; $('tr-px').value = o.px != null ? +(+o.px).toPrecision(6) : '';
    $('tr-at').value = ''; feeTouched = false; editPlan = o.plan || null; preview();
    if (window.VGNav) window.VGNav.go('scan', 'tport');
    setTimeout(() => { $('tr-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('tr-q').focus({ preventScroll: true }); }, 80);
  };

  /* ---------- views ---------- */
  const card = (k, v, h, cls) => { const d = el('div'); d.append(el('div', 'k', k), el('div', 'v' + (cls ? ' ' + cls : ''), v), el('div', 'h', h || '')); return d; };
  const daily = (B) => {
    const days = {};
    const D = (d) => days[d] || (days[d] = { d, n: 0, win: 0, loss: 0, pl: 0, fee: 0, flow: 0 });
    sorted().forEach((x) => {
      const r = D(nyDay(x.at));
      if (x.type === 'buy' || x.type === 'sell') { r.n++; r.fee += x.fee; }
      if (x.type === 'sell' && B.real[x.id]) { const pl = B.real[x.id].pl; r.pl += pl; if (pl >= 0) r.win++; else r.loss++; }
      if (x.type === 'dep') r.flow += x.usd; if (x.type === 'wd') r.flow -= x.usd;
    });
    Object.keys(T.snaps).forEach((d) => D(d));
    const list = Object.values(days).sort((a, b) => a.d.localeCompare(b.d));
    let prev = null, cum = 0;
    list.forEach((r) => { cum += r.pl; r.cum = cum; const s = T.snaps[r.d]; r.eq = s ? s.eq : null; r.chg = s && prev != null ? s.eq - prev - r.flow : null; if (s) prev = s.eq; });
    return list;
  };
  const draw = () => {
    if (!$('tr-strip')) return;
    const B = book(), V = value(B), today = nyDay(Date.now());
    const hasAny = T.tx.length > 0;
    if (hasAny && V.miss === 0) { const s = T.snaps[today]; const snap = { eq: r2(V.eq), cash: r2(B.cash), unreal: r2(V.unreal) }; if (!s || s.eq !== snap.eq || s.unreal !== snap.unreal) { T.snaps[today] = snap; save(false); } }
    const realAll = Object.values(B.real).reduce((a, x) => a + x.pl, 0), feeAll = T.tx.reduce((a, x) => a + (x.fee || 0), 0);
    const td = daily(B).find((r) => r.d === today);
    const st = $('tr-strip'); st.replaceChildren(
      card('มูลค่าพอร์ตเทรด', usd(V.eq), `${thb(V.eq * fx()).replace('+', '')} · เงินสด ${usd(B.cash)}`),
      card('วันนี้ (วันซื้อขายสหรัฐ)', pusd((td ? td.pl : 0) + 0), `ซื้อขาย ${td ? td.n : 0} ครั้ง · ค่าธรรมเนียม ${usd(td ? td.fee : 0)}`, td && td.pl < 0 ? 'neg' : td && td.pl > 0 ? 'pos' : ''),
      card('กำไรที่ขายแล้วรวม', pusd(realAll), `หักค่าธรรมเนียมแล้ว · จ่ายไปรวม ${usd(feeAll)}`, realAll < 0 ? 'neg' : realAll > 0 ? 'pos' : ''),
      card('เทียบเงินที่ฝาก (บาท)', B.depTHB > 0 ? thb(V.eq * fx() - B.depTHB) : '–', B.depTHB > 0 ? `ฝากสุทธิ ${thb(B.depTHB).replace('+', '')} · รวมผลค่าเงิน ${pct(V.eq * fx() / B.depTHB - 1)}` : 'บันทึก "ฝากเงิน" ก่อน', B.depTHB > 0 && V.eq * fx() < B.depTHB ? 'neg' : 'pos'));
    /* holdings */
    const hb = $('tr-hold'); hb.replaceChildren();
    const hs = Object.entries(B.h);
    if (!hs.length) hb.append(el('div', 'empty', hasAny ? 'ไม่มีหุ้นค้างในพอร์ตเทรด' : 'เริ่มจากบันทึก "ฝากเงิน" ที่โอนเข้า Dime สำหรับเทรด แล้วกด "เข้าซื้อแล้ว" ที่สัญญาณหุ้นด้านบน ระบบจะกรอกให้'));
    hs.forEach(([s, p]) => {
      const px = priceOf(s), avg = p.cost / p.q, sf = px != null ? feeOf('sell', p.q, px, false).total : 0, pl = px != null ? p.q * px - sf - p.cost : null;
      const r = el('div', 'sw-row');
      const who = el('div', 'sw-who'); who.append(el('b', null, s), el('small', null, `${+p.q.toFixed(6)} หุ้น · ทุนเฉลี่ย ${usd(avg)} (รวมค่าธรรมเนียม)`));
      const now = el('div', 'sw-now'); now.append(el('b', null, usd(px)), px == null ? el('small', null, 'ยังไม่มีราคาล่าสุด') : el('small', pl >= 0 ? 'pos' : 'neg', `${pct(px / avg - 1)} · ${pusd(pl)} · ${thb(pl * fx())} ถ้าขายตอนนี้`));
      r.append(who, now);
      if (p.plan) {
        const a = SWC.advise({ ...p.plan, entry: avg, at: p.at }, px, window.VGSwing ? window.VGSwing.e20(s) : null);
        r.append(el('div', 'sw-adv sw-' + a.k, a.t), el('small', 'sw-lvl', `ตัดขาดทุน ${usd(p.plan.half ? avg : p.plan.sl)} · เป้าแรก ${usd(p.plan.tp1)} · เป้าสอง ${usd(p.plan.tp2)}`));
      } else r.append(el('small', 'sw-lvl', 'ไม่ได้ซื้อจากสัญญาณ จึงไม่มีจุดขายที่แนะนำ'));
      const act = el('div', 'sw-act');
      const sell = (lab, q, half) => { const b = el('button', 'btn-line sm', lab); b.type = 'button'; b.addEventListener('click', () => prefill({ type: 'sell', s, q, px, plan: half ? { s, half: true } : null })); return b; };
      if (p.plan && !p.plan.half) act.append(sell('ขายครึ่ง', p.q / 2, true));
      act.append(sell('ขายทั้งหมด', p.q, false));
      r.append(act); hb.append(r);
    });
    /* ledger */
    const lb = $('tr-tx'); lb.replaceChildren();
    const TY = { buy: 'ซื้อ', sell: 'ขาย', dep: 'ฝากเงิน', wd: 'ถอนเงิน' };
    sorted().reverse().slice(0, 30).forEach((x) => {
      const li = el('li'); const rl = B.real[x.id];
      li.append(el('b', null, TY[x.type] + (x.s ? ' ' + x.s : '')),
        el('span', null, x.s ? ` ${+x.q.toFixed(6)} × ${usd(x.px)} · ค่าธรรมเนียม ${usd(x.fee)}${x.first ? ' (ไม้ฟรีของเดือน)' : ''} · ${hm(x.at)} ` : ` ${thb(x.thb).replace('+', '')} เรท ${x.rate} = ${usd(x.usd)} · ${hm(x.at)} `));
      if (rl) li.append(el('b', rl.pl >= 0 ? 'pos' : 'neg', pusd(rl.pl)));
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
    if (!rows.length) { box.append(el('div', 'empty', 'ยังไม่มีการซื้อขายในพอร์ตเทรด')); return; }
    const tb = el('table', 'tr-table'); const hd = el('tr');
    ['วันซื้อขาย', 'ครั้ง', 'ชนะ/แพ้', 'กำไรที่ขาย', 'ค่าธรรมเนียม', 'สะสม', 'มูลค่าพอร์ตสิ้นวัน', 'เปลี่ยนจากวันก่อน'].forEach((h) => hd.append(el('th', null, h)));
    const th = el('thead'); th.append(hd); tb.append(th); const bd = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr'); const td = (v, cls) => { const c = el('td', cls, v); tr.append(c); };
      td(thDay(r.d)); td(String(r.n)); td(r.win + r.loss ? `${r.win}/${r.loss}` : '–'); td(r.win + r.loss ? pusd(r.pl) : '–', r.pl > 0 ? 'pos' : r.pl < 0 ? 'neg' : null);
      td(r.fee ? usd(r.fee) : '–'); td(pusd(r.cum)); td(r.eq != null ? usd(r.eq) : '–'); td(r.chg != null ? pusd(r.chg) : '–', r.chg > 0 ? 'pos' : r.chg < 0 ? 'neg' : null);
      bd.append(tr);
    });
    tb.append(bd); const wrap = el('div', 'tr-scroll'); wrap.append(tb); box.append(wrap);
    const done = rows.reduce((a, r) => a + r.win + r.loss, 0), wins = rows.reduce((a, r) => a + r.win, 0), tot = rows.reduce((a, r) => a + r.pl, 0);
    box.append(el('p', 'pf-hint', `ขายไปแล้ว ${done} ครั้ง ชนะ ${done ? Math.round(wins / done * 100) : 0}% · กำไรรวม ${pusd(tot)} ≈ ${thb(tot * fx())} (เรทวันนี้ ${fx().toFixed(2)}) · มูลค่าสิ้นวันจดเมื่อเปิดหน้านี้ในวันนั้น`));
  };
  const csv = () => {
    const B = book(); const rows = [['date_ny', 'time', 'type', 'symbol', 'qty', 'price_usd', 'fee_usd', 'realized_usd', 'thb', 'rate']];
    sorted().forEach((x) => { const t = new Date(x.at); rows.push([nyDay(x.at), t.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok' }), x.type, x.s || '', x.q ?? '', x.px ?? '', x.fee ?? '', B.real[x.id] ? r2(B.real[x.id].pl) : '', x.thb ?? '', x.rate ?? '']); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })); a.download = 'valuegrab-trades.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /* ---------- fee settings ---------- */
  const setupFees = () => {
    const box = $('tr-fees'); if (!box) return;
    const fields = [['com', 'ค่าคอม (% ของมูลค่า)'], ['low', 'หุ้นราคาต่ำ ($ ต่อหุ้น)'], ['lowBelow', 'ราคาต่ำกว่า ($)'], ['vat', 'VAT บนค่าคอม (%)'], ['sec', 'SEC fee ตอนขาย (%)'], ['taf', 'TAF ตอนขาย ($ ต่อหุ้น)'], ['tafMax', 'TAF สูงสุดต่อคำสั่ง ($)'], ['cat', 'CAT ($ ต่อหุ้น)']];
    fields.forEach(([k, lab]) => { const l = el('label', null, lab); const x = el('input', 'inp'); x.type = 'number'; x.step = 'any'; x.inputMode = 'decimal'; x.value = T.fees[k];
      x.addEventListener('change', () => { const v = +x.value; if (v >= 0) { T.fees[k] = v; save(); preview(); draw(); } else x.value = T.fees[k]; }); l.append(x); box.append(l); });
    const l = el('label', 'sw-chk'); const c = el('input'); c.type = 'checkbox'; c.checked = !!T.fees.free; c.addEventListener('change', () => { T.fees.free = c.checked; save(); preview(); }); l.append(c, document.createTextNode(' ไม้แรกของเดือนไม่เสียค่าคอม')); box.append(l);
    const r = el('button', 'btn ghost sm', 'คืนค่าเริ่มต้นของ Dime'); r.type = 'button'; r.addEventListener('click', () => { T.fees = { ...FEES }; save(); box.replaceChildren(); setupFees(); preview(); }); box.append(r);
  };

  const setup = () => {
    if (!$('tr-form')) return;
    ['tr-type', 'tr-sym', 'tr-q', 'tr-px', 'tr-at', 'tr-thb', 'tr-rate'].forEach((k) => $(k).addEventListener('input', preview));
    $('tr-fee').addEventListener('input', () => { feeTouched = true; preview(); });
    $('tr-type').addEventListener('change', () => { feeTouched = false; editPlan = null; preview(); });
    $('tr-add').addEventListener('click', add);
    $('tr-csv').addEventListener('click', csv);
    if (!$('tr-rate').value) $('tr-rate').value = fx().toFixed(2);
    document.addEventListener('vg:ready', () => { if (!$('tr-rate').value) $('tr-rate').value = fx().toFixed(2); draw(); });
    document.addEventListener('vg:swing', draw);
    setupFees(); preview(); draw();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();

  window.VGTrade = {
    trade: () => T, prefill, feeOf,
    equityTHB: () => { if (!T.tx.some((x) => x.type === 'dep')) return 0; const B = book(); return value(B).eq * fx(); },
    replace: (c) => { T = { tx: (c && c.tx) || [], snaps: (c && c.snaps) || {}, fees: { ...FEES, ...((c && c.fees) || {}) } }; save(false); const b = $('tr-fees'); if (b) { b.replaceChildren(); setupFees(); } draw(); },
    merge: (c) => { const ids = new Set((c.tx || []).map((x) => x.id)); const tx = [...(c.tx || []), ...T.tx.filter((x) => !ids.has(x.id))];
      return { extra: tx.length - (c.tx || []).length, doc: { tx, snaps: { ...T.snaps, ...(c.snaps || {}) }, fees: { ...T.fees, ...(c.fees || {}) } } }; },
  };
})();
