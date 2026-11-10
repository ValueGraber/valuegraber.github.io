/* spot portfolio (invest → คริปโตและทอง → พอร์ต): baht ledger for crypto (Binance TH, THB pairs) and gold (Dime, USD/oz).
   Buy-and-hold: target weights per asset, rebalancing within a band, and profit-taking when an asset runs hot,
   so paper gains become real ones. Data { tx, snaps, fees, targets, band } syncs inside the portfolios doc as `spot`.
   tx: dep/wd {thb}; buy {s, amt, q, px, fx?, fee, cost}; sell {s, amt, q, px, fx?, fee, net}.
   Crypto px is baht per coin; gold px is USD per ounce with fx baht per USD (as on the Dime slip). */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const KEY = 'valuegrab-spot-v1';
  const FEES = { crypto: 0.25, gold: 0 };
  const blank = () => ({ tx: [], snaps: {}, fees: { ...FEES }, targets: {}, band: 5 });
  const norm = (j) => ({ ...blank(), ...(j || {}), fees: { ...FEES, ...((j && j.fees) || {}) }, targets: { ...((j && j.targets) || {}) } });
  let T = blank(); try { T = norm(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { /* defaults */ }
  const save = (sync = true) => { try { localStorage.setItem(KEY, JSON.stringify(T)); } catch (e) { /* ignore */ } if (sync && window.VGSync) window.VGSync.push('portfolios'); };

  const SP = () => window.VGSpot;
  const isGold = (s) => s === 'GOLD';
  const unit = (s) => (isGold(s) ? 'ออนซ์' : 'เหรียญ');
  const nameOf = (s) => (SP() ? SP().nameOf(s) : s);
  const fxNow = () => (SP() ? SP().fx() : (window.VG && window.VG.fx) || 33);
  const r2 = (x) => Math.round(x * 100) / 100;
  const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const fmt = (v) => Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
  const thb = (v) => (v == null || !isFinite(v) ? '–' : (v < 0 ? '−' : '') + '฿' + fmt(v));
  const pthb = (v) => (v == null || !isFinite(v) ? '–' : sgn(v) + '฿' + fmt(v));
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? '–' : sgn(v) + Math.abs(v * 100).toFixed(d) + '%');
  const qty = (q) => (+q.toPrecision(8)).toLocaleString('en-US', { maximumFractionDigits: 8 });
  const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const bkDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const thDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
  const hm = (t) => new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sorted = () => T.tx.map((x, i) => [x, i]).sort((a, b) => a[0].at - b[0].at || a[1] - b[1]).map((x) => x[0]);
  const rate = (s) => (isGold(s) ? T.fees.gold : T.fees.crypto) / 100;
  const costOf = (x) => (x.cost != null ? x.cost : x.q * x.px + (x.fee || 0));
  const netOf = (x) => (x.net != null ? x.net : x.q * x.px - (x.fee || 0));

  /* replay the ledger: cash, holdings (average cost incl. fees), realized P/L per sell */
  const book = () => {
    let cash = 0, dep = 0; const h = {}, real = {};
    sorted().forEach((x) => {
      if (x.type === 'dep') { cash += x.thb; dep += x.thb; }
      else if (x.type === 'wd') { cash -= x.thb; dep -= x.thb; }
      else if (x.type === 'buy') { const p = h[x.s] || (h[x.s] = { q: 0, cost: 0 }); const c = costOf(x); cash -= c; p.q += x.q; p.cost += c; }
      else if (x.type === 'sell') {
        const p = h[x.s] || { q: 0, cost: 0 }; const avg = p.q > 0 ? p.cost / p.q : 0; const q = Math.min(x.q, p.q); const n = netOf(x);
        cash += n; real[x.id] = { pl: n - avg * q, avg };
        if (h[x.s]) { p.q -= q; p.cost -= avg * q; if (p.q <= 1e-12) delete h[x.s]; }
      }
    });
    return { cash, dep, h, real };
  };
  const priceOf = (s) => (SP() ? SP().price(s) : null);
  const sellFee = (s, v) => v * rate(s);
  const value = (B) => {
    let mv = 0, unreal = 0, miss = 0; const rows = {};
    Object.entries(B.h).forEach(([s, p]) => { const px = priceOf(s); const v = px == null ? p.cost : p.q * px; if (px == null) miss++; const u = px == null ? 0 : v - sellFee(s, v) - p.cost; mv += v; unreal += u; rows[s] = { v, u, px }; });
    return { mv, unreal, eq: B.cash + mv, miss, rows };
  };

  /* ---------- form ---------- */
  let nTouched = false, feeTouched = false;
  const F = () => ({ type: $('tr-type').value, s: $('tr-sym').value, amt: +$('tr-q').value, px: +$('tr-px').value, fx: +$('tr-fx').value, n: +$('tr-n').value, thb: +$('tr-thb').value,
    at: (() => { const v = $('tr-at').value ? new Date($('tr-at').value).getTime() : NaN; return isFinite(v) && Math.abs(v - Date.now()) > 120e3 ? v : Date.now(); })() });
  /* fills auto values and returns the record to save (or null) */
  const calc = (f) => {
    if (!(f.type === 'buy' || f.type === 'sell') || !(f.amt > 0 && f.px > 0)) return null;
    const g = isGold(f.s), fx = g ? f.fx : 1; if (g && !(fx > 0)) return null;
    let q, fee;
    if (g) { q = f.type === 'buy' ? Math.floor(f.amt / fx / f.px * 1e4) / 1e4 : f.amt / fx / f.px; fee = r2(q * f.px * fx * rate(f.s)); }
    else { fee = r2(f.amt * rate(f.s)); q = f.type === 'buy' ? f.amt / f.px * (1 - rate(f.s)) : f.amt / f.px; }
    if (f.type === 'sell') { const p = book().h[f.s]; if (p && Math.abs(q - p.q) <= p.q * 0.005) q = p.q; }
    if (!nTouched) $('tr-n').value = q > 0 ? +q.toPrecision(8) : ''; else if (f.n > 0) q = f.n;
    if (!feeTouched) $('tr-fee').value = fee.toFixed(2); else fee = +$('tr-fee').value || 0;
    if (!(q > 0)) return null;
    const x = { s: f.s, amt: f.amt, q, px: f.px, fee };
    if (g) { x.fx = fx; const v = q * f.px * fx; if (f.type === 'buy') x.cost = r2(v + fee); else x.net = r2(v - fee); }
    else if (f.type === 'buy') x.cost = f.amt; else x.net = r2(f.amt - fee);
    return x;
  };
  const labels = (f) => {
    const g = isGold(f.s), trade = f.type === 'buy' || f.type === 'sell';
    ['tr-sym-l', 'tr-q-l', 'tr-px-l', 'tr-fee-l', 'tr-n-l'].forEach((k) => { $(k).hidden = !trade; });
    $('tr-fx-l').hidden = !trade || !g; $('tr-thb-l').hidden = trade;
    $('tr-q-lab').textContent = f.type === 'sell' ? 'ขายเป็นเงิน (บาท)' : 'จ่าย (บาท)';
    $('tr-px-lab').textContent = g ? 'ราคาที่ได้จริง (USD/oz)' : 'ราคาที่ได้ (บาทต่อเหรียญ)';
    $('tr-n-lab').textContent = g ? 'น้ำหนัก (oz) ตามสลิป' : 'จำนวนเหรียญที่ได้';
  };
  const preview = () => {
    const f = F(); labels(f); const out = $('tr-prev');
    if (f.type === 'dep' || f.type === 'wd') { out.textContent = f.type === 'dep' ? 'เงินบาทที่ใส่เข้าไปลงทุนส่วนนี้ (Binance TH หรือ Dime)' : 'เงินบาทที่ถอนออก'; return; }
    if (isGold(f.s) && !$('tr-fx').value) $('tr-fx').value = fxNow().toFixed(2);
    const x = calc(F());
    if (!x) { out.textContent = isGold(f.s) ? 'ใส่ยอดบาท ราคา USD/oz และอัตราแลกเปลี่ยนจากสลิป Dime น้ำหนักจะคำนวณให้ (แก้ให้ตรงสลิปได้)' : `ใส่ยอดบาทกับราคา ค่าธรรมเนียม Binance TH ${T.fees.crypto}% คิดให้อัตโนมัติ`; return; }
    let t = `ได้ ${qty(x.q)} ${unit(x.s)} · ค่าธรรมเนียม ${thb(x.fee)}`;
    if (isGold(x.s) && f.type === 'buy') { const v = x.q * x.px * x.fx; t += ` · มูลค่าทอง $${(x.q * x.px).toFixed(2)} = ${thb(v)} · เงินที่เหลือ ${thb(f.amt - x.cost)} กลับเข้าเงินสด`; }
    else if (f.type === 'buy') t += ` · ทุน ${thb(x.cost)}`;
    if (f.type === 'sell') { const p = book().h[x.s]; t += ` · ได้รับสุทธิ ${thb(x.net)}`; if (p) { const avg = p.cost / p.q, pl = x.net - avg * Math.min(x.q, p.q); t += ` · กำไรจริงไม้นี้ ${pthb(pl)} (${pct(pl / (avg * Math.min(x.q, p.q)))})`; } }
    out.textContent = t;
  };
  const add = () => {
    const f = F(), msg = $('tr-msg'); const trade = f.type === 'buy' || f.type === 'sell';
    let x;
    if (trade) {
      x = calc(f); if (!x) { msg.textContent = isGold(f.s) ? 'ใส่ยอดบาท ราคา USD/oz และอัตราแลกเปลี่ยนให้ครบ' : 'ใส่ยอดบาทและราคาให้ครบ'; return; }
      if (f.type === 'sell') { const p = book().h[f.s]; if (!(p && p.q >= x.q - 1e-12)) { msg.textContent = `ในพอร์ตมี ${nameOf(f.s)} ไม่ถึง ${qty(x.q)} ${unit(f.s)}`; return; } }
    } else { if (!(f.thb > 0)) { msg.textContent = 'ใส่จำนวนเงินบาท'; return; } x = { thb: f.thb }; }
    T.tx.push({ id: uid(), type: f.type, at: f.at, ...x }); save();
    nTouched = false; feeTouched = false; ['tr-q', 'tr-px', 'tr-fee', 'tr-n', 'tr-thb', 'tr-at'].forEach((k) => { $(k).value = ''; }); preview();
    msg.textContent = 'บันทึกแล้ว'; setTimeout(() => { msg.textContent = ''; }, 2500); draw();
  };
  const prefill = (o) => {
    $('tr-type').value = o.type; if (o.s) $('tr-sym').value = o.s;
    const g = isGold(o.s); const fx = fxNow();
    $('tr-q').value = o.amt != null ? Math.round(o.amt) : ''; $('tr-fx').value = g ? fx.toFixed(2) : '';
    $('tr-px').value = o.pxUsd != null ? (g ? o.pxUsd.toFixed(2) : +(o.pxUsd * fx).toPrecision(7)) : '';
    $('tr-at').value = ''; $('tr-n').value = ''; nTouched = false; feeTouched = false; preview();
    if (window.VGNav) window.VGNav.go('scan', 'tport');
    setTimeout(() => { $('tr-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('tr-q').focus({ preventScroll: true }); }, 80);
  };
  const sellBtn = (lab, s, amt) => { const b = el('button', 'btn-line sm', lab); b.type = 'button'; b.addEventListener('click', () => prefill({ type: 'sell', s, amt, pxUsd: SP() ? SP().usd(s) : null })); return b; };
  const buyBtn = (lab, s, amt) => { const b = el('button', 'btn-line sm', lab); b.type = 'button'; b.addEventListener('click', () => prefill({ type: 'buy', s, amt, pxUsd: SP() ? SP().usd(s) : null })); return b; };

  /* ---------- advice: hold, take profit, rebalance ---------- */
  const plan = (B, V) => {
    const eq = V.eq, band = T.band / 100; const tg = T.targets; const hasT = Object.values(tg).some((v) => v > 0);
    const out = {};
    const keys = new Set([...Object.keys(B.h), ...Object.keys(tg).filter((k) => tg[k] > 0)]);
    keys.forEach((s) => {
      const p = B.h[s], r = V.rows[s] || { v: 0, u: 0 }, st = SP() ? SP().status(s) : null;
      const w = eq > 0 ? r.v / eq : 0, t = (tg[s] || 0) / 100, gain = p && p.cost > 0 ? r.u / p.cost : 0;
      const a = { w, t, gain, st, acts: [] };
      if (st && st.h === 'weak' && p) a.acts.push(['out', 'เทรนด์ระยะยาวเป็นขาลงและแพ้ BTC ไม่ควรถือรอ พิจารณาลดสัดส่วนแล้วย้ายไปตัวที่แข็งแรงกว่า', 'sell', r.v / 2, 'ขายครึ่งหนึ่ง']);
      if (st && st.g === 'hot' && gain >= 0.3 && p) a.acts.push(['tp', `ร้อนแรงและมีกำไร ${pct(gain, 0)} แบ่งขาย 1/4 เก็บกำไรจริงไว้เป็นเงินสด`, 'sell', r.v / 4, 'แบ่งขาย 1/4']);
      if (hasT && w > t + band && p) a.acts.push(['tp', `สัดส่วน ${Math.round(w * 100)}% เกินเป้า ${Math.round(t * 100)}% ขายส่วนเกินให้กลับมาที่เป้า`, 'sell', (w - t) * eq, 'ขายส่วนเกิน']);
      if (hasT && w < t - band) {
        const need = (t - w) * eq;
        if (st && ['hot', 'wait'].includes(st.g)) a.acts.push(['slow', `สัดส่วน ${Math.round(w * 100)}% ต่ำกว่าเป้า ${Math.round(t * 100)}% แต่ราคายังแพง ทยอยเติมช้าๆ หรือรอย่อ`, null]);
        else a.acts.push(['buy', `สัดส่วน ${Math.round(w * 100)}% ต่ำกว่าเป้า ${Math.round(t * 100)}% และราคาเข้าได้ ซื้อเพิ่มให้ถึงเป้า`, 'buy', Math.min(need, B.cash > 0 ? B.cash : need), 'ซื้อเติม']);
      }
      if (!a.acts.length && p) a.acts.push(['hold', st && st.h === 'good' ? 'ถือต่อ เทรนด์ระยะยาวยังดี' : 'ถือต่อ', null]);
      out[s] = a;
    });
    return out;
  };

  /* ---------- views ---------- */
  const card = (k, v, h, cls) => { const d = el('div'); d.append(el('div', 'k', k), el('div', 'v' + (cls ? ' ' + cls : ''), v), el('div', 'h', h || '')); return d; };
  const daily = (B) => {
    const days = {}; const D = (d) => days[d] || (days[d] = { d, n: 0, pl: 0, fee: 0, flow: 0, buy: 0, sell: 0 });
    sorted().forEach((x) => {
      const r = D(bkDay(x.at));
      if (x.type === 'buy') { r.n++; r.fee += x.fee || 0; r.buy += costOf(x); }
      if (x.type === 'sell') { r.n++; r.fee += x.fee || 0; r.sell += netOf(x); if (B.real[x.id]) r.pl += B.real[x.id].pl; }
      if (x.type === 'dep') r.flow += x.thb; if (x.type === 'wd') r.flow -= x.thb;
    });
    Object.keys(T.snaps).forEach((d) => D(d));
    const list = Object.values(days).sort((a, b) => a.d.localeCompare(b.d)); let prev = null, cum = 0;
    list.forEach((r) => { cum += r.pl; r.cum = cum; const s = T.snaps[r.d]; r.eq = s ? s.eq : null; r.unreal = s ? s.unreal : null; r.chg = s && prev != null ? s.eq - prev - r.flow : null; if (s) prev = s.eq; });
    return list;
  };
  const draw = () => {
    if (!$('tr-strip')) return;
    const B = book(), V = value(B), today = bkDay(Date.now());
    if (T.tx.length && V.miss === 0) { const s = T.snaps[today], snap = { eq: Math.round(V.eq), cash: Math.round(B.cash), unreal: Math.round(V.unreal) }; if (!s || s.eq !== snap.eq || s.unreal !== snap.unreal) { T.snaps[today] = snap; save(false); } }
    const realAll = Object.values(B.real).reduce((a, x) => a + x.pl, 0), feeAll = T.tx.reduce((a, x) => a + (x.fee || 0), 0);
    const tot = realAll + V.unreal, locked = tot > 0 && realAll > 0 ? realAll / Math.max(tot, realAll) : 0;
    $('tr-strip').replaceChildren(
      card('มูลค่าพอร์ต', thb(V.eq), `เงินสด ${thb(B.cash)}${V.miss ? ' · ราคาบางตัวยังไม่มา ใช้ทุนแทน' : ''}`),
      card('กำไรบนกระดาษ', pthb(V.unreal), 'ยังไม่ได้ขาย ราคาลงก็หายได้ (หักค่าธรรมเนียมขายแล้ว)', tone(V.unreal)),
      card('กำไรจริง (ขายแล้ว)', pthb(realAll), `ล็อกไว้แล้ว ${Math.round(locked * 100)}% ของกำไรทั้งหมด · ค่าธรรมเนียมรวม ${thb(feeAll)}`, tone(realAll)),
      card('เทียบเงินที่ใส่', B.dep > 0 ? pthb(V.eq - B.dep) : '–', B.dep > 0 ? `ใส่สุทธิ ${thb(B.dep)} · ${pct(V.eq / B.dep - 1)}` : 'บันทึก "ฝากเงิน" ก่อน', B.dep > 0 ? tone(V.eq - B.dep) : ''));
    const P = plan(B, V);
    /* holdings */
    const hb = $('tr-hold'); hb.replaceChildren(); const hs = Object.entries(B.h);
    if (!hs.length) hb.append(el('div', 'empty', T.tx.length ? 'ตอนนี้ไม่ได้ถืออะไร' : 'เริ่มจากบันทึก "ฝากเงิน" แล้วกด "ซื้อแล้ว" ที่ตัวที่ราคาน่าซื้อด้านบน หรือบันทึกจากสลิปเอง'));
    hs.forEach(([s, p]) => {
      const r = V.rows[s], avg = p.cost / p.q, a = P[s];
      const row = el('div', 'sw-row');
      const who = el('div', 'sw-who'); who.append(el('b', null, nameOf(s)), el('small', null, `${qty(p.q)} ${unit(s)} · ทุน ${thb(p.cost)} (เฉลี่ย ${thb(avg)}${isGold(s) ? '/oz' : ''})`));
      const now = el('div', 'sw-now'); now.append(el('b', null, thb(r.v)), r.px == null ? el('small', null, 'ราคาจะมาเมื่อโหลดเสร็จ') : el('small', tone(r.u), `บนกระดาษ ${pthb(r.u)} (${pct(r.u / p.cost)}) · ${Math.round(a.w * 100)}% ของพอร์ต${a.t ? ' เป้า ' + Math.round(a.t * 100) + '%' : ''}`));
      row.append(who, now);
      if (a.st) { const tags = el('div', 'sw-tags'); tags.append(el('span', 'tag ' + SP().G[a.st.g][0], SP().G[a.st.g][1]), el('span', 'tag ' + SP().H[a.st.h][0], SP().H[a.st.h][1])); row.append(tags); }
      const act = el('div', 'sw-act');
      a.acts.forEach(([k, t, kind, amt, lab]) => { row.append(el('div', 'sw-adv sw-' + k, t + (amt ? ` ≈ ${thb(amt)}` : ''))); if (kind === 'sell') act.append(sellBtn(lab, s, amt)); if (kind === 'buy') act.append(buyBtn(lab, s, amt)); });
      act.append(sellBtn('ขายทั้งหมด', s, r.v)); row.append(act); hb.append(row);
    });
    drawTargets(B, V, P); drawLedger(B); drawDays(B);
  };
  const drawTargets = (B, V, P) => {
    const box = $('tr-targets'); if (!box) return;
    if (!box.dataset.built) {
      box.dataset.built = '1';
      (SP() ? SP().assets : []).forEach(([a]) => { const l = el('label', null, nameOf(a)); const x = el('input', 'inp'); x.type = 'number'; x.step = '1'; x.min = '0'; x.max = '100'; x.inputMode = 'numeric'; x.placeholder = '0'; x.dataset.a = a; if (T.targets[a]) x.value = T.targets[a];
        x.addEventListener('change', () => { const v = +x.value; if (v > 0) T.targets[a] = Math.min(100, v); else delete T.targets[a]; save(); draw(); }); l.append(x); box.append(l); });
      const l = el('label', null, 'ยอมให้คลาดจากเป้า (± จุด)'); const b = el('input', 'inp'); b.type = 'number'; b.min = '1'; b.max = '30'; b.step = '1'; b.id = 'tr-band'; b.value = T.band;
      b.addEventListener('change', () => { const v = +b.value; if (v >= 1 && v <= 30) { T.band = v; save(); draw(); } else b.value = T.band; }); l.append(b); box.append(l);
    } else box.querySelectorAll('input[data-a]').forEach((x) => { if (document.activeElement !== x) x.value = T.targets[x.dataset.a] || ''; });
    const sum = Object.values(T.targets).reduce((a, v) => a + v, 0);
    const note = $('tr-tnote');
    const miss = $('tr-tacts'); miss.replaceChildren();
    Object.entries(P).filter(([k, x]) => !B.h[k] && x.acts.length).forEach(([k, x]) => x.acts.forEach(([c, t, kind, amt, lab]) => { const d = el('div', 'sw-row'); d.append(el('div', 'sw-who', nameOf(k)), el('div', 'sw-adv sw-' + c, t + (amt ? ` ≈ ${thb(amt)}` : ''))); if (kind === 'buy') { const ac = el('div', 'sw-act'); ac.append(buyBtn(lab, k, amt)); d.append(ac); } miss.append(d); }));
    note.textContent = sum ? `รวม ${sum}% ที่เหลือ ${Math.max(0, 100 - sum)}% เป็นเงินสด (ตอนนี้เงินสด ${V.eq > 0 ? Math.round(B.cash / V.eq * 100) : 0}%)${sum > 100 ? ' · เกิน 100% ลดลงก่อน' : ''}` : 'ยังไม่ได้ตั้งเป้า ตั้งไว้แล้วระบบจะบอกว่าตัวไหนควรขายส่วนเกินหรือซื้อเติม เช่น ทอง 40 BTC 30 ETH 10 ที่เหลือเป็นเงินสด';
  };
  const drawLedger = (B) => {
    const lb = $('tr-tx'); lb.replaceChildren(); const TY = { buy: 'ซื้อ', sell: 'ขาย', dep: 'ฝากเงิน', wd: 'ถอนเงิน' };
    sorted().reverse().slice(0, 30).forEach((x) => {
      const li = el('li'); const rl = B.real[x.id];
      const px = x.s ? (isGold(x.s) && x.fx ? `$${(+x.px).toFixed(2)}/oz เรท ${x.fx}` : thb(x.px)) : '';
      li.append(el('b', null, TY[x.type] + (x.s ? ' ' + nameOf(x.s) : '')), el('span', null, x.s ? ` ${qty(x.q)} ${unit(x.s)} @ ${px} · ${x.type === 'buy' ? 'ทุน ' + thb(costOf(x)) : 'ได้ ' + thb(netOf(x))} · ${hm(x.at)} ` : ` ${thb(x.thb)} · ${hm(x.at)} `));
      if (rl) li.append(el('b', tone(rl.pl), pthb(rl.pl)));
      const del = el('button', 'tr-del', '×'); del.type = 'button'; del.setAttribute('aria-label', 'ลบรายการนี้');
      del.addEventListener('click', () => { if (del.dataset.ok) { T.tx = T.tx.filter((y) => y.id !== x.id); save(); draw(); } else { del.dataset.ok = '1'; del.textContent = 'ลบ?'; setTimeout(() => { if (del.isConnected) { delete del.dataset.ok; del.textContent = '×'; } }, 3000); } });
      li.append(del); lb.append(li);
    });
    $('tr-tx-h').hidden = !T.tx.length;
  };
  const drawDays = (B) => {
    const box = $('tr-days'); if (!box) return; box.replaceChildren();
    const rows = daily(B).reverse();
    if (!rows.length) { box.append(el('div', 'empty', 'ยังไม่มีรายการในพอร์ตนี้')); return; }
    const tb = el('table', 'tr-table'); const hd = el('tr');
    ['วันที่', 'ซื้อ', 'ขาย', 'กำไรจริง', 'ค่าธรรมเนียม', 'กำไรจริงสะสม', 'กำไรบนกระดาษ', 'มูลค่าพอร์ต', 'เปลี่ยนจากวันก่อน'].forEach((h) => hd.append(el('th', null, h)));
    const th = el('thead'); th.append(hd); tb.append(th); const bd = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr'); const td = (v, c) => tr.append(el('td', c || null, v));
      td(thDay(r.d)); td(r.buy ? thb(r.buy) : '–'); td(r.sell ? thb(r.sell) : '–'); td(r.sell ? pthb(r.pl) : '–', tone(r.pl)); td(r.fee ? thb(r.fee) : '–'); td(pthb(r.cum));
      td(r.unreal != null ? pthb(r.unreal) : '–', tone(r.unreal)); td(r.eq != null ? thb(r.eq) : '–'); td(r.chg != null ? pthb(r.chg) : '–', tone(r.chg)); bd.append(tr);
    });
    tb.append(bd); const w = el('div', 'tr-scroll'); w.append(tb); box.append(w);
    box.append(el('p', 'pf-hint', 'กำไรบนกระดาษกับมูลค่าพอร์ตจดอัตโนมัติวันที่เปิดหน้านี้ กำไรจริงนับเฉพาะที่ขายแล้ว'));
  };
  const csv = () => {
    const B = book(); const rows = [['date', 'time', 'type', 'asset', 'amount_thb', 'qty', 'unit', 'price', 'price_unit', 'fx', 'fee_thb', 'cost_or_net_thb', 'realized_thb']];
    sorted().forEach((x) => rows.push([bkDay(x.at), new Date(x.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok' }), x.type, x.s || '', x.amt ?? x.thb ?? '', x.q ?? '', x.s ? (isGold(x.s) ? 'oz' : 'coin') : '', x.px ?? '', x.s ? (isGold(x.s) && x.fx ? 'USD/oz' : 'THB') : '', x.fx ?? '', x.fee ?? '',
      x.type === 'buy' ? r2(costOf(x)) : x.type === 'sell' ? r2(netOf(x)) : '', B.real[x.id] ? r2(B.real[x.id].pl) : '']));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })); a.download = 'valuegrab-crypto-gold.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const setupFees = () => {
    const box = $('tr-fees'); if (!box) return; box.replaceChildren();
    [['crypto', 'คริปโต Binance TH (%)'], ['gold', 'ทอง Dime (%)']].forEach(([k, lab]) => { const l = el('label', null, lab); const x = el('input', 'inp'); x.type = 'number'; x.step = 'any'; x.inputMode = 'decimal'; x.value = T.fees[k];
      x.addEventListener('change', () => { const v = +x.value; if (v >= 0) { T.fees[k] = v; save(); preview(); draw(); } else x.value = T.fees[k]; }); l.append(x); box.append(l); });
  };

  const setup = () => {
    if (!$('tr-form')) return;
    const sel = $('tr-sym'); (SP() ? SP().assets : [['GOLD'], ['BTC']]).forEach(([a]) => sel.append(new Option(nameOf(a), a)));
    ['tr-type', 'tr-sym', 'tr-q', 'tr-px', 'tr-fx', 'tr-at', 'tr-thb'].forEach((k) => $(k).addEventListener('input', preview));
    $('tr-sym').addEventListener('change', () => { nTouched = false; feeTouched = false; $('tr-fx').value = ''; preview(); });
    $('tr-type').addEventListener('change', () => { nTouched = false; feeTouched = false; preview(); });
    $('tr-n').addEventListener('input', () => { nTouched = !!$('tr-n').value; preview(); });
    $('tr-fee').addEventListener('input', () => { feeTouched = true; preview(); });
    $('tr-add').addEventListener('click', add); $('tr-csv').addEventListener('click', csv);
    document.addEventListener('vg:spot', draw); document.addEventListener('vg:ready', draw);
    setupFees(); preview(); draw();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();

  window.VGTrade = {
    trade: () => T, prefill,
    equityTHB: () => { if (!T.tx.some((x) => x.type === 'dep')) return 0; return value(book()).eq; },
    replace: (c) => { T = norm(c); save(false); setupFees(); const b = $('tr-targets'); if (b) { b.replaceChildren(); delete b.dataset.built; } draw(); },
    merge: (c) => { const ids = new Set((c.tx || []).map((x) => x.id)); const tx = [...(c.tx || []), ...T.tx.filter((x) => !ids.has(x.id))];
      return { extra: tx.length - (c.tx || []).length, doc: { tx, snaps: { ...T.snaps, ...(c.snaps || {}) }, fees: { ...T.fees, ...(c.fees || {}) }, targets: { ...T.targets, ...(c.targets || {}) }, band: c.band || T.band } }; },
  };
})();
