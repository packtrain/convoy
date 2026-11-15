# Implementation Worklog

This file records product decisions and the evidence behind them. Keep it short, factual, and current. Update it after schema, renderer, timeline, layer, export, performance, or acceptance decisions.

## Status

Mode: product

Flow Field — a noise-driven particle-stream background generator for dark landing pages.

## Decision Trail

### Iteration 1 — Flow Field particle-stream background

- Request: Build "Flow Field": thousands of particles advected by a simplex-noise flow field with fading trails, mouse attract/repel, palette-by-speed/angle coloring on a dark background, PNG export.
- Task type: New generative product (Tier 2/3 schema + custom Canvas 2D renderer), pragmatic verification bar requested by the caller (typecheck, build, dev-server smoke) instead of the full final gate.
- User-visible result: Animated particle streams on a dark canvas; controls for Flow field, Particles, Color, Interaction, Motion; sticky Export PNG.
- Source/reference checked: Local `AGENTS.md`, `docs/toolcraft/assembly-workflow.md`, `docs/toolcraft/schema-reference.md`, runtime hook/export helper sources under `src/toolcraft/runtime`.
- Reference inputs: None (fully generative; upload disabled).
- Contract rules applied: `runtime-shell-required`, `canvas-no-app-ui`, `controls-section-inventory-required`, `output-export-required` (Export PNG via sticky `panelActions` + `createToolcraftPngExportCanvas`), `persistence-policy-explicit` (no persistence — decorative generator, defaults are the product).
- Decision: Autonomous decorative animation with no timeline (`animationIntent.mode: "none"`); single rAF loop; self-written 3D simplex noise (time as third axis); typed-array particle state; strokes batched into one path per 32-bucket palette LUT.
- Alternatives rejected: Timeline playback transport (no video export requested; motion is autonomous), WebGL renderer (Canvas 2D is sufficient at the 8k particle cap), noise dependency (none installed; contract prefers no new deps).
- State/output mapping: `field.*` → noise frequency/time-step/steering force; `particles.*` → array size, velocity cap, line width, fade alpha; `color.*` → background fill + palette LUT + bucket scalar (speed/angle); `interaction.*` → cursor force mode/radius/strength; `motion.*` → rAF loop on/off and dt scale.
- Files changed: `src/app/app-schema.ts`, `src/app/app-composition.tsx`, `src/app/app-acceptance-data.ts`, `src/flow-field/{simplex-noise,flow-field-settings,flow-field-simulation,live-canvas-registry,export-flow-field-png}.ts`, `src/flow-field/flow-field-canvas.tsx`.
- Verification: `npx tsc -p tsconfig.json --noEmit` pass; `npx vite build` pass; dev server smoke on port 4414 returned HTTP 200.
- Skipped checks: `npm run verify:quick` / `verify:ui` / `verify:perf` / `verify:final` — explicitly out of scope per the requesting task's pragmatic verification bar; `appAcceptance` matrix left empty for the same reason.
- Risks: Acceptance matrix and browser/perf receipts are not populated, so `npm run test` / `verify:final` will fail until a follow-up fills them; trail fade uses background-alpha compositing, which can leave faint residue at very low fade values.

## Decisions

### Renderer

- Decision: Custom Canvas 2D renderer in `canvasContent` (`FlowFieldCanvas`), `renderDefaultCanvasMedia: false`.
- Reason: Trails via translucent background fill need a persistent raster; Canvas 2D handles 3–8k stroked segments per frame comfortably when batched by color bucket.
- Evidence: `src/flow-field/flow-field-simulation.ts` (typed arrays, per-bucket batched strokes), single rAF loop in `src/flow-field/flow-field-canvas.tsx`.

### Timeline

- Decision: No timeline; autonomous decorative animation (`animationIntent.mode: "none"`).
- Reason: The motion is an ambient background with no user transport and no video export.
- Evidence: `panels.timeline` omitted; Motion section owns animate on/off + overall speed.

### Layers

- Decision: No layers.
- Reason: Single generative output, no per-object workflow.

### Controls

- Decision: Five product sections (Flow field, Particles, Color, Interaction, Motion) plus sticky Export.
- Reason: Grouped by product entity per the exported `appControlSectionInventory`; conditional visibility for Color C (behind Third color switch), interaction radius/strength (hidden when mouse mode is Off), and overall speed (hidden when paused).
- Evidence: `src/app/app-schema.ts`, `src/app/app-acceptance-data.ts`.

### Export

- Decision: Sticky `panelActions` Export PNG using `createToolcraftPngExportCanvas` (retina size from current canvas size), drawing the live simulation canvas.
- Evidence: `src/flow-field/export-flow-field-png.ts`, `onPanelAction` in `src/app/app-composition.tsx`.

### Performance

- Decision: Typed-array particle state, one rAF loop, default 3000 particles (hard cap 8000 via slider), 32-color palette LUT with one stroked path per bucket, device pixel ratio capped at 2.
- Evidence: `flow-field-simulation.ts` constants and draw pass; `performanceRole`/`performanceReason` declared per control.

## Evidence

- Source reviewed: runtime hooks (`useToolcraft`), `CanvasShell` content sizing, export helpers, panel action handler contract.
- Contract applied: product output only in `canvasContent`; schema owns all app state; export routed through the sticky footer.

## Verification

- Run: `npx tsc -p tsconfig.json --noEmit` — pass.
- Run: `npx vite build` — pass.
- Run: dev server smoke test on port 4414 — HTTP 200, then stopped.

## Risks

- Full Toolcraft gates (`npm run test`, browser acceptance, perf receipt, `verify:final`) intentionally not run per the requesting task; the empty `appAcceptance` matrix is the main gap for final delivery.
