# Brazilian Banks Desk

A research desk for equity analysts and portfolio managers, built on Banco Central do Brasil
IF.Data filings — report 3 (balance sheet and P&L), report 5 (capital), report 130 (NPL90).

Open `index.html` in a browser. No server, no build step. Everything is relative-pathed and
works from `file://`; the only network dependency is the Google Fonts stylesheet
(Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono) — offline, the pages fall back to system
stacks and still function.

## Screens

| File | Screen |
|---|---|
| `index.html` | Sector board — treemap / ladder of the system, indicator strip, movers, desk index |
| `bank-dossier.html` | One bank: percentile rulers, 13-quarter series, capital strip, funding stack |
| `peer-matrix.html` | Cross-section, 20+ sortable columns, selectable scatter axes, CSV export |
| `credit-risk.html` | Asset quality, NPL90 ladder, provisions-against-NPL90 panel, retail modalities |
| `capital-lab.html` | RAROC vs RWA density, Basel ladder, RWA composition, capital cross-section |
| `pnl-lab.html` | Income bridge, DuPont waterfall with cohort-median ghost, income cross-section |
| `data-integrity.html` | Validation register, bank quality league, coverage matrix, field dictionary |
| `ifrs-bridge.html` | IF.Data against reported IFRS, 26 reconciled lines |
| `brazilian-banks-dashboard.html` | The original single-page prototype — superseded, kept for comparison |

Screens link to each other by relative path and accept `?b=<bank_id>&q=<period>` where relevant.
Selection, quarter, universe, scatter axes and the comparison basket persist in `localStorage`.

## Data

`assets/*.js` hold the joined, validated feeds — this is what the pages read:

- `data.js` — report 3 snapshot, 34 conglomerates, 13 quarters to 2026 Q2
- `capital.js` — report 5: PR, RWA, Basel ratio, CET1, 43 entities
- `npl.js` — report 130: active defaulted portfolio, 33 entities, from 2025 Q1
- `breaks.js` — the validation register and field dictionary, generated from `assets/breaks.json`
- `validate.js` — the harness that runs 3,432 checks on every page load
- `app.js` — shared shell, charts, tables, DuPont, waterfall, format helpers
- `theme.css` — tokens and the class system

`data/ifdata-npl/` (91 MB) holds the raw BCB downloads and is only needed to re-run the build
scripts. Deleting it leaves the desk fully working; keep it if you want to reproduce or extend
the fetch. Expect OneDrive to spend a while syncing it.

## Rebuilding the feeds

`tools/` contains the fetch/join scripts. They need network access and the raw downloads:

```
node tools/build-capital.js     # report 5 -> assets/capital.js + capital-provenance.json
node tools/build-npl.js         # report 130 -> assets/npl.js + npl-provenance.json
node tools/build-breaks.js      # assets/breaks.json -> assets/breaks.js
```

Each writes a provenance file recording URL, sha256 and coverage per download, so any figure
on the desk can be traced back to the file it came from.

## Reading rules

The desk refuses to print a number it cannot defend:

- Series are split at their joins. A growth rate or delta across a definition change renders
  blank, never as a false percentage.
- Suppressed prints are dropped from aggregates, medians and charts rather than counted at zero.
- Gaps stay gaps. Nothing is interpolated.
- Every ratio that can be clicked opens its inputs: numerator, denominator, source print,
  horizon and any finding that touched it.
- Bank-level NPL90 exists only from 2025 Q1; before that the field is blank, not estimated.
- Cover of NPL90 spans two filings with no shared denominator — it is provisioning intensity,
  not a filed coverage ratio.

`DESIGN.md` states the visual philosophy. `improvement-pipeline.md` records what was delivered,
what is still open, and in what order it should be attacked.
