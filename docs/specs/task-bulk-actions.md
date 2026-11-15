# Task Bulk Actions Specification

This document defines behavior for task batch actions from multi-selection UI.

## Scope

- Main project task table multi-select toolbar
- Batch actions applied to currently selected rows

## Selection Visibility Contract

- Multi-selection is scoped to the rows currently visible in the active task table.
- If a selected row leaves the current table because of a status change, archive change, filter change, hierarchy change, or data refresh, it is removed from selection immediately.
- If some selected rows remain visible, they stay selected.
- If no selected rows remain visible, selection clears and the multi-select toolbar disappears.

## Multi-Select Toolbar Actions

The toolbar shows when 2 or more tasks are selected, or when one task was
selected with a modifier click (Cmd/Ctrl or Shift). A plain row click selects
the row and opens its details without showing the toolbar. Arrow-key moves
and a right-click on an unselected row also select without it. The count
reads "1 task selected" or "N tasks selected". The subtask table in the task
sidebar follows the same rule.

The toolbar exposes:

- Mark complete
- Change status
- Move to List (active non-archived views only)
- Change priority
- Change assignee
- Change due date
- Set label (applies one label, or none, to every selected task; see `task-labels.md`)
- Archive selected
- Unarchive selected (archived view only)
- Delete selected
- Clear selection

Due date trigger:
- The picker uses the shared due date format (`DATE_FORMAT`), the same as the table and sidebar.
- When no due date is set, the toolbar shows the compact icon-only trigger.
- Once a due date is selected, the trigger switches to a compact short-date pill so the applied value is visible without opening the picker.

Move to List trigger:
- In active, non-archived views, the toolbar shows an icon-only `Move to List`
  button.
- The picker shows active persisted Lists plus the Backlog system List.
- Archived and List creation remain hidden or disabled in this picker.
- Selecting a List calls the project-scoped task move mutation once with the
  selected subtree roots.
- The UI updates optimistically: moved subtrees leave the current visible table
  immediately unless the current view is the target List.

Layout:
- Keep regular actions first
- Keep destructive actions grouped near the end as adjacent buttons:
  - `Archive` + `Delete` in active view
  - `Unarchive` + `Delete` in archived view
- Keep clear selection (`X`) as the far-right button

## Backend Bulk Metadata Mutation

- Bulk metadata edits use one backend mutation:
  `tasks.bulkUpdate({ ids, status?, taskTypeKey?, assignee?, dueDate?, priority? })`.
- `assignee` is the typed assignee value for users, Project agents, and
  unassigned tasks.
- At least one update field must be provided.
- Status, priority, assignee, due date, and task type may be updated together in
  one call.
- Deleted or missing task IDs are ignored as no-op selections.
- All valid task IDs in a bulk action must belong to one project. Mixed-project
  selections fail before any task is written.
- If any valid selected task is unauthorized, the mutation fails before writing
  any task.
- Unchanged fields do not write the task or create activity logs.
- Status changes must still honor project-specific disabled-status validation
  for the selected tasks' project.
- Activity logs are preserved for status, priority, assignee, and due date
  changes. Task type changes do not create activity logs until the activity
  schema defines a task-type event.

## Archive Selected Behavior

- Archive action appears only in active task view (`archiveFilter = "active"`).
- Action calls bulk archive using currently selected IDs.
- Backend remains source of truth for archive eligibility.
  - Only top-level tasks are archived directly.
  - Descendants are archived via cascade from archived parents.
  - Selected subtasks are ignored by archive mutations.
- After triggering archive, current selection is cleared.
- Exactly one undo toast is shown per archive operation that archives at least
  one root task.
  - Toast duration: 5 seconds.
  - Toast action: `Undo`.
  - Undo unarchives only root tasks returned by the archive operation.
  - Undo relies on existing backend unarchive cascade behavior to restore
    descendants.
- See `task-archive-undo.md` for the shared archive undo contract.

## Unarchive Selected Behavior

- Unarchive action appears only in archived task view (`archiveFilter = "archived"`).
- Action calls bulk unarchive using currently selected IDs.
- Backend remains source of truth for unarchive eligibility.
  - Only top-level tasks are unarchived directly.
  - Descendants are unarchived via cascade from restored parents.
  - Selected subtasks are ignored by unarchive mutations.
- Restored top-level tasks are inserted at the top of active tasks.
- Restored order at top follows archived order (most recently archived first).
- After triggering unarchive, current selection is cleared.

## Delete Selected Behavior

- Delete action is available in both active and archived views.
- Action calls bulk delete using currently selected IDs.
- Delete selected always shows a confirmation dialog before calling the bulk
  delete mutation.
- If selected tasks include unselected descendants, the confirmation dialog appears with:
  - `Delete all`
  - `Keep all subtasks`
- If selected tasks do not include unselected descendants, the confirmation
  dialog appears with:
  - `Delete`
- Without subtasks the dialog reads "This action cannot be undone." The
  Undo toast that follows lasts only a few seconds, so the dialog still
  warns that the delete is permanent.
- After delete is triggered, current selection is cleared.
- Exactly one undo toast is shown per delete operation (including batch deletes).
  - Toast duration: 5 seconds.
  - Toast action: `Undo`.
  - Undo restores only tasks that were soft-deleted in that operation.
  - Undo does not revert hierarchy changes made by `keep_children`.

## Header Archive Button

- Table header "archive completed tasks" control remains separate from multi-select archive.
- Header action archives top-level completed tasks based on current filtered task list.
- Header archive follows the same archive undo contract as selected archive:
  one undo toast for a successful batch, no toast for no-op archive results.

## Right-Click Menu Behavior

When 2 or more tasks are selected and the user right-clicks a selected row, selection-scoped context menu actions apply to the current selected rows:

- Mark selected complete / incomplete
- Move selected to
- Archive selected / Unarchive selected
- Delete selected tasks

When the user right-clicks an unselected row, the table clears the previous
selection, selects the clicked row, and the context menu applies to that clicked
row only.

Menu grouping:

- The first group holds the property submenus: `Status`, `Priority`,
  `Assignee` and `Label`. Each renders the matching shared picker body (see
  `searchable-picker.md`). On a selected row they apply to every selected
  task through the bulk handlers; on an unselected row they apply to that
  row. A single task shows its current value as checked. Read-only viewers
  see the submenu triggers disabled with the view-only reason.
- The next group contains only selection-scoped status actions.
- The middle group contains clicked-task-only actions: duplicate, follow-up/subtask placeholders, details, new tab, and copy link.
- The bottom group contains only selection-scoped archive/unarchive and delete actions.

Selection-scoped labels must include `selected` so the action target is explicit. Clicked-task-only actions keep singular labels and operate on the clicked row even when opened from a selected row.
