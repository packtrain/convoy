# Background Creators Worklog

Mode: multi-product playground host

## Verification tier

- Tier: 4
- Reason: Consolidates five generated app exports into one routed host and one
  runtime snapshot.
- Run: unit tests, TypeScript/build, production chunk inspection, and browser
  smoke coverage for all five routes.
- Skip: full renderer performance checkpoints because renderer algorithms and
  workload controls are unchanged by this migration.

## Decision Trail

### 2026-07-15 — Merge standalone creators

- Request: Serve the five background creators from one project at distinct
  URLs.
- Task type: App assembly, route structure, generated app porting.
- User-visible result: `/ascii-art`, `/aurora`, `/flow-field`, `/grid-lines`,
  and `/halftone` resolve inside one Vite application; `/` redirects to the
  current halftone direction.
- Source/reference checked: All five existing creator exports, their generated
  Toolcraft contracts, and their product worklogs.
- Docs/contracts read: `workflow.md`, `core/runtime-boundary.md`,
  `assembly-workflow.md`, and `decision-contract.md`.
- Contract rules applied: `runtime-shell-required`, `canvas-no-app-ui`,
  `canvas-surface-preserved`, and `workflow-required`.
- Decision: Keep one immutable runtime snapshot and expose each product through
  a small lazy composition-loader interface. The shared host alone renders
  `ToolcraftApp` and keys it by slug.
- Alternatives rejected: Five dev servers preserve runtime duplication; eager
  composition imports put all renderers in the initial bundle; route-local
  Toolcraft chrome duplicates the runtime shell.
- State/output mapping: Each route loads its existing schema, canvas content,
  and panel action handler unchanged; the route slug selects and remounts the
  corresponding runtime state tree.
- Files changed: Consolidated `bg-creators/` project structure, creator
  registry/host/router, package scripts, tests, and playground documentation.
- Verification: `npm run typecheck` passed; `npm run test` passed 12 tests,
  including the 332-file shared runtime manifest check;
  `npm run build` passed and emitted five lazy `app-composition` chunks;
  `npm run test:browser` passed all six route checks.
- Skipped checks: Full Toolcraft renderer performance checkpoints were not run
  because this migration does not change renderer algorithms, controls, canvas
  sizing, export behavior, or workload limits.
- Risks: Creator-specific persistence must use distinct keys if it is
  introduced later. The shared runtime chunk remains large, but creator code is
  now split by route and no longer duplicated across projects.

### 2026-07-15 — Add creator index

- Request: Make the root URL an index with links to every creator.
- Task type: Host navigation and route behavior.
- User-visible result: `/` presents all five background instruments with a
  direct link, description, and visual identifier for each stable route.
- Decision: Render registry metadata only on the index and preload the selected
  creator composition on pointer or keyboard intent. This preserves lazy route
  chunks while reducing the wait after a user chooses an instrument.
- Files changed: Creator registry metadata, root index route and styling,
  browser route coverage, playground README, and route specification.
- Verification: Typecheck passed; 12 unit tests passed; production build
  passed and retained five lazy creator chunks; all six browser route checks
  passed; desktop and phone-width render inspection passed. Root web lint
  passed with 40 existing warnings and the main web app typecheck passed.
