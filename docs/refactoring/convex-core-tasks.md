# Core Tasks Convex Refactor Plan

Splits the `tasks.ts` god module (the last item, #12 in
`docs/refactoring/convex-backend.md`) into a `tasks/core` namespace per
`docs/guidelines/convex/backend-development.md`. The core task **entity** keeps
its CRUD/reads in `tasks/core.ts` (`api.tasks.core.*`) and its **capabilities**
(actions on the one task entity — not new entities) split into a `tasks/core/`
subfolder, symmetric with the sub-entities (`api.tasks.lists.*`,
`api.tasks.comments.*`).

## Summary

- `convex/lib/tasks/*` → `convex/tasks/lib/*` (domain-private helpers; done first).
- `convex/tasks.ts` → `convex/tasks/core.ts` (`api.tasks.core.*`).
- Capabilities extracted to `convex/tasks/core/{bulk,rank,move,search}.ts`
  (`api.tasks.core.bulk.*`, `.rank.*`, `.move.*`, `.search.*`).
- `convex/tasks.ts` was retained as a temporary re-export shim during the
  migration and was fully removed on 2026-07-19.

## Function moves and renames

CRUD/reads — namespace only (`api.tasks.X` → `api.tasks.core.X`): `listByProject`,
`listArchivedByProject`, `listByParent`, `countChildrenBatch` (internal), `getById`,
`getByRefs`, `create`, `update`, `updateExternalLink`, `remove`, `restore`,
`archive`, `unarchive`, `permanentlyDelete` (internal), `duplicate`.

Capabilities — namespaced **and** renamed (redundant prefixes dropped):

| Old path | New path |
|---|---|
| `api.tasks.bulkUpdate` | `api.tasks.core.bulk.update` |
| `api.tasks.bulkRemove` | `api.tasks.core.bulk.remove` |
| `api.tasks.bulkArchive` | `api.tasks.core.bulk.archive` |
| `api.tasks.bulkUnarchive` | `api.tasks.core.bulk.unarchive` |
| `api.tasks.updateRank` | `api.tasks.core.rank.update` |
| `api.tasks.batchUpdateRanks` | `api.tasks.core.rank.batchUpdate` |
| `api.tasks.updateParent` | `api.tasks.core.move.toParent` |
| `api.tasks.moveToList` | `api.tasks.core.move.toList` |
| `api.tasks.searchByProject` | `api.tasks.core.search.byProject` |
| `api.tasks.listRecentForSelector` | `api.tasks.core.search.recentForSelector` |

Single-task `archive`/`unarchive` stay on `core.ts` (`api.tasks.core.archive`);
only the **bulk** variants move to `core/bulk.ts` (split by cardinality).

## Helper disposition (shrinking the `tasks/lib/` bag)

Applied the helper-placement rule (1 consumer → inline; 2+ → shared `lib/`;
table writes → `tasksRepo`):

- `lib/bulkOps.ts` (`fetchValidTasksForBulkOp`) → **inlined** into `core/bulk.ts` (dissolved).
- `lib/publicShape.ts` (`toTaskSelectorResultsPage`) → **inlined** into `core/search.ts` (dissolved).
- `lib/search.ts` **split**: query-time helpers (`normalizeSearchExpression`,
  `parseRefQuery`, `matchesSearchFilters`) → module-local in `core/search.ts`;
  write-time/projection helpers (`buildTaskSearchText`, `normalizeWhitespace`,
  `stripInternalTaskFields`) → renamed **`lib/searchText.ts`** (shared by
  `core.ts`, `core/search.ts`, `lib/updateMutation.ts`, `lib/enrichment.ts`).
- `allRefsError` / `makeGetByRefLookupResult` (getByRefs only) → **inlined** into `core.ts`.
- Stays shared in `lib/`: `tasksRepo` + entity repos, `validators`, `constants`,
  `enrichment`, `statusPolicy`, `ranking`, `tree`, `lifecycle`, `updateMutation`,
  `searchText`.

## Scheduler / indexes / eslint

- `tasksRepo.softDeleteTask` schedules `internal.tasks.core.permanentlyDelete`;
  the temporary `convex/tasks.ts` shim kept the legacy
  `internal.tasks.permanentlyDelete` path resolvable during the compatibility
  window.
- No new indexes; no `.filter()` introduced.
- `core.ts` imports `./lib/*`; `core/*.ts` import `../lib/*` — both own-domain,
  allowed by the existing lint rule. No new carve-out blocks; the tasks
  carve-out is now migrations-only.

## Outcome (implemented 2026-06-20)

Sequenced as behavior-preserving, gated commits (each: convex codegen, web
`tsc`, `pnpm --filter @useconvoy/cli typecheck`, web lint, `web:test:once`):

- Phase A — extract each capability behind a re-export shim, one commit each:
  `core/bulk.ts`, `core/rank.ts`, `core/move.ts`, `core/search.ts`.
- Phase B — `git mv tasks.ts → tasks/core.ts` + full re-export shim (callers
  untouched), then sweep all callers `api.tasks.X` → `api.tasks.core.X` (frontend
  hooks/components, MCP handlers, `apps/cli`, tests), including the MCP handler
  function-name string mocks.
- `convex/tasks.test.ts` → `convex/tasks/core.test.ts` (colocated with `core.ts`),
  with the cleanly-separable capability suites extracted to colocate with their
  modules: `core/bulk.test.ts`, `core/rank.test.ts`, `core/search.test.ts`. The
  `move` tests stay in `core.test.ts` — they are interwoven with the subtask /
  hierarchy / authorization suites (shared fixtures) and don't separate cleanly.
- `convex/tasks/shims.test.ts` exercises the legacy paths to prove the shim
  resolves until removal.

## Phase C — shim cleanup (done 2026-06-20, after the migration deploy)

- Removed all public `api.tasks.*` re-export shims from `convex/tasks.ts` (callers
  were swept to `api.tasks.core.*` and deployed) and the four `tasks
  bulk/rank/move/search` describe blocks in `convex/tasks/shims.test.ts`.
- Fixed a latent ref the full shim had masked: `mcp/lib/tasks/resources.ts` used
  `internal.tasks.countChildrenBatch` → now `internal.tasks.core.countChildrenBatch`.
- Shrank the eslint carve-out in `apps/web/eslint.config.mjs` to migrations-only
  (the residual `convex/tasks.ts` re-exports `./tasks/core`, not `./tasks/lib/**`,
  so it needs no exception).

### Residual `permanentlyDelete` shim (removed 2026-07-19)

After the scheduled hard-delete compatibility window elapsed,
`convex/tasks.ts` and its legacy-path shim test were deleted. New and active
scheduled jobs target `internal.tasks.core.permanentlyDelete`.
