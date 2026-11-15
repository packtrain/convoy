# Task Lists Convex Refactor Plan

Moves the `taskLists` leaf callable module into the `tasks` domain folder per
`docs/guidelines/convex/backend-development.md`. Item #11.4 in
`docs/refactoring/convex-backend.md`. `taskLists` owns its own table, so it is a
sub-entity module of the `tasks` domain (`api.tasks.lists.*`), not its own
domain.

## Summary

- `convex/taskLists.ts` → `convex/tasks/lists.ts` (`api.tasks.lists.*`).
- Repo lives flat at `convex/tasks/lib/taskListsRepo.ts` (matching
  `tasksRepo.ts`/`taskArtifactsRepo.ts`); it is **extended**, not moved. The
  other List helpers stay under `convex/tasks/lib/lists/`.
- Callable module now has zero direct `ctx.db` access — all reads/writes go
  through `taskListsRepo` (own domain) and `projectsRepo` (foreign domain).

## Function moves and renames

All public functions keep their names; only the namespace changes.

| Old path | New path |
|---|---|
| `api.taskLists.list` | `api.tasks.lists.list` |
| `api.taskLists.getByRef` | `api.tasks.lists.getByRef` |
| `api.taskLists.create` | `api.tasks.lists.create` |
| `api.taskLists.update` | `api.tasks.lists.update` |
| `api.taskLists.setDefault` | `api.tasks.lists.setDefault` |
| `api.taskLists.pin` / `unpin` | `api.tasks.lists.pin` / `unpin` |
| `api.taskLists.pinSystemList` / `unpinSystemList` | `api.tasks.lists.pinSystemList` / `unpinSystemList` |
| `api.taskLists.listPinnedSystemListKeys` | `api.tasks.lists.listPinnedSystemListKeys` |
| `api.taskLists.listPinnedForOrganization` | `api.tasks.lists.listPinnedForOrganization` |
| `api.taskLists.archive` / `unarchive` | `api.tasks.lists.archive` / `unarchive` |
| `api.taskLists.remove` | `api.tasks.lists.remove` |

## Repo functions added (`tasks/lib/taskListsRepo.ts`)

- `paginateTaskLists(ctx, { projectId, isArchived, queryText?, paginationOpts })`
  — absorbs the `list` query's search-index vs. name-index branches.
- `listPinnedTaskListsByProject(ctx, projectId)` — collect-all for the sidebar.
- `insertTaskList(ctx, { projectId, name, ref, rank, color? }, createdBy)` — computes
  `normalizedName`/`searchText`, stamps system fields. `createInboxList` now
  delegates to it.
- `updateTaskList(ctx, listId, patch, updatedBy)` — the single update primitive;
  stamps `updatedBy`/`updatedAt`, applies the patch as-is so explicit
  `undefined` clears a field (pin/archive transitions). Exports
  `TaskListUpdatePatch`.
- `deleteTaskList(ctx, listId)`.

`projectsRepo.ProjectUpdatePatch` gains `defaultListId` so `setDefault` routes
through `updateProject` (stamping `updatedAt`) instead of patching the project
row inline. `setProjectDefaultList` stays for the creation path (no
`updatedAt`); no generic `patchProject` was added — the two existing functions
already express the user-edit vs. system-write distinction.

## Guard conversions

Two inline `ConvexError`s became `ensure` + `errors.ts` catalog entries
(messages unchanged):

- `LIST_ARCHIVED_CANNOT_BE_DEFAULT` — "Archived Lists cannot be set as the default"
- `LIST_ARCHIVED_CANNOT_BE_PINNED` — "Archived Lists cannot be pinned"

## Scheduler / indexes

- No `scheduler.run*` references into this domain; no `internal.taskLists.*`
  callers. Shim is one-deploy-cycle, not long-lived.
- No new indexes; no `.filter()` in the domain. No indexes became unused.

## Outcome (implemented 2026-06-18)

- `convex/taskLists.ts` was initially retained as a re-export shim to
  `./tasks/lists`, with `convex/tasks/shims.test.ts` exercising a legacy path;
  both were removed on 2026-07-19.
- Tests moved: `convex/taskLists.test.ts` → `convex/tasks/lists.test.ts`;
  `convex/tasks/listsDefault.test.ts` API refs updated.
- Call sites updated to `api.tasks.lists.*`: MCP handler, CLI (`lists/list.ts`),
  and the `project/task-lists/` + `sidebar/nav-projects` frontend.
- Specs updated: `task-lists.md` (table names unchanged), sidebar pinned-lists,
  cli-one-shot-commands.

## Shim removal (completed 2026-07-19)

Deleted `convex/taskLists.ts`, removed the legacy-path shim tests, and removed
the transitional note from `docs/specs/project-sidebar-pinned-lists.md`.
