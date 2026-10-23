# Improvement pipeline — Brazilian banks desk

A staged plan for turning the five-screen prototype into a research tool a PM would actually
put capital behind. Stage gates are sequential: do not start a stage until the previous gate
passes, because every later stage inherits the data errors of the earlier one.

Effort is in analyst-days (1 = half a day of focused work).

---

## Where it actually stands

| Layer | State | Blocks what |
|---|---|---|
| Snapshot (34 banks × 13 quarters) | Loaded, but carries at least 3 undocumented structural breaks | Every ratio on every screen |
| Ratio layer | Derived in `app.js`, defensible, but no plausibility gate | Trust in movers, cost of risk, efficiency |
| Reconciliation (IFRS bridge) | 26 rows, 6 banks only, no automated tie-out | Calling it a bridge at all |
| Coverage | Balance sheet + 6 ratios. No capital, no bank-level NPL, no market data | Valuation, ranking on risk-adjusted returns |
| Interaction | Filters, quarter stepper, map/ladder, P&L bridge, CSV | Saved views, comparison baskets, notes |
| Delivery | 5 HTML files + 3 shared assets + one orphaned 118 KB single-pager | Performance, one source of truth |

The prototype's real achievement is the interaction model. The real liability is that a
plausible-looking ROE tile can sit next to a NIM that is off by 10× and nothing in the UI
says so. Fix that before adding a single new chart.

---

## Stage 0 — Defect register (do this first, 3–4 days)

Nine findings from reading `assets/data.js` directly. Each is either a break that must be
restated or a value that should be suppressed, never interpolated.

| # | Finding | Evidence | Disposition |
|---|---|---|---|
| 1 | Credit-book definition breaks at 2025 Q1 | Santander 740.9 → 534.4, XP 68.0 → 29.7, ABC 32.2 → 20.2, Cielo 5.8 → 0.0, CloudWalk 0.42 → 0.0 while assets move −8% to +2% | Split series at the break; never compute a growth rate across it |
| 2 | NIM breaks at 2025 Q4 for the payments cohort | Mercado Pago 1.2% → 12.3%, PagSeguro −5.1% → 11.0%, Stone −7.4% → 16.0%, Cielo 0.4% → 7.6%, CloudWalk 1.2% → 16.4% | Denominator changed, not economics. Restate or truncate the series |
| 3 | Cost of risk carries impossible magnitudes | Stone −83.2% of credit book (2023 Q4); CloudWalk −19.3% | Suppress below a floor; a negative charge of that size is a sign error |
| 4 | Efficiency ratio explodes | Stone 57.6 (2025 Q1), Original 266.9 (2025 Q2), PagSeguro 2.85 (2025 Q3) | Cap the display, flag the point, exclude from cohort medians |
| 5 | Missing print at 2024 Q4 | `npl.PF`, `npl.PJ` and all six `mods` series are `null` there | Keep the hole visible; do not interpolate (already correct — guard it with a test) |
| 6 | Field dictionary does not exist | `cro`, `nim`, `cor`, `cov`, `eff` are four-character guesses | Publish a definition per field: numerator, denominator, annualisation, net/gross |
| 7 | Duplicate, mistranslated segment table | `modalities` ("Otros (personas)", "Tarjeta de crédito") duplicates the last two values of `mods` | Delete one; `mods` is the time series, keep it |
| 8 | "Exact match" notes contradict their own numbers | Caixa total credit 1379.22 vs 1379.20 called exact; BB repos 685.5 vs 696.94 with a "1.7% gap" note | Compute the delta in code and let the note quote it, never hand-write it |
| 9 | Silent truncation | BRB ends at 2025 Q3 with no flag | Render as "no filing" rather than a blank that looks like zero |

**Gate:** every field in the snapshot has a dictionary entry; every break has an owner and a
restatement decision recorded in a `breaks.json` sidecar.

---

## Stage 1 — Validation harness (2–3 days)

Move the checks above from prose into code that fails loudly.

- `validate(data)` → returns `{ errors, warnings }`; runs on load in dev, in CI on refresh.
- Rules, each with a tolerance: assets > 0; equity > 0; equity/assets within 3–25%;
  |NIM| < 12%; |cost of risk| < 8%; efficiency between 20% and 150%; coverage between 0 and 1.5;
  no ratio moves more than 3× quarter-on-quarter without an entry in `breaks.json`;
  TTM flows reconcile to the ratio × balance within 2%.
