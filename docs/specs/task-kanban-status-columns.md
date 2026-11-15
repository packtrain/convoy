# Task Board Status Groups

## Summary

A Board can group tasks by different dimensions. When grouped by status, the
Board renders named status groups that stay aligned with the shared task status
workflow order while respecting project-level disabled status toggles.

## Grouping And Filtering

- Board grouping is separate from task filtering.
- List selection and filters determine which tasks are visible.
- Board grouping determines how those visible tasks are organized into columns.
- The default Board grouping is status.
- The Board grouping dimensions are status, assignee, owner, priority, task type, and
  label (see [task-labels.md](task-labels.md)).
- Board grouping is encoded in the project URL as `groupBy`.
- Missing `groupBy` means status grouping.
- Invalid `groupBy` values are treated as missing and cleaned from the URL during
  normal project URL-state normalization.
- Board grouping is not persisted as a per-user preference; a project can store
  a project-wide default view, optionally overridden per List (see Default
  View below).
- Users change Board grouping from the project header settings menu, not from a
  separate persistent header control.
- The settings menu exposes `Columns by` icons for `Status`, `Assignee`,
  `Owner`, `Priority`, `Type`, and `Label`. Selection updates `groupBy` in the
  URL without switching layouts. List/Board navigation stays in the page header;
  [header navigation](project-header-navigation-state.md) owns these controls.
- Viewers retain card context actions for opening details and copying links.
  Write actions are unavailable.
- Filters hide cards, not Board groups.
- Board groups remain visible as drop targets even when the active filters leave
  them empty.
- If a Board drop changes a task so it no longer matches the active filters, the
  card disappears from the Board after the optimistic update.
- Opening and closing task details from the Board preserves `groupBy`, List, and
  filter URL state.

## Board Availability

- V1 Board is available for active Lists, including the project default List,
  persisted Lists, and the Backlog system List.
- V1 Board is not available for Archived tasks.
- The Board is generally available; it is no longer gated behind a developer
  setting.
- Backlog is still a List; Board navigation should not add special Backlog-only
  routing constraints in v1.
- The implementation should prevent Board viewing for Archived tasks with a
  simple availability guard, not by adding special Board data-model rules.
- Selecting Archived while on Board navigates to the Table route.
- Direct `/kanban` URLs for Archived tasks redirect to the equivalent Table
  route and clear Board-only URL state such as `groupBy`.

## Default View

The default view resolves at two levels: an explicit per-List override wins over
the project-wide default.

### Project Default View

- A project stores three defaults, each kept whatever the others are: the
  view (List or Board, absent means List), the list grouping (absent means
  None) and the board grouping, columns (absent means Status) plus rows
  (absent means None).
- Switching between List and Board fills the target view's grouping from its
  default when the URL has none for that view: `listGroupBy` for the List
  view, `groupBy` or `rowGroupBy` for the board. Grouping already in the URL,
  including an explicit `none`, survives the switch.
- A List override answers for its own mode's grouping; the other view's
  grouping comes from the project.
- The default view shapes entry links into the project only: sidebar project
  links and sidebar pinned-List links resolve to the default view URL.
- Explicit URLs and in-project navigation are never rewritten. The bare project
  URL remains the Table route, and applying the default involves no redirects.
- In-project navigation (filters, layout, archive toggle) keeps preserving the
  user's current view. Switching Lists is the one exception; see below.
- Changing the project default view requires the project update permission,
  from a `projectMembers` row or from org-level `projects:manage_all` in org
  settings (OS-1536).
- The default view is editable in the project settings dialog (General section)
  and via "Set as default view" in the project header settings dropdown and the
  mobile toolbar panel, which save the current layout and that view's
  grouping. The other view's default grouping stays. The action is disabled
  when the current view is already the default.
- Project settings → General shows `Default view` (List or Board),
  `Default list grouping` (No grouping or a dimension) and
  `Default board grouping` (a columns select and a rows select). The rows
  select omits the columns dimension; choosing the rows dimension as columns
  swaps the two.

### Per-List Default View

- A persisted List may store its own default view, which overrides the project
  default for that List.
