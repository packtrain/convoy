# Task list grouping

OS-2136 adds presentation grouping to the task list. None remains the default.
The list offers Status, Assignee, Owner, Priority, Type, Label and Section
([task-sections.md](task-sections.md)).
The settings dropdown exposes these as a Group by icon row with No grouping;
board grouping uses a Columns by icon row. Icons keep the current layout.
Layout switching remains in the page header. The board
also offers Owner. Both views share group membership, order, empty groups,
creation defaults and drop updates with the existing board rules.

Assignee uses the delegated agent when present, otherwise the human owner.
Owner always uses the human owner. Moving to an Owner group changes only the
owner and preserves delegation. No owner explicitly clears the owner.
Group-local creation passes the chosen Owner explicitly, including null, so an
agent filter cannot override it or trigger automatic owner assignment. Assignee
groups override any draft assignment input inherited from filters.

Root tasks determine the group. Expanded subtasks remain under their parent,
with their existing depth and fields. Filters retain the existing table tree
rules. Headers are separate from task rows and never count as selectable tasks.
Headers use the standard 44px task-row height and the same 20px expand control
with a 16px chevron as task rows. Headers expose collapse only. Each expanded,
creatable group ends with the standard "Add task..." input, including empty
groups. There is no global add row while grouping is active. Enter or blur
commits once; Escape clears the draft. New tasks append after the last visible
task in their group. Grouped task titles and creation rows keep their ungrouped
indent; groups add no extra indent.
While a grouping's assignees, labels or sections load, the list shows its
loading skeleton instead of putting every task in the empty group.
Priority groups run Critical, High, Medium, Low, None in both views. Collapse is stored
per user, project, List and grouping in browser preferences.

The task-name header dropdown offers "Collapse all". The mobile task-list menu
has the same action. It clears all task expansion, including nested tasks hidden
under collapsed parents, and collapses every group in the current grouping,
including empty groups. Reopening a group leaves its tasks collapsed. Group
collapse uses the same scoped browser preferences as individual toggles. The
action also works without grouping and in archived lists; it changes no tasks.

Group-local creation applies the group value and normal filter defaults. Drops
on headers move to the start of the group, and drops on a group's "Add task..."
footer move to its end, with a blue line at the top of the footer (OS-2156).
Before/after root-row drops use the target group.
Within a group, status bucket moves preserve the actual status. Center drops
retain the existing subtask behavior. Rank bounds come from the full List,
including filtered-out tasks. Grouping introduces no separate ranks or sorting.
Viewers cannot create or move tasks; existing server task permissions apply.

`listGroupBy` stores the list grouping in the URL, separately from board
`groupBy`. Missing or invalid list grouping means None, or Section when the List has
sections ([task-sections.md](task-sections.md#grouping)); choosing No grouping
writes `listGroupBy=none`. Task details, filter changes and board round trips
preserve it. Switching from the board with no `listGroupBy` applies the
default list grouping. A project stores its list and board groupings
together; a List override stores only its own mode's grouping (see
[task-kanban-status-columns.md](task-kanban-status-columns.md#default-view)).
Existing default-view permissions apply. Switching views never changes tasks.

List create/update mutations reject `defaultListGroupBy` unless the same call
sets `defaultViewMode: "list"`, and reject `defaultBoardGroupBy` unless it sets
`defaultViewMode: "board"`. Missing, null or mismatched modes cannot silently
discard grouping arguments. The domain enforces this for both direct and MCP
callers, using errors `defaultListGroupBy requires defaultViewMode: list in the
same call` and `defaultBoardGroupBy requires defaultViewMode: board in the same
call`.

Creating or updating a list-mode override without a grouping stores explicit
`"none"`. Legacy missing grouping fields still resolve to None; unrelated edits
do not backfill them. Clearing the view override removes grouping fields.
MCP grouping allowlists derive from the corresponding validators.


Desktop uses virtualized table rows. Mobile uses the existing card presentation.
Headers remain visible for empty groups. Archived pages may be grouped but
cannot create or drag; pagination must remain available when groups collapse.

Sections are specified in [task-sections.md](task-sections.md). Horizontal
board rows are specified in [task-board-rows.md](task-board-rows.md).

Enter-created drafts remain beside their anchor inside the same group, including
after its last task. Committing uses that group's creation defaults and explicit
assignment options. Outdenting a draft to root preserves its anchor's group.

Plain Up/Down navigation crosses group boundaries. Up expands the preceding
nonempty group and focuses its last navigable task; Down expands the following
nonempty group and focuses its first task. Filters and existing subtask expansion
still apply. Scroll the destination into the virtual window before focusing it
on the same keypress. Modifier shortcuts retain their existing behavior.
A `?task=<REF>` deep link likewise expands the collapsed group holding the task;
see `docs/specs/task-deep-links.md`.

Mobile group headers and creation footers span the content width. Adjacent
headers have no vertical gaps. Cards use the normal mobile inset;
creation uses a compact 12px inset and 14px text matching
task titles and group labels. Desktop typography is unchanged. The last card before
a creation footer has no bottom padding, so the input's spacing above and below
is balanced. Other card gaps remain unchanged. Touch drops on group footers
move to the end of the group, like desktop drops. Recognized but unavailable group drops remain
consumed and explain their refusal.

Group expansion uses an interruptible React transition. Repeated presentation of
the same input rows reuses the row array so unrelated renders do not rebuild the
table model. Fixed-height group expansion must not clear virtualizer measurements
or trigger a second measurement update. Only changes to custom-height section
rows require explicit invalidation. Row keys, estimates and the scroll-element
callback stay stable while their inputs are unchanged.

Task rows use a native completion checkbox to avoid mount-time control updates.
Closed tasks retain the filled primary-color circle and contrasting checkmark
in both light and dark themes. The dark unchecked background must not override
the checked fill.
Status, type, priority and assignee menus initially render accessible buttons;
the overlay implementation mounts on first open and remains mounted afterwards.
First activation preserves keyboard opening, pointer drag suppression, disabled
controls and focus return after closing. Hidden optional columns do not mount
their controls.
The first keyboard open focuses the first enabled menu item. Radix's menu root
normally learns input modality from the opening key event; a deferred root must
preserve that modality when it mounts after the event.

Desktop row controls must not schedule a second render just to resolve the same
desktop layout after mounting. Due-date controls select the current viewport
immediately when expanded rows mount; see `task-due-date-picker.md`.
