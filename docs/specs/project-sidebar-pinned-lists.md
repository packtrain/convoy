# Project Sidebar Pinned Lists Specification (OS-978)

Admins can pin project Lists to the sidebar so any member can jump straight to
a List without going through the project's default view.

## Scope

- Backend: `apps/web/convex/tasks/lists.ts` (`api.tasks.lists.{pin, unpin,
  pinSystemList, unpinSystemList, listPinnedSystemListKeys,
  listPinnedForOrganization}`).
- Sidebar: `apps/web/components/blocks/sidebar/nav-projects.tsx`
- Pin actions UI: `apps/web/components/blocks/project/task-lists/task-list-row.tsx`
  via `task-list-management.tsx`
- Related specs: [task-lists.md](task-lists.md),
  [permissions-system.md](permissions-system.md),
  [project-sidebar-actions.md](project-sidebar-actions.md)

## Storage Model

- Persisted Lists: pin state lives on the `taskLists` row: `isPinned`,
  `pinnedAt`, `pinnedBy` (all optional; absent means not pinned).
- System Lists (Backlog): system Lists are virtual and have no `taskLists` row,
  so their pin state lives embedded on the owning project document in
  `projects.pinnedSystemLists` — an array of `{ key, pinnedAt, pinnedBy }`
  (`key` is the stable system-List key, e.g. `"backlog"`). The array is tiny and
  bounded by the system-List catalog, so storing it on the project doc is safe.
- Pins are per project, not per user: pinned Lists render the same for every
  project member.
- Pin order: system Lists (Backlog) always render at the **top** of the group,
  in their own chronological pin order, followed by persisted pins in
  shared List order (`taskLists.rank` ascending, pre-sorted by the
  `by_project_and_isPinned_and_rank` index). Pinning records `pinnedAt` for
  audit/history, but persisted pin display order follows the List rank set in
  Project Settings -> Lists.

## Permissions

- Pinning and unpinning require `list:pin` (`ProjectPermission.LIST_PIN`),
  granted only to `project-admin`. An org owner/admin needs that project role;
  org role alone does not grant it (OS-1536).
- `list:pin` is intentionally separate from `list:manage`, which plain members
  also hold.
- Viewing pinned Lists requires only `project:view`.

## Rules

1. Pinning an archived List is rejected ("Archived Lists cannot be pinned").
2. A project can have at most 20 pinned Lists (`MAX_PINNED_TASK_LISTS`).
3. `pin` and `unpin` are idempotent no-ops when the List is already in the
   requested state.
4. Archiving a List removes its pin in the same patch. Unarchiving does NOT
   restore the pin.
5. Deleting a List needs no extra cleanup (pin state lives on the deleted row).
6. The default List may be pinned like any other active List.
7. The Backlog system List is pinnable via `pinSystemList`/`unpinSystemList`
   (keyed by `projectId` + system key, not a List id). It shares the same 20-pin
   budget as persisted Lists (`assertPinnedTaskListLimit` counts both), and
   pin/unpin are idempotent no-ops when already in the requested state. Other
   system Lists (e.g. Archived) are not pinnable today.
8. A new project starts with Backlog and Inbox pinned (OS-2191), pinned by its
   creator, so the sidebar shows them without opening the project. Admins unpin
   them like any other pin. The OS-842 Inbox backfill also creates its Inbox
   pinned.

## Sidebar Behavior

- The sidebar subscribes once per organization via
  `api.tasks.lists.listPinnedForOrganization`, which returns pinned Lists grouped by
  project, only for projects the caller can view, and only for projects with at
  least one pinned List. Each entry is a discriminated union (`kind`): persisted
  Lists carry the full public List shape (`kind: "list"`); system Lists carry a
  thin `{ kind: "system", key, ref, name }` shape (`pinnedSidebarListValidator`).
- A pinned system List (Backlog) renders a slimmed sub-item: it navigates and
  exposes only a direct Unpin button — no `...` actions menu (Backlog has no
  edit/default/archive/delete). It still accepts task drops, moving tasks to the
  Backlog via `listRef: "BACKLOG"` (`tasks.moveToList` resolves the ref).
- Pinned Lists render as sub-items (`SidebarMenuSub`) under their project row.
- Every project's first sub-item is **Threads** (OS-1957), linking to
  `/o/{org}/{alias}/threads`. It replaced the Threads button in the project
  header. It is active on any threads route of its project and uses the same
  left-rule active style as pinned Lists. It is not a drop target. Because
  every project now has a sub-item, every project row gets the expand/collapse
  button and the icon-collapsed dropdown, with Threads as the first entry.
  The pinned-List actions (permission query, drop targets) mount only for
  projects that have pins.
- **Pull Requests** follows Watch Tower in both layouts (OS-2178), with a
  pull request icon (GitHub is only one possible source),
  linking to `/o/{org}/{alias}/pull-requests` through
  `appRoute.projectPullRequests`. It shows for every member, viewers included,
  since connected pull requests are readable by the whole project
  ([github-integration.md](github-integration.md)). It is active on that route
  and is not a drop target. Every project therefore has at least one sub-item.
- Every project exposes a project-row expand/collapse button. On
  desktop hover or focus, the button appears in the project icon slot in place
  of the `#` icon; it shows `ChevronDown` when the Lists are expanded and
  `ChevronRight` when collapsed. The control uses row-specific accessible labels
  such as `Collapse lists for Alpha` / `Expand lists for Alpha` and reports its
  state with `aria-expanded`.
- In icon-collapsed sidebar mode, the project-row pinned-Lists affordance is a
  click trigger in the icon slot, not a hover-only control. Clicking it opens a
  dropdown of the project's pinned Lists, and each item navigates to the
  project's list view with `?list={ref}`. The dropdown opens with the project
  name as a non-interactive label (truncated), then a separator.
