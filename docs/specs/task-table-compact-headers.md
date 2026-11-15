# Task Table Compact Headers

## Scope

Defines task-table header behavior when metadata columns collapse to compact icon-width columns on narrow containers.

Related:

- `docs/specs/task-table-inline-create.md`
- `docs/specs/task-table-column-visibility.md`
- `docs/specs/task-types.md`

## Behavior

- The `Task` header remains visibly labeled in compact and wide task-table layouts.
- The `Task` header owns a trailing column-actions chevron button that becomes visible on task-name header hover or while its menu is open.
- The task-name header action menu includes `Archive done` with the shared archive-completed shortcut keycaps, and it opens the same archive-completed confirmation flow used by the shortcut.
- The task-name header action menu includes `Closed to bottom` with the shared move-closed shortcut keycaps, and it reorders visible active top-level rows so `Done` and `Canceled` tasks are below non-closed tasks.
- `Closed to bottom` remains visible in the active unfiltered view and no-ops when the active visible root order is already normalized or no eligible mixed ordering exists.
- `Closed to bottom` is disabled when archived rows are shown or when status/assignee filters are active.
- The task-name header action menu includes an `Auto width` item that switches the name column to auto/responsive width; see `docs/specs/task-table-name-column-resize.md` for its behavior.
- Compact metadata columns such as status, priority, assignee, and due date do not show visible header labels while the columns are icon-width.
- `Priority` is icon-only and `Assignee` is avatar-only at every width (40px and 48px at the wide breakpoint), so their header labels stay visually hidden at every width. Their headers show an icon instead, matching the task context menu: `Signal` for `Priority` and `UserRound` for `Assignee`, with the label as a hover title. The assignee name shows in the avatar's hover card and accessible label.
- `Status` shows its icon plus the status name as plain text at the wide breakpoint (112px column, no bordered chip), and the icon alone in compact layouts.
- Every empty cell shows the same mark, an em dash (`—`): no assignee, no priority (`None`), no label, no tags, no agent runs, and no due date. Kanban cards keep their own compact placeholders.
- If a configurable metadata column is hidden for the project, it is omitted entirely and has no compact header.
- Compact metadata headers preserve accessible names even when their labels are visually hidden.
- At the wide table breakpoint, metadata header labels are visible.
- The behavior must not change row alignment, metadata dropdown interactions, inline task editing, or task selection.

## Acceptance Checks

- On mobile/narrow containers, `Status`, `Priority`, `Assignee`, and `Due date` do not visually overlap.
- On mobile/narrow containers, assistive technology still has column names for compact metadata headers.
- On wide containers, metadata header labels render as normal table headers.
