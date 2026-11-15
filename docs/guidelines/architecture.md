# Architecture guardrails

## One canonical implementation

- Keep one canonical implementation per behavior; avoid duplicated logic across
  layers.
- Keep public APIs minimal — don't export helpers that production code does not
  use.

## Subsystems over scattered conditionals

- Prefer high-cohesion subsystems for domains with distinct rules, parsers,
  catalogs, validators, or transformations. Top-level modules should orchestrate
  and delegate, not accumulate domain-specific branches.
- When adding a variant to a feature (new CLI runtime, new protocol adapter, new
  import/export format), extend the owning subsystem or folder instead of
  scattering conditionals across unrelated files.

## Entities vs. embedded fields (Convex)

Only **entities** — things with their own table and lifecycle — get a dedicated
Convex module, `api.*` namespace, `<domain>/lib/` sub-folder, or adapter handler
file.

An embedded field or value-object lives on the owning domain's core module (e.g.
`api.tasks.core.updateExternalLink`, **not** `api.tasks.links.*`), with helpers
as a flat `lib/` file.

Folders under `<domain>/lib/` map to entities; flat files are helpers and
value-objects. Full detail: [convex/backend-development.md](convex/backend-development.md)
("Entities vs. embedded fields").

## Hook ownership

- `apps/web/hooks/` is for **shared cross-domain hooks only**. Do not add new
  feature hooks there unless they are reused across multiple unrelated domains.
- Product-domain hooks go under that domain, usually
  `apps/web/lib/<domain>/hooks/`.
- A hook that mainly drives one component subtree is colocated under that
  subtree.
- Playground/demo-only hooks stay under the relevant `app/playground/...`
  subtree.

Reference patterns: the task-table controller hooks and the thread/CLI hooks.

## Resilience

- Treat external dependencies as unreliable (I/O, browser APIs, network): fail
  soft and preserve core UX.
- Avoid expensive work on high-frequency paths; batch or debounce non-urgent side
  effects.
- Validate and normalize boundary state; self-correct stale or invalid persisted
  values where possible.
- Prefer state models that limit unnecessary rerenders as features scale.

## Deep modules

A feature is a deep module (Ousterhout, *A Philosophy of Software Design*):
a small interface over a lot of functionality, isolated in its own folder.

- One folder per layer: `apps/web/components/blocks/<feature>/` for UI,
  `apps/web/lib/<feature>/` for hooks and pure helpers. The UI folder's
  `index.ts` is the single entry point and exports one to three things; the
  `lib/` folder is internal to it and has no entry point of its own.
- List the wiring points outside the module before writing code — a route
  helper, a host switch, one mount line. If the list grows past a handful, the
  interface is too wide.
- Enforce the boundary with the existing `no-restricted-imports` patterns in
  `apps/web/eslint.config.mjs`, not a new mechanism.
- Dependencies point inward: the module may import shared libs, generic
  `components/custom/*`, and another feature's *exported* presentation (a
  header, a back button) as long as that feature only imports the module back
  through its wiring points; nothing outside imports the module's internals.
- Entities stay home. A Convex table, its `*Repo`, and a CLI op processor belong
  to the module that owns the entity; the feature adds variants there (new op
  kinds, new fields) instead of forking a parallel domain.
- Presentation that a second feature needs (a diff renderer, a file tree) moves
  to `components/custom/` when that second consumer appears, not before.

Precedents: `docs/specs/github-integration.md` (`components/blocks/integrations/`
+ `lib/integrations/`, thin wiring points) and the worktree changes view
(OS-1980).
