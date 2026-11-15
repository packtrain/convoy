# Task Status Selection Specification

This document defines the canonical task status catalog and how frontend task status pickers derive project-specific selectable statuses.

## Scope

- Task table status cell dropdown
- Task detail sidebar metadata status dropdown
- Multi-select toolbar status dropdown
- Task create dialog compact status selector
- Task table row context menu `Status` submenu (see `task-bulk-actions.md`)

## Canonical Status Catalog

The shared task status catalog is:

- `To Do`
- `Triage`
- `Planning`
- `Plan Review`
- `In Progress`
- `In Review`
- `Blocked`
- `Done`
- `Canceled`

Canonical workflow order is:

`To Do -> Triage -> Planning -> Plan Review -> In Progress -> In Review -> Blocked -> Done -> Canceled`

`Backlog` is not a workflow status. It is the system List `BACKLOG`.

## Project-Scoped Selectable Statuses

- Frontend status selectors should derive project-specific allowed statuses from `getAllowedTaskStatuses(project)`.
- If a project has no stored status configuration, all canonical statuses are selectable.
- `To Do` and `Done` are always selectable.
- Other statuses become non-selectable when the project disables them.

## Legacy Disabled Status Rendering

- Existing tasks keep their stored status even if that status later becomes disabled for the project.
- Status pickers must still render the current task status when it is disabled, so the user can see the current state.
- Disabled statuses should not be offered as new target choices except for that legacy current-value rendering.

## Shared Picker Presentation

- Search uses the shared transparent, borderless dropdown search row rather
  than rendering a framed input inside the menu.
- Search and arrow-key behavior follow the shared searchable picker —
  see [searchable-picker.md](searchable-picker.md).
- Shared status pickers should use a visibly scrollable menu height rather than expanding tall enough to stop cleanly at `In Review`.
- The shared `StatusDropdownMenu` should group `In Progress` and `Done` above the separator when those statuses are available in the filtered selector results.
- The shared `StatusDropdownMenu` should cap the visible list height so lower statuses such as `Blocked`, `Done`, and `Canceled` are discoverable via scrolling across all task status entry points.

## Closed Task Title Presentation

- In primary editable task views, task titles with status `Done` or `Canceled` should use the same muted + line-through styling.
- This title styling is presentation-only and does not change completion-specific interaction semantics that remain `Done`-only.

## Closed Task Checkbox Presentation

- In the task table, row checkboxes should render as checked for both `Done` and `Canceled`.
- Unchecking either state should still move the task back to `To Do`.
- This checked presentation does not change action labels or other completion-specific flows that continue to distinguish `Done` from `Canceled`.

## Subtask Progress Presentation

- Parent task progress indicators should count direct subtasks with status `Done` or `Canceled` as completed.
- This progress presentation does not change completion-specific interaction semantics that remain `Done`-only.

## Shared Sources Of Truth

- Canonical status order comes from the shared task status model.
- Project-specific allowed statuses come from `apps/web/lib/tasks/project-statuses.ts`.
- Shared UI components should consume these sources and must not define independent hardcoded status lists.