- Failures render as a per-bank data-quality badge in the dossier, not a console error.
- Golden-file test: the 2026 Q2 aggregate must stay within ±0.01 of a checked-in fixture.

**Gate:** a deliberately corrupted quarter causes a visible, specific failure on screen.

---

## Stage 2 — Coverage: what equity research needs and does not have (5–7 days)

The current extract supports a profitability read and nothing else. Four gaps, in value order.

1. **Capital (highest value, smallest lift).** IF.Data already publishes the Basel ratio, Tier 1
   and the capital requirement per conglomerate — the same endpoint the snapshot came from.
   Add `bas`, `t1`, `rwa`. Without RWA you cannot compute RAROC, and without RAROC an ROE
   ranking rewards leverage. This single addition makes the dossier defensible.
2. **Bank-level asset quality.** The published IF.Data credit tables carry the overdue and
   provisioning breakdown per institution. The current system-level NPL panel is a workaround
   for a missing join, not a data limitation. Add `npl90`, `npl_hh`, `npl_corp`, `prov`.
3. **Market data.** Price, shares, market cap, P/B, P/E, dividend yield, and 12-month price
   return. Needed for the only two questions a PM asks: is it cheap, and what does the market
   already believe. Point-in-time only — a P/B computed off today's price rewrites history.
4. **Segment and mix.** Loan book by product per bank, funding mix, fee income as its own line.
   Today "other result" absorbs fees, treasury, cost and tax into one residual; that residual is
   the largest single number in the P&L bridge and it explains nothing.

**Gate:** every screen states its coverage; no metric appears unless the underlying field is
present for at least 80% of the universe at that quarter.

---

## Stage 3 — Analytics depth (5–6 days)

- **P&L as a real bridge**, not a residual plug. NII + fees + insurance + treasury − cost −
  provisions − tax = net income, with the residual shrunk by an order of magnitude once fees
  are split out.
- **Capital-adjusted returns.** ROE ÷ (RWA/assets) and a RAROC column in the peer matrix.
- **Peer-relative z-scores** on every ratio, so the dossier's percentile rulers stop depending
  on a hand-picked cohort and start using the full distribution.
- **Contribution attribution**: what moved sector ROE this quarter — margin, risk, cost,
  mix — decomposed additively, summing to the actual change.
- **Sensitivity**: ±100 bp Selic, ±50 bp cost of risk, applied to NII and net income per bank.
  Crude is fine; unlabelled is not.

**Gate:** the decomposition sums to the reported change within rounding, and any residual above
2% of the total is labelled as unexplained on screen.

---

## Stage 4 — Verification and calculation surface (6–8 days)

The screens currently let an analyst *look*. They do not let one *check*.

- **Lineage on demand.** Click any figure → the field, the source table, the as-of date, the
  formula. This is the single highest-trust-per-hour feature in the whole pipeline.
- **Comparison basket.** Pin 2–5 banks, then every screen filters to the basket. Persisted.
- **Saved views.** Named filter + quarter + metric sets, shareable by URL.
- **Model export.** Download the raw series for the selection as CSV *and* as a tidy
  long-format table keyed by `(bank_id, period, field)` — the format a model actually ingests.
- **Analyst notes.** Per bank, per quarter, local, exportable with the data.
- **Revision log.** When a bank restates, show the previous print struck through.

**Gate:** a colleague can go from "Bradesco looks wrong" to "here is the source line" in under
thirty seconds without leaving the app.

---

## Stage 5 — Craft and reach (4–5 days)

- Delete `brazilian-banks-dashboard.html`. It is 118 KB of superseded logic and it is the only
  file that can drift from the shared data module.
- Split the snapshot: one file per quarter under `assets/data/`, loaded on demand. The single
  44 KB literal is already the slowest thing on the page and it grows linearly.
- Tablet and 1280 px layout pass. The treemap label logic needs a second threshold below 900 px.
- Keyboard: arrow-key quarter stepping exists — extend to bank switching, map/ladder toggle and
  table sort, with a visible focus ring on every one.
