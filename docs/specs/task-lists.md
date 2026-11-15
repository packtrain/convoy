# Task Lists Specification

This document defines task Lists as project-scoped task containers. It separates Lists from rendering modes and from workflow statuses.

## Scope

- Project task organization into Lists
- Project Lists
- Required/default project List behavior
- Backlog system List behavior
- System List target model for Archived
- Task movement between Lists
- Archived compatibility behavior pending OS-908
- Table-first rendering for Lists

## Terminology

- `List`: a project-scoped task container that owns task membership and task order.
- `Table`: a rendering mode that shows tasks in rows.
- `Board`: a future rendering mode that shows tasks in Board groups.
- `Inbox`: the required initial project List.
- `Backlog List`: the built-in deferred-work List in the target model.
- `Archived List`: the built-in removed-from-active-planning List in the target model.
- `Status`: a workflow state such as `To Do`, `In Progress`, `Done`, or `Canceled`.

`List` must not be used as the canonical name for the table rendering mode. Product language should use `Table` and `Board` for rendering modes.

## Target Model

- Every task belongs to exactly one List in the target model.
- A task has one `rank`, interpreted within its current List.
- `taskLists` stores project Lists, including the required initial `Inbox` List.
- Every project has a project-wide default List.
- `Inbox` is created with each project and starts as the project default List.
- The project default List can later be changed to another active List, such as `Sprint 10`.
- Tasks created without an explicit List use the project default List.
- System containers in the target model:
  - `Backlog`
  - `Archived`
- Persisted Lists are project-scoped containers stored in `taskLists`.
- `Backlog` is not a status in the target model.
- `Done` and `Canceled` remain statuses, not Lists.
- Moving a task between Lists creates task activity history.
- Previous List names are not stored as task tags.

## Phase 1A: Project Lists

Phase 1A introduced persisted project Lists and selected-List task behavior.
OS-907 moves Backlog into the system List model; archived behavior remains
compatibility behavior pending OS-908.

- Prerequisite cleanup: rename the canonical all-tasks filter value from `board` to `all`.
- Add `taskLists`, optional task List keys, and List selection.
- `projects.defaultListId` stores the current project default List.
- New projects create an Inbox List and set it as `projects.defaultListId`.
- Existing projects and eligible active tasks are backfilled through the
  OS-842 migration slice.
- New active tasks without an explicit List use `projects.defaultListId`.
- Backlog is represented by `listKey = system:backlog`, not task status.
- Existing archive behavior remains source of truth for current archived behavior.
- The project header Lists dropdown shows `Backlog` as a system List entry and
  keeps `Archived` as compatibility navigation until OS-908.
- Task List membership is optional only for remaining legacy/archive compatibility data.
- Tasks without List membership continue to be interpreted through current behavior:
  - archived tasks follow existing archive behavior
  - unarchived active tasks with no List membership are legacy data and should be migrated to the project default List
- Current task state cannot use `Backlog` as a workflow status.
- Archived tasks may retain their persisted List membership when they were
  already assigned to a List before archiving. Task archiving still does not
  move tasks into or out of persisted Lists in Phase 1A.

## System List Migration

Backlog is introduced as a system List in OS-907. Archived system List behavior
is deferred to OS-908. Inbox is not a hardcoded system key; it is a persisted
List row and starts as each project's default List.

- Backfill remaining legacy task containers:
  - legacy `status = Backlog` tasks -> `system:backlog` with workflow status
    restored during the completed OS-907 migration
  - archived tasks -> `system:archived` (deferred to OS-908)
  - persisted List tasks keep their `list:<taskListId>` key
- Making the task List key required must follow a widen-migrate-narrow migration.
- Use the Convex migration helper workflow for backfill and verification.
- Do not rely on long-term dual writes as the migration strategy.
- After migration, task reads and writes use List membership as the source of truth.
- Moving into or out of the Backlog List changes List membership only; workflow
  status is not restored or altered by List movement.

## Data Model

