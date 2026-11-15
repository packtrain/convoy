# Task Table Drag And Drop Specification

## Scope

- Project task table rows
- Task table instances embedded in the task detail sidebar
- Playground task table rows, backed by local state for performance testing
- Mobile task-list cards in the project task view (see
  [mobile-task-list.md](mobile-task-list.md)): on mobile the project view
  renders root tasks as cards instead of table rows. The cards carry the same
  `data-task-row-id` attribute, so the pointer-based long-press drag path
  (450 ms tap-and-hold, before/inside/after geometry against the card's
  height) applies to them unchanged. Card heights are variable; drop-position
  thresholds are percentage-based and need no row-height assumptions.

## Drag Source

- Reordering starts from the explicit drag handle in the first column, or from
  a mouse press on a task-field selector trigger (type, status, priority,
  assignee) that moves — see Editable Controls below (OS-1381).
- The row itself is a drop target, but it is not a blanket drag source; only
  the handle and the task-field triggers initiate drags on desktop.
- On mobile touch input, reordering can also start from a 450 ms tap-and-hold on the row surface, including the inline task title input and the drag handle area.
- Mobile tap-and-hold movement before activation cancels drag startup so normal scrolling still works.
- Mobile task rows do not mount row context menus and suppress native browser touch callouts on the row surface. Desktop right-click context menus remain available.
- When mobile long-press activates on a focused input, the input is blurred and any text selection is cleared before drag begins.
- Text selection via touch is suppressed during the long-press pending window to prevent the browser from selecting input text.

## Editable Controls

- On desktop, the task-field selector triggers (type, status, priority, assignee) open their dropdown on click (mouse release without movement) instead of on pointer-down. A mouse press on them that moves becomes a native row drag: the press temporarily arms `draggable` on the trigger (`data-task-field-drag`), and a click that concludes a drag does not open the menu (OS-1381).
- On mobile touch input, the same triggers open their dropdown on a quick still tap instead of on touch-down. A 450 ms tap-and-hold on them starts the row long-press drag (they are exempt from the interactive-control drag exclusion), and the release of a long-press or a moved touch does not open the menu (OS-1381).
- Other interactive controls inside a row keep their native behavior and must not initiate row dragging.
- In the main project table, clicking the task title edits it inline on desktop while the detail surface is closed. On mobile, tapping the task title opens the task detail surface so opening a task remains the default tap action.
- On mobile, the inline task title input, the drag handle area, and the task-field selector triggers allow long-press drag. Other interactive controls still exclude drag:
  - checkboxes
  - dropdown/menu triggers other than the task-field selectors
  - date pickers and other inline editors
  - links, buttons, and elements marked with `data-interactive`

## Expected Behavior

- Drag-selecting text inside the inline task title input performs text selection only (desktop).
- Mouse dragging from the drag handle starts task reordering.
- Mobile tap on the task title input opens the task detail surface.
- Mobile tap-and-hold (450 ms) on the task title input or any non-interactive row area starts task reordering.
- Mobile tap-and-hold from interactive row controls (buttons, checkboxes, dropdowns) does not start task reordering — except the task-field selector triggers, which do start it (OS-1381).
- Mobile tap-and-hold does not open the row context menu or browser native touch callout.
- Existing before/inside/after row drop targets continue to work once a drag has started from the handle.
- Existing before/inside/after row drop targets continue to work once a mobile long-press drag has started.
- In the playground task table, the local task store must preserve `parentId`
  and compute ranks within the target sibling scope so before/inside/after
  drops mirror the main project table without backend mutations.
- When the first row shows a `before` drop indicator, dropping in the upper table/header-adjacent area above that row or on other non-row page surfaces must complete the same first-position reorder instead of discarding the drop. Row and add-task row drops remain owned by their own drop handlers.
- The bottom add-task row also acts as an "append to end" drop zone. Its drop target is scoped to the table's parent: in the root task table it appends to the root (`add-root`), and in a parent-scoped table (e.g. the detail sidebar subtasks section) it appends under that parent (`add-{parentId}`). Dropping a subtask onto the bottom add-task row of a subtask table keeps it under the parent and must not reparent it to the root.

## Cross-Surface Drag Payload (OS-979)

- Desktop mouse drags from project/thread task-list cards use the table's
  native drag handlers and payload. The card body is the drag source; card
  controls keep their click behavior. See [mobile-task-list.md](mobile-task-list.md).
- Task-detail subtask cards publish the same project-scoped payload for the
  dragged child through `setTaskDragPayload`. Dragging into a composer does
  not reorder the child or change its parent. Both card paths share the
  native gesture handling in `useTaskCardDrag`.
- When the table has a `projectId`, drag starts also write a cross-surface
  payload to the drag's `DataTransfer`:
  - `application/x-convoy-tasks` — JSON `{ projectId, taskIds, taskRefIds }`
    where `taskIds` are the dragged root task ids (for a multi-select drag,
    tasks whose parent is also dragged are excluded — they move with their
    parent) and `taskRefIds` are the same roots' refs (e.g. `OS-42`),
    index-aligned with `taskIds`. `taskRefIds` is optional in the parsed
    shape: `readTaskDragPayload` drops it (keeping the payload) when it is
    missing or malformed, so id-based consumers accept payloads from any
    producer version.
  - `application/x-convoy-tasks-project-<projectId>` — empty marker type so
    drop targets can gate `dragover` by project (payload values are unreadable
    until drop).
