/* invest → หุ้นเทรด: swing-trade screener for S&P 500 (money-master 2.2 / 2.4).
   Minervini Trend Template (8 conditions, 150/200-day MAs approximated with 30/40-week MAs from history.json weekly closes,
   RS = percentile of the 26-week return), market regime from SPY vs its 40-week MA, two setups:
   breakout watch (all 8 pass, price within 5% of the 52-week high, not > 5% extended) and pullback in an uptrend (≥ 7 pass,
   price 0–4% above the 50-day MA, RSI 40–58). Stop / 2R target / shares from account size and risk %. Never places orders. */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const KEY = 'vg-swing-v1';
  let set = { acct: 5000, risk: 1 }; try { set = { ...set, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch (e) { /* defaults */ }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch (e) { /* ignore */ } };
  const usd = (v) => (v == null || !isFinite(v) ? '–' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pc = (v) => (v == null ? '–' : (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%');
  let H = null, busy = false, err = '';
  const ma = (a, n, end) => { if (end < n - 1) return null; let s = 0; for (let i = end - n + 1; i <= end; i++) { if (a[i] == null) return null; s += a[i]; } return s / n; };
  const load = async () => {
    if (H || busy) return; busy = true;
    try { const r = await fetch('history.json?v=' + ((window.VG && window.VG.updated) || Date.now())); if (!r.ok) throw new Error(r.status); H = await r.json(); } catch (e) { err = 'โหลดราคาย้อนหลังไม่สำเร็จ'; }
    busy = false; draw();
  };
  const compute = () => {
    const raw = (window.VG && window.VG.raw) || {}, out = [], r26 = {};
    Object.entries(H.closes).forEach(([s, c]) => { const n = c.length - 1; if (n >= 26 && c[n] > 0 && c[n - 26] > 0) r26[s] = c[n] / c[n - 26] - 1; });
    const srt = Object.values(r26).sort((a, b) => a - b);
    const rsOf = (v) => { let lo = 0, hi = srt.length; while (lo < hi) { const m = (lo + hi) >> 1; if (srt[m] < v) lo = m + 1; else hi = m; } return Math.round((lo / Math.max(1, srt.length - 1)) * 100); };
    Object.entries(H.closes).forEach(([s, c]) => {
      const x = raw[s]; if (!x || !(x.price > 0) || !x.ma50 || !x.ma200) return; const n = c.length - 1, p = x.price;
      const last = c.slice(-52).filter((v) => v > 0).concat(p); if (last.length < 30) return;
      const hi52 = Math.max(...last), lo52 = Math.min(...last), m150 = ma(c, 30, n), m200w = ma(c, 40, n), m200w4 = ma(c, 40, n - 4), rs = r26[s] != null ? rsOf(r26[s]) : null;
      if (m150 == null || m200w == null || m200w4 == null) return;
      const C = [p > m150 && p > x.ma200, m150 > x.ma200, m200w > m200w4, x.ma50 > m150 && x.ma50 > x.ma200, p > x.ma50, p >= lo52 * 1.3, p >= hi52 * 0.75, rs != null && rs >= 70];
      const pass = C.filter(Boolean).length;
      const ed = x.earningsDate ? Math.round((new Date(x.earningsDate + 'T12:00:00Z') - Date.now()) / 86400000) : null;
      const base = { s, name: x.name, sector: x.sector, p, rs, pass, C, hi52, ma50: x.ma50, rsi: x.rsi, earn: ed != null && ed >= 0 && ed <= 7 ? ed : null };
      if (pass === 8 && p >= hi52 * 0.95 && p <= hi52 * 1.05) { const entry = Math.max(p, hi52 * 1.001), stop = entry * 0.93; out.push({ ...base, k: 'bo', entry, stop, tgt: entry + 2 * (entry - stop), ext: p > hi52 ? p / hi52 - 1 : 0 }); }
      if (pass >= 7 && p >= x.ma50 && p <= x.ma50 * 1.04 && x.rsi >= 40 && x.rsi <= 58) { let stop = x.ma50 * 0.97; if (stop >= p * 0.99) stop = p * 0.95; out.push({ ...base, k: 'pb', entry: p, stop, tgt: p + 2 * (p - stop) }); }
    });
    const sp = H.spy || [], sn = sp.length - 1, s40 = ma(sp, 40, sn), s40b = ma(sp, 40, sn - 4);
    const up = sp[sn] > s40 && s40 > s40b;
    return { out, regime: { up, spy: sp[sn], s40, weak: sp[sn] < s40 } };
  };
  const card = (r, half) => {
    const c = el('div', 'panel sx-card');
    const h = el('div', 'sx-h'); h.append(el('b', 'sx-sym', r.s), el('span', 'sx-nm', r.name || ''), el('span', 'tag ' + (r.k === 'bo' ? 'buy' : 'watch'), r.k === 'bo' ? 'ใกล้จุดเบรก' : 'ย่อในขาขึ้น'));
    c.append(h, el('p', 'pf-hint', `RS ${r.rs} · ผ่านเกณฑ์เทรนด์ ${r.pass}/8 · ราคา ${usd(r.p)} · ห่างจุดสูงสุด 52 สัปดาห์ ${pc(r.p / r.hi52 - 1)} · RSI ${r.rsi != null ? Math.round(r.rsi) : '–'}`));
    const risk = r.entry - r.stop, riskUsd = set.acct * (set.risk / 100) * (half ? 0.5 : 1);
    const sh = Math.max(0, Math.min(Math.floor(riskUsd / risk), Math.floor((set.acct * 0.25) / r.entry)));
    const lv = el('div', 'gt-lv'); [['เข้า', r.entry], ['SL', r.stop], ['TP 2R', r.tgt]].forEach(([k, v]) => { const d = el('div'); d.append(el('small', null, k), el('span', null, usd(v))); lv.append(d); });
    c.append(lv, el('p', 'sw-size', sh ? `${sh} หุ้น (${usd(sh * r.entry)}) · เสี่ยง ${usd(sh * risk)} ถ้าโดน SL${half ? ' · ครึ่งขนาดเพราะตลาดอ่อน' : ''}` : 'บัญชีเล็กเกินสำหรับระยะ SL นี้'));
    const why = r.k === 'bo' ? `รอแท่งวันปิดเหนือ ${usd(r.hi52)} พร้อมวอลุ่มสูงกว่าปกติ 1.5 เท่า ถ้าวิ่งเกิน 5% แล้วไม่ไล่` : `ราคาย่อมาใกล้เส้น 50 วัน (${usd(r.ma50)}) ในขาขึ้น รอแท่งเขียวปิดสูงกว่าแท่งก่อนแล้วค่อยเข้า`;
    c.append(el('p', 'sw-why', why));
    if (r.earn != null) c.append(el('p', 'neg sx-warn', `งบออกในอีก ${r.earn} วัน ราคาอาจกระโดดข้าม SL ควรรอหลังงบ`));
    const b = el('button', 'btn-line sm', 'ดูรายละเอียดหุ้น'); b.type = 'button'; b.addEventListener('click', () => document.dispatchEvent(new CustomEvent('vg:open', { detail: r.s }))); c.append(b);
    return c;
  };
  const draw = () => {
    const box = $('sx-out'); if (!box) return; box.replaceChildren();
    if (err) { box.append(el('div', 'empty', err)); return; }
    if (!H || !window.VG || !window.VG.raw) { box.append(el('div', 'loading', 'กำลังโหลด…')); return; }
    const { out, regime } = compute(), half = !regime.up;
    box.append(el('p', 'rk-l ' + (regime.up ? 'pos' : 'neg'), regime.up ? `ตลาดขาขึ้น: S&P 500 (${usd(regime.spy)}) อยู่เหนือเส้น 40 สัปดาห์และเส้นชี้ขึ้น เปิดรับความเสี่ยงได้` : `ตลาดอ่อน: S&P 500 (${usd(regime.spy)}) ${regime.weak ? 'อยู่ใต้' : 'อยู่เหนือแต่เส้นยังไม่ชี้ขึ้น'}เส้น 40 สัปดาห์ (${usd(regime.s40)}) ลดขนาดครึ่งหนึ่งหรืองดเข้าใหม่`));
    [['bo', 'ใกล้จุดเบรก (ผ่านเกณฑ์เทรนด์ครบ 8 ข้อ)'], ['pb', 'ย่อในขาขึ้น (ใกล้เส้น 50 วัน)']].forEach(([k, t]) => {
      const list = out.filter((r) => r.k === k).sort((a, b) => b.rs - a.rs).slice(0, 12);
      box.append(el('h3', 'gt-h3', `${t} · ${out.filter((r) => r.k === k).length} ตัว`));
      if (!list.length) box.append(el('div', 'empty', 'วันนี้ไม่มีหุ้นเข้าเงื่อนไข'));
      list.forEach((r) => box.append(card(r, half)));
    });
    const dt = H.dates && H.dates.length ? H.dates[H.dates.length - 1] : ''; box.append(el('p', 'pf-hint', `ราคาวันล่าสุดจากระบบ · เส้น 150/200 วันประมาณจากราคาปิดรายสัปดาห์ถึง ${dt} · ใช้คัดหุ้นมาดูต่อ ไม่ใช่สัญญาณซื้อ`));
  };
  const visible = () => { const s = $('sx'); return s && !s.classList.contains('sub-off') && $('view-scan') && !$('view-scan').hidden && document.body.dataset.tab === 'invest'; };
  const setup = () => {
    if (!$('sx-out')) return;
    [['sx-acct', 'acct'], ['sx-risk', 'risk']].forEach(([id, k]) => { const x = $(id); x.value = set[k]; x.addEventListener('change', () => { const v = +x.value; if (v > 0) { set[k] = v; keep(); draw(); } else x.value = set[k]; }); });
    document.addEventListener('vg:ready', () => { if (H) draw(); });
    setInterval(() => { if (visible()) { if (!H) load(); } }, 1500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.VGSwingX = { _compute: () => (H ? compute() : null) };
})();