- Contrast regression test: re-run the tile-legibility solver in CI so a new colour mode cannot
  ship a label below 5:1.

**Gate:** first screen interactive under 1.5 s on a cold load at 3G throttle.

---

## Stage 6 — Operating it (ongoing)

- Nightly refresh job: fetch → validate → diff → publish. Publish only if `validate` returns
  zero errors; otherwise keep yesterday's snapshot and raise.
- One page per release: what was added, what was restated, what broke.
- Snapshot versioning keyed to the IF.Data reference date, so a chart can say *as of 2026-06,
  retrieved 2026-08-14*.
- A fixture of the last four validated snapshots, so a change in the parser shows up as a diff
  and not as a plausible new number.

---

## Order of work, condensed

1. Defect register and field dictionary — nothing else can be trusted until it exists.
2. Validation harness — so the register stays fixed.
3. Capital and bank-level NPL — the largest jump in analytical value per day spent.
4. Fees and cost split — turns the residual bridge into a real one.
5. Lineage and export — turns a viewer into a workbench.
6. Market data — only once the accounting side is clean, otherwise you are valuing errors.
7. Craft and performance — last, because the interaction model is already right.

---

## Delivery log — 2026-08-14

**Stage 0 — closed.** The register exists as data, not prose: `assets/breaks.json` holds
fourteen rules with evidence, owner and a restatement decision each; `assets/breaks.js` is
generated from it by `tools/build-breaks.js` so the desk can load it from `file://`; the
field dictionary lives in the same file, including four fields (`bas`, `rwa`, `npl90`,
`price`) recorded as *absent* rather than assumed.

**Stage 1 — closed.** `assets/validate.js` runs on every page load. 3,432 checks, 70 prints
restated, 34 gaps kept, 129 notes. It does four things the prototype did not:

1. Splits the credit and margin series at their joins, so no growth rate crosses a break.
2. Suppresses impossible prints (cost of risk below −2%, a zero credit book) and resolves every
   aggregate and cohort median over the *usable* cohort instead of counting a broken print at zero.
3. Grades each bank A–D from its own findings, and exposes that grade on the board, the dossier,
   the peer matrix and the register.
4. Renders the failure on screen — `data-integrity.html`, plus a lineage dialog behind any figure
   (value shown, source print, formula, table, as-of date, finding that touched it).

Stage 3's peer-relative percentiles now use the full clean distribution rather than a cohort that
silently included a −99% cost of risk.

**Stage 4 — partially shipped.** Comparison basket (2–5 banks, filters every screen), per-bank and
per-quarter analyst notes, tidy long-format CSV keyed by `(bank_id, period, field)` with a status
column, and a findings export. Saved named views and the revision log are still open.

**Still open, in value order.**

1. **Capital and RWA.** Same IF.Data endpoint, not in this extract. Without it no return here is
   leverage-adjusted and the ROE ranking still rewards balance-sheet shape. Highest value per day.
2. **Bank-level NPL.** A join against the published credit tables, not a data limit.
3. **Market data.** Only after 1 and 2, otherwise it values errors.
4. **Split the 44 KB snapshot per quarter** and delete `brazilian-banks-dashboard.html` — 118 KB of
   superseded logic that can drift from `assets/data.js`. Left in place pending your say-so.
5. Tablet and 1280 px pass; the tile-label threshold below 900 px is still a single value.

---

## Delivery log — 2026-10-20

**Stage 3 — capital half closed.** The Basel tables are no longer absent from the extract.

The OLinda `IfDataValores` endpoint returned HTTP 500 for every period during this build, so the
fetch moved to the portal's own REST archive (`www3.bcb.gov.br/ifdata/rest/arquivos`), which serves
report 5 as `dadosYYYYMM_5.json` plus the prudential cadastro. `tools/build-capital.js` fetches 17
quarters (13 displayed + 4 warm-up), joins entities by the `c0` conglomerate code, and writes
`assets/capital.js` (88 KB) and `assets/capital-provenance.json` (URL, sha256, bytes, coverage,
findings per file). The two sources were reconciled on all four overlapping quarters (2023 Q2, Q3, 2024 Q4,
2026 Q1) across every bank present in both: zero differences on PR, RWA and the Basel ratio,
and RAROC recomputed independently from the OLinda PR series matches the emitted values for
Itaú, Bradesco, Banco do Brasil and Santander.

