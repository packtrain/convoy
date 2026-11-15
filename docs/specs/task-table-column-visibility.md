# Task Table Column Visibility

## Scope

Defines project-wide visibility settings for optional task metadata columns.

Related:

- `docs/specs/project-settings-dev-mode.md`
- `docs/specs/task-table-compact-headers.md`
- `docs/specs/task-table-name-column-resize.md`

## Behavior

- Column visibility is a project setting, not a user preference.
- The configurable columns are `Priority`, `Assignee`, `Label`, `Due date`, and `Tags`.
- `Task`, row drag handle, and `Status` are required and are not shown as visibility options.
- A project without a saved visibility setting hides `Tags` and shows every other configurable column (`DEFAULT_HIDDEN_TASK_TABLE_COLUMNS` in `lib/tasks/task-table-columns.ts`). The default applies when the project's `hiddenTaskTableColumns` is unset; it is never written to the project.
- A saved setting always wins, including an empty list that shows every column. The first toggle on a project with no saved setting saves the default plus that change, so turning on `Tags` saves `[]`.
- Hidden columns are omitted from task table column definitions, not only visually hidden, so headers, rows, virtualization, and horizontal scroll stay aligned.
- The setting applies to every project-owned task table, including active List views, Backlog, Archived, and sidebar subtask tables.
- Kanban cards follow the same visibility setting for metadata they render: hidden `Priority`, `Due date`, and `Assignee` columns are omitted from card footers.
- `Tags` remains configurable for tables and has no kanban card effect until cards render tags.
- Project settings and the page-header settings dropdown use the same persisted setting.
- Visibility toggles update optimistically: the clicked control reflects the new state immediately, and reverts if the save fails.
- Project-route surfaces share the current organization/project route context so optimistic writes patch both `projects.getById` and `projects.getByAlias` query subscriptions for the current project.
- Column visibility controls do not expose ordering or drag-and-drop handles.
- Only users with project update permission can change visibility.

## Acceptance Checks

- A project admin can hide and show `Priority`, `Assignee`, `Label`, `Due date`, and `Tags` from project settings.
- A project with no saved setting shows the `Tags` toggle off and has no Tags column. Turning it on shows the column and keeps it after reload.
- The page-header settings dropdown label is `Column visibility`.
- The dropdown and settings tab do not show `Task` or `Status` as configurable options.
- Hiding a column removes it from main task tables, sidebar subtask tables, and matching kanban card metadata.
- Failed saves restore the previous visible/hidden state and show an error.
