# Mobile Task List Specification

The main project task view on mobile viewports and the thread Tasks panel below
768px of panel width render root tasks as kanban-style cards instead of the 44px
table rows. Implemented by `components/blocks/tasks/mobile-task-list.tsx`,
rendered by `TaskTableSurface` when the caller passes `mobileCardLayout`
(OS-1380, OS-1911).

## Scope

- Main project task view and the thread Tasks panel. The compact table rows
  truncated names to a few characters next to the ref/status/priority columns
  on phone widths (OS-1911).
- The task-detail subtask section uses the same `KanbanCard` below 768px of
  section width, including narrow desktop side panels. At 768px and above it
  keeps the compact table. Resizing the panel updates the renderer.
- The thread panel measures its own width, including narrow panes in a desktop
  workspace, and updates when resized. Until measured, it uses `useIsMobile`.
- In the thread panel the card list drops the inline "Add task" row and table
  keyboard shortcuts. The panel is read/edit-only for existing tasks in card
  mode; the bottom nav bar is hidden inside thread conversations.
- The wide table (`TaskTable`) is unchanged; the card list is a separate
  renderer over the same `useTaskTableController` output.

## Cards

- Each card is the shared `KanbanCard` (`components/blocks/tasks/kanban-card.tsx`),
  the same component the kanban board renders — no fork.
- Project/thread card wrapper responsibilities: `data-task-row-id` for drag
  targeting, tap-to-open-details, drop-indicator/drag styling, archived tint.
- Project/thread lists pass `onClick`, so every row's card title is a real
  button that opens details. The title carries `data-task-card-body`, which
  keeps it a long-press drag surface (`allowTaskCardBodyDrag`). The wrapper
  swallows the click that ends a drag in the capture phase.
- Cards follow the Board's display settings: the description preview is off
  unless "Show description" is on (mobile settings drawer, Cards section), and
  the label chip shows unless the Label column is hidden. See
  [task-kanban-status-columns.md](task-kanban-status-columns.md#card-metadata-presentation).
- Card controls (status, priority, assignee, due date, task type) are editable;
  `onTaskUpdate` must be wired or they silently render read-only. A project
  viewer gets values only, the header bar menu keeps Collapse all, and the List
  selector has no row menus or create row
  ([read-only-viewer-ux.md](read-only-viewer-ux.md)).
- Subtask progress ring maps from the tree node's
  `childCount`/`completedChildCount`; closed tasks render struck through.

## Behavior decisions

These rules apply to project and thread task lists. Task-detail subtasks use
the layout described below.

- **Roots only, no expansion.** Subtasks are reached through task details. A
  deep link to a subtask still opens its detail surface; the list does not
  reveal the subtask as a card.
- **No multi-select** on mobile (deferred). Tap on a card (outside its
  controls) opens task details.
- **Creation.** Ungrouped lists use the mobile nav bar's `+` button
  (`MobileCreateTaskPanel`). Grouped project lists also have one compact
  `Add task...` footer per expanded group. Thread card lists keep creation
  disabled. No inline draft rows or `C` hotkey on mobile.
- **No row context menus** (parity with mobile table behavior; long-press is
  reserved for reorder per
  [task-table-drag-and-drop.md](task-table-drag-and-drop.md)).
- **Header bar** replaces the table's column header: a slim bar with a `...`
  actions menu hosting Archive done, Closed to bottom, and Move active to —
  the same actions as the desktop name-column header dropdown. Column sorting
  and name-column resize do not apply on mobile.
- **Reorder** uses the shared `useTableDnd` mobile long-press path against the
  card wrappers, including `inside` drops (nesting a task under another —
  the nested task then leaves the roots-only list, and is reachable through
  its parent's details).
- **Desktop drag to composer.** A primary mouse press on a card's body arms
  native dragging. The card uses `useTableDnd` to write the same project-scoped
  task payload as table rows, so dropping it into a thread composer attaches
  the task. Release, cancellation and drag end disarm the card; drag end also
  clears its dragged appearance. Card controls and portalled menus do not
  start native task drags. Touch keeps the existing long-press reorder path.
- Native card dragging follows the table's enabled state and is disabled in
  archived lists. This does not add desktop reorder targets to the card list.
- **Infinite scroll** (archived view) mirrors the table: load more when the
  last visible card is near the end of loaded data.
- Accepted trade-offs vs. desktop rows: no one-tap done checkbox (status
  dropdown instead), no attachment/artifact count, no PR-link icon, no inline
  rename, and due date shows only when set. Tags stay hidden; labels show as a
  chip on the card.

## Layout

### Task-detail subtasks

- Render direct children as cards in the detail page's normal scroll flow.
  Nested children are reached by opening their parent card; the card shows
  their completion count.
- Keep the shared card's editable metadata and open details using `clientId`.
- A mouse drag from the subtask card body or footer display area can attach
  that child to a thread composer. The payload contains the child's ID and
  ref, and the drop leaves its parent and rank unchanged. This requires a
  project and is disabled for archived children.
- Task-list and subtask wrappers share `useTaskCardDrag` for mouse gesture
  handling. The shared card marks its detail-opening areas so they can start
  drags while retaining click and keyboard opening. Nested metadata controls
  remain excluded. Subtask cards do not add touch drag or reorder behavior.
- Keep an always-visible `+ Add task...` row below the subtask cards, including
  for an empty parent. Match the board's transparent input and muted plus;
  do not render a boxed field or hide the row until hover. Its accessible
  name is "Add subtask". Enter or blur creates a child of the opened task
  through the existing table controller, and the row remains ready for another.
- Card mode has no table selection toolbar, row shortcuts, or drag reorder.
  Wide sections retain the table's selection, nesting, and reorder controls.
- Do not use the full-page mobile list here. Its own scroll container, list
  header, and navigation padding do not belong inside task details.

### Project and thread task lists

- Group headers and creation footers span the content width with no gaps
  between adjacent headers. Cards retain the normal mobile inset without
  desktop tree indentation. See [task list grouping](task-list-grouping.md).
- Virtualized (`@tanstack/react-virtual`) with dynamic `measureElement`
  heights; cards vary in height.
- The scroll container carries `data-task-table-scroll-container` so the drag
  auto-scroll zone works.
- Bottom scroll padding (128px) keeps the last card clear of the floating
  mobile nav bar.
- Empty state: a muted "No tasks" line.
