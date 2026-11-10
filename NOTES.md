# ValueGrab: developer notes (read this instead of the whole template)

Site: https://valuegraber.github.io (GitHub Pages, `/docs` on `main`). Repo: ValueGraber/valuegraber.github.io.
Owner: Mon (Thai). All UI text is Thai, plain and calm.

## Files
- `src/template.html`: the source of truth for the page (~300 KB, one file: CSS, HTML, scripts). Do not read it whole; `grep -n` for anchors below.
- `src/calcs.js`: VI scoring (`CALC.scan/market/sectors`), inlined at `/*CALCS*/`.
- `tools/build.py`: builds `docs/index.html`. Always edit `src/`, then build. Never hand-edit `docs/index.html`.
- `tools/smoke.js`: opens every tab and sub-page on desktop and mobile with mock Firebase, fails on JS errors or overflow. Setup: `cd tools && npm i d3@7.9.0`.
- `tools/mockfb/`: fake Firebase (auth + Firestore in localStorage) for tests.
- `scanner.py` + `.github/workflows/update.yml`: daily cron (05:30 Thai, Tue–Sat) writes `docs/data.json` (500 S&P stocks, SPY, ^TNX, usdthb, eurthb, sekthb (`fx_thb`), gold GC=F, crypto BTC ETH SOL BNB XRP), `docs/history.json` (2y weekly closes incl. crypto) and `docs/prev.json` (previous day, for "what changed today").
- Schedule: every 30 min at :07/:37 from 05:07 to 10:07 Thai (Tue–Sat). Plus Monday night every 30 min 20:30–22:30 Thai (`30 13 * * 1`, `0,30 14-15 * * 1` UTC; crons ending in ` 1` pass `--live`) runs `fresh.py --live`: one intraday snapshot while NYSE is open; scanner writes `live: true` (asOf = today NY, before 16:30 NY), the web stamp says ราคาระหว่างวัน, and Tuesday morning still fetches the close because fresh.py never skips on `live`. Each scheduled run first runs `tools/fresh.py` (expected last NYSE close vs `docs/data.json` asOf, holiday list 2026–2027 inside) and skips in seconds when fresh; manual dispatch always runs. Update `HOLIDAYS` each year. Dispatch the workflow: `gh api -X POST repos/ValueGraber/valuegraber.github.io/actions/workflows/update.yml/dispatches -f ref=main`.

## Template map (grep these comment anchors)
| Anchor | What |
|---|---|
| `/* calm pass` | older CSS overrides (sizes, hairlines) |
| `/* passbook world` | the last CSS block: current look (passbook cover band, page tabs, Noto Sans Thai Looped + Chivo Mono figures, double-rule totals). See `DESIGN.md` and `PRODUCT.md` |
| `id="view-home"` / `/* home: one-screen` | home dashboard cards + full backup/restore |
| `id="view-money"` / `/* personal money` | net worth + asset pie (`drawAssetPie`), accounts have `cur` THB/USD/EUR/SEK (`rate()`: `settings.fxr` manual else `VG.fx/eur/sek`), monthly P/L for accounts with `pl` (`a.inv` total invested in the account currency, kept in step with later `f` entries from `a.invAt`; `a.log[ym] = {v, f}`, `plRows`, `plTotals`; group `pl` on the overview page; home card `hc-pl`), budget (kinds in/out/sav; `sav` is not expense; opening balance `M.open` → `leftOf`; groups `GROUPS`/`groupOf` with % targets `settings.gt`, map `settings.cg`; `drawWeek` pie + weekly), month calendar `drawCal` (shown on the nw sub-page, own month nav `mc-prev/next`) (`schedule(ym)` = bills, debt installments from `debt.day`, recurring income; pay/receive buttons, `payDebt` lowers the balance by the principal part), savings goals `M.goals` (entries link by `e.goal`), emergency fund, recurring income + bills (sub `fixed`; `M.incomes` type sal/other, gross + wht/sso/pvd/oth, `receive` logs an `in` entry carrying `sal:{g,t,s,p,o}`; `VGMoney.salary(y)` = received + still expected, used by the biz tax via `eff()` when the boxes are empty), debts (sub `debt`), retirement (`window.VGMoney`) |
| `id="view-scan"` / `const SIGNALS` | stock scanner, crypto list (`drawCrypto`), today summary (`drawToday`), detail sheet (`openSheet`) |
| `id="view-port"` / `/* portfolio: a single ledger` | trades/fx/div ledger, rebalance, DCA (`dcaS`, `boughtMap`), sell signals (`checkHolding`), growth, goal, calendar, yearly tax table (`window.VGPort`) |
| `id="view-biz"` / `/* business ledger` | income/expense, product cost + stock, invoices (`printDoc`, `bahtText`), tax 40(8) + deductions (`DITEMS`, `taxWith`) (`window.VGBiz`) |
| `/* ---------- layout: each card is a widget` | home cards: order / size (n,w,t,b) / hidden kept in `VGPrefs.get('home')`; `hc-left` and `hc-goals` hidden by default |
| `/* app preferences` | `window.VGPrefs` (dca, goal, ded, prof, slipMe). Taxpayer ID stays local only (`VGPrefs.tin`) |
| `/* slip scanner` | Tesseract.js 5.1.1 OCR (tha+eng) for slips and receipts (`window.VGSlip`) |
| `id="swing"` / `src/spot.js` | invest → คริปโตและทอง: long-term spot entry timing on daily bars for 12 crypto majors + gold (PAXG price, shown in baht/gram). Engine `src/spot-core.js` (`SPC.scan/status/backtest/advise`, inlined at `/*SPOTCORE*/`): setups pb/rc/dv, stop = swing low − 1 ATR (cap 25% crypto, 12% gold), TP1 +1.5R sell 1/3 then stop to entry, TP2 +3R sell 1/3, last third exits on a close below SMA50. Binance public `data-api.binance.vision` 1000 daily bars, live via `data-stream` WebSocket, REST poll fallback; runs only while one of its sub-pages is visible. Baht = USDT × `VG.fx`. `window.VGSpot`. Sub `swlog` = backtest table per asset. Settings in localStorage `valuegrab-spotset-v1` |
| `src/trade.js` / `id="tport"` `id="tday"` | spot portfolio in baht (`window.VGTrade`): `tx` dep/wd {thb}, buy/sell {s, q, px THB/unit, fee, plan, stage}; fees `crypto` 0.25% (Binance TH THB pairs incl. VAT), `gold` 0% (Dime 99.99%, spread only); average cost, advice from `SPC.advise`, daily table by Bangkok date, `snaps`, CSV. Synced as field `spot` inside the `portfolios` doc. Local key `valuegrab-spot-v1` |
| `<script type="module">` | Firebase sync: `STORES` = portfolios / business / money docs per uid, `window.VGSync.push(col)` |
| `const PAGES =` | navigation: 4 tabs (home, money, invest, biz) → pages → groups of old `data-sub` keys; titled groups fold (`.acc-h`, state in `vg-acc`). invest pages use views `port` and `scan`. Global `nav.subnav` sits before `#view-home`; bottom bar on phones; `#fab` quick-add menu (home script) |

