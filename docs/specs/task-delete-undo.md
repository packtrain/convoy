# Task Delete Undo

Defines undo behavior for task deletion across main table, sidebar, keyboard shortcuts, and bulk delete flows.

## Scope

- Single task delete
- Bulk task delete
- Active and archived task views

## Confirmation UX

- Single task delete does not show confirmation. This includes keyboard delete
  flows such as Backspace on an empty task title.
- Single task delete uses `delete_all` cascade semantics: deleting a parent task
  also soft-deletes its subtasks. The undo toast restores the tasks soft-deleted
  by that operation.
- Multi-delete operations must show a confirmation dialog before calling the
  bulk delete mutation. This applies to the multi-select toolbar and the
  selection-scoped right-click menu.
- If selected tasks include unselected descendants, the dialog offers:
  - `Delete all`
  - `Keep all subtasks`
- If selected tasks do not include unselected descendants, the dialog offers:
  - `Delete`
- Canceling the dialog must not call the delete mutation.

## Undo UX

- After a delete operation, show a toast with:
  - action label `Undo`
  - duration `5000ms`
- Show exactly one toast per delete operation.
  - Single delete -> one toast
  - Batch delete -> one toast for the batch

## Undo Semantics

- Undo is **undelete only**:
  - Restore tasks soft-deleted by the operation.
  - Use `tasks.restore` per deleted task ID.
- Undo does **not** rollback hierarchy changes made during delete.
  - For `keep_children`, promoted child parent links remain as changed.

## Backend Contract

- `tasks.remove` returns `{ deletedIds: Id<"tasks">[] }`
- `tasks.bulkRemove` returns `{ deletedIds: Id<"tasks">[] }`
- For no-op/idempotent paths, return `deletedIds: []`.

## Frontend Flow

1. Trigger delete operation.
2. Read returned `deletedIds`.
3. If not empty, show undo toast.
4. On `Undo`, call restore for each ID.
5. If any restore fails, show an error toast.

## Notes

- Undo availability is ephemeral (toast lifetime only).
- This behavior applies consistently across keyboard, dialogs, and context menu delete paths.
