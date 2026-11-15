# Task sections playground

OS-2104 prototype at `/playground/task-sections` in `apps/web`, linked from the
playground index. The production feature is specified in
[task-sections.md](task-sections.md). It explores Asana-style sections inside a List before any
backend work. All state is local and resets on reload.

"Section" is used instead of "group" because `CONTEXT.md` already gives
"group" to Board groups and Thread groups.

It renders the real `ProjectHeader`, `TaskTable`, `BoardLayout`,
`BoardColumn` and `KanbanCard` over `useLocalTasks`, seeded with
the landing preview's Milestone 1 tasks. The `prototype/` folder exports one
component through `index.ts`. The route page, a layout re-export from
`/playground/tasks` and the index entry are the only wiring.

## Table

`TaskTable` accepts `rowType: "section"` rows and renders them through the
optional `renderSectionRow` prop. Production callers pass neither. Section
rows are excluded from TanStack rows, DnD, selection and keyboard navigation.
A section row may set `height`; the virtualizer sizes it with `getRowHeight`
and re-measures when the rows change while `renderSectionRow` is set, because
moving or resizing a section row does not change the row count.

- Each section is a header row above its tasks: drag grip, collapse chevron,
  name, then a hover block right after the name with add-task, actions and
  the color swatch, in that order. The name input is at least 12rem wide so
  the block does not crowd short names. Headers show no task count.
- The name is always an input, like the task name cell: click and type.
  Enter or blur saves, Escape reverts, and an empty name reverts. A new
  section's name takes focus with its text selected.
- A section's tasks render one depth level deeper (24px) than the table
  would otherwise draw them, so they sit indented under the section title.
- A "Section header" toggle compares Compact and Spacious (the default) headers. Compact
  is a 44px row, the same as a task row. Spacious is a 68px row with one background
  and a `text-base` title. Its content sits in the bottom 48px, so the 20px
  above it separates the section from the previous one. Board lanes use 36px and 64px.
- Root tasks without a section sit in a "No section" block at the top. It
  shows only while it has tasks.
- Task drag uses the table's own DnD. A before/after drop on a root row also
  moves the dragged tasks into that row's section. A drop on a section header
  makes them the section's first tasks. Header drops stop propagation so the
  table's container and document drop handlers do not re-apply them.
- Drag a section header by its grip onto another header to reorder sections.
  The grip is the only drag handle, so the name input can select text.
- Section actions: rename (focuses the name), move up, move down, delete.
  Deleting moves the section's tasks to "No section".
- Add task creates an empty task at the end of the section and focuses its
  name cell. The table's bottom add row is hidden; "Add section" replaces it.
- Subtasks follow their parent and have no section of their own.

## Board

`?view=board` has a prototype toggle, "Board sections as", with two layouts.
Both list "No section" only while it has tasks.

- **Rows** (default, Jira swimlanes): the real board's six status buckets are
  the columns, and each section is a collapsible row of cells under the same
  header row as the table. A card dropped in a cell joins that section and,
  if its status is outside the bucket, takes the bucket's first status.
- **Columns**: one `BoardColumn` per section, in section order. Column headers
  drag to reorder sections, and "Add section" trails the last column.

Cards drag natively. A card dropped on a cell or column goes first; dropped on
a card, it goes before it. Column titles use the same click-to-edit name
input as the table.

## Section color

Each section has an optional color from the extended palette. The swatch at
the end of the header's hover block opens the shared `ColorPicker`; board
columns show it after the title on hover. A "Section color" toggle
compares three treatments:

- **Dot**: a colored dot before the name. Nothing else changes. Uncolored
  sections keep an empty dot slot so names line up.
- **Stripe**: colored name and a 3px left stripe on the header and every row
  of the section, subtasks included. Board columns get a colored top border.
- **Tint**: a pastel header background (8%) and a lighter one (4%) on every
  row of the section, subtasks and add-subtask rows included. Text keeps its
  normal color. Hovered and selected rows keep their own backgrounds. Board
  lanes and columns get the 4% tint behind the cards.

Stripe reaches task rows
through their `data-task-row-id` attribute, so the table needs no changes.

## Not covered

The task details sidebar is left out: it queries Convex, which rejects the
prototype's local task ids.

Per-row "Move to section" (it belongs in the real task context menu), status
and assignee filters, search, List switching and persistence. Colored text
contrast for light palette colors is not checked.
