# Task Create Dialog

## Scope

Defines the compact task-creation popup opened from the primary sidebar `Add task` action.

This spec covers:

- sidebar trigger behavior
- project preselection
- compact dialog layout
- create/cancel behavior
- post-create navigation into the existing task detail sidebar

Related:

- `docs/specs/task-deep-links.md`
- `docs/specs/task-status-selection.md`

## Trigger

- The primary sidebar `Add task` action opens a modal dialog.
- On a project task-list page, pressing `N` with no editable field focused opens
  the same modal dialog.
- The action is available from the organization workspace sidebar, not only from an individual project page.

## Project Selection

- The project selector renders as a compact dropdown button on the metadata row.
- Opening the project selector shows a searchable list so the user can type to filter/select a project.
- When the current route is inside a project (`/o/:organizationSlug/:projectAlias...`), that project is preselected when the dialog opens.
- When the current route is not inside a project, the project field starts empty.
- The selector lists only projects where the user has `TASK_CREATE`. A view-only current project is not preselected, so the field starts empty ([read-only-viewer-ux.md](read-only-viewer-ux.md#task-create-affordances-slice-3-os-1539)).
- Project selection is required before creation.
- The selected project trigger renders the project alias alongside the project name.

## Layout

The dialog uses a single compact column in this order:

1. Task type trigger + title input
2. Compact description editor
3. Footer row with status, priority, due date, assignee, and project on the left plus footer actions on the right

The dialog does not render a modal header title/description block or a top-right close button.

## Field Rules

### Type + Title Row

- The task type trigger is compact, icon-only, and defaults to `Task`.
- The row is top-aligned, and the type trigger sits in a slot whose height
  matches the title input's first line box. A single-line title renders the
  trigger vertically centered on that line; a wrapping title keeps the trigger
  on the first line instead of drifting to the middle of the wrapped block.
- The title input carries its line height inside the font-size class
  (`text-sm/6`). Split across `text-sm` + `leading-6`, `cn()` drops the
  `leading-6`, the first line box shrinks to 20px, and the slot then centers
  the trigger on a line the text never occupies (OS-1913).
- The mobile create-task drawer (`MobileCreateTaskPanel`) shares this row
  layout through `lib/tasks/create-title-row.ts`, so the two surfaces cannot
  drift apart.
- The title input is the primary field in the row and receives autofocus.
- The title input grows with its content **and with its available width**: the
  height comes from CSS (`field-sizing: content`), so a viewport or drawer width
  change re-wraps and re-sizes it in the same reflow. It never carries a
  measured height, which would freeze at the width it was measured on and crop
  the wrapped tail. Floor is one line box (40px); the ceiling is 160px in the
  dialog and 120px in the mobile drawer, and past it the field scrolls.
- The title input is visually borderless and matches the task detail title treatment more closely than a standard form field.
- The title must be non-empty to create the task.
- When the user ends the title with whitespace-separated `#tag` tokens, the create flow strips those trailing tokens from the persisted title and sends them as structured task tags.
- Only trailing `#tag` tokens are extracted. `#` text in the middle of the title remains part of the title.
- Extraction only happens when a non-empty title remains before the trailing tags. If the input is only `#tag` tokens, the full input is treated as the literal task title.
- Type directive tags are recognized from the same trailing-token region: `#bug`, `#feature`, `#feat`, `#epic`, `#chore`, `#idea`, `#investigation`, `#investigate`, and `#inv`.
- Type directive tags set the created task type and are not persisted as regular task tags.
- Type directive matching is case-insensitive.
- If multiple type directive tags are present, the rightmost directive wins.
- If the user explicitly selects a non-default type in the type trigger, that explicit selection wins over any inferred title tag.

### Metadata Row

- `Status`, `Priority`, `Due date`, `Assignee`, and `Project` render in compact control mode on the footer row when space allows.
- These controls should follow the compact task-table / compact toolbar patterns rather than full-width form-field styling.
- `Priority`, `Due date`, and `Assignee` are optional.
- `Project` is required.
- The compact due-date trigger renders as an icon when unset and switches to a short-date pill once a due date is selected.

### Description

- The description uses the same TipTap-based editor used in the task detail sidebar.
- In the create dialog it renders with a smaller initial editor height than the task detail sidebar.
- In the create dialog all description paragraphs render with the same compact text size; later paragraphs must not fall back to the larger task-detail paragraph size.
- The create dialog hides the editor toolbar.
- The create dialog removes the editor border/chrome so the description reads like an inline compose surface.
- Persisted-task-only sections are excluded from this dialog:
  - comments
  - artifacts
  - threads
  - subtasks
  - activity

## Defaults

- Type defaults to built-in `Task`, unless inferred from a trailing title type directive.
- Status defaults to `To Do` and is selectable via a compact icon-only trigger in the metadata row.
- Priority defaults to `None`.
- Assignee defaults to unassigned.
- Due date defaults to unset.
- Description defaults to empty.

## Actions

- Footer actions are `Cancel` and `Create`, aligned to the right side of the footer row.
- `Create` is the primary action.
- `Cancel` closes the dialog without creating a task and renders as a ghost action.

## Submit Behavior

- Create submits through the normal task creation flow.
- The mobile drawer submits from an icon button showing an up arrow, which the
  busy spinner replaces while the create is in flight — never both at once. Its
  accessible name is `Create`.
- The task is created in the selected project.
- The create mutation returns the created task reference metadata (`refId`) directly; the dialog must use that result for post-create navigation instead of issuing a separate task reload just to recover the ref.
- Trailing title tags are extracted on the UI side before the backend request is sent.
- Trailing title type directives are inferred on the UI side before the backend request is sent.
- After successful creation, the dialog closes and navigation goes to the selected project's canonical list route with `?task=<REF>`.
- The post-create route relies on the existing deep-link behavior to open the persisted task in the task detail sidebar.

## Acceptance Checklist

- Clicking sidebar `Add task` opens the dialog.
- Opening from a project route preselects that project.
- Opening outside a project route requires the user to select a project manually.
- The compact layout renders in the agreed order.
- Creating a task navigates to the selected project's list route with the new `task` query param.
- Status selector shows as an icon-only trigger in the footer row, defaulting to `To Do`.
- Clicking the status icon opens the standard searchable status dropdown.
- Changing status before creation submits the chosen status.