- Project List groups are expanded by default. Collapse state is local to the
  browser, stored in `localStorage` as collapsed project ids only, and is not
  synced through the backend. Stored ids of projects that no longer appear in
  the sidebar are pruned.
- Each sub-item links to the project's task view with `?list={ref}`, resolving
  that List's own default view when it has one and falling back to the project
  default (built with `projectEntryTarget`). A pinned List whose default is
  Board links to the kanban route with its grouping. Pinned system Lists
  (Backlog) have no List row and always inherit the project default.
- The pinned-List memo comparator must compare `defaultViewMode` and
  `defaultBoardGroupBy`, or a changed override leaves a stale href behind.
- The project row itself links to the project's default List (no `list` param),
  so it resolves that List's override as well, carried on the project row as
  `defaultListView` by `api.projects.core.listByOrganization`. Its memo
  comparator compares that override for the same reason.
- A sub-item is active when its project is the active project, the active
  section is a task view that supports List selection (Table or Board), and the
  `list` query param matches its ref. The pinned default List is also active
  while the project's default view is on screen (no `list` param) — e.g. right
  after clicking the project row.
- Active pinned List sub-items use a left-side rule, full-row hit area, and
  semibold label text without an active background fill. Project rows keep the
  filled sidebar active background treatment.
- Pinned Lists render with vertical breathing room below their project row.
- Hovering or focusing a pinned List sub-item must not put the parent project
  row into hover state or reveal the parent project's `...` action.
- While the pinned query is loading, project rows render without sub-items;
  pinned Lists must not block or delay project rendering.
- Each sub-item exposes hover-revealed inline actions: a direct pin-state
  button immediately before the `...` actions menu. The menu keeps the same
  items and rules as List management rows (Edit, Set as default, Pin/Unpin,
  Archive, Delete). One canonical implementation is shared between both
  surfaces: `TaskListActionsMenu` (menu items), `TaskListPinButton` /
  `getTaskListPinAction` (direct pin state), and `useTaskListActions`
  (handlers + edit/confirm dialogs) under
  `components/blocks/project/task-lists/`.

## Drag & Drop Tasks onto Sidebar Lists (OS-979)

- Tasks dragged from the task table (single or multi-selection) can be dropped
  onto sidebar targets:
  - a pinned List sub-item — moves the dragged tasks to that List;
  - the project row — moves them to the project's default List (skipped when
    the project has no `defaultListId`).
- Targets accept only drags carrying tasks of their own project (gated via the
  project-scoped drag MIME type, see
  [task-table-drag-and-drop.md](task-table-drag-and-drop.md)). Cross-project
  drops are therefore impossible; the backend additionally rejects target
  Lists outside the tasks' project.
- The currently viewed List is not a drop target (dragged tasks always come
  from it): the highlighted pinned List rejects drops, and so does the pinned
  default List / the project row while the project's default view (or the
  pinned default List) is on screen.
- The hovered target highlights (`bg-sidebar-accent` + ring) while a matching
  drag is over it; non-matching drags produce no highlight and no drop.
- Drops call the existing `tasks.moveToList` mutation with the dragged root
  task ids (`listRef` for pinned Lists, `listId` for the default List).
  Success shows a toast with the count and target List name; failures surface
  the server error as a toast.
- Drops are optimistic: moved tasks are removed from cached task-list views
  immediately (except views of the target List), so the drag-source table
  updates without waiting for the server.
- Multi-select drags move the selected root tasks; descendants follow their
  parent server-side. Dragging an unselected row moves only that task.
- Desktop-only: mobile long-press drag does not reach sidebar targets.
- Implementation: `components/blocks/sidebar/use-sidebar-task-drop.ts` and
  `lib/tasks/task-drag.ts`.

## Pin/Unpin UI

- Entry points: a hover-revealed direct button immediately to the left of the
  List row `...` menu in List management (settings dialog and the header List
  picker), the same direct button on sidebar pinned List sub-items, the
  explicit-save checkbox in the persisted List create/edit dialog, and the
  existing `...` menu item after `Set as default`.
- Labels/icons: `Pin to sidebar` (`Pin`) when unpinned, `Unpin from sidebar`
  (`PinOff`) when pinned. The direct button uses row-specific accessible names
  such as `Pin Sprint 1 to sidebar` and `Unpin Sprint 1 from sidebar`.
- The buttons and menu items are shown only to users with `list:pin` (via
  `useProjectPermissions().canPinLists`) and only for non-archived Lists.
- The create/edit dialog checkbox is also shown only to users with `list:pin`
  and only for non-archived persisted Lists. It starts checked when creating,
  and a checked create pins the new List in the same mutation; editing a List pins or unpins it when
  the saved checkbox value changes.
- Backlog system List: the header List picker (`TaskListPicker`, opted in via
  `allowSystemPin`) shows a hover-revealed pin/unpin control on the Backlog row,
  wired to `pinSystemList`/`unpinSystemList` through `useTaskListActions`'
  `systemActions`. Its current pin state comes from
  `api.tasks.lists.listPinnedSystemListKeys`. Other `TaskListPicker` surfaces (e.g.
  task-detail List assignment) do not opt in, so the control is header-only.

## Acceptance Checklist

- Project-admin can pin/unpin; member, viewer, and an org owner/admin with no
  project row never see the menu items, and direct mutation calls are rejected
  for them.
- Pinned List appears under the project in the sidebar for every member.
- Clicking a pinned List navigates to the project list view with `?list=REF`
  and the sub-item highlights.
- Archiving or deleting a pinned List removes it from the sidebar; unarchiving
  leaves it unpinned.
- The 11th pin attempt is rejected with a clear error.
