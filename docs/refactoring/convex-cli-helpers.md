# CLI Private Helpers Convex Refactor Plan

Moves the CLI backend helper tree out of root shared `convex/lib/` into the `cli`
domain folder per `docs/guidelines/convex/backend-development.md`. Item #10 in
`docs/refactoring/convex-backend.md`. This is a **pure helper relocation**: the
tree contains no callable Convex functions, so no `api.*`/`internal.*` surface
changed and no runtime shim was required.

## Summary

- `convex/lib/cli/*` → `convex/cli/lib/*` — all 27 files (runtime registry +
  `claudeCode/` + `shared/`, message helpers, profile registry, path/constants
  helpers, chunk ordering + normalization, waiting-input detection) plus the 4
  colocated tests, moved with `git mv` to preserve history.
- Establishes the `convex/cli/` domain folder ahead of item 13 (the callable CLI
  modules `cliThreads.ts`, `cliMessages.ts`, etc.), which will later land at
  `convex/cli/<module>.ts` alongside this `convex/cli/lib/`.
- No callable Convex exports exist in the tree → no shim, no scheduler changes.
  The generated `convex/_generated/api.d.ts` diff is path-string renames only
  (`lib_cli_* → cli_lib_*`), confirming the public/internal surface is unchanged.

## Import-specifier rewrites

`convex/lib/cli/` and `convex/cli/lib/` are both two levels under `convex/`, so
imports *to* `convex/_generated` and *to* the convex root were unaffected. Two
classes of specifier changed:

1. **Consumers of the tree** (`lib/cli/` substring): a uniform `lib/cli/` →
   `cli/lib/` rewrite covered all three forms — `@/convex/lib/cli/…` (5 frontend
   files in `lib/cli-runtime-ui/`, `lib/cli-stream-ui/`, `lib/threads/`; 2
   in-tree files; 1 callable), `./lib/cli/…` (the 5 root callable cli modules),
   and `../convex/lib/cli/…` (`convex-testing/builders.ts`).
2. **Imports escaping the tree into other `convex/lib/` siblings**: the relative
   depth to `convex/lib/<sibling>` changed (old `../<sibling>` → new
   `../../lib/<sibling>`). Fixed in `cli/lib/tasks.ts` (`access/permissions`,
   `contracts/taskTypes`), `cli/lib/waitingInput.ts`,
   `cli/lib/chunks/{normalizedEvents,store}.ts`, and `cli/lib/messages/data.ts`
   (`contracts/validators`). The two outside consumers under `convex/lib/`
   (`http/registerBody.ts`, `contracts/validators.ts`) used `../cli/…` → fixed
   to `../../cli/lib/…`.

## ESLint domain-boundary carve-out (transitional)

The boundary rule in `eslint.config.mjs` makes `convex/<domain>/lib/*` private to
its domain (non-type, non-`*Repo` imports restricted). Moving the tree turned
`convex/cli/lib/` into a **cli-domain private lib**, but its consumers still sit
outside `convex/cli/`:

- The 5 callable cli modules at the convex root (`cliThreads.ts`,
  `cliMessages.ts`, `cliMessageChunks.ts`, `cliProfiles.ts`, `cliSessions.ts`) —
  they *are* the cli domain, just not yet relocated (item 13).
- Two genuine cross-domain consumers, `convex/lib/http/registerBody.ts`
  (`parseAvailableCli`) and `convex/lib/contracts/validators.ts` (runtime
  contracts/validators), which previously imported the tree freely because it
  lived under shared root `convex/lib/`.

A transitional carve-out block (mirroring the tasks-migration one) lets those
files import `convex/cli/lib/*` until item 13. **Remove it when the callable cli
modules move into `convex/cli/`**; at that point the cross-domain dependency of
`registerBody.ts` / `contracts/validators.ts` should be resolved properly — by
promoting the truly-shared cli runtime contracts to root `convex/lib/` or by
exposing them through a cli public surface.

## Validation (implemented 2026-06-18)

- `npx convex codegen` — succeeds; `api.d.ts` diff is path renames only.
- `cd apps/web && npx tsc --noEmit` — clean.
- `pnpm --filter @useconvoy/cli typecheck` — clean (CLI only consumes generated api).
- `pnpm web:lint` — 0 errors (pre-existing warnings only).
- `pnpm web:test:once` — 220 files / 2507 tests pass, including the moved tests
  running from `convex/cli/lib/`.
- Grep gate: `rg "lib/cli/" apps -g '!**/_generated/**'` is empty.

## Follow-up

- Item 13 (callable CLI domain) moves `cli*.ts` → `convex/cli/*.ts`; delete the
  transitional eslint carve-out and re-home the `registerBody.ts` /
  `contracts/validators.ts` cli-runtime dependency at that time.
