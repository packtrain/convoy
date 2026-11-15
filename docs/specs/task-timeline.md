# Task Timeline

The task detail sidebar's single merged feed: comments, agent threads, and
activity in one reverse-chronological stream, replacing the
`Comments` / `Threads` / `All activity` tabs and their pinned footer composer.
Parent: OS-1388. Prototype: `/playground/timeline`.

Related specs: `docs/specs/task-comments.md` (the comment composer's own
rules), `docs/specs/task-activity-log.md` (the event catalog),
`docs/specs/task-associated-threads.md` (association source and the `/threads`
handoff), `docs/specs/cli-thread-sharing.md` (why a foreign thread row may fail
to open), `docs/specs/task-detail-metadata.md` (the `Threads` metadata row).

## Row kinds

Three, and each renders with the component that already owns it — the timeline
contributes layout, not new presentation. Renderers live in
`components/blocks/tasks/task-timeline/`, dispatched by kind through
`TimelineBlockRow`:

| Kind | Source | Renders as |
|---|---|---|
| `activity` | `taskActivityLogs` | `TimelineActivityGroup` — icon + one line of text on a shared vertical rail; consecutive rows group under one rail |
| `comment` | `taskComments` | `CommentItem` — the comment **is** the row, not a "added a comment" pointer to it |
| `thread` | `cliThreads` / `tasks.agentThreadWork` | `TimelineThreadRowCard`, wrapping `CompactThreadRowContent` — title, CLI icon, status indicator, relative time, plus the owner's name on another user's thread |

A thread row needs route params to build its href, so `TimelineBlockRow` skips
thread blocks without them rather than rendering a dead row. Outside a project
route the threads toggle is hidden anyway, so the source is off — this is the
belt to that braces.

### One value carries the project route

`TimelineThreadContext` (`lib/tasks/timeline/rows.ts`) holds `projectId`,
`organizationSlug`, and `projectAlias` **together**, resolved once in the sidebar
and passed down as a unit. Presence of the object *is* the predicate "is there a
project route", so no consumer re-derives it.

This replaced three optional string props threaded through four components, each
re-testing them under a different name — and one of those tests omitted
`projectId`, so the four were not equivalent. They agreed only because no thread
row is ever built without a `projectId`, a coupling invisible from the file that
depended on it. The object makes the relationship a type error instead of a
convention.

It is memoized at the sidebar, because the timeline's merge memo depends on it: a
fresh object per render would re-sort the whole loaded window on every paint.

A comment or thread row breaks an activity group. **Consecutive activity rows
share a rail regardless of user or time gap**, because every rail row carries
its own icon, actor, and timestamp. Splitting would break the shared vertical
line with no other visible effect.

The retired `All activity` tab did split, on same-user-within-~1s. That rule
went with it: `useTaskActivity` owned the window and had no other caller, so
nothing in the app groups activity that way any more.

### The event catalog has one home

Row copy comes from `describeActivity` in
`components/blocks/activity/activity-item.tsx`, shared with the activity log.
It returns `{ icon, text }` rather than one node because the two hosts place the
glyph differently: the activity log renders it inline at the head of the
sentence, the rail hoists it into a gutter beside the line. Wording must never
be reimplemented per surface — the prototype did exactly that as seed data, and
two copies of an event catalog drift.

`icon` is null for value-change events (status, priority, type) whose glyph is
the value itself, rendered as a badge inside `text`. The rail substitutes a
neutral glyph so those rows keep the gutter column.

Thread rows show **no** avatar and **no** message count. The owner's name is
sufficient attribution, and `agentThreadWork` carries no `avatarUrl` — an
avatar would need a per-entry user read for foreign rows.

A thread row is a bordered card so it reads as an object in the stream rather
than another activity line, and passes `forceStatusIndicator` so completed and
streaming rows align: without it a read completed row drops the leading grid
column and its title shifts left of every running row. For such a row the slot
holds an `aria-hidden` spacer — reserving the column *is* the point, not drawing
a glyph.