- Absent means *inherit* the project default. It is not the same as an explicit
  `list`: a List explicitly set to List/Table stops inheriting a project-level
  Board default. The UI therefore offers three states: `Project default`,
  `List`, and `Board (by X)`.
- A Board override with no stored grouping normalizes to `status`. Setting a
  List override to `List` or back to `Project default` clears the stored
  grouping.
- Archived is never Board, so a resolved Board mode is ignored while the
  archived filter is on.
- **Selecting a List applies that List's default view — but only if the List
  actually overrides.** Choosing a List whose default is Board navigates to the
  kanban route with that List's grouping, even from a Table view. This is a
  deliberate, scoped exception to the rule that in-project navigation never
  rewrites the current view. A List that inherits the project default changes
  nothing on screen, as do filters, the archive toggle, and the
  Backlog/Archived entries. Otherwise the layout toggle would be unusable in a
  Board-default project: every List switch would undo it.
- The default-List picker row carries no `list` param, so its override resolves
  through the project's `defaultListId` rather than by ref.
- The same applies to every entry link that omits `list` — the sidebar project
  row, the mobile Tasks tab, and the project-settings back arrow all open the
  project's default List, so that List's override wins there too. They read it
  from the `defaultListView` field on `api.projects.core.listByOrganization`
  rows, present only for projects whose default List actually overrides.
- Backlog and Archived have no List row and always inherit the project default.
- Entry links resolve the target List's override too: sidebar pinned-List links
  and the "open tasks" links in project settings → Lists.
- Changing a List override requires the List management permission
  (`list:manage`), held by project admins and members. This is deliberately
  looser than the project-wide default (`project:update`, admins only): a
  project admin owns the project-wide default, while anyone who can manage a
  List can tune that List's view.
- An archived List may carry an override; it simply survives unarchive.
- The override is editable in the List create/edit dialog (`Default view`) and
  via two sibling actions in the project header settings dropdown and mobile
  toolbar panel: `Set as default view for "{List}" only` and
  `Reset "{List}" to project default`. Both are hidden without a viewed List
  (Backlog/Archived) or without `list:manage`.

## Task Visibility

- V1 Board cards show root tasks only.
- V1 does not promote subtasks into Board groups, regardless of grouping.
- Subtask visibility on Boards is deferred to a later design pass.
- The later design pass should consider a Board configuration for whether
  subtasks are always shown, conditionally shown by grouping value, or hidden.
- If subtasks become conditionally visible, task-type grouping should still be
  allowed to hide subtasks by default because every task resolves to a type.

## Data Loading

- V1 Board loads the full selected List using the same task data source as
  Table.
- V1 Board groups tasks client-side.
- V1 does not require a Board-specific pre-grouped backend query.
- The full root-task List order must be available client-side for rank planning.
- Switching between Table and Board should reuse already-loaded selected-List
  task data where possible so the transition is effectively instant.
- Switching between Table and Board should not remount or visibly reload the
  shared project header or List selector.
- While the shared task-view shell is still loading project data, the Board
  route shows a Board-shaped column skeleton and the Table route shows the
  table-row skeleton; the header skeleton is shared between both.
- Board does not support separate column sorting in v1.
- Future Board sorting modes may be considered later.

## Generic Board Layout Components

- Board layout and column primitives are grouping-agnostic.
- Generic Board columns accept title, metadata, count, card items, empty state,
  and group-local add affordance configuration.
- Generic Board columns render count only when the consumer opts in, and counts
  render as compact badges.
- Generic Board columns require stable item keys from the consumer because Board
  cards will later be reordered by drag/drop.
- Status-specific workflow rules and presentation mapping stay in the status
  Board adapter, not in the generic layout or column components.
- Group-local add affordance creates root tasks in the selected List when the
  Board group has a valid create target.

## Board Ordering And Drag

- Board and Table share the same List-scoped root-task rank.
- Board groups must not introduce a separate per-group or per-Board persisted
  ordering model.
- Board drag is single-card only in v1; multi-card Board drag is deferred.
- Cards move with the keyboard. Each card's title is a real button: Enter opens
  task details, and Space lifts the card. While lifted, Up and Down step to the
  previous or next card edge in the column, Left and Right enter the
  neighboring column at the nearest card edge (or its body when empty), Space
  or Enter drops, and Escape cancels. Collision uses the lifted card's center
  in place of the pointer, so keyboard drops resolve to the same before, after,
  top and group zones as mouse drops.
