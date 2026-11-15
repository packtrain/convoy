# Task Due Date Picker

## Scope

Defines shared due-date picker behavior for task metadata controls, including
task table rows, task detail metadata, create dialog metadata, kanban cards, and
bulk action metadata controls.

Related:

- `docs/specs/task-create-dialog.md`
- `docs/specs/task-bulk-actions.md`
- `docs/specs/task-kanban-status-columns.md`

## Date Selection

- Selecting a date applies that date to the task metadata control.
- Selecting the already-selected date clears the due date.
- When the due date is cleared, the visible trigger or input must immediately
  return to its empty state without requiring a page refresh.
- The calendar opens on the selected date's month. With no date selected, it
  opens on the current month.

## Visual State

- A selected calendar date must remain visually selected while hovered.
- In dark theme, hover styling must not replace the selected-date foreground or
  background with the ordinary hover treatment.
- Rendered task due dates must use archived-label-style amber styling when the
  due date's calendar day is before today.
- Calendar icons attached to an overdue selected due date must use matching
  archived-label-style amber styling.
- A due date on the current calendar day is not overdue.
- Empty due-date controls must keep their normal placeholder/icon styling.

## Closed controls

Closed controls must not parse natural-language suggestions. Generate suggestions
when the text picker opens or its input changes, and reuse them during placement
updates. Reopening recomputes relative dates against the current date.

On client-only mounts, including expanded task groups, choose the calendar
popover or mobile drawer from the current viewport on the first render. Desktop
controls must not briefly mount a drawer and read its scroll position. Keep the
server snapshot stable during hydration, and follow breakpoint changes while
mounted.