### A thread row words its status

It also passes `showStatusLabel`, so the state reads as a word — `Working`,
`Queued`, `Waiting`, `Failed`, `Done` — between the CLI icon and the relative
time. A thread is the only row kind whose state outlives its own creation, and
the glyph cannot carry that alone: on a read completed run the indicator is the
`aria-hidden` spacer above, so an unlabelled card said nothing at all about how
the run ended.

`showStatusLabel` is **off by default** on `CompactThreadRowContent`. In a dense
thread list the glyph suffices and the metadata column is spoken for; the label
is for a row standing alone in a mixed stream.

The wording lives in `THREAD_STATUS_META` (`lib/threads/status-meta.ts`), now the
**single label catalog** for a thread's status. Three surfaces had their own copy
before this, and they had already drifted — `waiting_input` read `Waiting` in the
thread list and `Needs input` in the Runs column, for one state. All three now
source it:

| Surface | Was | Now |
|---|---|---|
| full thread-list row (`thread-list-item.tsx`) | private `FULL_ROW_STATUS_META` | `THREAD_STATUS_META` |
| Runs column / agent-work tooltip (`agent-thread-work-status.tsx`) | `AGENT_THREAD_WORK_STATUS_META` (labels + dot colors) | `getAgentThreadWorkStatusLabel`, wrapping the catalog; the file keeps only its dot colors |
| compact row (thread lists, Runs popover, timeline) | glyph only, no words | `showStatusLabel` |

Only the words and their color are shared. A surface still owns its glyph
(spinner vs. dot vs. spacer) and whether to label at all — the full row hides the
label on `completed`, the compact row shows it on request. `completed` is `Done`,
the wording the Runs column already used, and muted: a finished run is the
resting state and must not compete with live ones for attention.

### A thread row also shows read state

`isUnread` and `isDone` come from the own-thread query and render in the same
indicator slot: the blue dot the `Threads` metadata field shows for that thread,
and the check once it is marked done. Without them the timeline card contradicted
the field directly above it — same thread, dot in one place and not the other.

Both are **own-thread only**. `agentThreadWork` carries no per-viewer read state,
and "unread" is not a meaningful claim about a teammate's run: it would paint a
blue dot the viewer can never clear. `buildTimelineThreadRows` reports foreign
rows as neither, and that is asserted rather than incidental.

Read state is per-viewer live data, so it updates as the thread is opened — it is
not retrospective the way a snapshotted `agentThreadWork` field would be.

### A workflow run's row is marked by a glyph

The stream mixes plain threads with workflow runs and nothing else told them
apart (OS-1879). A run's row carries the plain `ThreadWorkflowRowBadge` glyph
before its title: no workflow color and no editor link, unlike the thread
list's badge — neither source here resolves the workflow identity, and marking
the row kind doesn't need it.

The glyph means "this row *is* the run", so only the run's container qualifies:
a lane thread carries `workflowRunId` too but sits inside the run, and badging
it would show one run twice with no distinction. An own row is the container
when it has no `parentThreadId`. A foreign row never gets the glyph — a
`workflow_run`-sourced `agentThreadWork` entry is a *lane* (the container syncs
as `manual_attachment`) and the entry carries no parent, so a foreign container
cannot be identified without widening the entry contract.

### The rail column is one shared fact

Every row aligns on the activity rail's icon column, and each row kind sits behind
different padding, so each needs a different offset to land there. Those offsets
are arithmetic over *other* components' internals — the rail's `left-1`/`size-5`,
`CompactThreadRowContent`'s border and `pl-2`, a trigger icon's `size-4`.

They live in `task-timeline/rail-geometry.ts` as named constants, not as literals
in the components. Previously three files held magic pixel values derived from
padding in four others that had no idea they were load-bearing: changing the
rail's `left-1` silently misaligned two unrelated components with no test
failure. The source sites now carry comments pointing here.

