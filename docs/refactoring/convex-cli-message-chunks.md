# CLI `messageChunks` Callable Convex Refactor Plan

Moves the first callable CLI module out of the Convex root into the `cli` domain
folder per `docs/guidelines/convex/backend-development.md`. This is step 1 of
item #13 in `docs/refactoring/convex-backend.md` (Callable CLI Domain), done one
module per commit with the hub (`cliThreads`) last.

## Summary

- `convex/cliMessageChunks.ts` → `convex/cli/messageChunks.ts`. The four
  read-only queries (`listWindowByThread`, `listLiveByThread`,
  `listNormalizedByThread`, `listNormalizedByMessages`) keep identical behavior;
  their public path changes from `api.cliMessageChunks.*` to
  `api.cli.messageChunks.*`, and they were refactored onto a repo with `ensure`
  guards (see "Full-domain refactor" below).
- The `cliMessageChunks` **table** name is unchanged — only the callable module
  path moved.
- `convex/cliMessageChunks.ts` was retained for one deploy cycle as a re-export
  shim for the legacy `api.cliMessageChunks.*` paths, then removed on 2026-07-19.
- Test moved with `git mv` to `convex/cli/messageChunks.test.ts` (14 tests);
  added `convex/cli/shims.test.ts` exercising one legacy path.

This is a **full domain refactor**, not just a relocation: the module also got
repo extraction, `ensure` guards, an `errors` catalog, and de-duplicated
read-row mapping — matching the task-leaf treatment.

## Full-domain refactor (repo, ensure, errors)

- **Repo extraction:** all `cliMessageChunks` index-backed reads moved to
  `convex/cli/lib/cliMessageChunksRepo.ts` (the first CLI repo). It exports
  `listLatestChunks`, `listChunksBeforeCursor`, `listChunksAfterCursor`,
  `getChunkAtCursor`, `listAllChunksByThread`, `listChunksFromCreatedAt`,
  `listChunksByMessage`, and the shared `ChunkCursor` type. The callable module
  now has **zero `ctx.db.` access** (playbook Step 4).
- **errors catalog:** `convex/cli/errors.ts` holds the two bootstrap-guard
  messages verbatim (`TOO_MANY_BOOTSTRAP_MESSAGES`, `bootstrapChunksExceeded`).
- **ensure guards:** the two `throw new ConvexError(...)` bootstrap-limit guards
  became `ensure(...).lte(max, errors.X)` (playbook Step 3). Empty-result early
  returns (no thread / no access / no `after`) stay as `return EMPTY` — those
  are access semantics, not errors.
- **De-duplication:** a single `resolveReadableThread` helper replaces the
  auth + `getAccessibleThread` + `hasProjectAccess` block repeated across all
  four queries; a shared `toReadRows` + `pageTailCursor` replace the four
  inlined `chunks.map(...)` / cursor-build blocks.
- **No `join` adoption:** the module reads only the `cliMessageChunks` table
  (no cross-table enrichment loops), so there is nothing for `join` to replace.
- **Pure-helper extractions (cohesion):** two algorithms moved out of the
  callable to their natural `cli/lib/` homes and gained unit tests:
  - read-time event derivation `getNormalizedEventForRead` →
    `resolveChunkReadEvent` in `cli/lib/chunks/normalizedEvents.ts` (beside the
    other normalization helpers; reuses `normalizeCliChunkToEvent`, so the
    callable no longer imports `normalizeCliChunk` directly). Typed on a narrow
    `Pick<Doc<"cliMessageChunks">, "type" | "data" | "normalizedEvent">` so it is
    testable without a full doc.
  - the hand-rolled k-way merge in `listNormalizedByMessages` →
    `mergeOrderedChunkGroups` in `cli/lib/chunks/chunkOrder.ts` (generic over
    `ChunkOrderComparable`).
  - `chunkOrder.ts` (+ test) also moved from `cli/lib/` into `cli/lib/chunks/`
    to sit beside the other chunk helpers (`normalizedEvents.ts`, `store.ts`);
    three importers were repointed (`messageChunks.ts`, `cliMessageChunksRepo.ts`,
    and the frontend `lib/cli-stream-ui/event-store.ts`).
  - The callable's `ReadRow.event` is now typed directly as
    `CliNormalizedEvent | undefined` instead of `ReturnType<typeof ...>`.
- **Behavior preserved:** the `listNormalizedByThread` delta path keeps its
  collect-from-`createdAt` + in-memory composite-cursor filter (now expressed
  via `compareChunkOrder(chunk, cursor) > 0`); the `TODO(OS-538)` to swap it for
  the index-backed `listChunksAfterCursor` is intentionally left for a separate
  behavior-reviewed change. All 14 existing module tests pass unchanged.

## Import-specifier rewrites

The module moved from `convex/` (1 level) to `convex/cli/` (2 levels), so
specifiers were re-based:

- `./_generated/*` → `../_generated/*`
- `./lib/access/{auth,permissions}` → `../lib/access/{auth,permissions}`
- `./lib/contracts/validators` → `../lib/contracts/validators`
- `./cli/lib/{messages/ownership,runtimes/registry,chunkOrder}` →
  `./lib/{messages/ownership,runtimes/registry,chunkOrder}` (now the domain's
  own `lib/`, so no eslint boundary carve-out needed)
- `../lib/authz/permissions` (apps/web `lib/`, outside `convex/`) →
  `../../lib/authz/permissions`

Test file: `./_generated/api` → `../_generated/api`; `../convex-testing` →
`../../convex-testing`; `api.cliMessageChunks.*` → `api.cli.messageChunks.*`.

## Call sites repointed

- `apps/web/lib/threads/hooks/use-cli-messages.ts` (5 refs: 2 `useQuery`,
  3 `FunctionReturnType<typeof api.cli.messageChunks.*>`)
- `apps/web/lib/threads/hooks/use-cli-messages.test.tsx` (4 `getFunctionName`
  refs)

No `internal.cliMessageChunks.*` references and no `scheduler.run*` references
into this module exist, so no scheduler shim was required.

## ESLint carve-out

Removed the `convex/cliMessageChunks.ts` / `convex/cliMessageChunks.test.ts`
entries from the transitional carve-out block in `apps/web/eslint.config.mjs`.
The relocated module lives inside the `cli` domain (its `./lib/*` imports are
in-domain and allowed); the root shim only re-exports and imports no `lib/`.
The remaining four root callable cli modules keep their carve-out entries until
they migrate; delete the whole block when `cliThreads` lands.

## Validation (implemented 2026-06-18)

- `npx convex codegen` — succeeds; `api.d.ts` carries both `cli/messageChunks`
  and legacy `cliMessageChunks` paths.
- `cd apps/web && npx tsc --noEmit` — clean.
- `pnpm --filter @useconvoy/cli typecheck` — clean (CLI consumes generated api).
- `pnpm web:lint` — 0 errors (pre-existing warnings only).
- `pnpm web:test:once` — 221 files / 2508 tests pass.
- Grep gates: `rg "\.filter\(\(q\)" convex/cli/` empty; `api.cliMessageChunks`
  only in the shim + `convex/cli/shims.test.ts`.

## Shim removal (completed 2026-07-19)

Deleted `convex/cliMessageChunks.ts`, removed the legacy-path shim tests, and
removed the transitional note from `docs/specs/cli-message-chunks-storage.md`.
