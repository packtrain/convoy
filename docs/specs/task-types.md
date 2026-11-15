# Task Types Specification

Task types are a static catalog of built-in types resolved from a shared constant. Custom task types are planned for the future.

## Scope

- Task data model and Convex task APIs
- Task table, task detail sidebar, and task search rendering
- Organization Settings task-type list
- MCP task payloads and task-type discovery

## Canonical Model

Task types are defined as a static constant catalog in `apps/web/lib/tasks/task-types.ts` (`BUILT_IN_TASK_TYPES`). There is no database table for task types.

Tasks store an optional `taskTypeKey: string` field. All task reads resolve the key to a `TaskTypeSummary` via pure function lookup. Tasks without a `taskTypeKey` default to the built-in `task` type.

`TaskTypeSummary` fields: `key`, `name`, `icon`, `color`, `isSystem`.

## Built-In Types

The built-in catalog is fixed:

- `task` (default)
- `bug`
- `feature`
- `epic`
- `investigation`
- `chore`
- `idea`

Built-in types are:

- defined as constants (no DB storage)
- returned in selectors
- read-only in organization settings
- rendered with Lucide icons
- never removable or archivable

## Custom Types (Coming Soon)

Custom task types are not yet supported. The organization settings UI shows a disabled create form with a "Soon" badge.

## Assignment Rules

- New tasks default to the built-in `task` type.
- Task create/update APIs accept a stable `taskTypeKey` input.
- The bulk task update API accepts `taskTypeKey` alongside other metadata
  update fields.
- Only built-in keys are valid.
- Changing a task's type logs one `type_changed` activity row (single and bulk
  updates alike); re-sending the same resolved key logs nothing. See
  `docs/specs/task-activity-log.md`.
- Passing `null` for task-type updates resets to the default `task` type.
- Passing `null` for bulk task-type updates resets every changed task to the
  default `task` type.
- Create-title UI flows infer task type from trailing type directive tags:
  `#bug`, `#feature`, `#feat`, `#epic`, `#chore`, `#idea`, `#investigation`, `#investigate`, and `#inv`.
- Inferred type directive tags are consumed and are not persisted as regular task tags.
- Type tag inference is limited to create-title parsing; tag edits and backend/API tag updates do not infer task type.
- Explicit non-default type selection in the create dialog takes precedence over inferred title type tags.

## UI Rules

### Task Table

- The list view shows a bare clickable task-type icon immediately to the left of the task ref.
- The inline icon has no badge chrome or border.
- The task-table selector uses a simple dropdown list with no search input.

### Task Detail Sidebar

- The metadata stack includes a `Type` row before `Status`.
- The row uses the same task-type selector and presentation as the task table.

### Task Search

- Search results replace the ref/title middle dot separator with the task-type glyph.

### Organization Settings

- Organization Settings includes a `Customization` section.
- Built-in types are shown as read-only rows with `icon + title`.
- A disabled create form with "Soon" badge is shown below the list.

## Shared Sources Of Truth

- Task-type catalog and helpers live in `apps/web/lib/tasks/task-types.ts`.
- Backend validation and validators live in `apps/web/convex/lib/taskTypes.ts`.

## MCP Rules

- MCP exposes `list_task_types` returning built-in types (no DB query).
- MCP task payloads include `taskType` summary.
- MCP `create_task` and `update_task` accept `taskTypeKey`.
- `taskTypeKey` enums are narrowed to the built-in keys.
- Invalid `taskTypeKey` errors list the allowed keys.

## CLI Rules

- `convoy task-types list` resolves the active project through the standard
  one-shot profile/project rules and calls `api.tasks.core.listTypes` directly.
- The command does not use MCP JSON-RPC.
- Text output exposes stable keys and display metadata; JSON output returns the
  canonical task-type summaries.
- The public query requires project view access and returns an empty catalog
  for unauthenticated or inaccessible callers.
