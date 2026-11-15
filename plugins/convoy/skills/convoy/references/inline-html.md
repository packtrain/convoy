# Inline HTML pages in Convoy replies

## When to use it

Use an inline page when the reader has to see numbers in relation to each other: a chart, a before/after comparison, a table that's too wide or too dense for markdown, or a small dashboard of check results.

Don't use one for prose, plain lists, or a table markdown handles fine. Those stay in the reply.

```bash
convoy threads attach <threadId> report.html --inline --message-id <replyId> --session-id <sessionId>
```

`--inline` works only on `.html` files. Without it, the file shows as a download card, which is right for exports and raw evidence.

After attaching, don't describe or repeat the page in your reply. The reader sees it at the end of the reply. Write only what the page doesn't say: the conclusion, a caveat, the next step.

## What Convoy provides

The page runs in a sandboxed frame at the end of your reply. Before it loads, Convoy adds:

- theme tokens as CSS variables on `:root` for the reader's current theme (light or dark)
- a base sheet: transparent background, `--foreground` text, `--font-sans` (Inter), 14px, line-height 1.5, `body { margin: 0 }`
- auto height: the frame grows to fit your page

The frame has no cookies, storage, or Convex API access. `localStorage`, `alert()`, and form submissions don't work. Links open in a new tab.

## Page structure

- One complete, self-contained HTML document. Put CSS in `<style>` and scripts in `<script>`. Don't load anything from a CDN; inline SVG and CSS cover charts and tables.
- Keep it under 500 KB. Inline images as `data:` URLs only when they're the point of the page.
- Don't set a background on `html`, `body`, or the outer wrapper. No outer card, border, or side padding. The page sits on the thread background, flush with the reply text.
- No banner title. Start with a section heading or go straight to the content.

## Colors: tokens only

Never write a hex, `rgb()`, or named color. Use only these variables, which change with the theme:

| Use | Variables |
|---|---|
| Text | `--foreground`, `--muted-foreground` (secondary text, captions, axis labels) |
| Surfaces | `--card` / `--card-foreground`, `--muted`, `--secondary` / `--secondary-foreground`, `--accent` / `--accent-foreground`, `--popover` / `--popover-foreground` |
| Lines | `--border` (dividers, gridlines, table rules), `--input`, `--ring` (focus) |
| Emphasis | `--primary` / `--primary-foreground` (a single highlighted value or active control) |
| Status | `--destructive` (failures only), `--danger-soft` (failure row background), `--highlight` (marking one cell or value) |
| Code | `--code-surface`, `--code-foreground` |
| Data | `--chart-1` … `--chart-5` |
| Shape and type | `--radius`, `--font-sans`, `--font-mono` |

Use `color-mix(in srgb, var(--chart-1) 20%, transparent)` for a lighter tint of a token. Don't invent new colors.

## Layout

- The width is fluid: about 360px on phones, about 900px on wide desktop. Design for both. Use flex or grid with `flex-wrap` / `minmax()`. No fixed widths above 320px.
- Let content set the height. Never use `vh` units, and never `height: 100%` on `html` or `body`.
- Give charts a fixed pixel height (160–320px) and a width of `100%`.
- No inner scrolling, except a wide table in an `overflow-x: auto` wrapper.
- Spacing: 4px steps. 8–12px inside groups, 24px between sections.

## Typography

Convoy is an operational tool, not a marketing page. Keep the page quiet and easy to scan.

- Section heading: 15–16px, weight 600. Only one level of heading in most pages.
- Body: 14px (inherited). Secondary text and captions: 12–13px, `--muted-foreground`.
- Numbers: `font-variant-numeric: tabular-nums`. Right-align numeric columns.
- No letter-spacing changes, no viewport-scaled font sizes, no all-caps labels, no emoji or icons in headings.
- Text never overflows its box. Wrap or truncate with `text-overflow: ellipsis`.

## Surfaces

- Build hierarchy with spacing, headings, and 1px `--border` dividers before reaching for boxes.
- When something needs a frame (a stat tile, a callout): `background: var(--card)` or `var(--muted)`, `border: 1px solid var(--border)`, `border-radius: var(--radius)`, padding 12–16px.
- No boxes inside boxes. No shadows, gradients, or glow.

## Tables

- Header row: 12px, weight 500, `--muted-foreground`, bottom border `1px solid var(--border)`.
- Rows: 8–10px vertical padding, `1px solid var(--border)` between rows, no zebra stripes, no vertical rules.
- First column left-aligned (the label); numeric columns right-aligned with tabular numbers.
- Put units in the header ("Wait (h)") or on every value ("28.0 h"), never mixed.
- Mark a failed row with `--danger-soft` and a single bad value with `--destructive` text.

## Charts

- Draw with inline SVG or CSS (`div` bars with percentage widths). Bars handle most comparisons. Use lines for a trend over time. Avoid pies, donuts, 3D, and dual axes.
- Series colors: `--chart-1`, `--chart-2`, … in order. Five series at most; group the rest as "Other" in `--muted-foreground`. A series keeps the same color in every chart on the page.
- `--destructive` means failure. Don't use it as a series color.
- Prefer labeling series directly (at the bar or line end) over a legend. If you need a legend, put it above the chart, left-aligned, 12px.
- Bar axes start at zero. Label axes with units. Gridlines: `1px var(--border)`, few of them.
- Put value labels inside a bar only when it's wide enough and the text contrast holds; otherwise place them just outside in `--foreground`.
- Every chart has a one-line caption in `--muted-foreground` stating what it shows, e.g. "Each row is scaled to one hour of model responses."
- `<svg role="img" aria-label="…">` with the takeaway in the label. Don't rely on color alone: name each series in text.
- Hover tooltips are fine, but every number the reader needs is visible without hovering.

## Evidence pages

For a check result (tests, lint, a UI check), lead with the outcome in one line (passed, failed, or not run, and the key count), then the details. Keep raw logs as a separate plain attachment; the inline page summarizes them.

## Before attaching

Open the file in a browser at 360px and 900px. Check that nothing overflows, nothing scrolls inside, and every color comes from a variable (search the file for `#` and `rgb`). The tokens are missing when you open it locally, so colors look blank; that's expected.