## Conventions
- Events: `vg:ready` (data.json loaded), `vg:data` (any user data changed → home + scan re-render), `vg:view` (tab shown), `vg:watch`, `vg:prefs`, `vg:add` (open portfolio form with a symbol), `vg:open` (stock sheet).
- Navigation: `window.VGNav.go(view, sub)` still takes old pairs like ('money','goals') or ('port','check'); `resolve()` maps them to tab/page and opens the group. Hashes: #money #invest #biz (old #portfolio #scan #business still work). Views: home, money, scan, port, biz.
- Storage keys: `valuegrab-portfolio-v1`, `valuegrab-biz-v1`, `valuegrab-money-v1`, `valuegrab-prefs-v1`, `valuegrab-watch-v1`.
- Firestore rules (already published by Mon): `match /{col}/{uid}`, owner only, `col in ['portfolios','business','money']`. A new top-level collection needs a rule change.
- Expense categories: housing + water/electricity = `ที่พักและค่าน้ำไฟ`, internet/phone = `ค่าเน็ตและโทรศัพท์`; old names are mapped in `norm` (`mapCat`).
- Sync: `push` remembers what it sent (`s.last`, key-sorted JSON); the snapshot that echoes our own write is skipped, so typing is never interrupted by a redraw. Lists that rebuild should also skip rebuilding while one of their inputs has focus (see `drawPL`).
- Editing pattern: Python `rep(old, new)` with `assert count == 1`, then `python3 tools/build.py && node tools/smoke.js`, then commit and push. The remote may print "repository moved": that is harmless.
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Open ideas (not built)
- Import from the OwnLife .xlsx (needs the real file).
- Track record of past "buy" picks vs SPY; a how-to page; offline mode.

## Diet page (`/diet/`)
- Separate weight-loss planner at https://valuegraber.github.io/diet/. Source `src/diet.html` (same body as Mon's Claude artifact), build with `python3 tools/build_diet.py` → `docs/diet/index.html`. Not part of `tools/build.py`.
- Storage: localStorage `wl-profile`, `wl-day-YYYY-MM-DD`, `wl-week-<monday>`; signed in → Firestore `diet/{uid}` (profile), `diet/{uid}/days/{date}`, `diet/{uid}/weeks/{monday}`. Same Firebase project/auth as ValueGrab. First sign-in uploads local data if the account has no profile yet.
- Features: exercise demos (`EX` steps + `POSES` stick figures, `openEx`), lift log (`profile.lifts`, `logLift`, `hintFor`), rest `Timer`, `profile.recent` foods + `copyMeal`, 7-day `renderSummary` + CSV `exportCsv`, waist/hip in `profile.weights`.
- Needs rule: `match /diet/{uid}/{rest=**} { allow read, write: if request.auth != null && request.auth.uid == uid; }`
