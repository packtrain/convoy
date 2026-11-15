# Task Table Name Column Resize

## Scope

Defines the two sizing modes of the task **name** (title) column in the wide
task-table layout — **auto/responsive** (default) and **fixed** (user-resized) —
and how each mode lays out the table.

Related:

- `docs/specs/task-table-compact-headers.md`
- `docs/specs/task-table-column-visibility.md`
- `docs/specs/task-table-scroll-padding.md`

## Modes

The name column has two modes in the wide table layout (`@4xl` container
breakpoint, ~896px, non-compact). All visible non-name columns — status,
priority, assignee, due date, **tags**, rank — keep fixed widths. Project-hidden
columns are omitted from the width calculation.

### Auto / responsive (default)

- This is the **default** state on first visit (no persisted width). The name
  column flexes to fill all available width (the table is fully responsive, the
  way it behaved before the resize feature existed). Icon-only Priority and
  Assignee columns and the hidden-by-default Tags column leave that width to
  the title (see `task-table-compact-headers.md`).
- No fixed width / `--task-name-w` is applied; the table fills the container and
  does not force horizontal scroll from the name column.

### Fixed (user-resized)

- The name column has a user-set width applied via `--task-name-w` (`flex: 0 1
  auto`, basis = user width). The column never grows beyond the user width, so
  leftover space stays empty after the last column — nothing stretches to fill it.
- A minimum width of **480px** is enforced (the resize floor and the "smallest"
  double-click target).
- In fixed mode the table sizes to its columns (`w-max`, with `min-w-full` to keep
  filling the container when wider). Consequently, when the container is too
  narrow to fit the name width plus the metadata columns, the table **scrolls
  horizontally** (so every column stays reachable) rather than the name column
  shrinking. The name column only flex-shrinks below the `@4xl` breakpoint, where
  it behaves like the auto variant.

## Behavior

- A title cut off by the column width shows the full title as a native tooltip
  on hover. A title that fits gets no tooltip. Read-only titles behave the same.
- A drag handle sits on the right edge of the `Task` header (shown at `@4xl` in
  both modes). Dragging it moves a vertical guide line only; the column width is
  **not** applied live. The new width is committed when the pointer is released
  ("drop to apply"), which switches the column to **fixed** mode.
- A press with no movement (below a small threshold) is treated as a click, not a
  resize: it does not commit a width or change the mode.
- Expansion is **unbounded** — the user may drag the name column arbitrarily wide
  (which extends the table and enables horizontal scroll). Only the 480px minimum
  is enforced.
- The drag starts from the column's current rendered width, so it behaves
  correctly whether the column is flexing (auto) or already at a fixed width.
- **Double-clicking the handle cycles** the mode:
  - From any fixed width larger than the minimum → **smallest** fixed width
    (480px).
  - From the smallest fixed width → back to **auto/responsive** (the fixed width
    is cleared).
  - From auto → **smallest** fixed width.
- The task-name header action menu includes an **Auto width** item that switches
  the column directly to auto/responsive mode (a one-click alternative to
  double-clicking back to auto). It is disabled when the column is already in auto
  mode.
- The chosen width is persisted per project in `localStorage` and restored on
  return; clearing to auto removes the persisted width (so auto is restored).
- In compact mode and below the `@4xl` breakpoint, the name column flexes to fill
  available space; no fixed width is applied.
- Switching modes / resizing must not change row alignment, virtualization,
  drag-and-drop reordering, inline task editing, or task selection.
- The resize gesture captures the pointer (`setPointerCapture`) and tears down on
  both `pointerup` and `pointercancel`, so the drag state (col-resize cursor and
  guide line) always clears when the gesture ends — even if the pointer leaves the
  window or the browser cancels the gesture. It must not linger until the next
  click.
- The drag guide is positioned in content coordinates (includes the scroll
  container's `scrollLeft`) and spans the table's full content height, so it stays
  aligned with the column edge and visible across the viewport even when the table
  has been scrolled horizontally or vertically.

### Accessibility

- The drag handle is pointer-only (no keyboard resize). The keyboard/assistive
  path to leave a fixed width is the header menu's **Auto width** item; there is
  no keyboard path to set an arbitrary custom width.

## Acceptance Checks

- On first visit (no persisted width), the name column flexes to fill the
  available width and the table is responsive (no horizontal scroll forced by the
  name column).
- In fixed mode on wide containers with spare room, the name column stays at the
  user width and the space after the last column is empty (no column stretches to
  fill it).
- In fixed mode, once the name width plus the metadata columns no longer fit the
  container, horizontal scroll appears and every column (priority, assignee, due
  date, tags, …) remains reachable. The name column does not shrink to fit in
  fixed mode (it scrolls instead); the smallest fixed width is 480px.
- Dragging the `Task` header edge shows a guide line that follows the cursor
  (correctly aligned even when scrolled horizontally or vertically) without
  resizing rows mid-drag; releasing commits the new width and switches to fixed
  mode. Dragging right has no upper limit.
- Double-clicking the handle cycles fixed → smallest (480px) → auto/responsive.
- Reloading the page restores the last committed width for that project, or the
  auto/responsive default if the width was cleared.
- In compact/narrow layouts, no resize handle appears and the name column still
  fills available width.
