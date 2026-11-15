# Task Activity Logs Convex Refactor Plan

Moves the `taskActivityLogs` leaf callable module into the `tasks` domain folder
per `docs/guidelines/convex/backend-development.md`. Item #11.5 in
`docs/refactoring/convex-backend.md`. `taskActivityLogs` owns its own table, so
it forms a sub-entity module of the `tasks` domain (`api.tasks.activity.*`), not
its own domain. This was the **last** task leaf to migrate.

## Summary

- `convex/taskActivityLogs.ts` → `convex/tasks/activity.ts`
  (`api.tasks.activity.*`, `internal.tasks.activity.logActivity`).
- New flat repo `convex/tasks/lib/taskActivityLogsRepo.ts` for the
  `taskActivityLogs` table.
- New `convex/tasks/lib/activity/validators.ts` holding the activity-log shape
  validators (`eventTypeValidator`, `changeDetailsValidator`) plus the new
  return-item validator (`taskActivityLogListItemValidator`).
- Callable module now has zero direct `ctx.db` access — the insert/paginate go
  through the new repo, the task existence check goes through
  `tasksRepo.getTaskById` (own domain, foreign table read), and actor enrichment
  goes through `usersRepo.getUsersByIds` via the `join` helper.

## Function moves and renames

All public/internal functions keep their names; only the namespace changes.

| Old path | New path |
|---|---|
| `internal.taskActivityLogs.logActivity` | `internal.tasks.activity.logActivity` |
| `api.taskActivityLogs.listByTask` | `api.tasks.activity.listByTask` |

## Repo functions added

`tasks/lib/taskActivityLogsRepo.ts`:

- `paginateTaskActivityLogsByTask(ctx, taskId, paginationOpts)` —
  `by_task_and_createdAt` index, `.order("desc")`, paginated.
- `insertTaskActivityLog(ctx, props)` — stamps `createdAt`; callers pass only
  the event props (`taskId`/`userId`/`eventType`/`changeDetails?`).

## Validators move

`eventTypeValidator` and `changeDetailsValidator` moved verbatim from the root
module into `tasks/lib/activity/validators.ts`. They are consumed by:

- `convex/schema.ts` (the `taskActivityLogs` table definition) — imports them
  from the **callable module** `./tasks/activity` (which re-exports them), not
  the `lib/` folder, because cross-domain value imports from a `<domain>/lib/*`
  path are blocked by the `no-restricted-imports` boundary rule (only `*Repo`
  files and type-only imports are exempt).
- `taskActivityLogsRepo.ts` — type-only import (`import type`), which the
  boundary rule allows.

## Guard conversions

None. The root module had no guard-style `if (...) throw` statements. The
empty-result early returns in `listByTask` (`return EMPTY_PAGE` for missing
auth / missing task / no access) are access semantics, not errors, and are left
as-is per the playbook. No new `errors.ts` entries.

## `join` adoption

`listByTask` previously hand-rolled actor enrichment with
`Promise.all(userIds.map(ctx.db.get))` + a null-filtered `Map`. It now uses the
fluent `join(results.page).on(log => log.userId).with(ids => getUsersByIds(ctx, ids)).selectAll(...)`
left join (`selectAll` keeps every log even when the acting user is deleted,
preserving the `userName: "Unknown"` / `userAvatarUrl: null` fallback).

## Return validator

The original `listByTask` had **no** `returns` validator. The migrated query
adds one via `paginationResultValidator(taskActivityLogListItemValidator)`
(CLAUDE.md gotcha #15), matching the existing `ActivityLog` frontend type. The
internal `logActivity` mutation keeps its `returns: v.id("taskActivityLogs")`.

## Scheduler / indexes

- **Scheduler-sensitive (the reason this leaf went last).**
  `internal.taskActivityLogs.logActivity` was scheduled via
  `ctx.scheduler.runAfter(0, ...)` from ~20 sites. All were repointed to
  `internal.tasks.activity.logActivity` in the same change:
  `convex/lib/tasks/activityLogger.ts` (13), `convex/tasks/artifacts.ts` (4,
  via `ctx.runMutation`), `convex/tasks/attachments.ts` (2, via
  `ctx.runMutation`), and `convex/tasks/comments.ts` (1, via
  `ctx.scheduler.runAfter`). The legacy `internal.taskActivityLogs.logActivity`
  path was kept alive by a one-deploy-cycle shim so in-flight delay-0 jobs
  enqueued just before deploy could still resolve. OS-1030 removed that shim
  after the drain window.
- No new indexes (`by_task_and_createdAt`, `by_task` already existed); no
  `.filter()` in the domain. No indexes became unused.

## Outcome

- Migration implemented 2026-06-18: `convex/taskActivityLogs.ts` became a
  one-deploy-cycle re-export shim → `./tasks/activity` (exporting
  `logActivity`, `listByTask`, `eventTypeValidator`, `changeDetailsValidator`),
  with the legacy `api.taskActivityLogs.*` path exercised in
  `convex/tasks/shims.test.ts`.
- Cleanup implemented in OS-1030: the temporary `convex/taskActivityLogs.ts`
  shim and its dedicated `convex/tasks/shims.test.ts` block were removed.
- Tests moved: `convex/taskActivityLogs.test.ts` → `convex/tasks/activity.test.ts`
  (`git mv`); imports (`./` → `../`, `../convex-testing` → `../../convex-testing`)
  and `api.tasks.activity.*` / `internal.tasks.activity.*` refs updated.
- Call sites updated to `api.tasks.activity.listByTask`: the frontend hook
  (`lib/tasks/hooks/use-task-activity.ts`) and the cross-domain test references
  in `convex/tasks.test.ts` and `convex/tasks/artifacts.test.ts`.
- No `getFunctionName` string-literal mock branches exist for this module
  (repo-wide `"taskActivityLogs:` grep is empty), so §6.5 of the handoff did not
  apply here.
- Spec impact: none. The activity-log mentions in `docs/specs/task-lists.md`,
  `task-bulk-actions.md`, and `task-backlog-status.md` are behavioral, not API
  paths.
- All Step 8 gates green: codegen (both old shim + new paths in
  `_generated/api.d.ts`), `tsc --noEmit`, CLI typecheck, `web:lint` (0 errors),
  full `web:test:once` (2507 passed), and the repo-only / `.filter()` greps.