- Screen readers hear the drag instructions on the title button and an
  announcement for pick up, each move, drop and cancel, named by task and
  column title (`useBoardDnd` passes them as the DndContext `accessibility`).
- Cards within each Board group render in List rank order.
- Dragging within a Board group reorders the moved root task by updating its
  List rank.
- Dragging between Board groups updates the field represented by the active
  Board grouping and updates List rank from the drop position; the field and
  rank persist through one atomic task update.
- Every Board drop has an ordering intent: top of group, bottom of group, before
  a card, or after a card.
- For non-empty Board groups, top and bottom drops map to before the first
  visible card or after the last visible card, using the full List rank
  container for rank bounds.
- Dropping into an empty Board group updates only the field represented by the
  active Board grouping and preserves the task's existing List rank.
- Board rank planning uses the full loaded root-task List order, not only the
  visible cards in the active Board group.
- If hidden tasks from other Board groups sit between two visible cards, a drop
  before or after a visible card resolves against that visible card's true List
  neighbors, matching the filtered-view reordering invariant in
  `task-table-drag-and-drop.md`.
- Same-group drops that do not change the visible order of the group are
  treated as no-ops and write nothing.
- While a drag is active, valid drop targets show an insertion indicator
  (before/after a card, top of group) or a group highlight (group body and
  empty groups); groups that are not valid drop targets are visually
  de-emphasized and ignore drops.
- The dragged card renders as a drag overlay while the source card stays in
  place with reduced opacity.
- Lifting a card re-renders only the drag overlay. Card bodies are memoized and
  the column model is cached per task set, so drag start costs the same on a
  board of 200 cards as on one of 5; the drag state lives in the Board and would
  otherwise re-render every card at the moment the card should start moving.
- Completing a drag does not open task details; a plain card click still does.
- Presses on the task-field selector triggers (type, status, priority,
  assignee) may start a card drag: those dropdowns open on click (release
  without movement) instead of on pointer-down (OS-1381). With a mouse, a
  press that moves beyond the activation distance lifts the card and never
  opens the menu. On touch, a quick still tap opens the menu, while a still
  long-press lifts the card (OS-1001) without opening the menu — including
  when the finger never moves before release.
- Pointer-downs on other interactive card controls (due date, links, buttons)
  do not start a drag. The card title button is the exception: it is the
  card's grab surface (`data-task-card-body`).

## Subtask Drag (OS-1115)

Dropping one card onto another makes it a subtask; dragging subtasks out of
the task detail sidebar onto the Board removes their parent.

- While a Board drag is active, each card exposes three stacked drop zones
  mirroring the table's row split: before (top quarter plus the gap above),
  into (center half), and after (bottom quarter plus the gap below).
- Dropping onto a card's center zone makes the dragged task a subtask of that
  card, appended to the end of the target's existing subtasks.
- The center drop only reparents (parent + rank); it never rewrites the
  grouping field, because the reparented card leaves the Board anyway (Boards
  show root tasks only).
- The center zone highlights the whole target card (accent ring) instead of an
  insertion line; center zones appear wherever card drop zones appear (the
  source group and droppable groups) — de-emphasized non-droppable groups stay
  inert for center drops too.
- Dropping a card onto its own center is a no-op; deeper circular-parent cases
  cannot arise from root-only cards and are re-validated server-side.
- Board columns and cards also accept native cross-surface task drags (the
  table drag payload from `task-table-drag-and-drop.md`, OS-979) — e.g.
  subtasks dragged out of the open task detail sidebar's subtask table.
- An external drop on a column body promotes the dragged tasks to root
  (parent cleared, appended to the end of the root List order) and applies
  the column's grouping-field drop target in the same gesture; descendants
  follow their parent.
- An external drag over a card resolves against the same 25/50/25 card split
  as Board-internal drags: the edge bands insert the promoted tasks before or
  after that card in the true root rank order (hidden siblings included) and
  apply the column's grouping field; the center band instead makes the
  dragged tasks subtasks of that card (parent + rank only, no field change).