- Helpers live in `apps/web/lib/tasks/task-drag.ts`; drop targets must read
  the payload with `readTaskDragPayload` (shape-validated, returns null on
  malformed data).
- Current external drop targets: sidebar pinned Lists and the project row
  (see [project-sidebar-pinned-lists.md](project-sidebar-pinned-lists.md)),
  Board columns, which promote dropped subtasks to root and apply the
  column's grouping field (see
  [task-kanban-status-columns.md](task-kanban-status-columns.md), OS-1115),
  and the thread composer, which attaches the first dragged root task (see
  [thread-task-selector.md](thread-task-selector.md)).
- Mobile long-press drag is pointer-based and does not produce a
  `DataTransfer`; external drop targets are desktop-only.

## Resource Drops Into Rows (OS-1711)

The table is also a drop *target* for resource drags — artifacts **and** file
attachments — from the task details Resources section. The payload is the mirror
of the task one and lives in `apps/web/lib/tasks/resource-drag.ts`:

- `application/x-convoy-resource` — JSON
  `{ kind, projectId, resourceId, taskId, name }`, where `kind` is `artifact` or
  `attachment`, `resourceId` is the id in the matching table, and `taskId` is the
  resource's current owner. `readResourceDragPayload` returns null on an unknown
  `kind` or unless all three ids are non-empty strings; a missing `name` falls
  back to the kind.
- `application/x-convoy-resource-project-<projectId>` — empty marker type for
  `dragover` gating, same reason as the task payload. One marker covers both
  kinds: rows accept them identically.

Behavior:

- A resource drag over a row always shows the `inside` indicator — before/after
  are meaningless for a move into a task — and never touches reorder state.
- A resource drag from **another** project is refused outright: `dropEffect` is
  `"none"` and no indicator is drawn. It must not fall through to the reorder
  affordance, which would advertise a drop the row cannot accept. Hence two
  checks: the unscoped mime says "this is a resource", the project-scoped marker
  says "this row can take it".
- Dropping calls `tasks.artifacts.moveTaskArtifact` or
  `tasks.attachments.moveTaskAttachment` per `kind`, with the row's task id. A
  drop on the resource's own task, on a row from another project, or on an
  add-task row does nothing.
- The drop is **optimistic**: the pill leaves the source task's Resources list
  immediately, without waiting for the round trip. Direct manipulation needs
  instant feedback — without it a slow network reads as a missed drop and invites
  a second drag. Convex rolls the update back on failure, so the pill reappears
  next to the error toast. Two things are deliberately left to the server
  response: the **target** task's list (rarely mounted — one task sidebar at a
  time — and the drag payload carries no full row to insert) and the row resource
  badges from `listByProject`.
- Both `TaskTable` instances get this from the same wiring, so the detail
  sidebar's subtasks table accepts resource drops too.
- The drag ends on the source pill, not in the table, so the table clears its own
  highlight from a document-level `dragend`/`drop` listener. It is the
  `!draggedId` counterpart to the ambient-top-drop listener and the two are
  mutually exclusive by that guard. Rows have no `dragleave`, so dragging a
  resource off the table without releasing leaves the highlight until `dragend`.
- Desktop-only, like every other external drop target.

## Filtered-View Reordering

- Rank planning always uses the full sibling list for the loaded rank container, never the visible/filtered rows. The set of rows shown in the table is decoupled from the task set used to compute LexoRank bounds.
- The drop position (`before`/`after`) is resolved against the full sibling list, so an `after` drop lands the moved task immediately after the drop target and before that target's *true* next sibling — even when siblings are hidden by a filter.
- **Assignee filters** keep reorder enabled. Assignee filtering is client-side only, so the full sibling set is still in memory; the moved task lands relative to its true neighbors, including assignee-hidden ones.
- **Status filters** keep reorder enabled in every view. The client always loads the full rank container for the selected List, including the Backlog system List, so rank bounds are computed against every sibling regardless of the active status filter. Closed-only views (`done`, `canceled`) show top-level rows only, but reorder still plans ranks against the full container — closed tasks stay in the closed band (see closed-to-bottom). Reorder is only disabled while a column sort is active, in which case drag handles are not rendered.
- Board group reordering follows the same full-container rank planning rule as
  filtered Table reordering. Board groups change which root tasks are visible in
  a column, but they do not define a separate rank scope.

## Rank Collision Recovery

- Task reordering is allowed to encounter duplicate LexoRank values from earlier concurrent writes.
- Healing is lazy: the original concurrent collision may leave duplicate ranks until a later reorder inserts into that duplicate sibling run.
- When a reorder inserts between two siblings with the same rank, the client heals the full duplicate run plus the moved task or tasks in one batch rank mutation.
- Healing only applies to reorder operations where the moved tasks are already in the same sibling scope locally. Cross-parent moves keep the existing parent update plus rank update flow.
- The batch rank mutation must only patch tasks from one sibling scope: same project, parent, archive state, and List scope.