### Project Lists

`taskLists` stores project Lists. Inbox is a persisted required List row created with each project. Backlog and Archived remain system containers in the target model unless a later spec changes them to persisted Lists.

Required fields:

- `projectId`
- `name`
- normalized name for case-insensitive uniqueness
- stable `ref` for MCP/CLI and URL-friendly references
- optional `color` for UI display
- optional per-List default view override (`defaultViewMode`, and
  `defaultBoardGroupBy` and `defaultBoardRowGroupBy` when it is `board`,
  `defaultListGroupBy` when it is `list`); absent mode means the List inherits the
  project default view. See
  [task-kanban-status-columns.md](task-kanban-status-columns.md) → Default View
  and [task-list-grouping.md](task-list-grouping.md) for grouping validation
  and storage defaults.
- created/updated audit fields
- deletion/archive state for non-required Lists

List names are unique within a project case-insensitively. The Inbox name is created by default and therefore naturally reserved in new projects.

A project can have at most 20 active Lists, including the project default List.
Creating another active List is blocked with user-facing warning copy until an
existing active List is archived. Active List navigation loads this bounded set
up front so the current default List is always available for name/color display.

List refs are project-scoped human-readable identifiers. MCP and CLI inputs should accept a List by raw document ID or by List ref, matching the existing task ID/ref pattern.

List refs use uppercase slug-like formatting. This follows the existing uppercase project alias and task ref convention (`ABC`, `ABC-123`) rather than the lowercase organization slug convention.

Examples:

- `INBOX`
- `SPRINT-10`
- `Q2-LAUNCH`

List refs are integration-facing. Renaming a List keeps the existing ref by default. Changing the ref is a separate explicit action with warning copy that saved MCP/CLI commands, URLs, or external references may break.

List ref collisions fail with a user-facing error. The system must not auto-suffix refs such as `SPRINT-10-2` without user intent. On create, the UI may suggest a ref generated from the List name, but if that ref collides the user must choose a different ref. On edit, renaming a List keeps the existing ref unless the user explicitly changes the ref.

The reserved system List refs `BACKLOG` and `ARCHIVED` cannot be used for
persisted project Lists. They are reserved for the current compatibility rows
and future system List containers.

List ref format:

- uppercase letters, numbers, and single hyphen separators
- starts with a letter
- ends with a letter or number
- no consecutive hyphens
- length: 2-32 characters
- validation shape: `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$` plus max length check

List color is optional UI metadata. A List without a color renders with the
same muted circle icon as Inbox. A List with a color renders that same circle
icon using the selected color. List color does not affect sorting, search,
permissions, MCP text output, task payloads, task search payloads, or task
movement behavior.

When set through public mutations, List color must be one of the supported
extended palette values selected by the UI:
`#fca5a5`, `#fdba74`, `#fde047`, `#86efac`, `#5eead4`, `#93c5fd`,
`#c4b5fd`, `#f9a8d4`, `#ef4444`, `#f97316`, `#eab308`, `#22c55e`,
`#14b8a6`, `#3b82f6`, `#8b5cf6`, `#ec4899`, `#b91c1c`, `#c2410c`,
`#a16207`, `#15803d`, `#0f766e`, `#1d4ed8`, `#6d28d9`, or `#be185d`.

`projects.defaultListId` stores the project-wide default List. The current default List cannot be deleted or archived until another active List is selected as the default.

A project must have at least one active List. The system must prevent archiving or deleting the last active List in a project, even if that List is otherwise non-required and empty.

### Task Container Key

Tasks store their container using an internal List key.

Canonical key shapes:

- `system:backlog`
- `system:archived`
- `list:<taskListId>`

Phase 1A:

- the task List key is optional for legacy/archive compatibility
- persisted Lists write `list:<taskListId>`
- Backlog writes `system:backlog`

Target model:

- every non-deleted task has a List key

Implementation must centralize List key construction and parsing. UI/API code should not concatenate or parse raw List key strings directly.

