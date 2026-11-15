# Task Comments Convex Refactor Plan

Moves the `taskComments` leaf callable module into the `tasks` domain folder per
`docs/guidelines/convex/backend-development.md`. Item #11.3 in
`docs/refactoring/convex-backend.md`. `taskComments` (and its
`taskCommentAttachments` table) own their own tables, so they form a sub-entity
module of the `tasks` domain (`api.tasks.comments.*`), not their own domain.

## Summary

- `convex/taskComments.ts` → `convex/tasks/comments.ts` (`api.tasks.comments.*`).
- Two new flat repos (matching `tasksRepo.ts`/`taskListsRepo.ts`):
  - `convex/tasks/lib/taskCommentsRepo.ts` — `taskComments` table.
  - `convex/tasks/lib/taskCommentAttachmentsRepo.ts` — `taskCommentAttachments`
    table.
  The existing comment helper folder `convex/tasks/lib/comments/` (just
  `validators.ts`) is unchanged.
- Callable module now has zero direct `ctx.db` access — all reads/writes go
  through the two comment repos (own tables) plus `tasksRepo.getTaskById`
  (own domain, foreign table read) and `usersRepo.getUsersByIds` (foreign repo,
  used via the `join` helper). `ctx.storage.*` calls stay in the callable module
  (storage has no repo abstraction).

## Function moves and renames

All public functions keep their names; only the namespace changes.

| Old path | New path |
|---|---|
| `api.taskComments.listByTask` | `api.tasks.comments.listByTask` |
| `api.taskComments.create` | `api.tasks.comments.create` |
| `api.taskComments.createWithAttachments` | `api.tasks.comments.createWithAttachments` |
| `api.taskComments.update` | `api.tasks.comments.update` |
| `api.taskComments.remove` | `api.tasks.comments.remove` |
| `api.taskComments.generateTaskCommentAttachmentUploadUrl` | `api.tasks.comments.generateTaskCommentAttachmentUploadUrl` |
| `api.taskComments.deletePendingUploadedAttachment` | `api.tasks.comments.deletePendingUploadedAttachment` |
| `api.taskComments.deleteTaskCommentAttachment` | `api.tasks.comments.deleteTaskCommentAttachment` |

## Repo functions added

`tasks/lib/taskCommentsRepo.ts`:

- `getTaskCommentById(ctx, commentId)`.
- `paginateTaskCommentsByTask(ctx, taskId, paginationOpts)` —
  `by_task_and_createdAt` index, `.order("desc")`, paginated.
- `insertTaskComment(ctx, props, authorId)` — stamps
  `createdAt`/`updatedAt`/`isEdited: false`; callers pass only the
  user-supplied props.
- `updateTaskCommentContent(ctx, commentId, content)` — intent-named author
  edit: stamps `updatedAt` and sets `isEdited: true`.
- `deleteTaskComment(ctx, commentId)`.

`tasks/lib/taskCommentAttachmentsRepo.ts`:

- `getTaskCommentAttachmentById(ctx, attachmentId)`.
- `listTaskCommentAttachmentsByComment(ctx, commentId)` — `by_comment` collect.
- `listTaskCommentAttachmentsByCommentIds(ctx, commentIds)` — batch getter for
  the `listByTask` enrichment (one array per comment, aligned by index).
- `findTaskCommentAttachmentByStorageId(ctx, storageId)` — `by_storageId`
  `.first()`.
- `insertTaskCommentAttachment(ctx, props, uploadedBy)` — stamps
  `uploadedBy`/`uploadedAt`.
- `deleteTaskCommentAttachment(ctx, attachmentId)`.

## Guard conversions

Inline guards became `ensure` + `errors.ts` catalog entries (messages unchanged
in behavior; the `new Error("...")` guards now throw user-facing `ConvexError`s,
matching the attachments precedent):

- `createCommentCore` / `generateTaskCommentAttachmentUploadUrl` /
  `deletePendingUploadedAttachment`: `if (!task || task.isDeleted)` →
  `ensure(getTaskById(...)).notDeleted(errors.TASK_NOT_FOUND)`.