What the data says, and what it refuses to say:

- **425 capital points, 17 gaps kept as gaps.** Eight payments institutions have no 2023 Q2 print,
  PicPay has seven quarters, BRB stops at 2025 Q3. Nothing is interpolated.
- **PR is filed only from 2024 Q4.** Before that it is derived as the reported Basel ratio × RWA;
  the basis is carried per point. RAROC therefore starts when five quarters of capital exist —
  2024 Q3 for the full cohort, 2023 Q4 for 26 banks that had earlier prints.
- **One repeated print is flagged, not fixed:** PagSeguro's 2025 Q4 RWA and PR repeat 2025 Q2 to
  the cent (`C0084813`). The source did not update; the desk shows the repeat and says so.
- **Fourteen jumps past the break threshold** (5pp on Basel, 25pp on RWA density), concentrated in Cielo, CloudWalk, PagSeguro and Neon. These are
  real filings, not parsing errors, but they make level comparisons across 2025 Q1 unsafe — stated
  on the screen rather than smoothed.
- **Zero capital-stack order failures:** CET1 ≤ Tier I ≤ Basel holds on all 425 points; the
  recomputed PR ÷ RWA matches the filed Basel ratio to 0.0003pp.

Shipped with the data: `capital-lab.html` (RAROC against RWA density, the Basel ladder with the
10.5% reference floor, RWA composition, 13-quarter Basel/CET1 chart, sortable cross-section),
three new columns on the peer matrix (Basel, RAROC, RWA) with CSV export, a capital strip on the
dossier, and a median-Basel stamp on the board. The floor is drawn as 8% + 2.5% conservation only;
systemic surcharges are excluded, so headroom is an upper bound.

**Still open, in value order.**

1. **Bank-level NPL before 2025 Q1.** The defaulted book is now joined per institution from report 130,
   but the source only publishes that table from 2025 Q1. Anything earlier needs the older AA–H
   grading, which is a different measure — so the desk leaves those quarters blank.
2. **Fees and cost split.** Turns the Income lab's residual into a real bridge.
3. **Market data.** P/B and P/E against the RAROC spread is the natural next screen, but only once
   the accounting side is settled.
4. **Saved views and a revision log** for the comparison basket.
5. **Tablet pass and the 1280 px tile-label threshold.**
6. **Delete `brazilian-banks-dashboard.html`** — still 118 KB of superseded logic, still your call.


## Delivery log — 2026-10-20 · bank-level defaulted book

