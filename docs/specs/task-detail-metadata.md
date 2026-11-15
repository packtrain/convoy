# Task Detail Metadata

## Scope

Defines the metadata row behavior in the task detail sidebar.
For title-editing behavior, see `docs/specs/task-detail-title-input.md`.

## Row Order

When present, metadata rows render in this order:

1. `Parent`
2. `List`
3. `Type`
4. `Status`
5. `Priority`
6. `Assignee`
7. `Threads`
8. `Due date`
9. `Tags`
10. `Links` (only when the task has external links)
11. `Created`

## Parent Row

- The metadata label is `Parent`.
- The value renders as `task type glyph + ref + title`.
- The task type glyph follows the shared rendering rules from `docs/specs/task-types.md`.
- The full row remains a single navigation target that opens the parent task in the sidebar.
- When a task has no parent, or parent navigation is unavailable, the row is omitted.

## List Row

- The metadata label is `List`.
- It renders after `Parent` and before `Type`.
- Persisted List tasks render the List identity using the shared List circle, name, and color.
- If the persisted List is archived, the row renders the List identity with an
  `Archived` label.
- Active tasks without persisted List membership render the compatibility `Inbox` identity only for legacy data.
- Tasks whose structured List payload is `{ type: "system", key: "backlog" }`
  render `Backlog` with the shared dashed-circle visual.
- Archived tasks do not expose a move control. If they still have persisted
  List membership, the row renders that List identity; otherwise it renders the
  task archive state as `Archived`.
- For non-archived tasks, the row value opens a searchable active List dropdown,
  even when the current task belongs to an archived List.
- Selecting a List immediately moves the task to that List using the shared task move-to-List operation.
- Moving a task from the sidebar must not require a page reload.
- The sidebar remains open for the selected task when it leaves the current table result, including after moving to a different List.

## Type Row

- The metadata label is `Type`.
- It renders before `Status`.
- The value uses the shared task-type presentation rules from `docs/specs/task-types.md`.
- The selector offers active task types for the current project/org and supports immediate updates.
- Built-in types render with their shared icon; custom types render with a colored dot.

## Threads Row

- The metadata label is `Threads`.
- The row renders only when task detail is shown in a project route with `projectId`, `organizationSlug`, and `projectAlias`.
- Every associated thread is a compact row, stacked vertically, newest first; `0` threads renders plain `No threads` text (OS-1803).
- More than 5 threads collapse to 4 rows plus a `Show {n} more threads` row.
- The icon-only `+` action sits on the right of the first row (or beside `No threads`).
- The `+` action is always visible and focuses the timeline's in-stream thread composer without clearing the existing draft (`docs/specs/task-timeline.md`).
- The row includes a separate icon-only `Open threads page` action using an external-link glyph.
- That action opens the project `/threads` page with the current task ref in the `attachedTask` query param in a new tab.
- The row's thread rows and association source are defined in `docs/specs/task-associated-threads.md`.

## Assignee Row

- The metadata label is `Assignee`.
- Selecting a new assignee or clearing the assignee updates the visible value immediately through the shared optimistic task update flow.
- The optimistic display includes the selected user's name and avatar when the selector has already loaded assignable project members.

## Tags Row

- The metadata label is `Tags`.
- The row renders in all task detail sidebars, including when the current task has no tags yet.
- The row renders below `Due date` and above `Created`.
- The value is a dedicated tag editor component owned by the task detail sidebar implementation.
- When tags wrap to multiple lines, the `Tags` label stays top-aligned with the editor content instead of vertically centering.
- Existing tags render as removable chips.
- Typing a tag and pressing `Enter` adds it immediately.
- Typing a tag and pressing `,` adds it immediately without inserting the comma.
- Empty or whitespace-only input is ignored.
- Duplicate tags are ignored using case-insensitive comparison.
- Display preserves the originally entered casing of the stored tag value.
- When the input is empty, pressing `Backspace` removes the last chip.
- Tag edits update the task immediately through the shared task update flow.
- Each tag edit logs one `tags_changed` activity row carrying the added and
  removed tags; a pure reorder logs nothing (`docs/specs/task-activity-log.md`).
- The editor shell is visually inline: no bordered input field, no filled background, and no default text-input treatment.
- Future project-level tag suggestions should reuse the same row and editor surface rather than replacing it with a different control.

## Links Row

- The metadata label is `Links`.
- The row renders only when the task has at least one external link (`externalLinks` non-empty); there is no empty state.
- The row renders below `Tags` and above `Created`.
- The value is a read-only list of the task's external links; creation and editing happen through MCP/CLI (see `docs/specs/task-external-links.md`).
- Each link renders an icon by kind (commit, branch, pull request, generic URL) and a compact label:
  - commit → short SHA (7 chars) plus title when present
  - branch → branch name
  - pull request → title, else identifier, else URL; displayed with a leading `PR:` unless the label already starts with `PR:`
  - url → title, else URL
- Links with a URL open in a new tab (`target="_blank"` with `rel="noopener noreferrer"`).
- Each rendered link item uses a native `title` attribute for date information:
  `Updated {date}` when `updatedAt` is available, otherwise `Created {date}`.
- Archived tasks render the same read-only list.
- Link additions, updates, and removals log one `external_link_changed`
  activity row each (`docs/specs/task-activity-log.md`).

## Created Row

- The metadata label remains `Created`.
- The value is rendered as: `by {creatorName} {relativeTime}`.
- `relativeTime` uses `formatDistanceToNow(createdAt, { addSuffix: true })` (for example, `3 days ago`).

## Hover Behavior

- The created metadata value exposes the full local timestamp on hover via the element `title` attribute.
- Full timestamp format is `PPpp` (date-fns).

## Data Contract

- Task payloads used by the sidebar include `createdByName`.
- Task payloads also include `taskTypeId` and a resolved `taskType` summary.
- `createdByName` is server-enriched in task queries (`listByProject`, `listArchivedByProject`, `listByParent`, `getById`, `getByRefs`).

## Fallbacks

- If creator lookup is missing, the UI falls back to `Unknown`.