Boundary payloads should expose structured List references, not raw List keys:

```ts
type TaskListRef =
  | { type: "system"; key: "backlog"; ref: "BACKLOG"; name: "Backlog" }
  | { type: "list"; id: Id<"taskLists">; ref: string; name: string };
```

## MCP And CLI Contract

MCP and CLI APIs should expose Lists using the same ID-or-ref ergonomics as tasks.

- MCP task tools use the argument name `listId` for List lookup inputs. The value
  may be either:
  - raw List document ID
  - project-scoped List ref
  - the reserved system List ref `BACKLOG`
- Task operations resolve the project first, then resolve List identifiers inside that project.
- List refs in task operations are bare project-scoped refs only, such as `SPRINT-1`.
- Scoped List ref strings such as `OTHER/SPRINT-1` are not accepted in `create_task` or move operations.
- Raw List IDs are accepted only if the List belongs to the resolved project.
- Task payloads include structured List information. Persisted Lists include
  `id`, `ref`, `name`, and default/archive metadata. Backlog uses
  `{ type: "system", key: "backlog", ref: "BACKLOG", name: "Backlog" }`.
- `create_task` accepts optional `listId`.
- If `create_task` omits `listId`, active tasks are created in the project default List.
- `list_tasks` without `listId` reads the project default List. If
  `list_tasks` receives `listId`, it lists tasks from that List.
- `search_tasks` searches project-wide active tasks across Lists by default.
- `search_tasks` accepts an optional List identifier to constrain search to one List.
- Archived search remains explicit via archive mode/filter.
- MCP exposes `list_task_lists` so agents can discover available Lists.
- `list_task_lists` returns active Lists by default, accepts `archived: true`
  for archived discovery, and supports pagination/search.
- MCP exposes `move_tasks_to_list` for moving existing tasks into an active
  persisted List or the Backlog system List. The target `listId` accepts a raw
  ID, bare ref, or `BACKLOG`.
- MCP exposes `create_task_list` and `update_task_list` for List management
  (create, rename, re-ref, recolor, set default view). Archive, unarchive,
  delete, and default-List changes remain UI-only pending OS-896.
- `create_task_list` and `update_task_list` accept optional `defaultViewMode`
  (`list` | `board`) and `defaultBoardGroupBy`. On `update_task_list`,
  `defaultViewMode: null` clears the override so the List inherits the project
  default view again.
- `list_task_lists` rows carry the stored default-view fields, including
  `defaultBoardRowGroupBy`, only for Lists that override the project default;
  the Backlog row never carries them.
- CLI exposes `convoy lists list` for List discovery.
- CLI exposes `convoy lists create` and `convoy lists update <list>` for
  List management, mirroring the MCP tools (`--clear-color` clears the color,
  `--clear-default-view` clears the default view override). Both commands take
  `--default-view <list|board>` and `--board-group-by <field>`; passing
  `--default-view` together with `--clear-default-view` is rejected, as is
  `--board-group-by` without `--default-view board` (it would silently do
  nothing).
- `convoy lists list` marks an overriding List with a trailing
  `[list]` / `[board:<groupBy>]` hint and exposes the raw fields in JSON output.
- MCP/CLI List management accepts raw List IDs or bare project-scoped refs;
  scoped refs containing `/` and system Lists (`BACKLOG`) are rejected.
- CLI task commands mirror MCP List resolution rules through `--list`.
- CLI task creation without `--list` uses the project default List for active tasks.
- CLI task listing without `--list` reads the project default List. If `--list`
  is provided, it lists tasks from that List.
- CLI task search searches project-wide active tasks unless `--list` is provided.
- CLI exposes `convoy tasks move-to-list <taskId|ref...> --list <list>` for
  moving 1-25 roots in one direct Convex mutation. The target accepts a raw
  List ID, bare ref, or `BACKLOG`.
- The CLI resolves task identifiers first and then calls `tasks.core.move.toList`
  once; it does not loop over one mutation per task.
