// Daily log of the scanner's "น่าซื้อสะสม" picks so the site can measure them later against SPY (money-master: prove the screener works).
// Run after scanner.py: node tools/picks.js   → appends { d, spy, p: [[symbol, price], ...] } to docs/picks.json (one row per data date).
const fs = require('fs'); const path = require('path');
const R = path.resolve(__dirname, '..'); const CALC = {}; const dash = { calc: (id, o) => { CALC[id] = o; } };
new Function('dash', fs.readFileSync(path.join(R, 'src/calcs.js'), 'utf8'))(dash);
const d = JSON.parse(fs.readFileSync(path.join(R, 'docs/data.json'), 'utf8'));
if (d.live) { console.log('live snapshot, skip'); process.exit(0); }
const rows = CALC.scan.fn(d.stocks, d.yield).filter((r) => r.signal === 'น่าซื้อสะสม' && r.price > 0);
const spy = Array.isArray(d.spy) ? (d.spy[d.spy.length - 1] || {}).close : d.spy && d.spy.price;
const f = path.join(R, 'docs/picks.json'); let log = []; try { log = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* first run */ }
const date = d.asOf || (d.updated || '').slice(0, 10);
log = log.filter((x) => x.d !== date); log.push({ d: date, spy: spy || null, p: rows.map((r) => [r.symbol, +r.price.toFixed(2)]) });
log.sort((a, b) => (a.d < b.d ? -1 : 1)); fs.writeFileSync(f, JSON.stringify(log));
console.log('picks', date, rows.length, 'spy', spy);
