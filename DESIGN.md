# FARO — design rules

A quarterly reading desk for Brazilian bank data. The philosophy is **minimalism with nothing
hidden**: as little surface as the reading allows, and every figure on that surface auditable.

## What the system refuses

- No shadows as decoration. Only the two overlays (tooltip, definitions dialog) leave the page,
  and they are the only things allowed to cast one.
- No icon set. A label in mono caps does the job an icon would do badly.
- No second accent. Cobalt appears for selection and focus, and nowhere else.
- No colour without meaning. Teal and brick encode direction; indigo encodes selection; the
  heat ramps encode a ratio. If a colour is not carrying data, it is removed.
- No animation beyond a 120ms background or opacity step. Nothing scales, nothing bounces.
- No number that cannot be traced. If the harness cannot defend a print, the cell shows a gap.

## Type

| Role | Face | Use |
|---|---|---|
| Display | Bricolage Grotesque 600 | headlines, every large figure |
| Body | IBM Plex Sans | prose, table names, labels |
| Mono | IBM Plex Mono | numerals, units, eyebrows, captions |

Figures are always mono and tabular so columns align and a digit change does not move the row.
Display type carries the hierarchy; mono carries the evidence. There is no third voice.

## Tokens

Six paper values and six semantic ones, all in `oklch()`, all in `assets/theme.css`:

```
--bg 0.984 · --surface 1.0 · --fg 0.205 · --muted 0.455 · --border 0.918 · --accent 0.420 0.145 266
--pos (teal) · --neg (brick) · --warn (ochre) · --accent-soft · --surface-2 · --surface-3
```

One paper step between layers. Structure is drawn with 1px hairlines, not with borders, fills or
elevation: the grid is the only ornament.

## The hover contract

Every cell that prints a number answers the cursor the same way — `.stat`, `.kpi`, `.stamp`,
`.side__row`, `.side__pl .pl`, `.ruler`, and every table row:

1. the background takes one paper step (`--bg` → `--surface`, or `--surface` → `--surface-2`);
2. the label comes from `--muted` to `--fg`;
3. nothing moves, nothing grows, no accent appears.

Hover never lowers contrast. Selection is the accent's job; hover is only "this is a cell, and
here is its boundary".

## Indicator strip anatomy

The five system readings on the Sector Board are the densest unit in the desk, in four rows:

```
TOTAL ASSETS                                              R$ bn
15,697
+1.6%  QoQ                                  +36% · 13Q
[  13-quarter series, filled, tinted by the quarter's direction  ]
```

- The value is 34px display; the series is a full-bleed 46px area chart, so the shape is readable
  from across a desk.
- Fill and stroke take the direction of the quarter's move — teal up, brick down, muted where the
  metric has no good direction (coverage). Cost of risk inverts: up is brick.
- A dashed rule marks the last print, so the series reads against *now*, not against its own mid.
- The footer states what the whole window did (`+36% · 13Q`), not the min and max: a trend is the
  question a sparkline answers.
- The cursor scrubs the series: a hairline snaps to the quarter, the tooltip prints that quarter's
  level and its own move. Reading does not require a click.
- Each cell is a link into the screen that takes the figure apart — peer matrix, DuPont waterfall,
  income bridge, cost of risk, coverage panel.

## Layout

- Fixed 224px rail, sticky 60px topbar, content flows in full-bleed sections separated by hairlines.
- Sections are numbered (`01 · The map`). Numbering is structural, not decorative: it is how the
  desk is referenced in writing and in these notes.
- Five-column grids for indicators, `1fr` grids for tables, `minmax(0,1fr)` everywhere a table or a
  chart could otherwise force a horizontal scrollbar.
- Responsive rules live in `assets/theme.css`; nothing is fixed-width, and the board reflows to one
  column at 980px rather than shrinking.