- CLI has no per-session selected List state in v1.
- OS-842 must update MCP/CLI List payloads and text output to expose the real
  default marker once `projects.defaultListId` is live.
- List refs are unique within a project and are enforced transactionally by create/rename mutations using indexed normalized lookups.
- The uniqueness guarantee is application-enforced through Convex mutations, not a database-level unique constraint.

## List Ordering

- Persisted Lists are ordered by `taskLists.rank` (LexoRank-compatible string).
- Project Settings -> Lists is the only UI where users can reorder Lists.
- All active persisted List rendering surfaces consume the same rank order,
  including the project header selector, task sidebar/row List pickers, move
  menus, MCP `list_task_lists`, and the pinned sidebar.
- Existing Lists are seeded from the pre-OS-1189 visible order during
  migration: the project default List is seeded first for active Lists, with
  the remaining active Lists in `normalizedName` order. After seeding, rank
  fully controls order, including the default List's position.
- Search behavior differs by surface: picker searches filter the already-loaded
  rank-ordered active List set locally, while Project Settings search uses the
  full-text search index and may return relevance order.
- Searchable List dropdowns and move-to-List menus focus the search field when
  opened. `ArrowDown` and `ArrowUp` move through enabled List targets, and both
  `Enter` and `Space` select the focused target. Printable search keys do not
  reach menu typeahead, so multi-character queries keep focus in the search
  field. The field renders one product clear action, without a second native
  search cancel control.
- Backlog appears as a system List target. Archived keeps special
  navigation/visual behavior until OS-908.

`Archived` may be hidden from normal active List navigation even though it is a system List in the target model.

## List Management UI

- Lists are managed in the top-level `Lists` section of project settings, not
  under `Customization`.
- In project settings, the List toolbar renders the search input, active/archived filter, and `New list` action on one row.
- The active/archived filter appears on the left immediately after the search input, and `New list` stays at the end of the row.
- Active, unfiltered Lists expose drag handles for users with `list:manage`.
  Drag reorder is disabled in archived view, while search filtering is active,
  and for users without List management permission.
- The List create/edit dialog lays out Name (with the color swatch) and Key on
  one row, followed by a `Default view` selector. Its first option,
  `Project default`, means "inherit" and clears any stored override. The rest
  sit under non-selectable `List` and `Board` group headers: `No grouping` and
  `by X` under List, `by X` under Board. The closed trigger shows the full
  name, e.g. `List (by Status)`.
- The project header settings dropdown and the mobile toolbar panel expose two
  flat sibling actions next to the project-scoped `Set as default view`:
  `Set as default view for "{List}" only` (needs `list:manage`) and
  `Reset "{List}" to project default` (only when an override exists). Both are
  hidden for Backlog and Archived.
- Lists can be pinned to the project sidebar by admins; archiving or deleting a
  List removes its pin. The Backlog system List is also pinnable (pin state
  lives on the project document since it has no List row). See
  [project-sidebar-pinned-lists.md](project-sidebar-pinned-lists.md).

## Task Ordering

- `rank` is scoped to the task's current container.
- Moving a task between containers recalculates the moved root rank in the target container.
- Moved root tasks land at the top of the target container.
- Bulk moves preserve the selected roots' relative order from the source view.
- Descendants keep their relative child order when their subtree moves.

## Hierarchy Rules

- A parent task and its descendants must belong to the same List.
- Moving a parent task to another List moves all descendants with it.
- Moving a child task to another List detaches it from its old parent, makes it a root task in the target List, and moves its descendants with it.
- Moving a subtree assigns a new target-container rank only to the moved subtree root.
- Descendant ranks remain scoped under their parent and keep relative order.

## Bulk Move Rules

V1 supports moving selected tasks to an existing active persisted List or the
Backlog system List. The move flow does not create Lists; users create Lists
through the project header or settings List management UI first.