- External center drops onto the task's current parent or itself are no-ops.
- Card zones show the same indicators as Board-internal drags (insertion line
  or whole-card ring); while a card zone is hovered, the column-level
  highlight is suppressed.
- Columns without a grouping-field drop target (legacy/stale groups) do not
  accept external drops, on the column body or on cards.
- The hovered column shows a full-column highlight during an external drag.
- External drops are desktop-only because mobile long-press drags produce no
  `DataTransfer` payload.

## Board Create Defaults

- Creating a task from a Board group creates a root task in the selected List.
- The column header plus opens an add input at the top of the column.
- The bottom hover add input remains available unless the top input is open.
- Hover-revealed create affordances are hidden while a Board drag is active so
  drop indicators are the only moving UI during a drag.
- Enter and blur commit non-empty Board add input text.
- After a successful create, the active add input clears and stays open for
  rapid entry.
- Group-local create applies the active group value to the field represented by
  the current Board grouping.
- Status group create uses the group's resolved drop target status.
- Top creates rank before the first visible card in that group when present.
- Bottom creates rank after the last visible card in that group when present.
- Empty group creates use normal List rank insertion without a group-local rank
  anchor.
- Assignee group create uses that group's value: a user group sets that user
  as owner, a Project-agent group delegates to that agent (the server
  auto-sets the creating user as owner), and `No assignee` creates with no
  owner.
- Priority group create uses that group's priority.
- Task-type group create uses that group's task type.
- Other task fields use normal task creation defaults.

## Card Metadata Presentation

- Board cards accept the shared `Task` model as their required data input.
- Board-specific derived values, such as subtask progress and status-group
  presentation, are passed as explicit card props instead of being folded into a
  separate dummy card model.
- Board card metadata controls reuse the shared task controls: task type/ref,
  status, priority, assignee, and due date are interactive when update handlers
  are provided.
- Compact Board-card metadata styling and editable/read-only behavior belongs to
  those shared task controls through variants/props, not to ad hoc rendering in
  the Board card.
- Board card subtask progress is display-only in v1.
- Cards hide the description preview by default. "Show description" in the
  board's view settings (and the Cards section of the mobile settings drawer)
  turns the two-line preview on for desktop Board cards and mobile cards. It is
  a per-browser setting (`lib/tasks/card-view-prefs.ts`), not a project setting.
- Cards show the task's label chip in the footer, after the task ref. Hiding the Label column
  hides it on cards too, like priority, assignee and due date.
- Card markup has one button: the title. The card container widens its click
  target (a click anywhere outside the footer controls opens details) without
  a `role="button"`, so footer controls never nest inside a button.
- Board grouping does not generally hide the grouped field from cards.
- When grouped by assignee, cards still show assignee.
- When grouped by priority, cards still show priority.
- When grouped by task type, cards still show task type.
- When grouped by status, single-status groups can hide the status indicator
  because the group already communicates the status.
- When grouped by status, the `To Do` group hides plain `To Do` card status
  indicators but shows `Triage` status indicators with their accent because
  `Triage` is the non-default status in that group.
- When grouped by status, the `Planning` group shows each card's actual status
  indicator because it contains `Planning` and `Plan Review`.
- When grouped by status, the `Done` group hides the status indicator; `Canceled`
  cards use a crossed-out visual, while `Done` cards do not.
- When grouped by any dimension other than status, cards show the status
  indicator.

## Task Detail Interaction

- Clicking a Board card opens the existing task detail surface in v1.
- Centered task detail presentation is deferred.
- Right-clicking a Board card opens the same task context menu as a task table
  row (status, priority, assignee and label submenus, complete, move to List,
  duplicate, open details, open in new tab, copy link, archive, delete), scoped
  to the clicked card; the Board has no multi-select, so selection-scoped menu
  labels do not apply. Keycap hints show only the keys a focused card handles
  (`P`, `A`, `L`, `M`); see [keyboard navigation](keyboard-navigation.md).
- Like the Table, the card context menu is not available on mobile.
- While the desktop task detail sidebar is open, the Board gains matching
  horizontal scroll space on the right so every column, including the last
  one, can scroll fully into view beside the sidebar; the space tracks sidebar
  resizing and the artifact panel. The mobile drawer does not add scroll
  space.

