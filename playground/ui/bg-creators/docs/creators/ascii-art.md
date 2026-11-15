# Implementation Worklog

This file records product decisions and the evidence behind them. Keep it short, factual, and current. Update it after schema, renderer, timeline, layer, export, performance, or acceptance decisions.

## Status

Mode: product

Product: ASCII Art — image → animated, mouse-reactive ASCII background effect (speakeasy.com hero-style: monochrome glyphs on near-black, source colors revealed in a soft disk around the cursor, subtle idle shimmer).

## Decision Trail

### Iteration 1 — ASCII Art product build

- Request: Build an image-to-ASCII background effect with ramp/tone/color/motion controls, a default gradient source image, hover color reveal, idle shimmer, and image export.
- Task type: new product (schema + custom Canvas 2D renderer + export).
- User-visible result: canvas immediately shows the bundled `gradient.jpg` as monochrome ASCII; hovering reveals real image colors in a soft radius; controls reshape glyphs, tone, color, and motion; Export PNG downloads the output.
- Source/reference checked: speakeasy.com hero effect description (prompt), local Toolcraft docs (`assembly-workflow.md`, `schema-reference.md`, `core/media-upload.md`, `core/setup-export.md`).
- Reference inputs: `gradient.jpg` copied from the sibling landing app as the default media asset.
- Contract rules applied: `canvas-no-app-ui`, `controls-section-inventory-required`, media `defaultAssets` with `sourceTarget`, required Background section before Image Export, sticky `panelActions` export with `upload-simple` icon, `canvas.renderScale: true` for a Canvas 2D raster preview.
- Decision: single-pass Canvas 2D renderer in `canvasContent` with `renderDefaultCanvasMedia: false`; grid sampling precomputed offscreen (one cover-crop draw at grid resolution + one `getImageData`) and only glyph/color picking per frame.
- Alternatives rejected: WebGL glyph atlas (overkill for the capped grid size); timeline-driven animation (decorative autonomous shimmer only, no video export); DOM/SVG glyph rendering (too many nodes).
- State/output mapping: `source.image` → sampled grid; `chars.*` → ramp/cell layout/font; `tone.*` → luminance mapping at sample time; `color.*` → per-glyph fill (mono tint, hover mix, or full source color); `motion.*` → per-cell sine shimmer in the rAF loop; `appearance.background` + `export.includeBackground` → preview/export background; `export.image.*` + sticky `Export PNG` → downloaded PNG/JPG via `createToolcraftPngExportCanvas`.
- Files changed: `src/app/app-schema.ts`, `src/app/app-composition.tsx`, `src/app/ascii/*` (settings, grid, draw, source, canvas, export), `src/app/app-acceptance-data.ts`, `public/gradient.jpg`.
- Verification: `npm run typecheck`, `vite build`, dev server smoke check on port 4411 (HTTP 200). Pragmatic scope agreed in the task; full `verify:final`/browser/perf gates intentionally not run.
- Skipped checks: browser acceptance suite, performance receipt, `verify:final` (task explicitly scoped verification to typecheck + build + dev-server smoke).
- Risks: `appAcceptance` matrix left empty (full acceptance gates would fail); full-color mode at the smallest cell size is the heaviest path (bounded by a 26k-cell grid cap).

## Decisions

### Renderer

- Decision: Canvas 2D in `canvasContent`, custom renderer, `renderDefaultCanvasMedia: false`, `canvas.renderScale: true`.
- Reason: per-glyph text rendering with per-cell color is a natural fit for Canvas 2D; grid is capped at ~26k cells so fillText stays cheap.
- Evidence: `src/app/ascii/ascii-canvas.tsx`, `src/app/ascii/ascii-draw.ts`; sampling only re-runs on source/tone/layout changes (`sampleAsciiGrid` memo), per-frame work is glyph/color selection only; rAF idles (no redraws) when animation is off and nothing changed.

### Timeline

- Decision: no timeline; autonomous decorative shimmer with a product `Animate` switch.
- Reason: motion is low-amplitude idle polish, not user-authored animation; no video export.
- Evidence: `appTransferMode.animationIntent.mode: "autonomous"` in `src/app/app-acceptance-data.ts`.

### Layers

- Decision: no layers.
- Reason: single source image, single output.
- Evidence: `panels.layers` omitted.

### Controls

- Decision: sections Source, Character, Tone, Color, Motion, Background, Image Export plus sticky Export.
- Reason: grouped by product entity (source input, glyph grid, tone mapping, glyph coloring, shimmer, export background, export settings).
- Evidence: `appControlSectionInventory` in `src/app/app-acceptance-data.ts`; conditional visibility for custom ramp text, hover radius/falloff, and motion sliders.

### Media

- Decision: `media.defaultAssets` ships `/gradient.jpg` bound to `source.image`; uploads replace it via the standard `fileDrop`; `mediaAssets[].transform` (rotate/flip) is honored at sample time.
- Reason: the prompt explicitly defines the default source image, so the canvas shows the effect immediately.
- Evidence: `public/gradient.jpg`, `media.defaultAssets` in `src/app/app-schema.ts`, transform handling in `src/app/ascii/ascii-grid.ts`.

### Export

- Decision: sticky `Export PNG` action (`role: "export-image"`, icon `upload-simple`) with `Image Export` format (PNG/JPG) and resolution (2K/4K/8K) selects, plus the required Background section (`export.includeBackground` + `appearance.background`).
- Reason: still product output; export renders the same grid through `createToolcraftPngExportCanvas` at the selected resolution (JPG always includes background).
- Evidence: `src/app/ascii/ascii-export.ts`, Background/Image Export sections in `src/app/app-schema.ts`.

### Performance

- Decision: precomputed grid + per-frame glyph pass; grid capped at 26k cells; cell size floor 8px; quantized mono styles (24 levels) to minimize fillStyle churn; per-cell color strings prebuilt at sample time; rAF skips work when idle.
- Reason: keep 60fps for the default mono/hover modes; full-color small-cell is the bounded worst case.
- Evidence: `maxGridCells` in `src/app/ascii/ascii-grid.ts`, style caching in `src/app/ascii/ascii-draw.ts`, dirty-flag idle path in `src/app/ascii/ascii-canvas.tsx`.

## Evidence

- Source reviewed: prompt description of the speakeasy.com hero effect; local Toolcraft contract docs.
- Contract applied: canvas contains product output only; upload flow stays runtime-owned; Background precedes Image Export; export uses the standard PNG export helper.

## Verification

- Ran: `npm run typecheck` (pass), `npx vite build` (pass), dev server on port 4411 served HTTP 200 then stopped.
- Not run (scoped out): `verify:final`, browser acceptance, performance receipt.

## Risks

- `appAcceptance` rows are empty; the full acceptance/browser/perf gates were intentionally out of scope for this pass and would need to be filled before a formal final delivery.
- Full-color mode with 8px cells on large canvases is the heaviest render path (bounded by the grid cap).
