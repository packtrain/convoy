# CLI Thread Detail Sidebar Specification

This document defines the reusable task detail presentation infrastructure for the threads workspace.

## Overview

- On desktop, the threads workspace uses an optional full-height right sidebar pane as its canonical right-side layout model.
- On mobile, task details render in a right-side drawer that fills the viewport instead of the in-flow sidebar pane.
- The shared pane model is reused by both:
  - `/o/{organizationSlug}/{projectAlias}/threads`
  - `/o/{organizationSlug}/{projectAlias}/threads/{threadId}`
- The desktop sidebar is an in-flow pane, not an overlay.
- Opening the desktop sidebar reduces the available width of the main thread content column.
- The mobile drawer overlays the workspace and does not resize or shift the main thread content.
- The mobile drawer keeps its full height when the software keyboard opens. Side drawers (`left`/`right`) default vaul's `repositionInputs` off; only bottom sheets lift above the keyboard (OS-2090).
- Dropdowns and popovers opened from the mobile drawer scroll by touch. They portal outside the drawer, so each one lifts the drawer's scroll lock while it is open (OS-2198).
- The first real consumer is task details opened from thread-route `task=<REF>` selection.
- On `/threads/{threadId}`, the sidebar is **tab-based** (OS-1169): multiple panels can be open at once as tabs; see "Tabbed Panels" below.

## Layout Rules

- On desktop, the thread detail workspace is a horizontal split:
  - left: the thread detail panel
  - right: optional sidebar pane
- The thread detail panel owns its own header above its conversation/composer content.
- The sidebar shell can either:
  - render its own generic top header row for host/placeholder content, or
  - defer top chrome to the active sidebar consumer when that consumer already provides a header
- The main thread content column owns:
  - conversation scroll region
  - composer
- The sidebar spans the full available height of the thread detail workspace.
- On mobile, the same sidebar content renders inside a full-width, full-height right drawer.
- The task detail content component remains shared between desktop and mobile.

## Sidebar Host Contract

- The sidebar host is content-agnostic and accepts arbitrary children.
- The host exposes:
  - open/close behavior
  - header/title chrome
  - close affordance
  - resize affordance
- Task details are a special case:
  - when `TaskDetailSidebar` is rendered inside the thread workspace, the shell header is hidden
  - the shared task detail header becomes the topmost sidebar header and owns the close affordance
- The host body does not add default inner padding around child content.
- Sidebar consumers are responsible for their own spacing.
- The shared host now supports URL-backed task-detail selection on thread routes.
- This host still does not introduce:
  - diff-specific rendering
  - panel registries or consumer catalogs

## Layout Modes (OS-1396; thread detail route)

- The thread detail route has two layout modes:
  - **Split** (default) — the two-column layout described above: thread on the
    left, panels in the right sidebar.
  - **Full** — there is no sidebar. The thread becomes one tab among the
    panels, and the active tab fills the entire workspace width. This exists so
    the Changes panel can be reviewed at full width.
- In full mode the tabs render **inside the thread header row, taking the place
  of the title** — the thread is not a separate "Thread" tab next to a title;
  its tab *is* the thread, labeled with the thread title (truncated). Thread
  tabs sit at the left, the panel tabs (`Changes`, `Tasks`, task detail) at the
  right, next to the layout toggle. In split mode the tabs stay in the
  sidebar's own tab bar. Both use the same underline tab list component.
