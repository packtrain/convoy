# Task Labels

Project-scoped labels for single-valued task classification, primarily to
drive the Board's "group by Label" view (OS-1004). Related specs:
[task-kanban-status-columns.md](task-kanban-status-columns.md) (Label board
grouping rules).

## Entity rules

- Labels live in the `projectLabels` table, scoped to one project.
- Max **20 labels per project** (`MAX_LABELS_PER_PROJECT`); creating beyond
  the cap fails with a user-facing error and the settings UI disables create.
- A task references **at most one label** via `tasks.labelId`.
- Name: 1–50 chars after trimming/whitespace-collapsing; unique per project,
  case- and whitespace-insensitively (via `normalizedName`).
- Color: required, from `EXTENDED_COLOR_PALETTE` (labels use the extended
  palette; task Lists keep the default one); defaults to blue (`#3b82f6`)
  when omitted at create. Extended-palette pickers render as the standard
  8-column grid (the agent-editor layout — `ColorPicker` defaults to it).
- Order: LexoRank `rank` field; label order = board column order. Reorder is
  a client-computed rank patch (`api.tasks.labels.reorder`).
- Renaming/recoloring never rewrites tasks — they reference the label by id.
- Duplicating a task carries its label over.

## API

Module `convex/tasks/labels.ts` → `api.tasks.labels.*`:

- `list({ projectId })` — rank-ordered labels; requires `task:view`.
  No per-label task usage counts in v1.
- `create({ projectId, name, color? })` — requires `project:update`.
- `update({ labelId, name?, color? })` — requires `project:update`.
- `reorder({ labelId, rank })` — requires `project:update`.
- `remove({ labelId, resolution, reassignToLabelId? })` — requires
  `project:update`; see below.
- `tasks.core.create` accepts `labelId`; `tasks.core.update` accepts
  `labelId` (null clears). Both validate the label belongs to the task's
  project. Requires `task:create`/`task:update` as usual.

## Deletion (hard delete with mandatory resolution)

Labels have no soft-delete/"deprecated" state. `remove` deletes the label row
and, in the same transactional mutation, resolves **every** referencing task —
including soft-deleted and archived ones (index `by_project_and_labelId` has
no `isDeleted`/`isArchived` component for this reason), so no dangling
`labelId` survives.

Resolutions:

- `clear` — remove the label from all referencing tasks.
- `reassign` — set all referencing tasks to `reassignToLabelId` (required,
  must be a different label of the same project).
- `archiveTasks` — clear the label AND archive the referencing tasks that are
  active (reuses the canonical archive path incl. subtree cascade);
  already-archived and deleted tasks are only cleared.

## Activity log

- Event `label_changed` with `changeDetails.type === "label"`; old/new label
  **name and color are denormalized** into the log entry so history renders
  after the label is hard-deleted.
- Logged on task create/update label transitions (set / change / clear, only
  on real change) and for each non-deleted task affected by `remove`.

## UI

- **Project settings → Labels** (`labels-section.tsx`): rank-ordered list with
  color swatch + name per row; create opens the shared label dialog with name
  input + extended color picker (create is disabled with a "20 of 20 labels
  used" hint at the cap); edit opens the same dialog for rename + recolor;
  reorder via drag-and-drop — each row has a grip handle on the left and drops
  compute the LexoRank client-side (label order = board column order); delete
  opens a resolution dialog with a radio group (default
  "Remove label from tasks"; "Reassign to…" is hidden when no other label
  exists; "Archive these tasks"). No per-label usage counts in v1. Non-admins
  see the list read-only with a lock hint. With no labels the section is the
  shared empty state ("No labels yet") with **Create label** inside it, in
  place of the button above the list.
- **Board**: label columns can also be reordered by dragging their headers,
  new labels can be created from the trailing "+", and hovering a label column
  header swaps its task count for a pencil that opens the shared label dialog
  in edit mode (rename + recolor; project editors only) — see
  [task-kanban-status-columns.md](task-kanban-status-columns.md).
- **Task detail sidebar**: a "Label" row with a single-select picker
  (`task-label-picker.tsx`) listing project labels as colored dot + name,
  plus "No label" to clear. The picker has a fixed footer action, "Create
  new", that opens the shared label dialog. Its search and keyboard behavior
  use the shared searchable picker and it opens in the same dropdown
  container as the status, priority and assignee pickers — see
  [searchable-picker.md](searchable-picker.md). Current value
  renders as a colored chip; empty state reads "Add label".
- **Create task** (desktop dialog and mobile panel): a label picker next to
  the assignee picker. The chosen label is sent as `labelId` to
  `tasks.core.create`; changing the project clears it.
- **Bulk toolbar and row context menu**: "Set label" applies one label (or
  "No label") to every selected task. There is no bulk label mutation: the
  client calls `tasks.core.update` once per selected task, each with its own
  optimistic update and activity log entry.
- **Task table**: a "Label" column (placed right after Assignee) rendering the
  label chip (an em dash when unlabeled); the cell is interactive and does not
  open the sidebar; the same picker component is reused. Its dropdown keeps
  the "Create new" footer visible while the label list scrolls, and "No labels
  found" uses the same compact height as a normal menu row. Label data resolves
  from one shared labels subscription per table (map by id), never per-cell
  queries. The column is toggleable via the project's column visibility
  settings.
- **No filter UI** for labels anywhere in v1.

## MCP

Labels are fully manageable over MCP (see `docs/specs/mcp-server.md`):

- `list_task_labels` — labels in board order (`task:view`).
- `create_task_label` / `update_task_label` / `delete_task_label` — label
  management (`project:update`); delete takes the same `resolution` contract
  as `api.tasks.labels.remove`.
- `create_task`/`update_task` accept a `label` argument (label ID or exact
  case-insensitive name; `null` clears on update).
- Task summaries and details expose `labelId`; names/colors resolve via
  `list_task_labels`. Label reordering is not exposed over MCP.

The label mutations accept `apiKey` auth (`getAuthenticatedAccess`), so
API-key principals are permission-checked the same as sessions.

## CLI

The `convoy` CLI mirrors the MCP surface against the same
`api.tasks.labels.*` functions (see `docs/reference/cli-commands.mdx`):

- `convoy labels list` — labels in board order.
- `convoy labels create --name [--color]`.
- `convoy labels update <label> [--name] [--color]`.
- `convoy labels delete <label> [--resolution clear|reassign|archive]
  [--reassign-to <label>]` (the CLI `archive` token maps to the backend
  `archiveTasks` resolution).
- `convoy tasks create --label <label>` and
  `convoy tasks update <taskId> --label <label> | --clear-label`.

A `<label>` is a raw label ID or exact case-insensitive name (resolved client
-side via `labels.list`). Reordering is not exposed on the CLI (board-column
order is a UI concern), matching the MCP decision.

## Permissions

| Action | Permission |
| --- | --- |
| List labels | `task:view` |
| Create / rename / recolor / reorder / delete labels | `project:update` (project admins; an org owner/admin needs that project role) |
| Set/clear a task's label | `task:update` |

## Non-goals (v1)

- Per-list label sets — follow-up OS-1097.
- Filtering tasks by label (table or board).
- Label chips on kanban cards (deliberate: cards stay uncluttered; the label
  is visible via column, table column, and sidebar).
- Migration/interplay with free-form `tags` — labels and tags coexist as
  separate concepts.