Tailwind needs arbitrary values literal in the class string, so the classes are
written out and `rail-geometry.test.ts` asserts they still match the arithmetic.
That is the guard a `toContain("-mx-[3px]")` assertion could not be — it pinned
the string while the pixels behind it were free to drift.

### Where the row model lives

The merge, ordering, activity grouping, and thread splice are pure functions in
`lib/tasks/timeline/rows.ts`, tested independently: they are cheap to get subtly
wrong and expensive to see in a rendered sidebar. Both thread sources flatten to
one `TimelineThreadRow` shape there, carrying `createdAt` (sort) and
`lastActivityAt` (display) as separate fields so a renderer cannot conflate
them. Own-thread display status is injected rather than imported, keeping the
module free of thread-status policy.

Merging sorts on `at` alone and relies on a **stable** sort, so rows tied to one
millisecond keep the order the server emitted them in — itself already exact by
`(createdAt, _creationTime)`. Flipping to ascending display reverses the array,
which mirrors tie order rather than scrambling it; a comparator with a synthetic
tiebreak would not.

## Ordering

**Every source sorts by `createdAt`**, so a row holds its position in history
instead of drifting as it changes. A thread that has streamed for an hour stays
where it started.

A thread card still *displays* `lastActivityAt` ("2m"). Sort position and
displayed timestamp are deliberately different things; do not "fix" one to
match the other.

Display default is **oldest-first** (ascending), matching the prototype and
today's comment list: the stream reads top-to-bottom into the composer at the
bottom. In that direction `Load more` sits at the **top** of the stream and
prepends older entries. The viewer can flip it — see **Sort direction**, and
**Pagination** for why the flip is display-only.

This flips the old `All activity` tab, which rendered newest-first. The two tabs
disagreed with each other; one merged stream cannot, and the comment reading
order wins because the composer is at the bottom.

## Where each source is read

| Source | Read | Ordering index |
|---|---|---|
| activity | `tasks.timeline.listByTask` (new) | `taskActivityLogs.by_task_and_createdAt` |
| comments | `tasks.timeline.listByTask` (new) | `taskComments.by_task_and_createdAt` |
| own threads | `cli.threads.lists.listByAssociatedTask` (existing) | `by_user_project_task_deleted_lastActivity` |
| others' threads | `task.agentThreadWork` (denormalized on the task doc) | in-memory |

Row payloads are **byte-identical to the single-source queries'**, because both
callers share one hydrator per kind (`tasks/lib/activity/hydrate.ts`,
`tasks/lib/comments/hydrate.ts`): actor name/avatar for activity; author,
attachments with signed storage URLs, and `canEdit`/`canDelete` for comments.
Enrichment must not be reimplemented per query — the tab-era duplication is
exactly how the two tabs came to disagree.

### Threads are not in the merge query

The merge query reads two tables. Threads come from data the sidebar already
holds:

- **Own threads** — `cli.threads.lists.listByAssociatedTask`, the same query the
  removed `Threads` tab used.
- **Other users' threads** — the entries in `task.agentThreadWork` whose
  `threadId` is *not* among the ids that query returned. This is exactly how
  the Runs column renders foreign threads
  (`agent-thread-work-cell.tsx`) — no extra query, and the entry shape
  physically has no message content, so nothing can leak through it.

`agentThreadWork` is the **only** place a task can see another user's threads.
Every thread list index leads with `userId`, and thread sharing deliberately
kept it that way: *"a shared thread never appears in a teammate's thread list"*
is a stated invariant of `docs/specs/cli-thread-sharing.md`. The split read is
therefore the permanent design, not a bridge to a future project-wide query.

**Load-order guard.** While `listByAssociatedTask` is unresolved the own-id set
is empty, so the viewer's own threads would momentarily match the "not mine"
test and render as foreign. Withhold foreign rows until that query resolves
(`isLoading ? [] : …`), as the Runs column does.

### Every thread row is clickable

Including a foreign one, and including a foreign one that is not shared. Such a
row navigates to the thread route, where `getViewableThread` returns null and
the viewer gets `Thread not found`.