- Tabs in full mode are the thread, `Changes`, `Tasks`, plus the task detail tab
  while `task=<REF>` resolves. The thread tab is the only one that renders the
  conversation and composer — Changes, Tasks, and task detail have no composer.
  It carries no icon: its label is the thread title, and the thread's
  associated task ref (normally in the header's leading slot) rides inside the
  tab before that label, so the active underline runs beneath it.
- Selecting a panel tab **covers** the thread rather than unmounting it (the
  panel renders as an overlay and the thread column becomes inert), so the
  conversation's scroll position survives tab switches.
- Opening a thread in full mode starts on the thread tab; in split mode the
  sidebar starts on `Changes` (there is no thread panel there), or on the
  attached task's tab (see "Attached task tab").
- Every tab owns its own second row. Changes has the changes toolbar and Tasks
  has its filters; the thread tab's second row holds the thread actions
  (Mark as read, Mark as done) plus the `...` menu, right-aligned.
  Those actions are never shown while another tab is active — they belong to
  the thread, not to the workspace chrome.
- The Thread actions, Changes toolbar, Tasks filters, and thread-workspace
  task-detail header use the card surface token, giving all four secondary
  rows the same background as the thread sidebar and normal compact thread
  rows.
- The thread-workspace task-detail header uses the same 16px horizontal inset
  as the workspace tab bar and the task body, so its first and last actions
  line up with the tabs, the tab-bar actions, and the task content.
- The `...` menu and right-clicking the thread tab both open the same complete
  thread actions menu used by thread-list rows (Rename, read/unread, done/not
  done, Continue locally, Pin/Unpin, Delete).
- The tab set is a **list**, not a fixed set of panels: sub-threads will add
  further thread tabs, so nothing may assume exactly one thread tab.
- The mode toggle sits at the **workspace's top-right corner**: the sidebar tab
  bar renders it left of the collapse toggle while the sidebar is open, and the
  thread header renders it in full mode. Split mode with a collapsed sidebar
  shows only the sidebar-open toggle. It is desktop-only (hidden below `md`);
  mobile always uses the split/drawer presentation regardless of the stored
  mode.
- The mode persists in local storage (key `convoy.thread-layout-mode`),
  shared across threads, and fails soft to `split` for missing or unrecognized
  values. It is read through a synchronous viewport check on mount, so a phone
  never renders the full-width header before the effect-resolved mobile flag
  arrives.
- Switching modes preserves the active tab, with two adjustments:
  - entering full mode while the sidebar was **closed** activates the `Thread`
    tab (so the conversation does not disappear); entering it while the sidebar
    was **open** keeps the panel that was on screen
  - leaving full mode from the thread tab falls back to `Changes`, since split
    mode has no thread panel; leaving it from any other tab opens the sidebar
    on that panel so what the user was reading stays on screen
  - a selected task tab survives both directions
- In full mode the `T` shortcut switches between the `Tasks` tab and the thread
  tab instead of toggling a pane.
- Inline title editing is unavailable in full mode (the title is a tab); rename
  from the thread list or switch back to split.

## Fixed Tabs (OS-1169 tabbed model, reworked; thread detail route)

- The thread header exposes **one** sidebar action: the open/close toggle. Per-feature header buttons (Run timeline, All changes) were removed in OS-1169.
- The sidebar has an **underline tab bar** (the shared `Tabs` `underline` variant) that is always visible while the sidebar is open. Three kinds of tab, and no others: **fixed** tabs (`Changes`, `Tasks`) which are always present and never closable; **conditional** tabs (`Workflow`, `Checks`) which exist while the thread has what they show and have no close control; and **conditional closable singleton** tabs (`Task detail`, `Artifact`) which exist exactly while their query param is set and carry a close affordance that clears it. There is no empty-state panel menu and no `+` button — the user never creates a tab directly, only by setting a param.
- Sidebar state is `activePanel` (`thread` — full mode only | `changes` | `tasks` | `workflow` | `evidence` | `task` | `artifact`) + a `changesView` + open/closed, page-local (not persisted across reloads). The layout mode itself *is* persisted; see "Layout Modes" above.
- Tabs:
  - **Changes** (default) — the run-diff viewer. What it shows is its `changesView`:
    - `latest` (default) — the newest loaded run with a change summary, as a per-run view that follows new runs (OS-1882). Its checkpoints are the last the CLI prunes, so a fresh open never fails on a missing ref.
    - `all` — the cumulative range (oldest loaded run's `preRef` → newest run's `postRef`), i.e. the old "All changes" panel. Fails on long threads once the oldest `preRef` is pruned; see `cli-thread-run-diffs.md`.
    - `range` — a committed run range from the toolbar selector (below), labeled `Runs <from>-<to>` (`Run <n>` for a single run), 1-based over the loaded runs (numbers shift when older chunks load; the refs stay authoritative).
    - `worktree` — every uncommitted change in the thread's checkout against `HEAD`, labeled "Working tree" (OS-2234). Fetched live from the CLI, with per-file Revert and a typed-confirmation Revert all; see `cli-thread-run-diffs.md`. Not offered to a read-only viewer.
    - `run` — a single run scrolled to a specific file, set by clicking a Changes-card file row (clicking another file of the same run refreshes the selection).
    - With no loaded run carrying a change summary (or no agent context), the panel shows a "No changes yet." placeholder.
  - While the Changes tab is active, a **toolbar row** sits between the tab bar and the panel content. Its leading **view selector** button shows the active view's label ("Latest run", "All changes", "Working tree", `Run <n>`, `Runs <from>-<to>`) with a chevron and opens a popover: "Latest run", "All changes" and "Working tree" items (the active one checked) above the embedded **run timeline** — the same newest-first run list with contiguous two-click range selection and per-row "Restore to before this run" hover action as before (see `cli-thread-run-diffs.md`). Committing a range switches the Changes view to that range and closes the popover. There is no separate Run timeline tab, and the tab label itself carries no dropdown. The toolbar's trailing edge holds four compact panel-header icon buttons (`icon-sm`: 28px target, 14px glyph): a collapse/expand-all toggle for the file sections, a diff-style toggle switching between unified and split diff rendering, a word-wrap toggle (wraps long diff/file lines instead of horizontal scrolling), and the file-tree toggle at the far right. All apply across all Changes views and persist while switching views (per-file collapse toggles reset when collapse-all flips). Diff style and word wrap persist in local storage across reloads; collapse-all is page-local. The file tree defaults to hidden and persists its open/closed preference in browser local storage across threads and reloads. When enabled and the patch has files, it appears to the right of the diff with its own scroll area.
  - **Tasks** — the project task-list panel. It shows the thread's project tasks, starts on the project's default List by omitting `listRef`, and keeps list, status, archive, and assignee filters as panel-local state. It reuses the canonical task table controls; its header exposes List selection and status/assignee filtering; selecting a task opens the task detail tab through the existing URL-backed task sidebar state.
    - **Search** (OS-2320): the header's left side holds a search input. A non-empty query swaps the List's tasks for search hits from `tasks.core.search.byProjectForTable`: active tasks from every List in the project, matched by name, description, tag, or exact ref. The selected List does not apply; the status and assignee filters still do. Hits render in the same task table rows or cards. While loading, the skeleton matches the layout: row skeletons for the table, card skeletons for cards. "Show more" loads the next page. They keep relevance order: drag reorder, nesting, add rows, and "move closed to bottom" are off, but dragging a hit onto the composer still attaches it. Clearing the input or pressing `Escape` in it brings the List back. The query is part of the lifted panel state, so it survives the first-send remount.
  - **Workflow** — the run's progress and controls, present while the thread (or its container) belongs to a Workflow run. See `workflows.md`.
  - **Checks** (OS-2289; labelled "Evidence" until 2026-11-10) — files the agent attached to its replies with `convoy threads attach`, one group per reply, newest first, each headed by its time. Files a user attached to their own messages are not evidence. Present while there is at least one such file; a selected Checks tab with none renders the default panel. Contents and the later Checks section are specified in `task-checks.md` → "Checks tab (thread sidebar)".
  - **Task detail** — labeled with the task ref, rendered only while URL `task=<REF>` resolves (mirrored by render-phase sync; covers back/forward and every task-open affordance). Closing task details (the task header's own close affordance) clears the task query state and returns to the panel that was active before the task opened. If the pane was closed when the user last opened the task (any task click, including re-opening it, and the attached task's offer), closing the task closes the pane too. Closing the task while an artifact tab is still open keeps the pane.
  - **Artifact** (OS-1569) — the shared `TaskArtifactPanel` in `compact` mode, rendered only while URL `threadArtifact=<artifactId>` is set. Opened by the artifact links in the transcript's artifact tool parts, which intercept a plain left click and keep their real page `href` (so ⌘/ctrl-click, middle click and "copy link address" still open the full page). Closable like the task tab: `onClose` clears the param and returns to the panel that was active before, mirrored render-phase off the param — so the tab opens on the click rather than a round trip later, and back/forward work.
    The panel needs no task context to render (`getTaskArtifactSafe` resolves by id), so the tab resolves its own: the artifact for the tab label (falling back to "Artifact" for the one round trip before it lands) and then the owning task for the archived read-only gate and the send-comments-to-thread handoff. Long artifact names truncate within the tab; the artifact icon and close control keep their fixed size. Read-only until the owning task resolves, and for a read-only viewer.
- For a **read-only viewer** of a shared thread (`cli-thread-sharing.md`), the
  **Changes tab is disabled, not removed**: it renders in the strip, muted and
  `aria-disabled`, refuses selection, and its tooltip reads "Changes are only
  available to the thread owner". The panel is unusable for them because every
  file read and every revert goes through the owner-scoped
  `cli.worktreeOps.enqueue`. Keeping the tab visible means the workspace does
  not silently change shape. Consequently the viewer's **default panel is
  Tasks**, everywhere a panel would otherwise default or fall back to Changes:
  the initial `activePanel`, the panel-to-return-to when a task tab closes, the
  layout-mode toggle's split mapping, and the sidebar tab bar's `thread`
  fallback. The **Tasks** panel stays fully available — it is the project's
  task table, which a project member can already read and edit.
  `ThreadTab` carries this as `disabled` + `disabledReason`; a disabled tab
  must **not** be styled with `pointer-events-none`, which would swallow the
  tooltip that explains it. The group tab strip shares the same node and never
  disables a tab.
  The `thread` fallback is resolved **once** into the value both the tab bar's
  highlight and the panel body read. Resolving it in only one of the two lets a
  viewer highlight Tasks while the Changes panel renders behind it — reachable
  by resizing a full-width viewer to mobile.
  `ThreadChangesToolbar` and `RunTimelinePanel` take `onRevertRun` as optional
  and hide "Restore to before this run" without it. The workspace gates it on
  the same `runFileOpContext` as the transcript's run cards, so a viewer cannot
  reach a revert through the timeline either.
- **The pane follows the active tab, not the URL param.** `task=<REF>` stays set
  while the user switches to the Tasks tab — that is what keeps the task tab in
  the strip — so the shared pane component takes the showing panel as an input.
  Deciding from the selection alone renders the task's details underneath the
  Tasks tab (OS-1660).
- **One owner reconciles tabs against the URL.** Both conditional tabs are
  mirrored by a single render-phase adjustment keyed off the **raw query params**
  — never off a hydrated document. Two independent mirrors keyed off values that
  hydrate at different times let a `?task=&threadArtifact=` deep link land on one
  tab and have it stolen a round trip later, with no user input (OS-1569).
  Consequences that must hold:
  - Precedence is explicit, not incidental: the tab whose param *changed* wins,
    and when both change in one commit the artifact wins (the more specific
    target; the task tab remains in the strip either way).
  - A tab gated on a param must render *something* for that param before its
    document resolves — the task panel shows a skeleton rather than falling
    through to Changes, which would flash the wrong panel under a highlighted
    tab.
  - The panel-to-return-to holds **only unconditional** panels, so it can never
    name a tab that has since closed. Remembering a conditional tab strands
    `activePanel` on a tab absent from `panelTabs`: nothing is `aria-selected`
    and the body falls through to Changes — which for a viewer is the panel
    whose own tab is deliberately `aria-disabled`.
  - Closing one conditional tab while the other is still open activates that
    one, rather than dropping to the remembered panel.
  - **The rendered panel is normalized against the params, not trusted from the
    pick.** A pick naming a conditional tab whose param is unset resolves to the
    view's default for the tab highlight and the panel body alike. The guard is
    at the render step only — the pick itself stays raw, because the mirror reads
    it to decide what a closing tab falls back to. This is reachable without a
    resize: the pick is shared with the new-thread pane, whose own tab follows
    `task=<REF>` rather than the pick, so opening a task there and closing it
    leaves `task` recorded with no param behind it; a send then handed the
    workspace a tab it does not have, and the sidebar rendered the task branch's
    loading placeholder until the user closed and reopened it.
- **Opening a tab is idempotent.** Selecting a task or artifact that is already
  in the URL produces an identical URL, which the navigation layer discards — so
  the param never changes and the render-phase mirror, being edge-triggered,
  cannot fire. Revealing the surface is therefore the **opener's** job, not the
  mirror's: every opener selects its tab and opens the pane alongside setting the
  param. The mirror is left to what only it can do — deep links and
  back/forward. Without this, re-opening the current target does nothing whenever
  its tab is open but inactive, or the user has collapsed the sidebar with the
  param still set (OS-1663, OS-1569).
  - Tasks route this through `useThreadWorkspaceTaskSidebar`'s `onOpenTask`, so
    the reveal happens once where all openers already converge (transcript links,
    task tool-part ref links, header ref link, Tasks panel rows, subtasks,
    add-to-group draft) instead of at each call site, where any missed one is a
    silently dead affordance.
  - Task **tool-part** ref links (OS-1686) carry only a ref, never the archive
    flag, so they open as `active` and let the hook's URL correction fix the
    filter when the task turns out to be archived. This is the one opener that
    can be wrong about the filter, and the correction already exists for deep
    links — so it needs no second resolution hop before the tab appears.
  - URL **corrections** (an unresolvable ref, a mismatched archive filter) go
    through the raw navigation call and deliberately do *not* reveal: they are
    not user intent, and would reopen a pane the user just closed.
- **Attached task tab** (OS-2067). When the thread has an attached task and no
  `task` or `threadArtifact` param, the split pane opens on that task: the
  workspace writes `task=<attached REF>` (replace, not push) and the mirror
  above opens the tab. It fires once per thread visit, at the first of:
  - arriving at the thread with the pane already open
  - opening the pane from the header toggle

  Any other opener (a Changes card, `T`) shows the panel it asked for and uses
  up the offer, so a closed task tab stays closed until the user leaves the
  thread and comes back. Full mode does not offer it; the thread tab stays
  first there.
  The tab is in place on the first paint the thread renders, without a frame
  of `Changes` first. A Group child's task doesn't wait for the child's own
  doc: it comes from the strip's task summaries, or, right after a container
  redirects to the child, from the container's own task when the two match
  (a run's lanes carry the run's task).
- Only the **active** tab's panel is mounted; switching tabs remounts panels (their internal state resets).
- Closing the **sidebar** hides the pane but keeps the active panel, the Changes view, and any `task=<REF>` selection; reopening restores them.
- The run-diff viewer has no chrome of its own until an "Open file" tab exists; only then does its inner Changes/file tab strip appear (the viewer has no close button). The task detail header keeps its close affordance.

## New Thread Page Sidebar (no tabs)

- The new-thread route (`/threads`) reuses the same split pane and header
  toggle, but is **not tabbed** — it has exactly two possible contents: the
  Tasks panel (default) and task details (while URL `task=<REF>` resolves).
- The sidebar starts closed by default on both desktop and mobile. The user can
  open it from the header toggle or the `T` shortcut.
- **Its state is held one level above both views** (OS-1660,
  docs/specs/thread-groups.md → Page structure): open it here, send the first
  message, and the new thread's workspace inherits it open, on the same panel,
  with the Tasks panel's filters and any `task=<REF>` selection intact. The pane
  component itself is re-created by the view swap — the two views render their
  own split pane — so the guarantee is over that state, not over the mount.
  Since this pane has no Changes tab, revealing Tasks here records that choice,
  so the handover doesn't land on the detail view's default panel.
- Selecting a task swaps the panel for task details and reveals the sidebar
  if the user had closed it — including re-selecting the task already in the URL,
  which changes no param (see "Opening a tab is idempotent"). Closing task
  details (its own close affordance) clears `task=<REF>` and falls back to the
  Tasks panel without closing the pane. Closing the pane itself keeps the URL
  task selection; reopening restores whichever content the URL implies.
- The shell's default header (title + close) shows only while the Tasks panel
  is visible; task details own their header, as on the detail route.

## Header Affordance

- The thread detail panel header renders a right-side action to toggle the sidebar.
- The affordance remains available when no task is selected.
- On thread detail routes, selecting a task opens the shared pane with task details without leaving the current thread route.
- On mobile, selecting a task opens the shared drawer with task details without leaving the current thread route.

## Width Rules

- Width persistence is client-side only and stored in local storage.
- The remembered width is shared across thread detail pages.
- The sidebar starts from a default width of `400px` when no valid stored value exists.
- Width is clamped between `400px` and `900px`.
- Invalid or out-of-range stored values are ignored and replaced by the default width for the current session.
- Width persistence and clamping apply only to the desktop sidebar.
- The mobile drawer ignores remembered sidebar widths.

## Resize Rules

- A vertical separator is rendered on the leading edge of the sidebar.
- Dragging left increases width.
- Dragging right decreases width.
- Keyboard resizing works from the separator:
  - `ArrowLeft` increases width by `16px`
  - `ArrowRight` decreases width by `16px`
  - holding `Shift` changes the step size to `48px`
- Mouse resize persists on pointer release.
- Keyboard resize persists immediately after each step.
- Resize controls are not rendered in the mobile drawer.

## Accessibility Rules

- The separator uses `role="separator"` with vertical orientation metadata.
- The separator is keyboard-focusable.
- The separator exposes current/min/max values via ARIA attributes.
- The close action is exposed as a button in the sidebar header.
- The mobile drawer exposes an accessible title/description for the dialog surface.
- When task details own their own header, that shared task detail header owns the visible close affordance in both desktop sidebar and mobile drawer presentation.

## Query-State Rules

- `task=<REF>` selects the task shown in the shared pane.
- `artifact=<artifactId>` selects an artifact for the currently selected task. The artifact panel opens in compact mode: it fills the sidebar width (covering the task details until closed) instead of the wide side-by-side layout used on task views (see `docs/specs/task-artifacts.md`).
- `threadArtifact=<artifactId>` opens the artifact as its own host tab. Deliberately **not** the same param as `artifact`: that one is task-scoped (nested in the task tab, cleared on every task change, and also used by the project route), while `threadArtifact` is a tab of the thread workspace and survives task changes. Both may be set at once — one artifact nested in the task tab, another in its own tab.
  The split exists because the click has to be instant: artifact tool payloads carry an `artifactId` but no reliable task ref, so a `task=<REF>&artifact=<id>` URL would have to wait on a two-hop resolution (artifact → `taskId` → `refId`) before anything appeared, and would then replace whatever task the user had open. `threadArtifact` pushes straight from the payload.
- `archived=true` switches task resolution to archived mode when needed.
- Closing the task **tab** clears `task`, `artifact`, and `archived`, while preserving unrelated thread-route params (`threadArtifact` included). Closing the sidebar as a whole does not clear them (the task tab survives reopening).
- Closing the artifact **tab** clears only `threadArtifact`.
- Every sidebar URL write builds on the **live** browser URL, not the copy
  from the last render. Next updates the URL during its commit and sends no
  event, so a component that hasn't re-rendered since still holds the
  previous page's URL. Building on that copy sent the attached-task write
  right after a container's redirect back to the container itself, a second
  full load (OS-2067).
- User-driven thread sidebar updates use in-place history pushes:
  - open task
  - close task
  - change task
  - change artifact
  - open/close the artifact tab (`threadArtifact`)
  - change `attachedTask`
- Automatic thread sidebar self-corrections use replace semantics:
  - invalid `task`
  - invalid `attachedTask`
  - invalid `threadArtifact` — a push would stack a cleaned URL on the invalid
    entry, so Back would return to it, re-correct, and push again, trapping the
    user. Note `getTaskArtifactSafe` also returns `null` when auth resolves
    empty, so this fires on a token blip too, not only a deleted artifact.
  - archive-mode reconciliation
- On `/threads/[threadId]`, selecting tasks from thread-surface task affordances updates only the sidebar/query state and must not trigger a full thread-detail navigation.
- The selected task resolves project-wide (`getByRefs`), but the editable task collection backing the subtask table is List-scoped (`listByProject`). The thread workspace must scope that collection to the selected task's owning List — not the project default List — so descendants of a non-default-List task render (OS-1520). Until the selected task's List metadata resolves, the collection falls back to the default List; the merge that prepends the selected task keeps the parent itself visible during that transition.

## Non-Goals

- No automatic composer attachment when a task is opened in the pane.
- No attempt to optimize for full task-table or kanban rendering in this slice.

## QA Checklist

- Thread detail renders full-width main content when the sidebar is closed.
- Toggling the header action opens the sidebar as a full-height sibling pane.
- The open sidebar always shows the fixed underline tab bar (Changes, Tasks); the Changes tab is active by default and renders the latest run's diff (or "No changes yet.").
- On a thread with an attached task, opening the sidebar (or arriving with it open) selects that task's tab instead. After closing that tab, closing and reopening the sidebar does not bring it back.
- The changes toolbar selector shows the active view label, and its dropdown offers "Latest run", "All changes", "Working tree" and the run timeline; committing a run range switches the Changes view to that range and updates the label.
- Closing and reopening the sidebar preserves the active tab and Changes view.
- Opening the sidebar reduces main content width rather than covering it.
- Closing the sidebar restores the single-column layout.
- Selecting `task=<REF>` on a thread route renders `TaskDetailSidebar` in the shared pane.
- On mobile, selecting `task=<REF>` renders the same `TaskDetailSidebar` content in a drawer.
- Clicking a thread task ref on `/threads/[threadId]` updates the sidebar in place without reloading the main thread pane.
- Drag and keyboard resizing both work and persist.
- Resize controls are absent on mobile.
- Reloading a thread detail page restores the remembered width.
- Invalid stored widths fail soft to the default value.
- The layout toggle switches to full mode: left-aligned tabs replace the header title, the sidebar disappears, and the active panel spans the full width.
- The layout toggle stays at the workspace's top-right corner in every state (sidebar tab bar while open, thread header otherwise).
- In full mode the composer is present on the thread tab only, and Mark as done appears only on that tab's own toolbar row.
- Reloading restores the remembered layout mode; an unrecognized stored value falls back to split.
- The layout toggle is not rendered below `md`, and a stored `full` mode does not change mobile presentation.
- Opening a task in full mode adds the task tab and renders task details full width; closing it returns to the previously active tab and clears `task`/`artifact`/`archived`.
- Clicking an artifact link in a transcript artifact tool part opens the artifact tab in the sidebar (or full width in full mode) without leaving the thread; the tab is labeled with the artifact name and closing it returns to the previously active tab.
- ⌘/ctrl-click, middle click, and "copy link address" on the same link still target the artifact's full page.
- On mobile the artifact tab renders inside the thread sidebar drawer, not a second drawer nested in it.
- A read-only viewer can open the artifact tab and cannot edit its content.
- Reloading `?task=<REF>&threadArtifact=<id>` stays on the artifact tab once the task resolves; the task tab is present but not selected.
- Opening a task and an artifact, then closing both in either order, always leaves a tab selected whose panel exists (never an unhighlighted strip over Changes).
- Closing the artifact tab while a task is still open activates the task tab, not Changes.
- Clicking the same artifact link again after switching to another tab brings the artifact tab forward.
- Clicking a task tool part in the transcript (the `Created task OS-1685 “…”` row, or a ref link in a reader's or writer's body) opens that task's detail tab in the sidebar without leaving the thread — it does not expand an accordion. ⌘/ctrl-click, middle click, and "copy link address" still target the task's full page.
- Clicking a task tool part for a task that is archived lands on its detail tab with the archive filter corrected, not on an empty panel.
- An invalid `threadArtifact` clears itself without trapping Back.
