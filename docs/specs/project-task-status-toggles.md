# Project Task Status Toggles

## Summary

Projects can disable optional built-in task statuses while keeping `To Do` and `Done` always enabled.

## Data Model

- Project documents store task status configuration in `disabledStatuses?: Status[]`.
- Missing `disabledStatuses` means all optional statuses are enabled.
- `disabledStatuses` must not include `To Do` or `Done`.
- `Backlog` is not stored in project status configuration because it is a system List.

## Allowed Statuses

- The canonical status catalog still comes from the shared task status model.
- Project-specific selector choices come from `getAllowedTaskStatuses(project)`.
- `getDisabledTaskStatuses(project)` returns the canonicalized list of disabled optional statuses.

## UI Behavior

- Project Settings exposes immediate-save toggles for optional statuses.
- Required statuses render as locked and always enabled.
- Disabled statuses are removed from new status selections in:
  - task table status pickers
  - task detail sidebar status pickers
  - bulk status pickers
- Existing tasks that already use a disabled status remain visible with their current status badge.
- If a picker is opened on a task whose current status is disabled for the project, that current status must still be shown as the selected value even though it is not offered as a normal new choice elsewhere.

## Board Behavior

- Status Board groups should normally follow the project's allowed statuses.
- A disabled status must keep its containing Board group visible as a legacy
  group while tasks still exist in that status.
- Once no tasks remain in a disabled status, its legacy Board group should
  disappear if no other grouped status keeps it visible.

## Backend Rules

- Creating a task with a disabled status must fail.
- Updating a task to a disabled status must fail.
- Bulk status updates must reject the operation for any affected project where the target status is disabled.
- Disabling a status must not migrate existing tasks.

## MCP Rules

- Scoped MCP `initialize` responses should expose project-specific allowed and disabled task statuses.
- Scoped `tools/list` should narrow `create_task.status` and `update_task.status` enums to the project's allowed statuses.
- `list_tasks.status` and `search_tasks.filters.status` continue to accept the full real status catalog so disabled-status tasks remain discoverable.