Deliberate. Pre-empting it would mean denormalizing `sharedAt` (and a group
container's `sharedAt`) onto `agentThreadWork`, which is a drift class and an
extra write on a hot path, to avoid a dead end a viewer reaches only by
clicking someone else's unshared run. Not worth it.

## Pagination

```
tasks.timeline.listByTask({ taskId, sources, before?, limit })
  → { items: Array<{ kind, at, activity | comment }>,
      nextBefore: { at, creationTime } | null,
      isDone: boolean }
```

**Not `.paginate()`.** A Convex cursor is per-table and per-index; it cannot
span a merge of two tables.

### The cursor is a position, not a timestamp

`nextBefore` is a composite `{ at, creationTime }`: `at` is `createdAt`, and
`creationTime` is the row's `_creationTime`.

**A bare `createdAt` watermark is not sufficient, and using one silently loses
rows.** `createdAt` has no uniqueness — a single `tasks.core.update` touching
status + priority + name writes three activity rows in the same millisecond — so
a scalar cursor cannot express "resume partway through this millisecond". Any
page boundary landing inside a tied group either drops the unread remainder (if
the next page reads `< at`) or repeats it (if `<= at`).

`_creationTime` fixes this because Convex keeps it strictly distinct even for
rows written in one mutation, and orders it as the implicit final field of every
index. So `(createdAt, _creationTime)` is a total order matching the index's
own, and resuming mid-millisecond is exact.

This is why there is **no tie-extension rule**: a page may end inside a tied
millisecond, and never returns more than `limit` rows.

`at` is also hoisted onto each item so the client can order without
discriminating on `kind` first. `nextBefore` is null exactly when `isDone`.

### Input contract

`limit` is clamped server-side to 1..100 — the argument is a client hint, not a
licence to read a whole table in one call. A **non-finite** `limit` falls back to
the default page size rather than clamping: `Math.min`/`Math.max` propagate
`NaN`, which would reach `.take(NaN)` and throw, and this handler's every other
boundary deliberately fails soft so the sidebar cannot blank out.

A **non-finite cursor is treated as absent.** Convex's index range degenerates
to unbounded on a `NaN` comparison, so a corrupt cursor would otherwise restart
the feed from the newest row while appearing to resume. Cursors round-trip
through client state, so this must be total.

The query is **session-auth only**: no `apiKey` argument. Its one consumer is
the sidebar, and adding an unused key path to a merged read is API surface
nothing exercises. `tasks.comments.listByTask` keeps its key path — the MCP
task resource reads through it. `tasks.activity.listByTask` never had one.

### Per page

1. For each **enabled** source, read `limit` rows descending, resuming strictly
   after `before` (or from the newest row when `before` is absent). Resuming
   takes **two index reads** per source: one `eq(createdAt, at)` +
   `lt(_creationTime, creationTime)` to finish the boundary millisecond, then
   `lt(createdAt, at)` for whatever older rows still fit. Both are index-only
   and bounded by `limit`.
2. Merge by `(createdAt, _creationTime)` descending — the same order the index
   uses, which is what makes paging exact.
3. Truncate to `limit`.
4. Return the last emitted row's position as the next `before`, and `isDone`
   when no enabled source has rows past it.

"Has more" is derived **structurally** — a source's read capped out, or its
oldest read row sorts past the page boundary — never by object identity of the
row instances. Identity happens to work today, but a later normalization step
that copies rows would break it into always-true, yielding endless pagination
with nothing to catch it.

A source that read exactly `limit` rows is indistinguishable from one holding
more, so when the data divides evenly the last content page reports
`isDone: false` and the following page comes back empty and done. The client
must treat `isDone`, not an empty page, as the end signal — and must not
render "no activity" for that trailing empty page.

**Always paginate newest-first**, regardless of the display direction. One
cursor rule, one code path; the sort toggle reverses the already-loaded array.
Ascending display consequently loads *toward* the top of the stream, which is
what puts `Load more` there.

### The client side of the cursor

`usePaginatedQuery` cannot host this — it requires a `.paginate()` query — so
`lib/tasks/hooks/detail/use-task-timeline.ts` accumulates pages itself: an array
of cursors, one `useQuery` **per loaded page** via `useQueries`, flattened
newest-first.

One subscription per page rather than one snapshot per page is the point: a
comment edited three pages up still streams in. Copying resolved pages into
local state would freeze every page but the newest.

Only the resolved **prefix** is rendered. Pages resolve out of order routinely
(an older page may already be cached), and splicing around a gap would put rows
out of order.

Changing `taskId` **or the source set** resets the window. A cursor earned under
three sources cannot resume against two — the rows it points past may not be read
at all any more — so the reset is a correctness requirement, not tidiness.

**This is the only comment/activity list subscription in the sidebar.**
`useTaskComments` holds mutations only: it used to paginate
`tasks.comments.listByTask` for the `Comments` tab, and keeping that would mean
two extra live reads per open sidebar (the composer and the timeline both call
it) of rows the merge query already delivers.

**Thread splice rule.** Threads are not paginated — both thread sources load
whole, and the count per task is small. Render only threads whose `createdAt`
is at or above the current **page floor**: the `at` of the oldest loaded
activity/comment row (i.e. `nextBefore.at`). Otherwise a year-old thread appears
above content that has not loaded yet. Comparing on `at` alone is right here —
threads have no `_creationTime` in this ordering, and a thread tied with the
floor row renders rather than being withheld. When every enabled server source is exhausted (`isDone`), or when
no server source is enabled at all, the floor is unbounded and every thread
renders.

`createdAt` for a foreign thread comes from the `agentThreadWork` entry
(OS-1588), snapshotted from the thread on first sync and preserved afterwards so
it does not drift as the run progresses. An entry written before that field
existed falls back to its `updatedAt`, which places it later in history than it
belongs — acceptable for pre-existing rows, and it self-corrects on the entry's
next sync, which backfills the field
(`docs/specs/agent-automation.md`).

That fallback is `getAgentThreadWorkSortKey`, and it is **permanent, not a
migration window**: a legacy entry only backfills when its thread next changes
state, and a finished run may never have one. Read a foreign row's sort key
through that helper rather than reaching for `entry.createdAt` directly.

## Source toggles

Three independent on/off toggles — comments, threads, activity — all **on** by
default, plus the sort-direction control. Both live in one `ListFilter` menu in
the timeline's header (`timeline-header.tsx`), whose source rows carry the icons
the retired tabs used — `MessageSquare`, `MessageSquareMore`, `Activity` — so
the vocabulary survives the cutover.

Independent checkboxes, not a mode switch: a radio group cannot express
"comments + threads, activity off", which is the combination most people want.

**A disabled source is a read that is skipped entirely**, not a read that is
filtered. A narrowed feed is strictly cheaper than the full one, and it is why
the merge query beats folding everything into `taskActivityLogs`: on one table,
"comments only" would need either a composite index per subset or a post-read
filter (rejected below). For the client-side thread source, "skipped" means
`listByAssociatedTask` is passed `"skip"` — not that its rows are dropped after
loading.

The threads toggle is only available where the thread source is: the sidebar
needs `projectId`, `organizationSlug`, and `projectAlias` to build thread
routes. Outside a project route the toggle is hidden and the stream is
comments + activity.

The trigger is **marked when any source is off**, otherwise a narrowed feed
reads as a quiet task. Only sources the viewer is actually offered count toward
that: a stored-off `threads` pref survives navigating away from a project route,
and flagging it there would point at a control that isn't rendered, with nothing
to restore.

### The prefs are per-viewer and browser-local

`lib/tasks/timeline-view-prefs.ts`, following
`lib/threads/changes-view-prefs.ts` — browser UI preferences, not server state,
failing soft to the defaults on any storage error. Deliberately not project
config: `useProjectTaskTableColumnVisibility` is shared across the project and
`canEdit`-gated, neither of which is right for "what I want to look at".

One key per source rather than one packed value, and **only an explicit `"0"`
turns a source off**. That inverts `changes-view-prefs`'s `storedIs` shorthand,
which is why the helper does not carry over: there every pref is two-valued and
an absent key means "the default, the one that isn't stored". Here the default is
*on*, so an absent — or corrupt — key must read as on. A storage failure
therefore widens the feed, never narrows it.

`use-timeline-view-state.ts` reads both prefs **synchronously in a `useState`
initializer**, not in an effect. `sources` is part of `useTaskTimeline`'s window
key, so seeding from the defaults and correcting afterwards would subscribe page
0 under the wrong source set, discard it, and re-subscribe — a wasted round trip
on every sidebar open for anyone who has narrowed their feed. The persist call
sits beside `setState` rather than inside its updater, which StrictMode invokes
twice.

The hook is colocated with the timeline subtree it drives rather than living in
`lib/tasks/hooks/`, because nothing else reads these prefs.

## Sort direction

Display-only. The query always paginates newest-first — one cursor rule, one code
path — and `mergeTimelineRows` takes the `direction` argument that reverses the
already-loaded window, mirroring tie order rather than scrambling it.

`Load more` walks backwards in time either way, so it sits at whichever end holds
the oldest row: the **top** in the default ascending display, the **bottom** when
reading newest-first. It is one element rendered in one of two positions, not two
buttons — its `isDone` gate and loading state cannot drift between directions.

### The whole surface reverses, not just the row order

The composer belongs at the end the **newest** row is at, so flipping the sort
flips the layout with it:

| Reading | Top → bottom |
|---|---|
| oldest-first (default) | header · `Load more` · rows · trigger row · open composer |
| newest-first | header · open composer · trigger row · rows · `Load more` |

The collapsed trigger row always sits on the **stream side** of the open
composer, so it reads as the next thing past the newest row; the open composer
sits at the outer edge against the panel boundary. Reading oldest-first it
closes the panel and carries bottom padding to sit off that boundary; reading
newest-first it opens the panel directly under the header, whose own bottom
spacing already separates the two — a second top padding there reads as a gap.

The **header does not move**. It labels the section and owns the control that
does the flipping — sliding it out from under the pointer on use would be
self-defeating.

Both flips reorder a **keyed** two-element array rather than branching into two
JSX trees. Keys are by identity, not position: an index-keyed (or keyless)
reorder makes React reconcile the composer against the stream at slot 0 and
remount both, which discards exactly what the stay-mounted rule below protects —
in-flight attachment uploads and the thread draft provider. Two hand-written
branches would instead let the two orders' props drift apart.

The `+` action on the `Threads` metadata row scrolls to the composer, so it
targets `block: "end"` or `"start"` per direction; scrolling to `end`
unconditionally would land on the oldest rows for a newest-first reader. It reads
the pref at click time rather than lifting the timeline's view state into the
sidebar, which is sound because `useTimelineViewState` persists before it
re-renders.

## `comment_added` is no longer written

In a unified timeline the comment itself is the row, so a `comment_added`
activity row beside it is a duplicate.

It is removed at the **write** site — the `logTaskActivity.commentAdded` call
in `convex/tasks/comments.ts`. Filtering at read time is not available: Convex
cannot index a `!=`, and a post-read filter breaks the page-size contract (take
20, drop 6, return 14, but consume 20 positions of the cursor).

The `emitEvent({ type: "task.comment_added" })` call beside it **stays** — that
is the notification bus and is unrelated.

The `comment_added` literal stays in `eventTypeValidator` and in the frontend
`ActivityEventType` union: historical rows exist and must still validate.
`changeDetails` carries only a `commentId`, so nothing could be backfilled from
them anyway.

**Historical rows render as nothing** — `describeActivity` returns a descriptor
with null text for `comment_added`. No query filter, so the cursor stays exact; a
page on an old task simply shows fewer visible rows than it fetched.

The **whole row** goes, not just its description: a bare avatar and timestamp
still reads as an entry. `isRenderableActivity` is the shared predicate, and
every activity host filters on it before drawing chrome. `TimelineActivityGroup`
is now the only host: it drops such rows before drawing the rail, so a group of
only retired events renders nothing at all, line included. (The avatar-attributed
`ActivityItem` / `ActivityGroup` gated on the same predicate and went with the
`All activity` tab.)

## The composer

One composer at the newest end of the stream, in-stream rather than pinned,
hosting both actions with one open at a time:

- the **thread composer** open by default, with a collapsed `Add comment...`
  trigger row on the stream side of it;
- choosing that trigger swaps in the **comment composer** and collapses the
  thread side to a `Start a thread...` trigger.

Which end that is, and whether the trigger row lands above or below, follows the
sort direction — see **Sort direction**.

Both keep their existing behavior in full: the comment composer's `Enter` /
`Shift+Enter`, clipboard-image paste, and attachment-upload timing
(`docs/specs/task-comments.md`); the thread composer's context bar, its
preattached and locked task pill, and its draft scope key `task:<taskId>`
(`docs/specs/task-associated-threads.md`, `docs/specs/cli-thread-drafts.md`).

The thread side is `TaskThreadComposer`
(`components/blocks/tasks/task-thread-composer/`). It is the same component the
Runs popover hosts — drafts, profiles, project agents, attachment upload,
remembered CLI selections, and the locked task pill — and it lived under
`task-detail-sidebar/` as `task-threads-footer.tsx` until the tabs went. Its top
border is **opt-in** (`bordered`), because in-stream a full-width rule reads as a
section divider that isn't there.

Both composers stay **mounted** when collapsed, hidden rather than unmounted:
unmounting the comment side drops its in-flight attachment uploads, and
unmounting the thread side tears down its draft provider mid-edit.

Outside a project route there is no thread side, so the comment composer is the
whole composer and neither trigger row renders.

An **archived** task keeps the whole stream visible and disables both
composers.

The `+` action on the `Threads` metadata row focuses the timeline's thread
composer — opening the thread side if the comment composer is showing — and
preserves the existing draft. It no longer switches a tab. It scrolls to
whichever end the composer is on (**Sort direction**).

## Loading and empty states

- While the first page is loading, the stream region renders skeleton rows.
- With every enabled source resolved and empty, the region renders
  `No activity yet`.
- With **every** source toggled off, the region says so rather than showing the
  empty state — an empty feed the user caused is not an empty task. That case is
  checked *before* the loading state: with nothing enabled there is no page to
  wait for, so a skeleton there would spin on a request that is never made.

The empty state requires `isDone`, not merely "not loading". A resolved page can
group to **zero visible rows while older rows remain**: retired `comment_added`
rows are dropped client-side by `isRenderableActivity` and the server does not
filter them, so a page arrives non-empty and renders nothing. Gating on
`!isLoading` alone put `No activity yet` directly above a `Load more` button.

For the same reason `Load more` must **not** be nested under a `blocks.length > 0`
check. In the zero-visible-rows case that would remove the only control that
reaches the older rows, stranding the reader. The stream wrapper renders whenever
the first page has resolved and collapses via `empty:hidden` so it contributes no
stray padding when it holds neither rows nor the button.

## Out of scope

- **Thread summary text.** The prototype's rich thread card needs a
  `metadata.lastResult` denorm written in `cli.messages.complete`; compact rows
  ship first and the card is OS-1592. A run that fails or is cancelled never
  reaches `complete`, so those threads simply keep no summary.
- Avatars and message counts on thread rows (above).
- Search or text filtering inside the timeline.
- Retroactive backfill of `comment_added` rows into anything.
- Any change to which threads a task can see. That is
  `docs/specs/cli-thread-sharing.md`.
