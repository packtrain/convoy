# App Version Convex Refactor (Pilot)

## Summary

Pilot the domain-folder convention from `convex-backend.md` on the smallest callable domain. This proves the generated-API path migration (`api.appVersion.get` -> `api.appVersion.core.get`) end to end — codegen, call-site updates, test relocation, and validation — before the first multi-module migration (organizations).

This is an intentional generated API rename **with a temporary backward-compatibility shim**: root `convex/appVersion.ts` becomes a one-line re-export of the new module so the legacy `api.appVersion.get` path keeps working for stale browser bundles. The existing `AppVersionWatcher` (which polls the Next.js `/api/app-version` route, independent of Convex) shows the "Refresh required" banner that moves users off old bundles; the shim is deleted one deploy cycle later.

## Scope

```txt
apps/web/convex/appVersion.ts       -> apps/web/convex/appVersion/core.ts
apps/web/convex/appVersion.test.ts  -> apps/web/convex/appVersion/core.test.ts
```

- One export (`get`, a public query). No internal functions, no domain `lib/` needed.
- API rename: `api.appVersion.get` -> `api.appVersion.core.get`.
- Regenerate generated API files: `pnpm --filter @convoy/web exec convex codegen`.

## Call Sites (verified)

- `apps/web/components/blocks/user/settings/developer-section.tsx` — the only production caller.
- `apps/web/convex/appVersion.test.ts` — moves with the module.
- No `apps/cli` usage. No MCP usage. No `ctx.scheduler.run*` references into this domain, so no shim or drain step is required.

## Risks

- **Stale browser bundles**: covered by the shim — old bundles keep calling `api.appVersion.get` successfully, and the Convex-independent `AppVersionWatcher` banner prompts a refresh after the next frontend deploy. Shim removal happens only after a deploy cycle has passed.

## Steps

1. Create `convex/appVersion/core.ts` with the unchanged implementation; replace root `convex/appVersion.ts` with `export { get } from "./appVersion/core";` plus a removal note.
2. Move the test to `convex/appVersion/core.test.ts`, update its references to `api.appVersion.core.get`, and add a legacy-path test asserting `api.appVersion.get` still resolves through the shim (deleted together with the shim). (Vitest's default recursive glob picks up nested test files; no harness changes.)
3. Run codegen and update `developer-section.tsx`.
4. Update `docs/specs/user-settings-developer-section.md` and any stale path references in docs/AGENTS/CLAUDE.
5. Record learnings in `convex-backend.md`.
6. **Follow-up (separate change, one deploy cycle later)**: delete `convex/appVersion.ts`, the legacy-path test, and the transitional note in the spec.

## Validation

```bash
pnpm --filter @convoy/web exec convex codegen
pnpm --filter @convoy/web exec vitest run convex/appVersion/core.test.ts
pnpm web:test:once
pnpm web:lint
cd apps/web && npx tsc --noEmit
pnpm --filter @useconvoy/cli typecheck
rg "api\.appVersion\.get" apps   # must only show api.appVersion.core.get call sites
```

## Exit Criteria

- `convex/appVersion/core.ts` is the canonical module; root `convex/appVersion.ts` is a marked transitional shim with a scheduled removal.
- All validation passes, including CLI typecheck against regenerated API types.
- Learnings (codegen quirks, file-plus-folder behavior, anything unexpected) are recorded back into `convex-backend.md` before starting the organizations migration.

## Outcome (implemented 2026-06-11)

- **File-plus-folder coexistence works.** `convex/appVersion.ts` and `convex/appVersion/core.ts` coexist cleanly: codegen registers both `appVersion` and `appVersion/core` module paths, and the generated types merge so `api.appVersion.get` and `api.appVersion.core.get` are both valid. This resolves the "verify codegen handles file-plus-folder module paths" watch item in `convex-backend.md`.
- **A re-export is a sufficient shim.** `export { get } from "./appVersion/core";` registers the same query under the legacy path — no duplicated implementation needed. Verified by a convex-test case calling the legacy reference.
- Validation: targeted tests, web tsc, web lint, and CLI typecheck all pass. The full suite has 3 pre-existing failures in `part-renderer-registry.test.tsx` (Edit-tool diff whitespace assertions), confirmed unrelated by reproducing them on a clean tree.