`tools/build-npl.js` fetches IF.Data report 130 ("Carteira de crédito ativa por carteiras de
instrumentos financeiros") for the six quarters in which it exists, joins the prudential entity
code to the desk bank id, and writes `assets/npl.js` (30 KB) plus `assets/npl-provenance.json`
with URL, sha256 and byte count per file.

- **195 usable points over 33 institutions, six quarters, 8 gaps kept as gaps.** Cielo files no
  credit book at all; Amazônia and PicPay each miss one quarter.
- **The additive identity holds on all 196 filings checked** — total = C1…C5 + not-informed +
  not-individualised + overseas — which is what proves the column mapping before a single ratio
  is printed. Identity failures would have emitted zero banks.
- **One zero print suppressed.** PicPay's 2025 Q4 defaulted balance is exactly zero on a R$ 27.4 bn
  book. That is a filing, not a fact: the point is null and listed in the register.
- **Two scope jumps flagged** at 2026 Q1 — BRB 3.1% → 15.5%, CloudWalk 0.9% → 14.2% — and the
  credit screen says level comparisons across them are unsafe.
- **The cohort aggregate is 4.16% at 2026 Q2**, credit-weighted over R$ 6.86 tn. The system series
  on the same screen is a different scope (BCB's published NPL rate); the two are shown side by side
  and never blended.

Shipped: the ranked defaulted-book panel and focus card on **Credit & risk**, NPL90 as a third
scatter axis, a stat cell, a cross-section column and two CSV fields on **Capital lab**, and the
field dictionary entry flipped from absent to reported.


## Delivery log — 2026-10-20 · cover against the defaulted book

**Credit & risk** gains section 03: provisions against the defaulted book, as a scatter of
NPL90 (x) against the cover multiple (y, log scale), with bubble area = credit book, iso-cover
rule at 1.0×, cohort medians, and a focus card with a six-quarter cover trend and the shortfall
or surplus in R$ bn. Clicking a bubble selects the bank; the three thinnest covers are one click
away under the chart. The risk table gains a “Cover of NPL” column.

- **Cover = implied provisions ÷ defaulted stock**, where provisions = the reported coverage ratio
  × the credit book. It is a provisioning-intensity indicator across two filings (Cosif and SCR),
  not a filed coverage ratio — stated on the screen and in the field dictionary.
- **At 2026 Q2 the cohort covers 1.80×**, median institution 1.74×, over R$ 286 bn of defaulted
  credit. Aggregate cover has fallen from 2.18× in 2025 Q1 while the defaulted share rose from
  3.08% to 4.16%.
- **One filer below full cover:** Banco do Nordeste at 0.88× (R$ 1.38 bn of provisions against
  R$ 1.57 bn defaulted). Two more sit under 1.25×.
- **No interpolation.** The panel is empty before 2025 Q1, when the defaulted series starts, and
  a bank without either print is excluded rather than counted at zero.


## Delivery log — 2026-10-20 · cover in the dossier capital strip

**Bank dossier** now loads `assets/npl.js` and closes the capital strip with a fifth cell:
cover of the defaulted book, reading exactly as the Credit & risk screen does — implied
provisions (reported coverage ratio × credit book) ÷ the SCR defaulted stock.

- **One cell, four answers:** the multiple, the surplus or shortfall in R$ bn against full cover,
  the cohort median and the bank's rank out of the filers that quarter, and a six-quarter
  sparkline with the 1.0× rule drawn so the trend is readable without leaving the page.
- **It follows the desk controls.** Changing the quarter recomputes the cell from that print;
  changing the selected bank swaps it. Below 2025 Q1 it reads “—” and says `from 2025 Q1` rather
  than drawing a line into a period the source does not publish.
- **It is a door, not a dead end.** The cell links straight into `credit-risk.html?b=…` for the
  full coverage panel. Hover lifts the cell to `--surface-2`; the global accent focus ring applies.
- **Same caveat, same place.** The construct spans two filings (Cosif provisions, SCR defaulted
  stock), so it is provisioning intensity, not a filed coverage ratio — stated in the tooltip and
  already in the definitions dialog and field dictionary.

Cohort median at 2026 Q2: 1.74× over 32 filers; Banco do Nordeste remains the only book under
full cover (0.88×, a R$ 0.2 bn shortfall after rounding).

## Delivery log — 2026-10-20 · cover in the capital cross-section

**Capital lab** section 04 gains a `Cover NPL` column between NPL90 and RAROC. It is the same
construct as Credit & risk and the dossier strip — implied provisions (reported coverage × credit
book) ÷ the SCR defaulted stock — so the capital cross-section can answer, in one row, what return
is being earned, how risk-weighted it is, how much of the book is defaulted, and how thick the
provision stock is against it.

- **Comparable down the column.** The cell is sortable like the rest, prints as a multiple, and
  turns red below 1.00×, where the provision stock is smaller than the defaulted balance.
- **Hover carries the two raw halves** — provision stock and defaulted balance in R$ bn — so the
  multiple is auditable without leaving the table.
- **Footer prints the median institution**, not the credit-weighted aggregate, and the coverage
  line counts how many of the shown institutions actually carry a usable cover this quarter.
- **CSV gains `Cover of NPL90 (x)`** beside the defaulted balance.
- **Same caveat, stated in the method block:** two filings, no shared denominator, so it is
  provisioning intensity, not a filed coverage ratio. Blank before 2025 Q1 and for filers with no
  defaulted print (Cielo, BRB at 2026 Q2).

At 2026 Q2: median institution **1.74×** over 32 filers, with Banco do Nordeste the only book
under full cover at **0.88×**.

## Delivery log — 2026-10-20 · cover in the peer matrix

**Peer matrix** now loads `assets/npl.js` and carries the defaulted book in the cross-section:
`NPL90` (SCR report 130, defaulted stock ÷ active credit book) sits beside `Cover NPL` between
RWA and RAROC, so leverage, capital, asset quality and provisioning intensity read on one line.
The denominator was added next to the multiple because a cover figure without the defaulted share
it is measured against is unreadable in a table.

- **Same construct everywhere:** implied provisions (reported coverage ratio × credit book) ÷ the
  SCR defaulted stock — not a second definition invented for this screen.
- **Sortable and auditable.** Both columns sort like the rest; `Cover NPL` prints as a multiple,
  turns red below 1.00×, and its hover title gives the two raw halves in R$ bn.
- **Footer prints medians of the shown rows**, not aggregates, so searching the table moves the
  benchmark with the search.
- **CSV gains** `NPL90`, `Defaulted (R$ bn)` and `Cover of NPL90 (x)`, with the counter reporting
  how many shown institutions carry a usable cover that quarter.
- **Scope stated in the footnote:** two filings, no shared denominator, starts 2025 Q1, and
  non-filers read “—”.

At 2026 Q2: 32 of 34 institutions carry a cover, median **1.74×** (NPL90 median 4.03%); Banco do
Nordeste is again the only book under full cover at **0.88×**, while Cielo and BRB are blank
because they file no defaulted stock.

## Delivery log — 2026-10-20 · cover of NPL as a scatter axis

**Peer matrix** section 01 is no longer a fixed ROE-vs-efficiency chart. Two pickers above it
choose the vertical and horizontal metric, and `Cover of NPL90` is one of the ten options — on
either axis. The pair swaps automatically rather than letting a metric be plotted against itself,
persists in `localStorage`, and is written to the URL (`peer-matrix.html?x=cover&y=roe`) so a view
can be handed to someone else.

- **One construct, no second definition:** the cover axis is implied provisions (reported
  coverage × credit book) ÷ the SCR defaulted stock — identical to Credit & risk, the dossier
  strip, the capital cross-section and the peer table column.
- **Log scale for the multiple.** Cover runs from 0.88× to 22.55× at 2026 Q2; on a linear axis the
  defaulted-book story collapses into one corner. The axis states `log` in the legend.
- **A brick rule at 1.0×** marks full cover whenever the multiple is on screen, with the legend
  saying what the line is: implied provisions against the SCR defaulted stock, two filings, no
  shared denominator.
- **Outliers are pinned, never dropped.** Linear axes keep the full sample unless a print sits
  beyond three central spreads, in which case the span is capped and those points sit on the edge
  with a dashed ring and an `off-scale` tag in the tooltip. Log axes are never capped.
- **Ticks are chosen, not evenly sliced:** nice steps in the metric's own unit (`%`, `pp`, `×`),
  and the header note reports the median of whichever two metrics are plotted, so the benchmark
  moves with the view instead of staying hard-coded.
- **Selection and keyboard:** bubbles keep the accent fill for the selected bank, are reachable by
  tab, and open the dossier on Enter or Space.

At 2026 Q2 with cover on the x-axis: 31 institutions file both lines, median cover **1.74×**,
median ROE **15.6%**; Banco do Nordeste sits at **0.88×** and BNDES at **22.55×**. Before 2025 Q1
the chart says the defaulted book is unpublished instead of drawing an empty frame.

## Delivery log — 2026-10-20 · DuPont decomposition

**Income lab** section 03 is now a decomposition of ROE rather than only a bridge to net income.
Five factors, read left to right as an equation:

> **ROE = leverage × ( margin − cost of risk × credit share + other result )**

It is anchored on the two ratios each bank actually files — ROE and ROA — so the chain closes on
the reported number instead of on a reconstruction of it. Verified across the whole panel: 380
bank-quarters, maximum error `3.3e-16`, i.e. floating point. Nothing is plugged except the one line
that has to be.

- **`assets/app.js` gains `dupont(b, i)` and `dupontAttr(b, i, step)`**, so every screen can read the
  same identity. `credit share` = credit book ÷ assets; `credit cost` = cost of risk × share;
  `other result` = reported ROA − margin + credit cost (solved); `leverage` = ROE ÷ ROA, the
  average-balance multiplier the two ratios imply.
- **Change is attributed, not asserted.** Contributions use the midpoint convention
  (ΔA × average B + average A × ΔB), so the five bars sum to the reported ΔROE with no residual —
  320 attributable bank-quarters, maximum error `3.1e-16`. Window switch: QoQ or four quarters.
- **A series join stops the attribution.** Where the harness splits a bank's series at a structural
  break, change is blank and the panel says which quarter the join sits at. At 2026 Q2 that is Pine
  and CloudWalk; over four quarters it is five more, plus six institutions with an incomplete
  identity in one of the two windows.
- **Interaction:** click any factor to hold it — the caption switches to that factor's definition,
  inputs, cohort median and rank, and the matching attribution bar and read-out line highlight.
  Ranks are by value, highest first, and the caption says so.
- **Cross-section** section 04 toggles between the income lines and the DuPont ratios (credit share,
  margin, cost of risk, credit cost, other/assets, ROA, leverage, ROE), sortable, with cohort
  medians in the footer and a second CSV shape.
- **Two residual lines, both stated.** Section 01 solves its residual on spot balances; the identity
  solves its own on the reported average-balance ratios. The gap is a median of **0.09pp of assets
  (up to 0.48pp at PicPay)** and it is disclosed in the method block rather than smoothed.

At 2026 Q2 the cohort median is ROE **15.6%** on ROA **1.43%**, leverage **12.5×**, margin **3.92%**,
cost of risk **4.15%** on a **46.1%** credit share. Itaú: ROE 20.87%, of which margin added
**+0.83pp** and leverage took **−1.12pp** quarter on quarter. The extreme-ROE outliers are not
earnings stories — C6 Bank at 44.5% ROE runs 24.9× leverage on a 1.79% ROA, while CloudWalk at
1.5× leverage shows the highest ROA in the panel (4.40%) on a 3.9% credit share.

## Delivery log — 2026-10-21 · DuPont rebuilt as a waterfall

The equation row in section 03 was too small to read and buried the story in five 17px cells. It is
now one full-width waterfall, 358px tall, with a 300px reading column beside it. Two readings share
the same geometry, switched by a segmented control:

- **Build the level** (default) — three floating bars in points of *average equity*: net interest
  income, the provision charge, then the solved residual, closing on the reported ROE column.
  Bars are `leverage × margin`, `−leverage × credit cost`, `leverage × other`. The residual bar is
  hatched and outlined, because it is the one line that is solved rather than filed.
- **Attribute the move** — the previous five-step attribution, now as a waterfall from last
  quarter's ROE column through margin, cost of risk, credit share, other result and leverage to
  this quarter's column. The axis zooms to the corridor the steps move through, otherwise a 1.0 pp
  move collapses inside a 22 pp level; the foot states that the two totals run to the floor.

Both readings close exactly. Level: verified across all 390 bank-quarters the identity can be built
for, maximum error `2.2e-16`. Move: unchanged midpoint convention, `3.1e-16`.

- **Factor cells grew from 100px to a five-column band** with the value at 19px, cohort median,
  rank and a percentile track, and they are now dials: picking one highlights the bar it drives
  (margin and leverage → the income bar; cost of risk and credit share → the provision bar; the
  residual → its own bar) and swaps the caption to that factor's definition.
- **The reading column** states the same three lines in words with each contribution's share of
  ROE, or the top three movers and what moved in the attribution.
- **A break warning sits under the level reading.** Where the credit book or the margin resets in
  the quarter on screen, the foot says the bars are arithmetic on a redefined input.
- **Nothing disappeared when the data cannot support it.** The level reading renders in every
  quarter, including the first, so the section is never blank; Cielo and BRB state which input is
  missing instead of drawing an empty frame, and the attribution offers a one-click return to the
  level.

At 2026 Q2, Itaú reads **+37.3 pp** of net interest income, **−14.4 pp** of provisions and
**−2.0 pp** of other result, closing on **20.9%** ROE. Mercado Pago is the extreme case and the
reason the level view earns its space: **+193 pp** of margin carried at 18.0× leverage, **−152 pp**
of provisions, **−33 pp** of residual, **8.4%** left over.

## Delivery log — 2026-10-21 · Cohort-median ghost behind the waterfall

Section 03 compares a bank against itself. It now also compares it against the cohort: every
column of the DuPont waterfall carries a light, dashed **ghost bar** of the same quantity at its
cohort median, drawn wide enough to read around the solid bar, with ghost connectors and a
toggle in the section header (state persisted).

**It does not pretend the medians compose.** Each ghost bar is the median of that one column
across the active cohort — never a bank assembled out of medians. At 2026 Q2 the ghost's three
steps read **+45.3 / −20.5 / −4.6pp**, which add to **20.2pp** while the median bank actually earns
**15.6%**: medians of products are not products of medians, and no bank sits at every median at
once. Rather than bend a bar to close the gap, the chart draws it — a dotted drop at the closing
column, and the foot prints the **4.6pp** difference in words. The gap is not a constant to be
tolerated: it runs from **−0.5pp** in 2023 Q2 to **+7.6pp** in 2025 Q2, and a plug would have hidden an
8pp swing behind a bar nobody could audit.

**The move reading gets its own anchor.** Anchoring a median path at the median level would push a
40%-ROE bank's axis out by 20pp and destroy the zoom that section was built for, so the ghost there
starts where the bank started and takes the cohort's median step in each of the five factors. Itaú
at 2026 Q2: a quarter that moved like the median bank would have gone **21.9% → 21.0%**, against the
reported **20.9%** — the median quarter was roughly flat, margin taking 2.0pp and other result
adding 1.6pp back.

**Also added.** The reading column prints each line's cohort-median counterpart beside the bank's
own number, so the comparison survives without hovering; the ghost follows the universe filter and
the comparison basket, so a five-bank basket ghosts against those five; hovering a bar still reports
the median of the *factor* (margin, leverage), which is a different object from the median of the
*line* and is labelled as such.

## Delivery log — 2026-10-22 · One hover contract, and an indicator strip that answers

The desk had a split personality: table rows responded to the cursor, and the figures that matter
most — the system indicators at the top of the board, the stat strips, the mast stamp, the side
panel — were inert. A reader could not tell whether "Total assets" was a number or a button.

**The strip is rebuilt, not restyled.** Four rows: label and unit, the value at 34px, the quarter's
move with the window change on the right, and a full-bleed 46px area chart of the 13-quarter series.
The chart is tinted by the direction of the quarter's move — teal up, brick down, muted where the
metric has no good direction (coverage); cost of risk inverts, so a rising charge is brick. A dashed
rule marks the last print so the shape reads against *now*. The cursor scrubs the series: a hairline
snaps to the nearest published quarter and the tooltip prints that quarter's level and its own move,
so the line stops being decoration. Each cell is a link into the screen that takes the figure apart.

**The footer prints the window, not the range.** `+36% · 13Q` for assets, `+1.1 pp · 13Q` for cost of
risk — computed from the first and last published prints of the series, so a series that starts late
counts its own quarters rather than claiming thirteen. Nothing is interpolated across a harness gap.

**One hover contract, applied everywhere.** `.stat`, `.kpi`, `.stamp`, `.side__row`, the income-bridge
rows, the percentile rulers and every table row now take one paper step and bring their label to full
ink. No accent, no scale, no shadow — hover says "this is a cell", selection stays the accent's job.
Added on the integrity screen for the quality cells, the field dictionary and the coverage matrix.

**Verified statically** by executing the strip's own renderer against the real snapshot: 5 series,
5 SVGs, no `NaN`, no `undefined`; window text `+36% · 13Q / +0.9 pp · 13Q / +0.3 pp · 13Q / +1.1 pp ·
13Q / +0.6 pp · 13Q` at 2026 Q2, and correctly truncated to `5Q` at 2023 Q2. Deltas below 0.05pp
round to `0.0 pp` and lose their direction colour instead of printing "up −0.0 pp".

**Recorded as a principle.** `DESIGN.md` now states what the system refuses — no shadows, no icon set,
no second accent, no animation beyond 120ms, no colour without meaning, no number that cannot be
traced — plus the type pairing, the tokens, the hover contract and the strip anatomy. The rules were
implicit in the CSS; they are now the contract for anything added next.
