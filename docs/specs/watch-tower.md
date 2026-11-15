# Watch Tower Specification

Cross-project agent-thread dashboard (OS-1220, page in OS-1253, batch
actions in OS-1255, per-section pagination in OS-1259): a
GitHub-PR-dashboard-style inbox of the current user's CLI threads across
the current organization's projects, grouped by what needs the user's
attention. Design playground: `apps/web/app/playground/watch-tower/`.

## User-visible behavior

- Route: `/o/{organizationSlug}/watch-tower` ("Watch Tower" in the sidebar's
  main nav, `TowerControl` icon). Content is scoped to the route's
  organization: only the current user's threads from every accessible project
  **in that org**, newest activity first. There is no ownership toggle here.
  Switching organizations switches the feed.
- Project route: `/o/{organizationSlug}/{projectAlias}/watch-tower`, linked as
  Watch Tower after Threads in both expanded and collapsed project navigation.
  It shows only that project's threads, defaults to All threads, and offers
  Only mine. Both links require the same `CLI_THREAD` permission as Threads;
  unauthorized direct requests return no summaries.
- Rows are standalone threads and top-level group/workflow containers (OS-1984).
  Threads with `parentThreadId` set never appear separately. Each standalone
  row shows: CLI runtime icon, thread title, the
  project name (plain text, no icon), the branch name (OS-1257: git-branch
  icon + mono text, truncated, full name in the `title` tooltip — the
  enriched item's `branch`, i.e. execution snapshot ?? profile path branch
  ?? worktree branch) when known, and the linked task as a chip (type
  icon + ref + name) when one is attached — the task name is omitted when it
  matches the thread title (case-insensitive; a "…"-truncated title matching
  the name's prefix counts), since task-created threads inherit the task
  name; then three fixed right-side
  columns — a status indicator (its word from `THREAD_STATUS_META`, so a
  running row reads "Working" and a blocked one "Waiting", like the board
  cards; only Needs review, which has no thread status, words itself),
  cumulative `+/−` line totals (from
  `cliThreads.git.linesAdded/git.linesRemoved`, OS-1252; "—" when unset,
  right-aligned), and a right-aligned relative "Updated" time. Clicking a
  row opens the thread detail page in its owning project, except that clicking
  its linked-task chip opens that task on the owning project's task page.
  Below the `sm` breakpoint the Status, Changes and Updated columns are all
  hidden (OS-1449 — the sections already group by status, so per-row status is
  redundant on mobile and only steals width): rows are just the thread cell
  (icon, title, meta) at full width, and the header keeps only its "Thread"
  label.
- Two **layout modes** (OS-1595): **List** (stacked sections, the default) and
  **Board** (one kanban column per section). The choice persists in
  localStorage (`convoy.watch-tower.view-mode`, device-wide, not per-org;
  unknown values fall back to `list`) and applies on every load. Both modes
  render the same five sections from the same per-section queries — see
  [Board mode](#board-mode-os-1595).
- The page has **one toolbar control**: a settings dropdown (`ListFilter` icon,
  toolbar right) holding a "Layout" radio group (List / Board) and the
  per-section visibility checkboxes. Project views also include a "Threads"
  radio group (All threads / Only mine). Layout and section visibility are both
  "what am I looking at" settings, so they share one menu instead of competing
  for header width. Filter state persists in localStorage
  (`convoy.watch-tower.hidden-sections`, device-wide, not per-org); unknown
  keys and malformed payloads are dropped on read.
- **Empty state.** When the list has no rows, every visible section has
  finished loading, and no filter is applied, the page shows "Nothing to watch
  yet" and hides the settings dropdown, which has nothing to act on. A filter
  is a hidden section or, in a project, the Only mine scope. With a filter
  applied the dropdown stays so the user can undo it. The board keeps its
  dropdown because its empty columns stay rendered. The empty state links
  "Start a thread" to the project's threads page (`appRoute.projectThreads`).
  The personal tower uses the last visited project in the organization and
  shows no link when there is none. In both the list and the board, the empty
  state is centered vertically in the space below the page header.
- Threads are grouped into sections, in fixed order:
  1. **Running** — status `streaming` or `pending` (queued), and no pending
     interaction request. A queued thread no agent has claimed yet
     (`pending` + `processingState: idle`, i.e. no CLI connected or it hasn't
     picked the thread up) renders a muted "Waiting for agent" indicator
     instead of the Running spinner — client-side rendering only, same
     bucket.
  2. **Waiting for your input** — status `waiting_input`, unacknowledged; or
     a running thread parked on a pending approval/question
     (`hasPendingInteraction`, see `docs/specs/cli-interactive-approvals.md`)
     — it returns to Running when the request is answered
  3. **Failed** — status `failed`, unacknowledged
  4. **Needs your review** — finished but not explicitly marked done. Reading
     a thread does NOT move it out of this bucket (OS-1382): the user may
     check a thread and come back later for a follow-up, so only the explicit
     done mark demotes it.
  5. **Done** — explicitly marked done (`isThreadDone`)
- Bucketing mirrors the project thread list's display rule
  (`getThreadDisplayStatus`): a failed/waiting thread whose attention was
  acknowledged (`attentionAcknowledgedAt >= lastActivityAt`) falls to the
  finished buckets, so the two surfaces never disagree.
- **Done is explicit** (OS-1382): `cliThreads.doneAt` plus the sticky
  `isMarkedDone` flag (OS-2176). Agent activity doesn't clear the mark; a user
  turn does. Marks from before OS-2176 still expire on newer activity. Full
  rules: `docs/specs/cli-thread-read-state.md`. Marking done implies
  reviewed (also stamps `readAt` and acknowledges attention); "Mark as
  unread" clears the mark (unread ⇒ not done); clearing the done mark
  ("Move to review" / "Mark as not done") touches only the mark. The rule
  lives in `isThreadDone` (`convex/cli/lib/watchStatus.ts`); enriched thread
  items expose it as `isDone`. Besides the Watch Tower bulk actions, the
  thread list's "..." menu offers a "Mark as done"/"Mark as not done" toggle
  (see `docs/specs/cli-thread-read-state.md`).
- Section headers are one line at every width (OS-1449): the section title
  never wraps, and the muted description next to it truncates with an ellipsis
  when there is no room (mobile usually drops most of it).
- In list mode empty sections are omitted (the board keeps its columns — see
  below). Section visibility lives in the settings dropdown's checkbox list
  (checkbox on the left; the menu stays open on toggle) and is shared by both
  modes.
- Pagination is **per section** (OS-1259): each section is its own
  paginated query ordered by `lastActivityAt` desc (page size 25) with its
  own "Show more" button. Sections can never appear late: with the old
  single global feed, a sparse section (e.g. an old "Waiting for your
  input" thread) was invisible until enough pages happened to be loaded.
  Hidden sections skip their query entirely.
- Deleted threads never appear. Threads whose project was
  deleted are dropped (fail-soft).

## Team summaries (OS-1745)

The project Watch Tower defaults to **All threads**, including unattached threads
and top-level containers belonging to any owner in that project. **Only mine**
restricts it to the current user's rows. The filter applies to list and board.
It persists separately for each organization/project at
`convoy.watch-tower.project-scope.{organizationSlug}/{projectAlias}`; unknown
values fall back to all. The obsolete `convoy.watch-tower.scope` preference is
ignored. The top-level personal Watch Tower always requests owned rows.
Changing scope clears selection and pending deletion. Changing project or
organization remounts the dashboard, clearing both and restarting pagination.

Foreign rows show title, human owner name, runtime or container icon, container
child count, project, status and activity time. They have no conversation link,
preview, selection checkbox or mutation action, even if explicitly shared.
The API excludes their profile/path, branch, PR, diff, task, agent and workflow
identity enrichment. Shared conversation links elsewhere continue working under
the existing sharing policy. Missing owners display Unknown.

Only owned rows participate in Shift-select ranges and bulk actions. Own row
navigation, task links and actions remain available in either scope. Foreign
rows have no personal unread indicator. Buckets describe the owner's state;
opening Watch Tower never marks a teammate's thread read or done. All mode
uses Waiting for input and Needs review, with descriptions referring to the
owner. Container rows follow the same aggregation as Only mine.

Summary visibility requires the existing `CLI_THREAD` project permission and
organization membership. Project viewers and organization admins without a
project membership get no summaries from that project. Deleted projects and
threads are excluded; access removal updates the subscribed feed. Summary
visibility does not grant transcript access or permission to control a run.

## Container rows (OS-1984)

- Container placement comes from live children, with precedence
  `failed > waiting_input > running > needs_review > done`. Acknowledged
  failures and waiting states count as settled, using the same rule as
  standalone threads. Pending interactions and held queues count as waiting.
  Section display order remains unchanged.
- A nonempty container is in Done only when every live child is in the Done
  bucket. Reading children clears unread indicators but leaves review work in
  Needs your review. A child's new activity or cleared done mark moves the
  container back to the appropriate section. The container's own raw status,
  `doneAt`, and workflow-owned `aggregateStatus` cannot override child buckets.
- Empty workflow containers need review unless explicitly marked done after
  their latest activity. They remain visible even while a run has no lane
  threads. Ordinary groups dissolve on their last child's departure or
  deletion. The completed backfill soft-deleted historical ordinary groups with
  no live children, including groups whose children were all soft-deleted.
- The row's unread flag is `hasUnreadChildren`. Every unread list row,
  standalone or container, shows the shared unread indicator beside its
  title regardless of running or attention status. Settled board cards use
  their shared status indicator. The row's time is the container's
  monotonic `lastActivityAt`, advanced by child activity. Membership changes,
  attention acknowledgments, read/done changes, and deletion update the row in
  the same transaction. Agent-spawned descendants belong to the same container
  and stay excluded from the dashboard as separate rows.
- Group rows use a group icon and live child count. Workflow containers use
  the existing workflow glyph, name, and color. Both open the existing project
  conversation route using the container ID. List and board use the same
  enriched item and child-derived status. The workflow glyph is passive;
  clicks pass through it to the conversation link in both layouts.
- Branch and task chips identify the oldest live child's branch and task,
  matching the project Threads list. The branch falls back to the container's
  execution/profile path; an empty workflow can retain its preseeded origin
  task. These are origin metadata, not claims that all children share them.
  Container rows show no agent chip, PR badge, or diff totals. There is no
  group-wide PR or diff calculation, and copying one child's numbers would
  misrepresent the group. Container creation does not copy those fields from
  children, and CLI recording requires a claim, which containers cannot hold.
  List Changes shows its unset placeholder; board cards omit the totals.
- Container selection passes container IDs to existing batch mutations.
  Read/done/not-done/delete reuse their child cascades, ownership checks,
  project permissions, 50 selected-row cap, and 1000-row fan-out cap. A failed
  or waiting container may also contain running children; each child retains
  the existing cascade semantics, and live activity keeps the group out of Done.
- Desktop tray queries keep their kind-based indexes. They continue to show
  individual active/attention children and exclude containers.

## Board mode (OS-1595)

- Columns **are** the five sections, same fixed order left to right, same
  titles; the section description becomes the column dot's tooltip. There is no
  client-side grouping and no extra query: each column renders the section query
  the list already runs, so the two modes can never disagree on bucketing.
- **Empty columns stay rendered** (they show "Nothing here."), unlike the list,
  which omits empty sections: a board whose columns appear and vanish as agents
  finish is disorienting, and the column is the layout's visual anchor. A column
  hidden by the section filter is gone in both modes — the filter is shared, one
  key, because "what do I care about" is the same question either way.
- Per-column pagination: each column carries its own "Show more" under its card
  stack, driven by that section's own paginated query. Columns show no count
  badge — a page is 25 rows, so the number would understate a busy bucket.
- Cards mirror the project thread list's **non-compact card** layout (see
  `cli-thread-list.md`), two `minmax(0,1fr) auto` grid rows:
  1. task-ref chip (the shared `ThreadTaskRefLink`, ref only — the title
     carries the name) + thread title, with the status right-aligned
  2. project name · PR badge · branch, with `+/−` line totals, the agent chip,
     the runtime icon and the relative time right-aligned
  The status glyph comes from the shared `ThreadStatusIndicator` and its word
  from `THREAD_STATUS_META`, via `getThreadDisplayStatus` — not a local switch
  (see the frontend guidelines' status-glyph rule). A **settled** thread shows
  only the bare glyph, no word: the column already says the bucket, the same
  reasoning that drops the list's Status column on mobile. Live and blocked
  states keep their word, since the bucket alone doesn't distinguish e.g.
  Working from Queued. The unclaimed-queue state (`pending` +
  `processingState: idle`) keeps its explicit "Waiting for agent" — a real
  sub-state inside Running that the shared status union has no member for.
  An unset diff renders nothing here, unlike the list's fixed Changes column
  with its "—" placeholder.
- Card selection: the title starts flush with the card's leading edge — the
  checkbox slot is `hidden` at rest (not merely transparent, which would leave a
  permanent indent) and pushes the title right when it appears, exactly like the
  project thread list's card. Only the **hovered** card reveals its own; as soon
  as the column has any selection every card in it keeps its checkbox visible,
  matching the list's rule.
- Board mode gets a **bordered page header bar** (title + settings control,
  full-bleed, `border-b`) whose bottom border doubles as the top edge of the
  column strip, so header and board read as one surface. It matches the project
  task views' header bar — `h-14`, `px-4`, `text-sm font-medium` — because a
  full-height board is an app surface, so its title sits on the app-chrome scale
  rather than the page-title one. List mode keeps its page-scale title above a
  centered `max-w-5xl` column.
- Columns **share the available width evenly** rather than sitting at the task
  board's fixed `w-80` (`BoardLayout`'s `fillWidth`): with five columns and a
  wide viewport the board fills the space instead of leaving a gap. Equal
  *shares* are not enough for equal *widths* — a flex item's default
  `min-width: auto` floors it at its own content, so the column holding the
  longest card title ends up wider than its neighbours. The floor therefore
  lives on the column wrapper (identical for all: `md:min-w-80`) and both the
  track and the column drop theirs (`md:min-w-0`); the track must also drop
  `min-w-max`, which would size it to the sum of every column's widest card and
  overflow the viewport. Once the shares reach the floor the board scrolls
  horizontally, exactly like the task board.
- `fillWidth` is opt-in for boards with a small fixed column set; a board whose
  column count follows the data (the task board's label/assignee lenses) keeps
  fixed widths, since equal shares get absurd at two columns.
- The board is a full-height scroller. On mobile it reuses the task board's
  scroll-snap gallery (one column per view, neighbors peeking) and clears the
  bottom nav bar.
- Loading: the header and view settings stay mounted in both views. The board
  renders its columns immediately and lets each show its own spinner, so one
  slow bucket never blanks the page. The list shows row skeletons in place of
  its sections until the first page arrives.
- **No drag-and-drop**, deliberately. The column is a *derived* projection, not
  a settable field: only two of the twenty column pairs are legal user intents
  (anything → Done, Done → Needs review), and Running can never be a drag source
  or target at all because its bucket follows live run state — a card dragged
  out of it would snap back. Both legal moves are already one click away as bulk
  actions, so the bulk of a DnD implementation would be rejecting illegal drops.
  There is also no intra-column ordering: columns are server-ordered by
  `lastActivityAt` and no rank field exists. If drag is ever added, scope it to
  those two transitions and keep Running inert.

## Batch actions (OS-1255)

- Hovering a row swaps the CLI runtime icon for a checkbox; clicking it
  selects the row without navigating (plain row clicks still navigate).
  While a section has any selection, every row in that section shows its
  checkbox persistently. Shift+click selects the range from the last
  clicked row, within the section's visible order.
- Selection is scoped to **one section at a time**: clicking a checkbox in
  another section starts a new selection there and clears the current one.
  Escape or the header's ✕ clears the selection. Selection is capped at
  **50** rows (`THREAD_BATCH_ACTION_MAX`, `lib/threads/constants.ts`) —
  further clicks are clamped and the header count shows "(max)".
- When a section has selected rows, its header shows right-aligned actions
  (sized to the title's line height so appearing/disappearing never shifts
  the table): count, **Mark as read** and **Mark as done** (only in Waiting
  for your input / Failed / Needs your review), **Move to review** (only in
  Done — clears the done mark), **Delete** (confirmation
  dialog), and ✕. Actions receive only ids currently visible in that
  section. The **Running** section has no checkboxes and no bulk actions —
  bulk-acting on mid-flight threads is deliberately not offered.
- In **board mode** the selection model is identical (one column at a time, same
  cap, same per-section action policy), only the chrome differs: the card
  reveals a checkbox at the start of its title line on hover (not swapped for
  the runtime icon — that lives on the card's footer line, where a checkbox
  would read as a footer control), and the owning column's header gives up its title
  for the selection's actions — short-label/icon buttons with tooltips, since a
  `w-80` header cannot fit the list's full-text buttons. The column header has a
  fixed height, so a live selection's taller controls can't grow it — columns
  share one border line across the board, and only the selected column's would
  step out of alignment.
  Keeping the actions *in the column* is what makes the one-column-at-a-time
  model legible; a board-wide floating action bar is the documented plan B if
  the header proves too cramped in practice, at the cost of hiding which column
  a selection belongs to (worse on mobile, where that column can be scrolled
  off-screen). Switching layout modes clears any selection, since each mode
  re-derives the section's visible order.
- Backend: `cli/threads/batch.batchMarkRead` / `batchMarkDone` / `batchMarkNotDone`
  / `batchRemove`, each taking up to 50 `threadIds`
  (`ConvexError` above the cap). Per id they are fail-soft: missing, deleted,
  foreign, or inaccessible threads are skipped, not errors — selections can
  go stale between render and click. `batchMarkRead` and `batchMarkDone`
  always acknowledge attention (so failed/waiting rows demote, matching the
  section the action is offered in).
  `batchRemove` reuses the single-thread delete path per thread (fail
  streaming run / requeue claimed, then soft delete). No optimistic
  updates: the reactive Watch Tower query drops the rows on commit.

## Data model & backend

- **Denormalized bucket** (OS-1259): `cliThreads.statusProjection.watchTowerStatus`
  (`running | waiting_input | failed | needs_review | done`) stores the
  Watch Tower bucket so each section is a plain indexed equality query.
  It is never written directly: `deriveThreadStatusProjection`
  (`convex/cli/lib/watchStatus.ts`, the single source of truth for the
  bucket rule, attention rule, unread rule, and done rule) recomputes the
  whole `statusProjection` object inside `cliThreadsRepo` on every write that
  touches an input field (`status`, `readAt`, `attentionAcknowledgedAt`,
  `doneAt`, `lastActivityAt`, `hasPendingInteraction`, `queueHeldAt`) via
  `patchThreadWithStatusProjection`. Any new repo write helper touching those
  fields must go through that helper — a bare `ctx.db.patch` desyncs the
  projection silently.
- **Denormalized done flag** (OS-1451): `cliThreads.statusProjection.isDone`
  stores the `isThreadDone` rule on its own,
  indexed, for the thread list's Active/Done sections (see
  `cli-thread-list.md`). It is a sibling of the bucket rather than a reading
  of it: the bucket collapses done-ness with attention state, so a running
  or failed thread also carries a meaningful `isDone: false`.
- Container `childWatchStatus` stores the child fold independently of
  workflow-run `aggregateStatus`. `deriveThreadStatusProjection` uses this
  bucket for containers while preserving the existing timestamp-based
  `statusProjection.isDone` used by the project Threads list. Watch Tower's
  returned container `isDone` instead reflects its Done bucket.
- The write seam compares all five child bucket ranks. Rising contributions
  update the container directly; falling contributions recompute from the
  bounded child set. This includes transitions between review and done even
  though both map to `aggregateStatus: idle`. New children retain the O(1)
  insertion fold, and cascades recompute once at the end.
- Watch Tower index:
  `cliThreads.by_user_deleted_parent_watchTowerStatus_lastActivity`, with
  `parentThreadId` unset. Desktop attention queries retain
  `by_user_deleted_kind_watchTowerStatus_lastActivity` with `kind` unset.
- The OS-1984 container backfill is complete. Its migration, verifier,
  readiness index, and legacy feed have been removed. Watch Tower always uses
  the parent-aware index, without a deployment-wide readiness lookup.
  New containers seed `childWatchStatus` at creation. The field remains
  optional because standalone threads and historical deleted containers can
  lack it; live container writes maintain the child fold.
- Personal query: `cli/threads/lists.listMine({ organizationSlug, section })`.
  It is always owner-only, uses the existing user index, and filters by
  organization and project access before enrichment. Short/empty filtered
  pages retain native pagination; the hook continues past empty pages.
- Project query: `cli/threads/lists.listProjectWatchTower({ organizationSlug,
  projectAlias, section, scope? })`. Omitted scope means all. Resolve the live
  project by org/alias, authorize `CLI_THREAD` using the loaded document, then
  paginate directly. All uses
  `by_project_deleted_parent_watchTowerStatus_lastActivity`; mine uses
  `by_user_project_deleted_parent_watchTowerStatus_lastActivity`. Both fix
  deletion, absent parent and section and order by descending activity.
  Native Convex pagination owns cursors and reactive page splitting.
  No project-membership enumeration, cross-project stream merge, new stored
  field, data migration or custom cursor is required.
- Both queries return a dedicated summary validator/projection in
  `cli/threads/lib/validators.ts`. Only owned rows get existing enrichment.
  Summaries omit unused pending-message and queue-hold fields.
  Foreign rows batch-fetch distinct owners, never profiles, tasks, agents,
  workflows, messages or chunks.
- Project discovery costs one indexed project lookup and up to two membership
  lookups per page execution, excluding authentication and organization lookup.
  This is independent of the user's total project memberships. Add one indexed
  thread page, U foreign owner-document reads and enrichment for owned rows.
  Database reads fetch full thread/user documents even though returned foreign
  summaries are small. These counts describe code operations, not measured
  billing or network round trips.
- Each visible section has one initial paginated subscription, at most five;
  hidden sections skip it. Loading more retains additional reactive pages.
  The two new indexes add storage and maintenance but no application writes.
  Ordinary chunk appends write chunks and stream heads, not thread activity.
  Claim heartbeats, usage-cursor updates and metadata/lifecycle writes can still
  invalidate relevant thread readers. Bucket changes can affect both old and
  new sections; thread writes do not automatically rerun all five. Measure
  executions, documents/bytes read and response bytes under concurrent viewers
  before adding throttling or projections.
- Unauthenticated callers, unknown/deleted organizations or projects, and
  callers without project permission get empty pages. Scope changes restart
  cursors; organization/project navigation resets the whole dashboard state.
- Frontend: `useWatchTowerSection(organizationSlug, section, project?)`
  (`lib/watch-tower/use-watch-tower-threads.ts`) wraps
  `usePaginatedQuery`; `project` groups `{ projectAlias, scope }`, omitted for
  the personal view. Pass undefined organizationSlug to skip hidden sections;
  the module (`components/blocks/watch-tower/watch-tower-page.tsx`) calls it once
  per section and renders each section's rows directly — no client-side
  bucketing.
- Layout split (OS-1595): the page owns data, selection and mutations and
  delegates rendering to `thread-list.tsx` (sections) or `thread-board.tsx`
  (columns). Shared per-thread parts live in `thread-meta.tsx` (the project ·
  PR · branch · task cluster) and `thread-status.tsx` (bucket glyphs), so the
  row and the card cannot drift. Preferences and the canonical section list live
  in `lib/watch-tower/watch-tower-view.ts`. The board composes the same generic
  `components/blocks/board/` primitives as the project task board
  (`BoardLayout` + `BoardColumn`), but not its `KanbanCard` — every field on
  that one is a task field.

## Deferred

- **"By task status" grouping** (OS-1254): second lens grouping threads by
  the linked task's status, with a "No task" group pinned last; requires the
  task's `status` in the CLI task summary.
- Project and time-window filters (the playground mocked "All projects" /
  "Last week" toolbar buttons).
- Per-section pagination ("Recently finished" beyond the global feed).

## Related

- `docs/specs/cli-thread-run-diffs.md` — per-run diff summaries and the
  denormalized thread line totals (OS-1252) behind the Changes column.
- `docs/specs/cli-thread-read-state.md` — the read/attention semantics
  (`readAt`, `attentionAcknowledgedAt`) this dashboard derives its "needs
  review" and demotion rules from.

## Module boundary

`components/blocks/watch-tower/index.ts` exports only WatchTowerPage. Its private
hook and preferences live in `lib/watch-tower`. Both routes mount that export;
the route helper and sidebar links/active state are the other wiring points.
ESLint enforces the boundary. Thread schema, repo and query changes stay in the
existing CLI thread module. No CLI or desktop behavior changes.
