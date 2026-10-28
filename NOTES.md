# ValueGrab: developer notes (read this instead of the whole template)

Site: https://valuegraber.github.io (GitHub Pages, `/docs` on `main`). Repo: ValueGraber/valuegraber.github.io.
Owner: Mon (Thai). All UI text is Thai, plain and calm.

## Files
- `src/template.html`: the source of truth for the page (~300 KB, one file: CSS, HTML, scripts). Do not read it whole; `grep -n` for anchors below.
- `src/calcs.js`: VI scoring (`CALC.scan/market/sectors`), inlined at `/*CALCS*/`.
- `tools/build.py`: builds `docs/index.html`. Always edit `src/`, then build. Never hand-edit `docs/index.html`.
- `tools/smoke.js`: opens every tab and sub-page on desktop and mobile with mock Firebase, fails on JS errors or overflow. Setup: `cd tools && npm i d3@7.9.0`.
- `tools/mockfb/`: fake Firebase (auth + Firestore in localStorage) for tests.
- `scanner.py` + `.github/workflows/update.yml`: daily cron (05:30 Thai, Tue–Sat) writes `docs/data.json` (500 S&P stocks, SPY, ^TNX, usdthb, gold GC=F, crypto BTC ETH SOL BNB XRP), `docs/history.json` (2y weekly closes incl. crypto) and `docs/prev.json` (previous day, for "what changed today").
- Dispatch the workflow: `gh api -X POST repos/ValueGraber/valuegraber.github.io/actions/workflows/update.yml/dispatches -f ref=main`.

## Template map (grep these comment anchors)
| Anchor | What |
|---|---|
| `/* calm pass` | final CSS overrides (font IBM Plex Sans Thai, hairlines) |
| `id="view-home"` / `/* home: one-screen` | home dashboard cards + full backup/restore |
| `id="view-money"` / `/* personal money` | net worth + asset pie (`drawAssetPie`), budget (kinds in/out/sav; `sav` is not expense; opening balance `M.open` → `leftOf`; groups `GROUPS`/`groupOf` with % targets `settings.gt`, map `settings.cg`; `drawWeek` pie + weekly), month calendar `drawCal` (shown on the nw sub-page, own month nav `mc-prev/next`) (`schedule(ym)` = bills, debt installments from `debt.day`, recurring income; pay/receive buttons, `payDebt` lowers the balance by the principal part), savings goals `M.goals` (entries link by `e.goal`), emergency fund, recurring income + bills (sub `fixed`; `M.incomes` type sal/other, gross + wht/sso/pvd/oth, `receive` logs an `in` entry carrying `sal:{g,t,s,p,o}`; `VGMoney.salary(y)` = received + still expected, used by the biz tax via `eff()` when the boxes are empty), debts (sub `debt`), retirement (`window.VGMoney`) |
| `id="view-scan"` / `const SIGNALS` | stock scanner, crypto list (`drawCrypto`), today summary (`drawToday`), detail sheet (`openSheet`) |
| `id="view-port"` / `/* portfolio: a single ledger` | trades/fx/div ledger, rebalance, DCA (`dcaS`, `boughtMap`), sell signals (`checkHolding`), growth, goal, calendar, yearly tax table (`window.VGPort`) |
| `id="view-biz"` / `/* business ledger` | income/expense, product cost + stock, invoices (`printDoc`, `bahtText`), tax 40(8) + deductions (`DITEMS`, `taxWith`) (`window.VGBiz`) |
| `/* ---------- layout: each card is a widget` | home cards: order / size (n,w,t,b) / hidden kept in `VGPrefs.get('home')`; `hc-left` and `hc-goals` hidden by default |
| `/* app preferences` | `window.VGPrefs` (dca, goal, ded, prof, slipMe). Taxpayer ID stays local only (`VGPrefs.tin`) |
| `/* slip scanner` | Tesseract.js 5.1.1 OCR (tha+eng) for slips and receipts (`window.VGSlip`) |
| `<script type="module">` | Firebase sync: `STORES` = portfolios / business / money docs per uid, `window.VGSync.push(col)` |
| `const SUBS =` | sub-page lists per tab; elements carry `data-sub="..."`, hidden via `.sub-off` |

## Conventions
- Events: `vg:ready` (data.json loaded), `vg:data` (any user data changed → home + scan re-render), `vg:view` (tab shown), `vg:watch`, `vg:prefs`, `vg:add` (open portfolio form with a symbol), `vg:open` (stock sheet).
- Navigation: `window.VGNav.go(view, sub)`. Views: home, money, scan, port, biz.
- Storage keys: `valuegrab-portfolio-v1`, `valuegrab-biz-v1`, `valuegrab-money-v1`, `valuegrab-prefs-v1`, `valuegrab-watch-v1`.
- Firestore rules (already published by Mon): `match /{col}/{uid}`, owner only, `col in ['portfolios','business','money']`. A new top-level collection needs a rule change.
- Expense categories: housing + water/electricity = `ที่พักและค่าน้ำไฟ`, internet/phone = `ค่าเน็ตและโทรศัพท์`; old names are mapped in `norm` (`mapCat`).
- Editing pattern: Python `rep(old, new)` with `assert count == 1`, then `python3 tools/build.py && node tools/smoke.js`, then commit and push. The remote may print "repository moved": that is harmless.
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Open ideas (not built)
- Import from the OwnLife .xlsx (needs the real file).
- Track record of past "buy" picks vs SPY; a how-to page; offline mode.
