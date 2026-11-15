# Implementation Worklog

This file records product decisions and the evidence behind them. Keep it short, factual, and current. Update it after schema, renderer, timeline, layer, export, performance, or acceptance decisions.

## Status

Mode: product

Halftone — image → animated dot-matrix / halftone background effect with mouse-reactive color reveal.

## Decision Trail

### Iteration 1 — Halftone product implementation

- Request: Build "Halftone": render a source image as a grid of halftone dots on a near-black background, with grid/tone/color/motion controls, hover color reveal, idle radial pulse, default gradient source image, and PNG/JPG export.
- Task type: New product on fresh starter (schema + Canvas 2D renderer + export).
- User-visible result: Canvas shows the default gradient image as an animated halftone dot matrix immediately; controls reshape grid, tone, color, and motion live; hovering reveals sampled source colors around the cursor; sticky Export PNG downloads at the selected format/resolution.
- Source/reference checked: `AGENTS.md`, `docs/toolcraft/assembly-workflow.md`, `schema-reference.md`, `core/media-upload.md`, `core/setup-export.md`, runtime types in `src/toolcraft/runtime`.
- Reference inputs: none (no Figma/video reference); default asset copied from the landing web app (`gradient.jpg`).
- Docs/contracts read: assembly workflow, schema reference, media upload, setup/export core modules.
- Contract rules applied: `canvas-no-app-ui`, `controls-section-inventory-required`, media `defaultAssets` with `sourceTarget`, Background section pair (`export.includeBackground` + unlabeled color), Image Export format/resolution selects, sticky `panelActions` export with `createToolcraftPngExportCanvas`, seamless forward-only decorative animation.
- Decision: Canvas 2D renderer in `canvasContent` with `renderDefaultCanvasMedia: false`; grid precomputed offscreen (positions, raw luminance, source RGB, center distance) only when image/spacing/angle/size/transform change; per-frame work limited to a 256-entry tone LUT plus radius/fill computation; batched Path2D fills per color mode (mono: 1 fill, duotone: 24 tone buckets, hover-reveal: batched mono outside the radius + per-dot fills inside, full-color: per-dot).
- Alternatives rejected: WebGL renderer (unnecessary for ~10k dots at default spacing and adds shader complexity); Toolcraft timeline (motion is decorative autonomous background animation, no transport or video export, so `animationIntent.mode: "autonomous"`); per-frame image resampling (violates performance rule, replaced by cached grid).
- State/output mapping: `source.image` (fileDrop + default asset) → sampled grid; `grid.*` → grid geometry (resample); `tone.*` → tone LUT → dot radii; `color.*` → fill batching/blends; `motion.*` → rAF pulse phase; `scene.background` + `export.includeBackground` → preview/export backdrop; `export.image.*` → export encode; `panel.actions` export-image → `createToolcraftPngExportCanvas` + download.
- Files changed: `src/app/app-schema.ts`, `src/app/app-composition.tsx`, `src/app/app-acceptance-data.ts`, `src/halftone/halftone-settings.ts`, `src/halftone/halftone-grid.ts`, `src/halftone/halftone-render.ts`, `src/halftone/halftone-source.ts`, `src/halftone/halftone-canvas.tsx`, `src/halftone/halftone-export.ts`, `public/gradient.jpg`.
- Verification: `npm run typecheck` and `vite build` pass; dev server serves HTTP 200 on port 4412 (pragmatic tier — see Skipped checks).
- Skipped checks: full `verify:final` gate, browser acceptance matrix (`appAcceptance` rows), and `verify:perf` receipt — explicitly out of scope for this pass per the requesting task's pragmatic verification bar.
- Risks: acceptance matrix is empty, so `npm run test` acceptance coverage gates would fail if run; minimum spacing (6 px) on large canvases yields ~55k dots, which is heavier per frame in full-color mode.

## Decisions

### Renderer

- Decision: Canvas 2D product renderer (`src/halftone/halftone-canvas.tsx`) with `canvas.renderScale: true`.
- Reason: Dot-matrix fills are a raster workload well within Canvas 2D budget; grid sampling is cached offscreen, per-frame work is radii + fills only.
- Evidence: `sampleHalftoneGrid` runs only on image/spacing/angle/size/transform change; `renderHalftoneFrame` uses batched `Path2D` fills.

### Timeline

- Decision: No timeline; `animationIntent.mode: "autonomous"`.
- Reason: The idle radial pulse is decorative, seamless (time-based sine phase, forward-only), with no transport, scrub, loop control, or video export.
- Evidence: `appTransferMode.animationIntent` in `src/app/app-acceptance-data.ts` declares full autonomous behavior coverage.

### Layers

- Decision: No layers.
- Reason: Single source image, single output surface; the fileDrop control owns upload/clear/transform.
- Evidence: `panels.layers` omitted.

### Controls

- Decision: Seven product sections — Source, Grid, Tone, Color, Motion, Background, Image Export — plus the sticky export action section.
- Reason: Grouped by product entity (source input, grid geometry, tone mapping, dot coloring, idle motion, backdrop, export encoding); conditional controls (`duotone` color, hover radius/falloff, motion speed/amplitude) use `visibleWhen`.
- Evidence: `appControlSectionInventory` in `src/app/app-acceptance-data.ts` covers every product target exactly once.

### Media

- Decision: Default gradient source via `media.defaultAssets` (`/gradient.jpg`, `sourceTarget: "source.image"`); renderer consumes `state.mediaAssets` including runtime transforms; source draws cover-cropped into current canvas bounds (`editable-output`).
- Reason: The prompt explicitly supplies the default asset; runtime owns upload/clear/reset semantics.
- Evidence: `findHalftoneSourceAsset` filters by `sourceTarget` and layer visibility; `drawHalftoneCoverImage` honors rotate/flip transforms.

### Export

- Decision: Sticky `Export PNG` panel action (role `export-image`, icon `upload-simple`) rendering through `createToolcraftPngExportCanvas` at the selected `export.image.resolution`, honoring `export.includeBackground` (forced on for JPG since it has no alpha).
- Reason: Standard export helper contract; still product exposes PNG export.
- Evidence: `src/halftone/halftone-export.ts`; progress reported via `reportProgress`.

### Performance

- Decision: Precompute sampled grid offscreen; per-frame tone LUT; batched fills per color mode; rAF loop parks drawing when motion is off and nothing changed (dirty flag).
- Reason: No per-frame image resampling; hover reveal bounds the per-dot colored fill count by hover radius.
- Evidence: `performanceRole`/`performanceReason` declared on every visible product control; renderer draw path in `halftone-canvas.tsx`.

## Evidence

- Source reviewed: local Toolcraft docs and signed runtime source (`export/export.ts`, `state/types.ts`, `schema/types.ts`).
- Contract applied: Background pair, Image Export selects, sticky export action, media default assets, autonomous animation intent.

## Verification

- Run: `npm run typecheck` — pass.
- Run: `npm run build` (tsc + vite build) — pass.
- Run: dev server on port 4412 served HTTP 200, then stopped.
- Deferred: `npm run verify:final`, browser acceptance, `verify:perf` receipt (pragmatic verification bar for this pass).

## Risks

- Risk: `appAcceptance` matrix is empty; the full acceptance gate would fail until rows plus browser evidence are authored.
- Risk: Dense grids (spacing 6 on 1920×1080) in full-color mode use per-dot fills (~55k dots/frame); acceptable on modern hardware but the heaviest configuration.