- The frontend sends moved root task IDs in one request.
- The target is passed as a List ref and resolved project-scoped on the server.
- Callers must normalize selection to moved roots before calling the mutation.
- If both a parent and descendant are sent as moved roots, the server rejects the move as overlapping roots.
- No client-side N-request loop is allowed.
- The move picker shows active persisted Lists and Backlog. It does not show
  Archived or an inline create action.
- Moved roots land at the top of the target List.
- Bulk moves preserve selected root relative order.
- Moving a child task to another List detaches it from its old parent and
  preserves the moved subtree under that child.
- Moving into or out of Backlog changes List membership only. It does not alter
  workflow status and does not cascade status changes.
- Task tags are not modified by List moves.
- List moves clear task sections unless the move picks a destination section;
  see [task-sections.md](task-sections.md#moving-between-lists).
- List moves create one activity log entry per task whose List membership changes.
- Activity for moving into Backlog renders the next location as `Backlog`.
- The task right-click context menu also exposes a direct **"Move to backlog"**
  shortcut (labelled **"Move selected to backlog"** in multi-selection scope)
  above the "Move to" submenu. It moves the task/selection to the Backlog system
  List in one click and is hidden when the task/selection is already in Backlog.

### Move Active Tasks To A List (OS-891)

The task list header dropdown (task-name column actions) offers a **"Move active
to"** action that moves every active top-level task in the current view to a
chosen List.

- "Active" means top-level (root) tasks whose status is not closed
  (`Done`/`Canceled`). Subtasks are never selected directly; each active root
  moves with its whole subtree (standard `move.toList` behavior).
- The action is only enabled in the active (non-archived) view with no status or
  assignee filter applied, so it always operates on the whole list, and only
  when at least one active root task exists.
- The selected roots are dispatched to `move.toList` in **client-side chunks**
  (15 roots per call) so each move is its own small transaction. This is the one
  intentional exception to "no client-side N-request loop", scoped to this
  whole-list carry-over action (e.g. sprint rollover).
- Progress is shown via a single updating toast; rows leave the source view
  chunk by chunk through the existing optimistic update.

Deferred:

- Move all tasks matching the current filtered view to another List.
- Server-side operation accepts source List plus filters and resolves matching tasks.
- Filters include status, assignee, search, and future filter dimensions.
- Large matching sets must account for Convex transaction limits with batching or scheduling.
- Backend background-scheduled batching of `move.toList` itself (frontend
  chunking is sufficient for now).

## Creation Rules

- New tasks are created in the selected List when a List is selected.
- Sidebar and mobile quick-create inherit the selected List, including Backlog,
  and preserve that List in the created task's deep link.
- If quick-create switches to a different project, the source project's List is
  not carried over; the target project's default List applies.
- If no List is selected, new tasks go to the project default List in the target model.
- When Backlog is selected, new tasks are created with `listKey = system:backlog`
  and a normal workflow status.
- New tasks cannot be created directly in the Archived List.
- Creating a task cannot use `status = Backlog`.

## Backlog System List

- Backlog uses reserved public ref `BACKLOG` and internal key `system:backlog`.
- `filter=backlog` is not a supported Backlog selector.
- `status: "Backlog"` is an invalid API payload.
  Clients select Backlog through `listRef: "BACKLOG"` / `list=BACKLOG`.
- Status selectors and status filters do not include Backlog.
- Moving a subtree to Backlog assigns `system:backlog` to every moved task and descendant.
- Moving a subtree out of Backlog assigns the target persisted List key to every moved task and descendant.

## Archived Behavior

Archived has special visual and interaction behavior.

Phase 1A:

- Existing archive behavior remains source of truth.
- Archived tasks cannot be assigned to persisted Lists.
- Creating tasks in archived view is disabled.

Target model:

- Archiving means moving a task to the Archived List.
- Unarchiving defaults to the project default List.
- UI may offer a future `Restore to...` action to choose another target List.
- Archived may stay behind an archive-specific control rather than appearing in the normal List selector.

## Filters

- Status, assignee, and search filters apply within the selected List.
- Drag reorder under filters follows the filtered-view reordering rules in
  `task-table-drag-and-drop.md`: enabled in every status/assignee view (the
  client loads the full rank container, so bounds use every sibling); only a
  column sort disables reorder.
- Closed-only status filters (`Done`, `Canceled`, or both) in project task List
  results show matching top-level tasks only. This applies to default List reads,
  persisted List reads, and API callers. Matching subtasks remain available
  through their parent-scoped subtask tables and must not be promoted into root
  rows when their parent is not part of the filtered result set.
- The normal/default task table shows active tasks assigned to
  `projects.defaultListId`.
- Persisted List views show tasks assigned to the selected List.
- Backlog views show tasks assigned to `system:backlog`; Archived continues
  using archive-mode view logic until OS-908.

## URL State

- The selected List is encoded as a project route query parameter: `?list=<LIST_REF>`.
- The selected Board grouping is encoded as `?groupBy=<GROUPING>` on Board
  routes.
- Missing `groupBy` means status grouping.
- Board grouping URL state is separate from status and assignee filter URL
  state.
- The selected List is not encoded as a path segment in v1.
- Project task table URLs should include an explicit `list` parameter once Lists are enabled.
- If `list` is missing, the route uses the current project default List without
  canonicalizing to a List ref.
- If `list` is invalid, the route clears `list` and falls back to the project
  default List.
- If `list` references an archived persisted List, the route keeps the selected
  List and renders tasks that still belong to that List. The header labels the
  selected List as archived, but normal active List picker discovery continues
  to hide archived Lists.
- Future URL canonicalization to the default List ref is allowed but deferred.
- If `task` is present, task resolution is project-scoped and not constrained by the URL List.
- In v1, if the selected task's current List differs from the URL List, the app still renders the URL List and opens the task in the sidebar.
- Automatic canonical correction from URL List to task current List is deferred.
- Search-result navigation is explicit rather than automatic: active results link to their owning List and task, while archived results link to the archive view and task. This applies to header, Cmd+K, and mobile search surfaces.
- Opening a task preserves the current `list` query param.
- Closing task details removes `task` and `artifact` but preserves `list`.
- Opening an artifact preserves `list`.
- Switching Lists clears `task` and `artifact`.
- Switching Lists preserves status and assignee filters.

## List Selector

- Lists are selected through a dedicated List selector control.
- The List selector is separate from the status/assignee Filter control.
- In the project header, controls are ordered as rendering mode, then List selector, then Filter.
- The Filter control continues to own status and assignee filters.
- The List selector includes the project default List, Backlog system List,
  persisted Lists, and Archived compatibility entry. Selecting Backlog sets
  `list=BACKLOG`.
- Header List selector rows are link-backed navigation targets. Middle-click,
  Cmd/Ctrl-click, and browser link actions on persisted Lists plus the
  default, Backlog, and Archived entries open the
  corresponding project List view in a new tab/window. Plain left-click keeps
  the current dropdown selection behavior.
- After OS-842 activation, the first selector entry represents the current
  project default List and renders that List's current name/color. It is not a
  hardcoded Inbox label. Selecting it clears the `list` URL parameter.
- Selecting a List applies that List's own default view when it has one,
  falling back to the project default. This holds for plain left-click and for
  the link-backed rows, so opening a List in a new tab lands on the same view.
  The default-List entry resolves its override through the project's
  `defaultListId`, not by ref; Backlog and Archived inherit the project default.
- Active non-default Lists expose a `Set as default` action in the header
  selector and project settings List management UI. The action asks for
  confirmation and names the List that will become the default. Setting a
  default changes future empty-selection reads/creates; it does not move
  existing tasks.
- One selector component serves both breakpoints, with one trigger: the pill is
  identical on mobile and desktop (same label, styling, and states — no
  mobile-only affordances). Below `md` the pill renders in the mobile task-views
  header at the right edge, immediately left of the `Filters` button (spec:
  docs/specs/mobile-bottom-nav.md), and opens the same shared List picker in a
  draggable bottom sheet (`MobileSheet`) instead of the popover menu. System entries,
  link-backed rows, and `?list=` URL effects are identical across both
  presentations. Sheet-specific behavior:
  - The sheet extends to the bottom of the screen, so the floating mobile nav
    bar overlaps it. The List viewport carries the nav-bar clearance as
    trailing scroll padding (inside the scroll area, not as sheet padding), so
    the last List row can always be scrolled clear of the bar and tapped.
  - Vertical drags inside the picker scroll the List instead of dragging the
    sheet closed (`data-vaul-no-drag`); the top handle stays the drag
    affordance.
  - The List rows fill the sheet height instead of the 17rem menu viewport. The
    search row and the system entries stay pinned; only the persisted List rows
    scroll.
  - The search input is not auto-focused, so the on-screen keyboard does not
    cover the sheet on open.
  - The sheet is a selection surface: per-row management actions (rename,
    archive, delete, pin, set as default) and the Backlog pin control are not
    offered there, since touch has no hover to reveal them. Creating a List
    stays available; management lives in project settings.
  - Closing the sheet resets the List search query, matching the desktop
    dropdown.
- The shared List picker used by the project header and task-details sidebar
  limits persisted List rows to a 17rem scroll viewport. With compact row
  spacing, an overflowing picker leaves roughly half of the next row visible
  at the bottom so users can discover that more Lists are available by
  scrolling.
- Backlog List choice belongs to the List selector and task filtering belongs
  to the Filter control within the selected List.

## Table And Board Rendering

V1 is Table-first.

- List Table view shows tasks in rank order within the selected List/container.
- Existing task drag-and-drop updates the task rank within the selected container.
- Board rendering for Lists is deferred.

Target Board behavior:

- User selects a List, which opens that List's default view (its own override,
  otherwise the project default).
