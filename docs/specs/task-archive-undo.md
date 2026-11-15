# Task Archive Undo

Defines undo behavior for task archiving across the main table, context menu, task detail sidebar, and bulk archive flows.

## Scope

- Single task archive
- Bulk selected task archive
- Archive completed tasks header action
- Active task view only

## Undo UX

- After an archive operation reports at least one undo root task, show a toast with:
  - action label `Undo`
  - duration `5000ms`
- Show exactly one toast per archive operation.
  - Single archive -> one toast
  - Batch archive -> one toast for the batch
  - Archive completed -> one toast for the batch
- Do not show an undo toast when the archive mutation reports no archived root tasks.

## Undo Semantics

- Undo is **unarchive only**:
  - Unarchive the root task IDs returned by the archive operation.
  - Existing backend unarchive cascade behavior restores descendants.
- Undo should optimistically restore the just-archived task tree in the active task view while the backend unarchive mutation is pending.
- Optimistic restore order should match the backend: restored root tasks appear at the top of active root tasks, with descendants preserved under their restored root.
- Every ID in `archivedRootIds` restores as a root task, including subtasks that were detached from their parent on archive — the optimistic restore must not re-nest them under their former parent.
- The active task view must keep restored rows visible until the Convex subscription contains them, without also writing those same restored rows into the active list query cache.
- Undo does not attempt to restore any other task state changed after the archive operation.

## Backend Contract

- `tasks.archive` returns `{ archivedRootIds: Id<"tasks">[] }`.
- `tasks.bulkArchive` returns `{ archivedRootIds: Id<"tasks">[] }`.
- For no-op/idempotent paths, return `archivedRootIds: []`.
- `archivedRootIds` includes root tasks that changed from active to archived, plus subtasks archived directly.
- When a subtask is archived directly, the backend clears its `parentId`, archives it, cascades archive to its descendants, and returns the subtask ID in `archivedRootIds`. Its descendants keep their existing `parentId` values.
- If a selected subtask has any ancestor (root or subtask) that is also archived in the same operation, the subtask is archived through that ancestor's cascade: it keeps its `parentId` and is not added separately to `archivedRootIds`. This holds regardless of the order of IDs in the selection.

## Frontend Flow

1. Trigger archive operation.
2. Read returned `archivedRootIds`.
3. If not empty, show undo toast.
4. On `Undo`, call bulk unarchive for the returned root IDs.
5. If bulk unarchive fails, show an error toast.

## Notes

- Undo availability is ephemeral (toast lifetime only).
- This behavior does not add reciprocal undo for unarchive actions.
