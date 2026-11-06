# Design: the passbook

ValueGrab looks like a Thai bank passbook (สมุดบัญชี): a deep-indigo cover with a foil wordmark, pale security-tint pages, figures printed in a balance column. Calm, familiar, and Mon's own. Surface mode: Operate (daily phone use, dark mode common).

## World
- **Cover band**: full-width indigo gradient (`--cover-2` → `--cover`) with a faint guilloche wave, drawn by `body::before`, height `--band` (114px desktop, 72px phone). Wordmark "Value" in `--cover-ink`, "Grab" in `--foil`, with a small foil booklet outline.
- **Page tabs** (desktop): the selected main tab is cut from the page (`--bg`) into the cover. Phone: bottom bar, selected item in `--accent` with a foil notch on top.
- **Sub-pages**: index tabs on a ruled edge, the active one underlined in `--accent`.
- **Figures**: key numbers in Chivo Mono (`--num`), tabular. Totals carry the accountant's double rule (`border-bottom: 3px double var(--line-2)`): `.strip .v`, `.hbig`, `#iv-sum b`, table `tfoot`.
- **Balance band** (`.strip`): square top edge with a 3px cover-coloured rule (foil in dark).
- **Stamps**: tags, mood and score are small rectangles (radius 4–8) with a hairline in their own colour, never pills.
- **Quick add**: rounded-square button in cover indigo (foil in dark), like a passbook in the hand.

## Colour roles
- `--cover`, `--cover-2`, `--cover-ink`, `--foil`: the shell only.
- `--accent` / `--accent-soft` / `--on-accent`: interactive (buttons, focus, selection, checkboxes).
- `--jade` = deposit / up / good, `--brick` = stamp red / loss / alert, `--ochre` = watch. Meaning only, never decoration.
- Ground `--bg` (pale security blue in light, night ink in dark), cards `--surface`, hairlines `--line`, stronger rules `--line-2`.
- Charts: `PAL` in the indigo / deposit green / foil family; benchmark (SPY) line in foil.

## Type
- Noto Sans Thai Looped (400–700): all text; the looped Thai of printed bank documents.
- Chivo Mono (400–600): figures only.

## Shape
Cards radius 10, controls 8, hairline borders, almost no shadow. Light and dark follow the system.

## Where it lives
`src/template.html`, the final CSS block `/* passbook world` (tokens in `:root` at the top).