- V1 Board is available for active Lists, including the project default List,
  active persisted Lists, and the Backlog system List.
- V1 Board is intentionally unavailable for Archived tasks.
- Backlog Board support should not require a special data-model path.
- Board grouping is separate from task filtering.
- Board groups organize visible tasks within the selected List.
- When grouped by status, Board groups represent one or more statuses.
- Dragging between Board groups changes the field represented by the active
  Board grouping and updates the same List-scoped rank used by Table.
- Dragging within a Board group updates the same List-scoped rank used by Table.
- Board does not store a separate ordering model from Table.

## Permissions

- Lists are project-wide shared objects, not personal views.
- Users who can view project tasks can view Lists.
- Creating, renaming, archiving, unarchiving, deleting Lists, or setting a
  List's default view requires `list:manage`. This is deliberately looser than
  the project-wide default view, which requires `project:update`.
- During OS-853, `list:manage` is granted to `project-admin` and `member`, but not `viewer`.
- Without `list:manage` the UI offers none of these: List rows in the header
  picker and the sidebar have no `...` menu or pin button, and the picker has no
  create row ([read-only-viewer-ux.md](read-only-viewer-ux.md#settings-sidebar-and-mobile-chrome-slice-6-os-1546)).
- Moving tasks between Lists requires task update permission.
- Required/system Lists cannot be deleted.
- The project default List cannot be deleted or archived until another active List is selected as default.
- Non-default Lists can be archived even when tasks still belong to them; task
  membership and order are preserved.
- Non-required Lists can be deleted when they have no active tasks. Archived
  tasks do not block deletion: they keep their stale `listKey` and their List
  metadata renders as a removed List ("Deleted list") in task payloads and UI
  (MCP task summaries surface it as no List membership). Unarchiving such a
  task self-corrects its membership to the project default List.

## Activity

- Moving a task between Lists records task activity.
- List move activity records previous and next List references.
- If the previous List row was deleted, activity renders the previous location
  as a removed List rather than Inbox.
- List move history is not stored as task tags.

## Acceptance Checks

- User can create a List with a project-unique name.
- User cannot create `Sprint 1` and `sprint 1` in the same project.
- User cannot create more than 20 active Lists in one project.
- New projects create an Inbox List and set it as the project default List.
- Persisted Lists appear in `taskLists.rank` order. Migration seeds the default
  List first for existing projects, but user sorting can later move it.
- The project default List cannot be deleted or archived.
- User can move selected tasks to an existing List in one server operation.
- Move-selected UI targets existing active persisted Lists and Backlog.
- Moving a parent task moves all descendants.
- Moving a child task detaches it from its old parent and moves its subtree.
- Moved roots land at the top of the target container.
- Bulk moves preserve selected root relative order.
- Tasks outside the project default List do not appear in the default List table.
- Current task state cannot have `status = Backlog`.
- Archived tasks cannot be assigned to persisted Lists during Phase 1A.
- Moving into or out of Backlog does not alter workflow status.
- Task tags are not modified by List moves.
- List moves create activity log entries.
- A List with no default view override opens in the project default view.
- Clicking the sidebar project row opens the project's default List in that
  List's default view, not the project-level one.
- A List whose override is Board opens on the kanban route with its grouping,
  even when selected from a Table view.
- A List explicitly set to `List` opens on the Table route even when the project
  default is Board.
- Clearing a List override returns that List to the project default view.

## Test Coverage

Backend tests should cover:

- List create/rename/delete validation
- case-insensitive List name uniqueness
- default List protection
- permission checks
- move selected tasks to List
- caller-side moved-root normalization for bulk moves
- subtree movement and child detach behavior
- rank recalculation in target container
- Backlog system List transitions
- archived assignment rejection in Phase 1A
- activity log creation
- project isolation

Frontend tests should cover:

- Table/List terminology in navigation
- List selector ordering
- move-selected UI flow
- no inline create-List row during move flow
- Backlog absent from status selection
- archived visual/interaction separation

Migration tests should cover:

- optional task List key handling for legacy/archive compatibility
- backfill project Inbox Lists and `projects.defaultListId`
- backfill normal active tasks to the project default List
- backfill active legacy `status = Backlog` tasks to `system:backlog`
- verification that no active legacy Backlog-status tasks remain
- verification that active Backlog subtasks do not have parents outside Backlog
- backfill mapping to `system:archived` when OS-908 lands
- verification before narrowing List key to required

## OS-842 Default Inbox Backfill Runbook

After deploying the Phase 2 migration code, run the default Inbox backfill
manually. Do not switch no-list reads or creates to `projects.defaultListId`
until verification passes.

1. Dry run:
   `cd apps/web && npx convex run migrations:runAll '{"dryRun": true}'`
2. Execute:
   `cd apps/web && npx convex run migrations:runAll`
3. Watch status:
   `cd apps/web && npx convex run --component migrations lib:getStatus --watch`
4. Verify:
   `cd apps/web && npx convex run migrations:verifyDefaultListBackfill`
5. After deploying Phase 3 activation, run steps 2 and 4 once more to catch
   tasks created between the Phase 2 backfill and Phase 3 deploy.

## OS-907 Backlog System List Backfill Runbook

The OS-907 Backlog status migration and final legacy task-state cleanup have
completed in production. The narrowed schema no longer includes
`statusBeforeBacklog` and no current task can store `status = "Backlog"`.

The active read-only follow-up check is Backlog subtask parent/List
consistency:

1. Verify Backlog subtask parent/List consistency:
   `cd apps/web && npx convex run migrations:verifyBacklogSystemListParentConsistency`

`verifyBacklogSystemListParentConsistency` is read-only. If it returns
`splitBacklogSubtaskIds`, inspect those tasks: they are active Backlog subtasks
whose parent is missing, archived/deleted, or not also in Backlog. If
`truncated` is `true`, rerun with a higher `scanLimit` or investigate before
treating the result as complete.