## Permissions

- Board uses the same task permissions as Table.
- Users with task view permission can view the Board and open task details.
- Group-local task creation requires task create permission.
- Board drag requires task update permission because it updates rank and/or task
  metadata.
- Viewers can view Board cards but cannot add or drag cards.

## Status Group Order

When all statuses are enabled, the Board should render these status groups in
order:

`To Do -> Planning -> In Progress -> In Review -> Blocked -> Done`

## Status Group Membership

| Group | Statuses | Drop target status |
|---|---|---|
| `To Do` | `To Do`, `Triage` | `To Do` |
| `Planning` | `Planning`, `Plan Review` | `Planning` |
| `In Progress` | `In Progress` | `In Progress` |
| `In Review` | `In Review` | `In Review` |
| `Blocked` | `Blocked` | `Blocked` |
| `Done` | `Done`, `Canceled` | `Done` |

## Disabled Status Drop Targets

- A status group first uses its configured drop target status.
- If the configured drop target status is disabled for the project, the group
  uses the first allowed status from its status membership list.
- If no status in the group is allowed, the group can remain visible for legacy
  tasks but is not a drop target.
- A disabled single-status legacy group is visible while tasks remain in that
  status, but dropping into it is disabled.

## Assignee Grouping

Since the assignee/delegation split (OS-1335, see `agents.md`), the Board
groups by EXECUTOR — `delegatedToAgent ?? assignee` — so delegated tasks sit
under their agent's column regardless of owner.

- Assignee grouping renders the full assignable-user set and the project's
  active Project agents, not only entries with visible tasks.
- The first assignee group is `No assignee`; agent groups come next, then user
  groups in the same ordering as the task assignee selector.
- If assignable users are still loading, assigned cards must not disappear; the
  Board can render temporary task-derived assignee groups until the full user set
  is available.
- If a visible task references a user or Project agent outside the assignable
  set, the Board keeps a stale group for that task using the hydrated
  `assignee`/`delegatedToAgent` details returned with the task. Stale agent
  groups are not drop targets.
- Empty user groups remain visible as drop targets.
- Dragging a task into `No assignee` clears both the owner and the delegation.
- Dragging a task into a user group sets that user as owner AND clears the
  delegation.
- Dragging a task into a Project-agent group delegates the task to that agent;
  the owner is kept, or auto-set to the acting user by the server when the
  task has none.
- Ownerless delegated tasks sit in their agent's column while matching
  owner-based "unassigned" filters — expected behavior.

## Priority Grouping

- Priority grouping renders all priority groups, not only priorities with
  visible tasks.
- Priority groups render in high-to-low order:
  `Critical -> High -> Medium -> Low -> None`.
- Empty priority groups remain visible as drop targets.
- Dragging a task into a priority group sets the task priority to that group.

## Task Type Grouping

- Task-type grouping renders all built-in task type groups, not only types with
  visible tasks.
- Task-type groups follow the built-in task type catalog order.
- If a visible task references a task type outside the built-in catalog, the
  Board keeps a legacy task-type group after the built-in groups.
- Empty task-type groups remain visible as drop targets.
- Dragging a task into a task-type group sets `taskTypeKey` to that group.
- V1 task-type grouping still shows root tasks only.

## Label Grouping

- Label grouping renders a leading `No label` group followed by one group per
  project label, in label rank order (label order in project settings = Board
  column order). Labels come from `api.tasks.labels.list`; see
  [task-labels.md](task-labels.md) for the entity rules.
- Empty label groups remain visible — the Board is expected to be built before
  tasks are labeled.
- With zero labels defined, the Board degrades to a lone `No label` group
  holding all visible tasks.
- Dragging a task into a label group sets `labelId` to that label; dragging
  into `No label` clears it. Field and rank apply atomically via the shared
  move path; same-group reorder never touches `labelId`.
- Creating a task from a label group pre-sets that label; from `No label` it
  creates without a label.
- Multi-select drops apply the label to every selected card (shared drop
  mechanism, same as other groupings).
- Cards show the label chip in every grouping, including label grouping (see
  Card Metadata Presentation).
