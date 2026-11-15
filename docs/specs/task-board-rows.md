# Task board rows

OS-2138 adds optional horizontal rows to the board. Columns keep the rules in
[task-kanban-status-columns.md](task-kanban-status-columns.md); shared group
membership, order and create/drop values come from
[task-list-grouping.md](task-list-grouping.md). Every card sits in one cell,
the intersection of its row group and its column group.

## Choosing rows

- Rows offer None plus the seven column dimensions: Status, Assignee, Owner,
  Priority, Type, Label and Section. None is the default.
- The two axes never share a dimension. Choosing the row dimension for
  columns, or the column dimension for rows, swaps the axes. The settings
  menu marks that choice "swaps axes". With rows on None there is nothing to
  swap with, so the column dimension is disabled under "Rows by".
- On the board only, the settings menu has a "Rows by" submenu under the
  "Columns by" icons. The trigger shows the current rows; each item has the
  dimension's icon and name, with "No rows" first. The mobile toolbar panel
  has a matching "Rows by" section.
- Swapping axes changes presentation only. A task's cell is the same pair of
  groups in either orientation.

## URL and defaults

- `rowGroupBy` stores the rows in the URL. Missing, invalid, `none` or equal to
  the column dimension means None; choosing No rows writes `rowGroupBy=none`.
  Switching to the List view keeps it, so the board comes back with the same
  rows; switching to Archived drops it. Task details and filter changes keep
  it. Switching to the board with neither `groupBy` nor `rowGroupBy` applies
  the default board grouping.
- Project and List defaults store `defaultBoardRowGroupBy` next to
  `defaultBoardGroupBy`. "Set as default view" saves both axes, including an
  explicit `none`, and is disabled only when both match.
- A List update must set `defaultViewMode: "board"` in the same call to
  write rows (`defaultBoardRowGroupBy requires defaultViewMode: board in the
  same call`). A board-mode update without rows clears them; list mode and
  inherit clear them too. Unrelated List edits keep them.
- Project settings show both axes and keep them whatever the default view.
  The List dialog shows column grouping only; choosing a different default
  view there clears the List's stored rows.
- MCP and CLI List tools do not set rows yet. Their board-mode List updates
  clear stored rows, like the List dialog. MCP `list_task_lists` reports a
  List's `defaultBoardRowGroupBy`.
- Entry links (sidebar project and pinned-List links) include `rowGroupBy`
  when the resolved default is a board with rows.

## Layout

- Column headers render once, sticky at the top, with each column's visible
  card count. Each row is a lane: a 40px header with a collapse chevron, the
  group icon, title and count, then one cell per column. Cells stretch to the
  lane's height, and the column lines continue below the last lane to the
  bottom of the board. An expanded lane ends with a line above the next row
  header.
- Row headers stay sticky on the left while the board scrolls sideways.
- Collapse is per user, project, List and row dimension, stored in browser
  preferences. A collapsed row hides its cells and accepts no drops.
- Empty rows, columns and cells still render, so tasks can be dropped there.
- Mobile keeps the one-column-per-view gallery: column headers are the snap
  points and every lane scrolls with them. The column lines run through the row headers,
  whose chevron and title sit inside the column.
- With rows on, column headers are plain: no column create button, no label
  or section column reordering, renaming or "Add label"/"Add section". Those
  stay available without rows.

## Cells

- A cell creates root tasks with both groups' create values and appends after
  the cell's last card. There is no top create input in a cell. The bottom
  "Add task..." input shows on hover, and always on touch screens.
- A cell that can't create tasks shows the reason in place of "No tasks", for
  example an impossible Owner × Assignee pair or a legacy status group.
- Cards inside a cell follow List rank. Board and List share one rank; there
  are no per-cell ranks.
- A drop inside the same cell is a rank-only reorder.
- Keyboard drags (Space on a card title) work in cells too. Up and Down step
  through card edges that share the column, so they can cross into the same
  column's cell in the next row. Left and Right pick the nearest cell
  sideways, preferring the current row. See
  [task-kanban-status-columns.md](task-kanban-status-columns.md#board-ordering-and-drag).
- A drop into another cell writes only the axes whose group changed, plus
  rank, in one `tasks.core.update` call. Moving a Plan Review card to another
  row of the Planning column keeps Plan Review.
- A drop is refused when a changed axis has no drop value, for example a
  legacy status group or a stale agent. Moving within such a group along the
  other axis still works.
- Center drops still make subtasks and external sidebar drops apply both
  cell values, as on a board without rows.

## Owner × Assignee

Owner and Assignee both decide the owner, so the pair has joint rules in both
orientations.

| Assignee group | Valid Owner groups | Cell value |
|---|---|---|
| No assignee | No owner | no owner, no delegation |
| Person X | X only | owner X, no delegation |
| Agent A | any owner, including No owner | that owner, delegated to A |
| Stale agent | none (not a drop target) | n/a |

- Impossible cells never contain tasks, cannot create or accept drops, and
  explain why in place of "No tasks": "No assignee means no owner" or
  "Assigning X makes them the owner".
- Every drop between cells of this pair writes the joint owner and delegation,
  even when only one axis changed. A No owner × Agent cell therefore sends an
  explicit `assigneeId: null`, so the server's automatic owner never moves the
  task out of the chosen cell. Cell creation passes the row's owner the same
  way.

## Server

No new task mutations. `tasks.core.update` already applies grouping fields
and rank atomically, and validates status policy, labels, sections, task type,
agents and permissions. Owners are not checked against project membership;
that matches column drops and the task detail picker today.

## Data loading

The board still loads the whole selected List once and groups on the client;
rows add no queries. Assignee, label and section directories load when either
axis needs them. Cell models are cached per task set, so a drag start costs
the same as without rows.
