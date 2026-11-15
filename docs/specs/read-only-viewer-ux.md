# Read-only viewer UX

A project `viewer` holds `PROJECT_VIEW` and `TASK_VIEW` only
([permissions-system.md](permissions-system.md#project-role-permissions)). The
server already rejects every write they try. This spec says what the web UI
shows them instead of buttons that fail. Epic OS-1361; slice 1 is OS-1537.

The same rules apply to anyone whose project role lacks the permission,
including an org owner or admin with no `projectMembers` row. Since OS-1536
that row is the only grant, so such a user really is a viewer of the project.
There is no implicit-access bypass in the UI either.

## The rule

| Affordance | Read-only treatment |
|---|---|
| Primary create actions (add task, add subtask, new artifact, attach files) | Hidden |
| Drag affordances (reorder, drag to composer, drop zones) | Hidden or inert |
| Field editors (title, status, priority, type, label, List, assignee, due date, tags) | Visible, not editable, shared tooltip |
| Meaningful menu items (mark complete, duplicate, archive, unarchive, move to) | Visible, disabled, shared tooltip |
| Destructive items (delete) | Hidden |
| Composers with nothing left to submit | Replaced by a one-line note |

Values stay legible. A read-only field renders its value as plain text (or the
same badge), not a greyed-out control. The tooltip is the native `title`
attribute with one shared string, `VIEW_ONLY_REASON` in
`lib/authz/use-project-permissions.ts`. A disabled shadcn `Button` or menu
item drops pointer events, so the `title` sits on a wrapper or the item
keeps `data-[disabled]:pointer-events-auto`. A disabled Radix menu item still
calls its `onClick`, so read-only items get no handler at all.

### Loading

While `myRole === undefined`, every mutating affordance is unavailable. The
hook's flags are all false and `readOnlyReason` is already set, so nothing
renders enabled and then flips. Surfaces whose layout depends on the role, such
as the timeline composer, wait for it to load instead of rendering a guess.

## Capability hook

`useProjectPermissions(projectId, organizationId?)` in
`lib/authz/use-project-permissions.ts` is the single client source:

- `canCreateTask`, `canUpdateTask`, `canDeleteTask`, `canComment`,
  `canUseThreads`, each from `hasProjectPermission` on the `getMyRole` result.
- `readOnlyReason`: `null` when the caller can update tasks, otherwise
  `VIEW_ONLY_REASON`. Disabled tooltips and notes share it. The slice 7 badge
  has its own wording because it names the role.
- `orgRole` and `canDeleteProject` when `organizationId` is passed. Project
  delete is an org permission (`requireOrgPermission(PROJECT_DELETE)` in
  `convex/projects/core.ts`), so the project role cannot answer it.

Convex shares one subscription per identical query, so calling the hook in
several components costs one `getMyRole` read. Task table cells never call it
per cell: they read `canUpdateTask` from the table meta (slice 2, below).
Other surfaces call the hook directly: the task detail sidebar, the artifact full page
(`useArtifactOwningTask`), the threads layout, and the project task views shell.

Surfaces that list several projects read the role from the project row instead.
`api.projects.core.listByOrganization` returns `myRole` on each row, taken from
the memberships `filterProjectsByAccess` already reads, so it adds no query.
The create dialogs, the sidebar Add task entry, and the mobile nav bar use it.

Tests stub the role with `withProjectRole(role, fallback)` from
`apps/web/test-utils/project-role.ts`.

## Surfaces

### Task detail sidebar (slice 1)

`TaskDetailSidebar` calls the hook with its `projectId`. Without a project
(the playground) nothing is gated. `isReadOnly = isArchived || readOnlyReason`
replaces the old archived-only check everywhere it applied.

| Part | Viewer sees |
|---|---|
| Header toggle (Mark complete / Completed) | Disabled, tooltip |
| Header Unarchive (archived task) | Disabled, tooltip |
| Header delete (archived task) | Hidden |
| Header "Open threads page" | Hidden (`canUseThreads`) |
| Actions menu: mark complete, Move to, duplicate, archive, unarchive | Disabled, tooltip. Move to has no submenu |
| Actions menu: delete | Hidden |
| Actions menu: open in new tab, copy link | Enabled |
| Title | `readOnly` textarea, selectable, tooltip |
| List, type, status, priority, label | Plain value, tooltip on the row |
| Assignee, delegate to agent | Trigger disabled. The hover card still shows who it is |
| Due date | Picker disabled, value at full opacity |
| Tags | Chips only, "No tags" when empty |
| Threads row | Hidden (`canUseThreads`) |
| External links | Already read-only (links come from MCP and CLI) |
| Description | Read-only editor (the archived state) |
| Attachments and artifacts section | No upload, create, or delete (the archived state). "No resources" when empty |
| Paste and drop files | Ignored |
| Artifact panel | Read-only, comment rail read-only |
| Subtasks | No add row in table or card layout, no card drag. "No subtasks" when empty |
| Timeline composer | One-line note with `VIEW_ONLY_REASON` |

The timeline composer drops the comment side when `!canComment` and the thread
side when `!canUseThreads`. With neither, it is the note. With one, that side
shows alone with no swap trigger.

`useArtifactOwningTask` folds the role into `isReadOnly` the same way, so the
artifact full page and the thread workspace's artifact agree with the sidebar
panel. It stays `undefined` until both the task and the role load.

### Task table and board (slice 2, OS-1540)

`useTaskTableController` takes `canUpdateTask` (default `true`) and returns it.
Its callers pass the hook's flag: the task list page, the thread tasks panel,
and the sidebar subtask table (`!readOnly`). The controller turns DnD and the
write hotkeys off with it ([keyboard-navigation.md](keyboard-navigation.md#read-only-viewers)).
`TaskTable` puts it on the table meta, so `createColumns` keeps its signature
and the cells read `canUpdateTask` from the cell context. It is part of the row
memo's version string, so rows re-render when the role loads.

| Part | Viewer sees |
|---|---|
| Task name | Plain text, no input. Clicking it opens the task |
| Completion checkbox | Disabled, shows the state |
| Task type icon | Icon only, no menu. The ref still copies on click |
| Status, priority, label | Value, no menu |
| Assignee | Trigger disabled, hover card still shows who it is |
| Due date | Picker disabled, value at full opacity |
| Row drag handle, field-drag arming, mobile long-press drag | None (`isDndEnabled` false) |
| Resource drops onto rows | Refused |
| Mobile cards and sidebar subtask cards | No field editors (`onTaskUpdate` omitted) |
| Board cards and card drag | Already gated in `kanban/page.tsx` on `canUpdateTask`. Card menus: see slice 4 |
| Sidebar project and List rows | Not drop targets (`useSidebarTaskDrop` returns no props) |

An editor open when write access goes away (role changed mid-session) closes
and drops the pick: `AssigneeSelector`, `DateTimePickerPopover`, and the date
input's text suggestions close on `disabled`. The other cells swap their menu
for a plain value, which unmounts it. A mobile long-press drag already in
progress drops nothing: its pointer-up reads the latest drop callback.

Table cells do not carry the `VIEW_ONLY_REASON` tooltip. A row full of
identical tooltips adds noise. The slice 7 badge marks the whole view once.

`useSidebarTaskDrop` calls the hook per sidebar project. That is one
`getMyRole` subscription per listed project, already shared with pinned List
rows that call it through `useTaskListActions`.

### Task create affordances (slice 3, OS-1539)

A viewer reaches no create form. Each entry point checks `TASK_CREATE`, so a
project role with update but no create access would also lose them.

| Entry point | Viewer sees |
|---|---|
| Project header round + ("Add task (N)") | Hidden. The shell passes no `onAddTask` |
| Top and bottom "Add task..." rows, task list page and thread tasks panel | Hidden. Both pass `allowAddTask: canCreateTask && !archived` to the controller |
| Inline draft row (header +, `C`, Enter in a name input) | Never starts. `beginInlineTaskDraft` returns early when `allowAddTask` is false |
| `C` and `N` on the task list page | Not registered (`enabled` is false) |
| `Mod+Shift+A` and `Mod+Shift+B` on the task list page | Not registered (they need `TASK_UPDATE`) |
| Section group add rows | Already gated on `TASK_CREATE` in `use-task-grouping.tsx` |
| Create task dialog and mobile create drawer | The project picker lists only projects with `TASK_CREATE`. A view-only active project is not preselected |
| Sidebar Add task (desktop sidebar and mobile menu) | Hidden when no project in the org allows creating tasks, and while the list loads |
| Mobile nav bar + slot | Hidden when the resolved project lacks the permission for that slot: `CLI_THREAD` in the threads area, `TASK_CREATE` elsewhere. With no resolved project, shown only if some project allows creating tasks. Hidden while projects load |

Losing create access while a form is open (role changed mid-session) leaves
nothing to submit. An open inline draft disappears and its commit does nothing:
the controller reads the draft through `allowAddTask`. The create dialog and the
mobile drawer resolve the selected project against the live picker list, so the
project drops out, its assignee and agent clear, and Create disables.

### Menus and bulk actions (slice 4, OS-1542)

Row and card menus follow the rule above. Header menus and the bulk toolbar
act on many tasks at once, so their write actions are hidden, not disabled.

| Surface | Viewer sees |
|---|---|
| Row right-click menu (table, sidebar subtask table) and board card menu | Same as the detail actions menu: write items disabled with the tooltip, Move to without a submenu, delete hidden. Open details, open in new tab, and copy link stay enabled |
| Selection-scoped row menu (right-click inside a multi-selection) | Same, with the "selected" labels |
| Multi-select toolbar | The count and clear selection only. Selection itself stays |
| Desktop task header menu | Collapse all and Auto width. No Archive done, Closed to bottom, or Move active to |
| Mobile task list menu | Collapse all only |
| Archive completed dialog | Never opens; one already open closes when write access goes away |
| Bulk delete dialog | Never opens: the toolbar, row menu delete, and Cmd/Ctrl + Backspace are all gone. One already open closes when delete access goes away (`use-project-task-detail-surface.tsx`) |

`TaskTable` passes `readOnly={!canUpdateTask}` to each row, and the row hands
it to `TaskContextMenu`, which turns it into `readOnlyReason` for the shared
`TaskActionMenuItems`. The header menus read `canUpdateTask` from the table
meta (desktop) or the controller (mobile).

### Threads, workflow runs, and worktrees (slice 5, OS-1545)

A viewer cannot read threads, shared ones included, because `VIEWER` has no
`CLI_THREAD` permission. Widening that would loosen every thread query, not
just shared ones ([cli-thread-sharing.md](cli-thread-sharing.md)). So there is
no read-only threads area and no `CLI_THREAD_VIEW` split: every entry point is
hidden, and everything mounted inside the threads area (composer, workflow run
panel and rail, worktree changes view, shared-threads view) is unreachable.

| Entry point | Viewer sees |
|---|---|
| `/threads` and `/threads/<id>`, deep links included | The threads layout waits for the role, then replaces the route with the project task view. Nothing under it mounts |
| `N` (new thread) | Not registered (`enabled: canUseThreads`) |
| Sidebar project Threads and Watch Tower rows, and their collapsed-sidebar menu items | Hidden per project from the row's `myRole`. The Pull Requests row stays, since viewers read connected pull requests, so the project keeps its expand toggle and collapsed-sidebar menu |
| Sidebar Watch Tower (desktop and mobile menu) | Hidden when no project in the org allows threads, and while the list loads. Its query already drops projects without `CLI_THREAD`, so a deep link shows the empty state |
| Mobile nav bar Threads tab | Hidden when the resolved project lacks `CLI_THREAD`. With no resolved project, shown only if some project allows threads. Hidden while projects load |
| Task table Runs column | Badges only, not a button. The cell opens no popover or drawer, so no thread list, mini preview, or composer. `TaskTable` reads `canUseThreads` once and puts it on the table meta |
| Task detail timeline: thread source, thread composer, Threads row, Open threads page | Already hidden by slice 1 |
| Keyboard shortcuts dialog | No Threads group inside such a project |

Unreachable without an entry point, so not gated separately:

- `getThreadCostSummary` throws for a viewer, but only `CostIndicator` calls it
  with a thread id, from a thread view inside the threads area or the Runs
  mini preview. `listServiceSummaries` has no web caller (CLI only).
- Workflow run controls (`use-workflow-run-actions.ts`) and worktree ops mount
  only under the threads layout or a task thread composer. Slice 8 (OS-2195)
  covers the run controls' own gate.
- The agent automation dialog and its auto-start toggle open only after the
  web UI assigns a task to an agent, which a viewer cannot do.

### Settings, sidebar, and mobile chrome (slice 6, OS-1546)

Settings sections that show values stay and render read-only. Sections made of
editors and things to manage are hidden. `isSectionPermitted` in
`components/blocks/project/settings/project-settings-config.ts` is the one rule.
The settings nav (desktop sub-sidebar, mobile section header), the sidebar
project menu, and the route gate all read it.

| Section | Viewer sees |
|---|---|
| General, Labels, Customization | Read-only notice and disabled fields (already gated on `canEditProject`) |
| Members | The member list. No Add member, role, or remove controls |
| Usage | The dashboard. Its query needs only `PROJECT_VIEW` |
| Integrations | The GitHub connection and sync state, with no Connect, Sync again, or Disconnect ([github-integration.md](github-integration.md)) |
| AI Agents, Prompts, Skills, Workflows, Lists | Hidden. They need `AGENTS_MANAGE`, `SLASH_COMMANDS_MANAGE`, `SKILLS_MANAGE`, `TASK_UPDATE`, and `LIST_MANAGE` |
| Danger Zone | Hidden without the org `PROJECT_DELETE`, whatever the project role |
| Dev-only placeholder sections | Unchanged, behind `extraProjectSettings` |

The route gate is `app/o/[organizationSlug]/[projectAlias]/settings/layout.tsx`.
It reads the section from the path, so a section page and its editor routes
(`agents/new`, `agents/<id>`, `prompts/new`, `prompts/<id>`, `skills/...`,
`workflows/new`, `workflows/<id>`) share one check. While the roles load, a
gated route shows a skeleton. Once denied, it replaces the URL with General.
Nothing under it mounts, so no editor offers a Save the server would reject.
Gated sections are absent from the nav until the roles load.

| Surface | Viewer sees |
|---|---|
| Sidebar project `...` menu | Settings. Add members needs `PROJECT_MEMBERS_ADD`. AI Agents, Prompts, Skills, Workflows, and Lists follow the section rule. Delete needs the org `PROJECT_DELETE`, so an org admin who is a project viewer keeps it |
| Desktop project header settings menu | No Add members (`canManageMembers`), no AI Agents (`AGENTS_MANAGE`) |
| Mobile filters and view drawer | Members stays, it reads. No AI Agents. Column visibility and default-view rows were already gated |
| Mobile menu panel | Its project rows are `NavProjects`, so the same `...` menu. Organization Settings is an org-role surface, not gated here |
| Mobile task detail | The vaul drawer over `TaskDetailSidebar`, so slice 1 applies. Menus scroll inside it since OS-2198 |
| List row menus: header List picker, sidebar pinned Lists | None. `useTaskListActions` returns no `rowActions` without `LIST_MANAGE`, and pinning stays on `LIST_PIN`. Rows are plain links |
| Header List picker "Create list" row | Hidden without `LIST_MANAGE` |
| An open List create, edit, default, archive, or delete dialog | Closes when `LIST_MANAGE` goes away (role changed mid-session), so it never submits |
| An open sidebar project delete confirmation | Closes when the org `PROJECT_DELETE` goes away mid-session |

The sidebar reads each project's role from its `listByOrganization` row and the
org role from one `organizations.members.getMyRole` subscription in
`NavProjects`. `task-types-section.tsx` checks the org `ORG_UPDATE` through
`hasOrgPermission` instead of comparing role names.

A viewer holds every permission these settings reads need, and Convex
tests pin that. Two item reads now return their empty answer when the project
is out of reach, so a subscription that outlives its access does not hit the
error boundary: `cli/profiles.get` returns null and
`users/projectPreferences.get` returns the defaults. The list reads
(`cli/profiles.listByProject`, `listRuntimeCatalogs`,
`slashCommands.listByProject`, `listComposerCatalog`, `skills.listByProject`)
and the cost queries still throw. MCP and API-key callers use most of them and
need the error, and the page that asks for a list needs the project anyway.

### View-only badge (slice 7, OS-1550)

`ViewOnlyBadge` (`components/blocks/project/view-only-badge.tsx`) sits after
the project name in the desktop project header and the mobile task-views
header. The shell passes it the `myRole` it already reads, so it adds no query.
It renders only for a loaded role without `TASK_UPDATE`, never while
`myRole === undefined`, so members see no flash. Its `title` names the role
and who to ask: "You're a Viewer in this project. Ask a project admin for edit
access." Touch devices do not show a `title`, so on mobile the badge is the
only signal. That is the same tradeoff the disabled controls make.

Disabled controls keep `VIEW_ONLY_REASON` as their tooltip (slices 1–6).
Three strings stay separate on purpose: `VIEW_ONLY_REASON` explains a disabled
control, the badge names the role, and `PERMISSION_DENIED_MESSAGE` covers any
project denial, including a demoted admin who is not view-only.

### Soft failures (slice 7, OS-1550)

A revoked role mid-session, a stale tab, or a deep link still sends writes the
server rejects. They fail with one friendly toast, never silently and never with
the server's string.

- A project permission denial is a `ConvexError("Permission denied: <permission>")`
  from `requireAuthorizedProject`. Production redacts plain `Error` messages,
  so only a `ConvexError` reaches the client intact. Other denial reasons (no
  membership, project not found) stay plain errors. So does
  `requireOrgPermission`: the friendly copy says "in this project", which
  would be wrong for org settings.
- `getErrorMessage` in `lib/errors.ts` swaps any string `data` starting with
  `PERMISSION_DENIED` (`lib/authz/permissions.ts`) for `PERMISSION_DENIED_MESSAGE`.
  Every `getErrorMessage` caller gets the copy, `showConvexErrorToast`
  included.
- `getMutationErrorMessage` returns the mapped `ConvexError` text, or the
  caller's fallback for anything else, never a plain error's raw server text.
  The new-thread submit and the archive and delete undo actions
  (`use-task-undo-actions.ts`) use it, so a stale tab's archive or delete says
  why it failed.
- Fire-and-forget task writes (`updateTask`, `addTask`, `duplicateTask`,
  reorders, rank healing, parent changes, bulk field updates, move to List, in
  `useTasks` and `useArchivedTasks`) end in `.catch(toastMutationRejection)`.
  The optimistic update reverts and the toast says why. A `ConvexError` shows
  its mapped message, anything else "Couldn't save your change". All share one
  sonner toast id, so a bulk write rejected per row shows one toast.

### Workflows (slice 8, OS-2195)

No new gate. Both surfaces were already behind one.

| Surface | Viewer sees |
|---|---|
| Workflow editor (`workflows/new`, `workflows/<id>`) | Redirected to General by the slice 6 route gate. Without `TASK_UPDATE` the editor itself renders read-only: no `onChange`, so no drag handles, no add or delete for lanes, stages, or steps, disabled name inputs and lane menu, and step cards that open no dialog |
| Run panel, Run rail, in-thread wait card | Nothing. Each renders its controls only from `workflows.runs.core.get`, which returns null without `CLI_THREAD`. A starter demoted to viewer loses the controls live, and cancel, resume, retry, skip, and approve all reject with `Permission denied` |

There is no client-side permission check beside the query. A second check would
gate the same fact twice.

## Stays interactive on purpose

Do not disable these for viewers. They change nothing shared, or the server
allows them:

- Filters, sorting, grouping choice, search.
- Selection, opening tasks, copy link, open in new tab.
- Per-user read state and notification preferences.
- Timeline source toggles and sort direction.
- Downloading attachments and opening artifacts.

## Already gated (do not regate)

- Task sections on `LIST_MANAGE`: `components/blocks/task-grouping/section-board.tsx`
  and `use-task-grouping.tsx`.
- Skills on `SKILLS_MANAGE`: `components/blocks/organization/settings/skills/skills-section.tsx`.
- Workflow definitions on `TASK_UPDATE`: `components/blocks/workflows/workflow-editor-page.tsx`.
- Per-comment edit and delete from server-computed `canEdit`/`canDelete`
  (`convex/tasks/lib/comments/hydrate.ts`, `convex/tasks/artifactComments.ts`).

## Server contract

The UI hides what the server refuses. A project permission denial is a
`ConvexError` whose data starts with `Permission denied` (see Soft failures).
Convex tests pin that a viewer gets `Permission denied` from the mutations this surface calls: task update,
duplicate, archive, unarchive, remove, move to List (`convex/tasks/core.test.ts`),
comments (`comments.test.ts`), artifact comments (`artifactComments.test.ts`),
and artifact and attachment writes (`artifacts.test.ts`, `attachments.test.ts`).
