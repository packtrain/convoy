# Implementation Worklog

This file records product decisions and the evidence behind them. Keep it short, factual, and current. Update it after schema, renderer, timeline, layer, export, performance, or acceptance decisions.

## Status

Mode: product

Aurora — gradient-mesh / aurora glow background generator. Slow-moving, heavily blurred, seeded radial-gradient blobs drifting over a near-black background with optional film grain, mouse parallax, and vignette. Linear.app-style hero glow aesthetic.

## Decision Trail

### Iteration 1 — Aurora glow background generator

- Request: Build "Aurora", a fully generative gradient-mesh/aurora background tool (no image upload) with blob, palette, grain, motion, and frame controls plus PNG export.
- Task type: New product on the neutral starter.
- User-visible result: Canvas renders 3–7 blurred colored blobs drifting seamlessly over a dark background; controls panel exposes Blobs / Palette / Grain / Motion / Frame / Image Export sections and a sticky Export PNG action; Randomize action reseeds the layout.
- Source/reference checked: `AGENTS.md`, `docs/toolcraft/assembly-workflow.md`, `docs/toolcraft/schema-reference.md`, runtime source (`use-toolcraft`, canvas shell, export helpers, panel action plumbing).
- Reference inputs: Prompt description only (Linear.app-style hero glow); no Figma/video reference.
- Contract rules applied: `runtime-shell-required`, `canvas-no-app-ui`, `controls-product-coverage`, `controls-section-inventory-required`, `output-export-required`, `persistence-policy-explicit` (no persistence, decorative generator resets by design).
- Decision: Canvas 2D renderer; blobs painted to a 1/8-resolution offscreen layer with per-blob radial gradients and the selected composite op, then upscaled with an optional `ctx.filter` blur; single rAF loop with dirty-flag rendering; precomputed 160px grain tile drawn as an `overlay` pattern; parallax from a window pointermove listener smoothed per frame; seamless loop via integer orbit turns over a normalized phase.
- Alternatives rejected: per-pixel gradient mesh shader (WebGL overkill for this look); full-resolution blob painting with large blur every frame (too expensive); Toolcraft timeline (decorative autonomous motion, no transport or video export requested).
- State/output mapping: all controls live under `aurora.*` targets read by `readAuroraSettings(state.values)`; `export.image.format`/`export.image.resolution` feed `createToolcraftPngExportCanvas`; `canvas.renderScale` scales the preview backing store.
- Files changed: `src/app/app-schema.ts`, `src/app/app-composition.tsx`, `src/app/app-acceptance-data.ts`, `src/app/aurora/aurora-settings.ts`, `src/app/aurora/aurora-renderer.ts`, `src/app/aurora/aurora-canvas.tsx`, `src/app/aurora/aurora-export.ts`.
- Verification: `npx tsc -p tsconfig.json --noEmit` pass; `npx vite build` pass; dev server smoke check (HTTP 200) on port 4415.
- Skipped checks: `npm run verify:final`, browser acceptance/performance suites, and `appAcceptance` matrix rows — explicitly out of scope for this pragmatic delivery pass.
- Risks: acceptance matrix is empty, so `npm run test` gates will fail until rows are authored; export renders the loop at phase 0 rather than the current preview phase.

## Decisions

### Renderer

- Decision: Canvas 2D via `canvasContent` (`AuroraCanvas`), low-res offscreen blob layer (1/8 width, clamped 24–400px) upscaled with optional canvas filter blur.
- Reason: Cheap heavy blur; blob count ≤ 7 keeps per-frame gradient cost trivial.
- Evidence: `src/app/aurora/aurora-renderer.ts`, `src/app/aurora/aurora-canvas.tsx`.

### Timeline

- Decision: No Toolcraft timeline; autonomous decorative loop.
- Reason: No user-facing transport, scrubbing, or video export; motion is a seamless forward-only loop (integer orbit turns over normalized phase).
- Evidence: `appTransferMode.animationIntent` mode `autonomous` in `src/app/app-acceptance-data.ts`.

### Layers

- Decision: No layers.
- Reason: Single generated output, no per-object editing.
- Evidence: `panels.layers` omitted.

### Controls

- Decision: Six product sections (Blobs, Palette, Grain, Motion, Frame, Image Export) plus sticky Export; upload disabled (fully generative).
- Reason: Grouped by product sub-entity; conditional sliders (`visibleWhen`) hide grain/vignette/speed details when their toggle is off.
- Evidence: `src/app/app-schema.ts`, `appControlSectionInventory`.

### Export

- Decision: Sticky `Export PNG` panel action through `createToolcraftPngExportCanvas` honoring `export.image.resolution`; renders the still frame at phase 0 with static grain.
- Reason: Still product delivery; deterministic output from seed.
- Evidence: `src/app/aurora/aurora-export.ts`, `onPanelAction` in `src/app/app-composition.tsx`.

### Performance

- Decision: Single rAF loop with dirty-flag skip (no repaint when static and pointer settled), 1/8-res blob layer, precomputed grain tile, `canvas.renderScale` enabled for the raster preview.
- Reason: Keeps idle cost near zero and animated cost bounded by one small-canvas paint + one upscale per frame.
- Evidence: `src/app/aurora/aurora-canvas.tsx` tick loop; renderer layer caching.

## Evidence

- Runtime API verified against the signed runtime copy: `useToolcraft`, `ToolcraftAppComposition`, `controls.setValue` command, panel action handler contract, PNG export helpers.
- Build evidence: typecheck and production build pass; dev server serves HTTP 200.

## Verification

- Ran: `npx tsc -p tsconfig.json --noEmit`, `npx vite build`, dev-server HTTP 200 smoke on port 4415.
- Not run (out of scope for this pass): `npm run verify:quick`, `npm run verify:ui`, `npm run verify:perf`, `npm run verify:final`.

## Risks

- `appAcceptance` rows are not authored; full Toolcraft gates (`npm run test`, browser/perf receipts) will fail until they are.
- PNG export uses loop phase 0, not the live preview phase.
- Grain uses `overlay` compositing; on very light custom backgrounds the grain reads stronger than on the default near-black.
