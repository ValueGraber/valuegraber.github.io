# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One person: Mon, the owner, based in Rayong, Thailand. Uses the site daily, mostly on a phone (dark mode on the phone is common), sometimes on a desktop. Reads Thai; English is a second language, so labels stay Thai and plain.

## Product Purpose
A personal finance home in one page: an S&P 500 value scanner plus a crypto list, a stock portfolio (DCA, rebalance, sell signals), personal money (net worth, budget, bills, debts, goals, retirement), a small business ledger with Thai tax 40(8) and invoices, and a slip/receipt scanner. Success: Mon opens it every day because it is pleasant and the important number on each page is obvious.

## Positioning
Built for one Thai investor-entrepreneur's whole money life at once: value-investing picks, personal budget and Thai business tax share one ledger and sync to one account.

## Operating Context
Static GitHub Pages site (`docs/`, built from `src/template.html` by `tools/build.py`). Data refreshes daily from `scanner.py`. User data in localStorage, synced through Firebase per uid. Four tabs: home, money, invest, biz; sub-pages and folding groups; bottom bar and quick-add button on phones.

## Capabilities and Constraints
- All text is Thai, calm and plain. Content, labels, features and data are out of scope for visual work.
- Signals and tax numbers are estimates; the not-advice disclaimers stay visible.
- Single HTML file, no framework; must pass `tools/smoke.js` (no JS errors, no horizontal overflow) on desktop light and mobile dark.
- Light and dark themes both supported (follows the system).

## Brand Commitments
- Name: ValueGrab (wordmark "Value" + "Grab").

## Product Principles
- The number that matters on each page is read first.
- Calm, not loud: money tools should lower stress, not add it.
- Distinct enough to feel like Mon's own place, not a generic web app.
- Phone first; the desktop is a wider version of the same thing.