- Label grouping shows root tasks only, matching the other non-status
  groupings.

### Label column reordering (project admins)

- The whole column header of a label column is a drag handle; dragging a
  column reorders the underlying label (persisted via
  `api.tasks.labels.reorder`, so settings and the Board stay in sync).
- A blue vertical drop line marks the boundary where the dragged column will
  land; a small header pill follows the pointer as the drag overlay.
- The `No label` column is fixed first and cannot be dragged; dropping a
  column around it inserts at the start of the label list.
- Column dragging is only available in label grouping and only to members
  with `project:update`.

### Creating labels from the Board (project admins)

- A trailing "+" after the last column (aligned with the column-header add
  buttons) opens a popover with a name input and an extended-palette color
  picker; creating adds the label — and its column — without leaving the
  Board.
- The "+" is disabled with a hint when the 20-label cap is reached, and is
  hidden for members without `project:update`.

### Editing labels from the Board (project admins)

- Hovering (or focusing within) a label column header replaces its task count
  with a pencil button that opens the same label dialog in edit mode, for
  renaming and recoloring the label.
- Only label columns have it: not `No label`, not other groupings, and not for
  members without `project:update`.

## Mobile Layout

- On mobile, the Board shows one column per view, swiped horizontally like a
  gallery: the drag follows the finger, and releasing either snaps back or
  advances to the neighboring column (native CSS scroll snapping, mandatory on
  the x axis).
- A snapped column is centered with a fraction of the previous and next
  columns peeking at the edges; matching empty gutters appear before the first
  column and after the last one so every column centers consistently.
- Mobile columns keep the desktop design (flush columns separated by right
  borders); the first column additionally draws a left border because its
  left edge is exposed by the gutter.
- Desktop keeps fixed-width columns with free horizontal scrolling and no
  snapping.
- On touch devices, a deliberate still hold (~400ms without moving) lifts a
  card for drag and drop, with a short vibration where supported; a finger
  that starts moving sooner pans or swipes natively. "Without moving" is
  forgiving: the hold tolerates the natural drift of a pressed finger
  (~10px), so a lift is not silently cancelled by jitter. A hold anywhere on
  the card lifts it, including on footer controls (type, status, due date,
  priority, assignee) — a quick tap still activates the control. While a
  card is lifted, scroll snapping pauses so edge auto-scroll can move between
  columns, and the browser's long-press behaviors (text selection, callout,
  context menu) are suppressed on cards.
- The Board loading skeleton uses the same responsive column sizing so content
  does not shift when it loads.

## Notes

- On mobile, the shared task-view shell renders one bottom navigation bar
  (menu, search, toolbar, create) for both the Table and Board routes; pages
  report their task detail surface state to the shell, which hides the bar
  while a detail surface is open.
- The mobile toolbar panel covers what the desktop header offers: switching
  between List and Board, Board grouping (on the Board route), "Set as default
  view", members, filters, and Archived. A Settings entry (shown under the
  same developer setting as the desktop header settings menu) opens a drawer
  with the settings-menu items: copy link and column visibility.
- `Backlog` is a system List, not a Board group.
- Disabled statuses should be omitted from normal status groups.
- If tasks still exist in a disabled status, the group containing that status
  should remain visible as a legacy group until the last task leaves it.
- Dragging a task into a multi-status group changes the task to that group's
  drop target status; dragging within a multi-status group is rank-only and
  never rewrites the task's status.
- Multi-status groups should visually expose the task's actual status when it is
  not otherwise obvious.
- When new first-class workflow statuses are introduced, the Board's explicit
  status group configuration must be updated in the same change if it does not
  derive from the shared status source automatically.

## Board rows

Optional horizontal rows split each column into cells. See
[task-board-rows.md](task-board-rows.md).

## Shared list grouping and Owner

List and board grouping share membership and create/drop rules. Owner groups by
the human owner and changes ownership without clearing delegation. See
[task-list-grouping.md](task-list-grouping.md) for grouped lists and list defaults.
Project/List defaults also accept List with a grouping dimension. An absent
list grouping means None. Switching a List default to Board or inheritance
clears its list grouping. Assignee user and No assignee creation explicitly clear
delegation inherited from filters so the new task belongs to the chosen group.