- `update`: `if (!comment)` →
  `ensure(getTaskCommentById(...)).notNull(errors.COMMENT_NOT_FOUND)`; task guard
  → `.notDeleted(errors.TASK_NOT_FOUND)`; author check `if (authorId !== user._id)`
  → `ensure(comment.authorId).eq(user._id, errors.COMMENT_EDIT_AUTHOR_ONLY)`.
- `remove`: task guard → `.notDeleted(errors.TASK_NOT_FOUND)`. The
  `if (!comment) return null` idempotent early return is preserved (not an error).
- `deleteTaskCommentAttachment`: comment guard →
  `.notNull(errors.COMMENT_NOT_FOUND)`; uploader check →
  `ensure(attachment.uploadedBy).eq(user._id, errors.COMMENT_ATTACHMENT_DELETE_UPLOADER_ONLY)`;
  task guard → `.notDeleted(errors.TASK_NOT_FOUND)`. The `if (!attachment) return null`
  idempotent early return is preserved.

New catalog entries (lifted verbatim) in `convex/tasks/errors.ts`:
`COMMENT_NOT_FOUND`, `COMMENT_EDIT_AUTHOR_ONLY`,
`COMMENT_ATTACHMENT_DELETE_UPLOADER_ONLY`.

The empty-result early returns in `listByTask` (`return EMPTY_PAGE` for missing
auth / missing task / no access) are access semantics, not errors, and are left
as-is per the playbook.

## `join` adoption

`listByTask` previously hand-rolled author enrichment with
`Promise.all(authorIds.map(ctx.db.get))` + a null-filtered `Map`. It now uses the
fluent `join(results.page).on(c => c.authorId).with(ids => getUsersByIds(ctx, ids)).selectAll(...)`
left join (`selectAll` keeps every comment even when the author is deleted,
preserving the `authorName: "Unknown"` fallback). Attachment fetching uses the
new `listTaskCommentAttachmentsByCommentIds` batch getter.

## Scheduler / indexes

- `createCommentCore` schedules `internal.taskActivityLogs.logActivity` via
  `ctx.scheduler.runAfter(0, ...)`. This call site stays on the **legacy**
  `internal.taskActivityLogs` path because `taskActivityLogs` has not migrated
  yet; it moves to `internal.tasks.activity.logActivity` in the activity-logs
  migration. Delay-0, so a one-deploy-cycle shim covers it.
- No new indexes (`by_task_and_createdAt`, `by_comment`, `by_storageId` already
  existed); no `.filter()` in the domain. No indexes became unused.

## Outcome (implemented 2026-06-18)

- `convex/taskComments.ts` was initially retained as a re-export shim to
  `./tasks/comments`, with the legacy path exercised in
  `convex/tasks/shims.test.ts`; both were removed on 2026-07-19.
- Tests moved: `convex/taskComments.test.ts` → `convex/tasks/comments.test.ts`
  (`git mv`); imports and `api.tasks.comments.*` refs updated.
- Call sites updated to `api.tasks.comments.*`: MCP comment handler
  (`convex/mcp/handlers/tasks/comments.ts`), MCP task resources
  (`convex/mcp/lib/tasks/resources.ts`), CLI (`commands/tasks/shared.ts`), and
  the frontend (`lib/tasks/hooks/use-task-comments.ts`,
  `lib/tasks/hooks/use-comment-attachment-upload.ts`).
- Function-name string literals (mock branches keyed on `getFunctionName`)
  updated `"taskComments:..."` → `"tasks/comments:..."` in
  `convex/mcp/handler.test.ts`, `lib/tasks/hooks/use-comment-attachment-upload.test.tsx`,
  and `components/blocks/tasks/comments/comment-composer.test.tsx`. The `api.*`
  grep gate does **not** catch these — they are plain strings.
- Spec updated: `docs/specs/task-attachments.md` (comment attachment endpoints +
  transitional shim note) and `docs/specs/cli-one-shot-commands.md`
  (`tasks.comments.listByTask`).
- All Step 8 gates green: codegen, `tsc --noEmit`, CLI typecheck, `web:lint`
  (0 errors), full `web:test:once` (2500 passed), and the repo-only / `.filter()`
  greps.

## Shim removal (completed 2026-07-19)

Deleted `convex/taskComments.ts`, removed the legacy-path shim tests, and
removed the transitional note from `docs/specs/task-attachments.md`.
