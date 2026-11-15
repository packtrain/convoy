# Task sections

OS-2137. A section is a named, ordered, optionally colored part of one List.
Sections are separate entities, not tasks: they have no ref, status or
assignee. The prototype it replaces is
[playground-task-sections.md](playground-task-sections.md); shared grouping
rules are in [task-list-grouping.md](task-list-grouping.md).

## Data

- `taskSections` rows store `projectId`, `listKey`, `name`, optional `color`
  and a LexoRank `rank`. `listKey` matches `tasks.listKey`, so the Backlog
  system List can have sections too.
- A project has at most 100 sections across all its Lists, archived Lists
  included. The cap is checked on create and also bounds every section read.
  Names are trimmed, 1–100 characters, and need not be unique. Colors come
  from the extended palette.
- Root tasks have an optional `sectionId`. Subtasks never have one; they
  follow their root. A section must belong to the task's project and List.
- Identical names in different Lists never mean the same section.

## Lifecycle

- Members and admins (`list:manage`) create, rename, recolor, reorder and
  delete sections. Viewers can see them.
- Deleting a section hard-deletes it and clears `sectionId` on every task that
  referenced it, including archived and deleted tasks, in the same mutation.
  Those tasks show under "No section".
- Removing a List deletes its sections.
- Nesting a task under a parent clears its section. Promoting a subtask to a
  root (outdent, archiving it without its parent, or deleting its parent with
  "keep subtasks") gives it the section of its former root.
- Duplicating a root task keeps its section.

## Moving between Lists

- A move to another List clears the section of every moved task by default.
- The "Move to" menu loads the project's sections while open; List rows stay
  disabled until they load. Choosing a List that has sections opens a second
  step: a "Section in {List}" back row, "No section", then the List's
  sections. Choosing a List without sections moves at once, as before.
- The chosen section is validated against the destination List and applied in
  the same mutation as the move. A section from another List is rejected.
- "Move to backlog", "Move active to", sidebar drops and the task detail List
  field always move to No section. "Move active to" skips the section step.

## Grouping

`section` is a grouping value for the list (`listGroupBy`) and board columns
(`groupBy`), including project and List default views. It follows every rule
in [task-list-grouping.md](task-list-grouping.md): group-local creation, header
and row drops, collapse, keyboard navigation and mobile layout.

- Groups are "No section" first, then sections by rank. "No section" always
  shows, even when empty, so tasks can be dropped back into it. Tasks whose
  `sectionId` is unknown to the current List show under "No section".
- Section headers show no task count. Members see an editable name (Enter or
  blur saves, Escape reverts, empty reverts), then on hover an actions menu
  (Move up, Move down, Delete) and a color swatch. Viewers and
  archived pages see a plain name.
- On desktop, members drag a section header by the grip left of its chevron.
  A blue line at the top of a section header means "drop above this
  section"; on "Add section..." it means "drop last". The line shows only
  where the drop changes the order: never on "No section", the dragged
  section, the section right after it, or task rows. Mobile has no grip.
- The list ends with an "Add section..." input for members, and the board has
  the same input after the last column. Enter or blur creates; Escape
  discards. The new section shows at the end right away (optimistic), as
  do renames, recolors, reorders and deletes. A leading "# " is dropped from the name. The list input lines
  up with the section chevrons.
- Typing `# Name` (hash, space, name) in the list's top-level "Add task..."
  row creates a section named "Name" in the current List instead of a task,
  and switches the list to Section grouping. Trailing `#tag` tokens keep
  their task meaning.
- Board section columns use the same name field, menu and swatch, with the
  task count. Dragging a column header reorders sections; "No section" stays
  first and does not drag.
- A List with sections opens in Section grouping when the URL has no
  `listGroupBy`, including when its default view groups by None. A default
  view with another grouping puts it in the URL, so it still wins. Picking No
  grouping writes `listGroupBy=none` and holds for that visit. Archived pages
  and the board never derive it. The page shows its loading skeleton until the
  List's sections load, even over cached tasks, so it never renders ungrouped
  first.
- Switching views or grouping never changes `sectionId`.

## Appearance

Each user picks two settings under Settings → Appearance → Task sections.
They are stored in `userPreferences` and follow the user across devices.
Each setting is a row of cards, one per option. Each card shows a fixed
miniature section in that option; header cards use Tint and color cards use
Compact, whatever the user has picked.

- **Header**: Compact (default) is a 44px row like a task row. Spacious is a
  68px row with a `text-base` title in its bottom 48px. Board columns keep
  their normal header.
- **Color**: Tint (default), Stripe or Dot. Uncolored sections show none.
  - Tint: 8% header background and 4% on every row of the section, subtasks
    and add rows included. Board columns get the 4% tint behind the cards.
  - Stripe: colored name and a 3px left stripe on the header and every row.
    Board columns get a 3px colored top edge.
  - Dot: a colored dot before the name. Uncolored sections keep the dot slot
    so names line up.

Row colors reach rows through `TaskTable`'s `getRowStyle`, applied to the
positioned row wrapper, so hovered and selected rows keep their own
backgrounds on top.

## Not covered

A per-row "Move to section" menu item, section activity history, MCP tools for
sections.
