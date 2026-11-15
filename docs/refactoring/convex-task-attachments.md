# Task Attachments Convex Refactor Plan

Moves the `taskAttachments` leaf callable module into the `tasks` domain folder
per `docs/guidelines/convex/backend-development.md`. Item #11.1 in
`docs/refactoring/convex-backend.md`. `taskAttachments` owns its own table, so it
is a sub-entity module of the `tasks` domain (`api.tasks.attachments.*`), not its
own domain.

## Summary

- `convex/taskAttachments.ts` → `convex/tasks/attachments.ts`
  (`api.tasks.attachments.*`).
- New repo at `convex/tasks/lib/taskAttachmentsRepo.ts` (flat, matching
  `tasksRepo.ts`/`taskListsRepo.ts`). The existing attachment helper folder
  `convex/tasks/lib/attachments/` (just `validators.ts`) is unchanged.
- Callable module now has zero direct `ctx.db` access — all reads/writes go
  through `taskAttachmentsRepo` (own domain) and `tasksRepo.getTaskById`
  (own domain, foreign table read). `ctx.storage.*` calls stay in the callable
  module (storage is not a `ctx.db` concern and has no repo abstraction).

## Function moves and renames

All public functions keep their names; only the namespace changes.

| Old path | New path |
|---|---|
| `api.taskAttachments.generateTaskAttachmentUploadUrl` | `api.tasks.attachments.generateTaskAttachmentUploadUrl` |
| `api.taskAttachments.getTaskAttachmentUrl` | removed in OS-1901; `registerPendingUploadedAttachment` returns the URL |
| `api.taskAttachments.saveTaskAttachment` | `api.tasks.attachments.saveTaskAttachment` |
| `api.taskAttachments.listTaskAttachmentsByTask` | `api.tasks.attachments.listTaskAttachmentsByTask` |
| `api.taskAttachments.deleteTaskAttachment` | `api.tasks.attachments.deleteTaskAttachment` |

## Repo functions added (`tasks/lib/taskAttachmentsRepo.ts`)

- `getTaskAttachmentById(ctx, attachmentId)`.
- `listTaskAttachmentsByTaskId(ctx, taskId)` — `by_task` index collect.
- `insertTaskAttachment(ctx, props, uploadedBy)` — stamps `uploadedBy`/
  `uploadedAt`; callers pass only the user-supplied props.
- `deleteTaskAttachment(ctx, attachmentId)`.

## Guard conversions

Three inline guards became `ensure` + `errors.ts` catalog entries (messages
unchanged in behavior; `Task not found` was previously a `new Error`, now a
user-facing `ConvexError`):

- `saveTaskAttachment`: `if (!task || task.isDeleted)` →
  `ensure(getTaskById(...)).notDeleted(errors.TASK_NOT_FOUND)`.
- `deleteTaskAttachment`: `if (!attachment)` →
  `ensure(getTaskAttachmentById(...)).notNull(errors.ATTACHMENT_NOT_FOUND)`
  (new catalog entry `ATTACHMENT_NOT_FOUND: "Attachment not found"`, lifted
  verbatim from the old `ConvexError`).
- `deleteTaskAttachment`: `if (!task)` →
  `ensure(getTaskById(...)).notNull(errors.TASK_NOT_FOUND)` (null-only check
  preserved — a soft-deleted task does not block attachment deletion).

The empty-result early returns in `listTaskAttachmentsByTask` (`return []` for
missing auth / missing task / no access) are access semantics, not errors, and
are left as-is per the playbook.

## Scheduler / indexes

- `saveTaskAttachment` and `deleteTaskAttachment` call
  `internal.taskActivityLogs.logActivity` via `ctx.runMutation` (not the
  scheduler). These call sites stay on the **legacy** `internal.taskActivityLogs`
  path because `taskActivityLogs` has not migrated yet; they move to
  `internal.tasks.activity.logActivity` in the activity-logs migration.
- No `scheduler.run*` references into this domain. Shim is one-deploy-cycle.
- No new indexes (`by_task` already existed); no `.filter()` in the domain. No
  indexes became unused.

## Outcome (implemented 2026-06-18)

- `convex/taskAttachments.ts` was initially retained as a re-export shim to
  `./tasks/attachments`, with the legacy path exercised in
  `convex/tasks/shims.test.ts`; both were removed on 2026-07-19.
- Tests moved: `convex/taskAttachments.test.ts` →
  `convex/tasks/attachments.test.ts` (`git mv`); imports and `api.tasks.attachments.*`
  refs updated.
- Call sites updated to `api.tasks.attachments.*`: MCP task resources
  (`convex/mcp/lib/tasks/resources.ts`), CLI (`commands/tasks/shared.ts`), and
  the frontend (`hooks/uploads/use-file-upload.ts`,
  `lib/tasks/hooks/use-task-attachments.ts`,
  `components/blocks/tasks/task-description-editor.tsx`).
- Spec updated: `docs/specs/task-attachments.md` (namespaces + endpoints +
  transitional shim note).

## Shim removal (completed 2026-07-19)

Deleted `convex/taskAttachments.ts`, removed the legacy-path shim tests, and
removed the transitional note from `docs/specs/task-attachments.md`.
