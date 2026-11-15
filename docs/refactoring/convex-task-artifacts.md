# Task Artifacts Convex Refactor Plan

Moves the `taskArtifacts` leaf callable module into the `tasks` domain folder per
`docs/guidelines/convex/backend-development.md`. Item #11.2 in
`docs/refactoring/convex-backend.md`. `taskArtifacts` owns its own table, so it
forms a sub-entity module of the `tasks` domain (`api.tasks.artifacts.*`), not its
own domain.

## Summary

- `convex/taskArtifacts.ts` → `convex/tasks/artifacts.ts` (`api.tasks.artifacts.*`).
- The callable module was **already** refactored onto repos, `ensure`, and the
  `tasks/errors.ts` catalog in earlier work (the `tasks/lib/taskArtifactsRepo.ts`
  flat repo and the `tasks/lib/artifacts/` helper folder — `normalize.ts`,
  `validators.ts` — predate this change). So this migration is purely the
  namespace move (callable path + shim + call sites + tests + docs); no repo,
  `ensure`, or `errors` work was required.
- Callable module has zero direct `ctx.db` access — all reads/writes go through
  `taskArtifactsRepo` (own table) plus `tasksRepo.getTaskById` /
  `getActiveTaskById` (own domain, foreign-table reads). No `.filter()` in the
  domain; no enrichment loops, so no `join` adoption was needed.

## Function moves and renames

All public functions keep their names; only the namespace changes.

| Old path | New path |
|---|---|
| `api.taskArtifacts.listTaskArtifactsByTask` | `api.tasks.artifacts.listTaskArtifactsByTask` |
| `api.taskArtifacts.getTaskArtifact` | `api.tasks.artifacts.getTaskArtifact` |
| `api.taskArtifacts.getTaskArtifactSafe` | `api.tasks.artifacts.getTaskArtifactSafe` |
| `api.taskArtifacts.createTaskArtifact` | `api.tasks.artifacts.createTaskArtifact` |
| `api.taskArtifacts.updateTaskArtifact` | `api.tasks.artifacts.updateTaskArtifact` |
| `api.taskArtifacts.replaceInTaskArtifact` | `api.tasks.artifacts.replaceInTaskArtifact` |
| `api.taskArtifacts.deleteTaskArtifact` | `api.tasks.artifacts.deleteTaskArtifact` |

## Scheduler / indexes

- `createTaskArtifact` / `updateTaskArtifact` / `replaceInTaskArtifact` /
  `deleteTaskArtifact` schedule `internal.taskActivityLogs.logActivity` via
  `ctx.runMutation`. These call sites stay on the **legacy**
  `internal.taskActivityLogs` path because `taskActivityLogs` has not migrated
  yet; they move to `internal.tasks.activity.logActivity` in the activity-logs
  migration.
- No new indexes; no `.filter()` in the domain. No indexes became unused.

## Outcome (implemented 2026-06-18)

- `convex/taskArtifacts.ts` was initially retained as a re-export shim to
  `./tasks/artifacts`, with the legacy path exercised in
  `convex/tasks/shims.test.ts`; both were removed on 2026-07-19.
- Tests moved: `convex/taskArtifacts.test.ts` → `convex/tasks/artifacts.test.ts`
  (`git mv`); imports (`./_generated` → `../_generated`, `../convex-testing` →
  `../../convex-testing`) and `api.tasks.artifacts.*` refs updated.
- Call sites updated to `api.tasks.artifacts.*`: MCP artifact handler
  (`convex/mcp/handlers/tasks/artifacts.ts`), MCP task resources
  (`convex/mcp/lib/tasks/resources.ts`), the frontend
  (`lib/tasks/hooks/use-task-artifacts.ts`), and the CLI artifact commands
  (`apps/cli/src/commands/tasks/artifacts/*` and `commands/tasks/shared.ts`).
- Function-name string literals (mock branches keyed on `getFunctionName`)
  updated `"taskArtifacts:listTaskArtifactsByTask"` →
  `"tasks/artifacts:listTaskArtifactsByTask"` in `convex/mcp/handler.test.ts`
  (note the `/`, not `.`). The `api.*` grep gate does **not** catch these — they
  are plain strings.
- Specs updated: `docs/specs/task-artifacts.md` (namespace block + transitional
  shim note) and `docs/specs/cli-one-shot-commands.md`
  (`tasks.artifacts.*` endpoint refs).
- All gates green: codegen, `tsc --noEmit`, CLI typecheck, `web:lint`
  (0 errors), full `web:test:once` (2501 passed), CLI tests (291 passed), and the
  repo-only / `.filter()` greps.

## Shim removal (completed 2026-07-19)

Deleted `convex/taskArtifacts.ts`, removed the legacy-path shim tests, and
removed the transitional note from `docs/specs/task-artifacts.md`.
