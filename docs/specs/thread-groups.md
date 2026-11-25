# Thread Groups

Status: design agreed (grilling session 2026-07-20; scoping session 2026-07-28).
Tracking task: OS-1364 (Phase 1 of OS-556 Workflows).
Terminology: `CONTEXT.md` (Language). Threads have no archived state since
OS-1561 — done is the only put-away state, and this spec is written that way.

A **Thread group** lets a user open additional CLI threads beside the current
one — rendered as **tabs** in the detail area — while the thread list shows one
collapsed item for the whole group. Typical use: several threads on the same
task without creating them one by one in the sidebar.

Thread groups share their persistence mechanic with Workflow runs: both are
**container threads**. Canonical schema lives in `workflow-data-schema.md`
(Existing CLI additions); this spec covers the group-specific behavior.

## Container model (shared with Workflow runs)

- A container is a `cliThreads` row with `kind: "group"` and no transcript of
  its own. Absent `kind` = plain chat thread; legacy rows need no migration.
  A Workflow run's container is a group with `workflowRunId` set (OS-1867;
  the earlier separate `"workflowRun"` kind was dropped so run containers
  inherit the whole group UI).
- Phase 1 (OS-1364) adds the container fields: `kind`, `parentThreadId`,
  `aggregateStatus`, `childCount`, and the indexes: `by_parentThreadId` plus
  a `parentThreadId` discriminator (before the sort field) in the whole
  flat-list index family — sort (created/lastActivity) × done,
  e.g. `by_user_project_deleted_parent_lastActivity`. The
  workflow linkage fields (`workflowRunId`, `workflowLaneId`,
  `workflowRunStepId`) landed with OS-1867; `cliMessage.request` lands with
  the bash-step engine.
- Child threads set `parentThreadId` to the container. One nesting level:
  a child is never a container, a container is never a child. A thread
  belongs to at most one container, so a Workflow-run thread cannot also be
  a group child.
- `parentThreadId` is **membership, not lineage**, and the one-nesting-level
  invariant is why the two cannot share a field: a thread spawned by a child's
  agent flattens into the same container as its spawner, so `parentThreadId`
  says nothing about who created whom. Agent-driven spawns record that
  separately in `spawnedByThreadId` (OS-1162), which is set once at creation and
  is free to point at a container, at a Group child, or outside the group entirely.
  Write paths check it names a live thread of the same user; nothing in the group
  machinery reads it.
- **An agent spawn can turn a plain thread into a group** — intended, not a bug.
  Because agent spawns go through `addThreadToGroup`, spawning from a *plain* thread
  runs the lazy-container path: a container is created, the source is reparented,
  and a pin or share transfers to it. The user's sidebar row changes from a thread
  row into a group row with tabs. This is ordinary group behavior — identical to
  adding a Group child from the "+" button — and only the initiator differs.
- The flat thread list is one paginated query over `cliThreads` filtering
  `eq("parentThreadId", undefined)` on
  `by_user_project_deleted_parent_lastActivity` — containers and
  plain threads appear, children don't. No client-side merging of sources.
- Containers denormalize `aggregateStatus`, `childWatchStatus`, `childCount`, the child
  unread/attention aggregates `hasUnreadChildren`/`hasAttentionChildren`
  (OS-1475), `originBranch` — the oldest live child's execution branch,
  shown as the group row's branch chip (OS-1476) — and `originTaskId`, the
  same child's attached task, shown as the row's task-ref chip (OS-1557).
  `originTaskId` is a display denorm only: the container is never a
  participant in the task's `agentThreadWork`, which stays per-child.
  All are maintained at the `cliThreadsRepo` write seam in the
  same transaction that updates a child, which also bumps the container's
  `lastActivityAt` so the item sorts by the group's latest activity. No
  per-row child subscriptions in the list. The enriched list item derives a
  container's `hasUnread`/`requiresAttention` purely from these aggregates
  (never from the container's own read timestamps).
- Denorm upkeep is tiered by what a child write actually moved (OS-1599), so
  the common case does not re-read the group. Every aggregate is monotone in
  one direction, which makes the tiers sound:
  - nothing moved → the container is not touched at all;
  - a term rose (activity advanced, an unread/attention flag turned on, or the
    child's bucket outranks the stored aggregate or child watch bucket) → the container is
    patched directly from that one child, since max/OR/precedence each need no
    Group child context;
  - a term fell, including a change from needs review to done, a child departed (move-out or delete), or the origin child
    changed → full recompute over `by_parentThreadId`, because a Group child
    may still hold the state that this child just dropped;
  - a child was born into the group (OS-1885) → an O(1) fold: the newest row
    can never take the origin role and only adds state, so the insert extends
    `childCount` and escalates from that one child. A run's wide parallel
    stage must not re-read every sibling (agent prompt snapshots included)
    per insert. Birth into an empty container recomputes instead, seeding the
    `origin*` fields.

  Containers keep the timestamp-based `statusProjection.isDone` for the project
  thread list. Their Watch Tower bucket uses `childWatchStatus`, with all five
  buckets kept distinct, including review and done. See `watch-tower.md`.
  Every tier routes through the projection seam. `originThreadId` records which child
  the `origin*` denorms came from, so "did the origin change?" costs no reads.

  Trade-off: the full recompute is also the drift self-heal, and it now runs
  only on de-escalation, departures, and cascade tails rather than on every
  group write. There is no reconciliation job, so a denorm bug outside
  those paths would persist until one of them fires. Cascades therefore keep
  their unconditional terminal recompute.
- `aggregateStatus` precedence (OS-1476 failed group-status attempt): any child failed →
  `failed`; else any child `waiting_input` (or, for runs, held) →
  `needs_attention`; else any child streaming or pending, or settled while
  its watched PR's checks run ([Pull request watch](pull-request-watch.md#watch-status-slice-4)) → `running`; else
  `idle` (run containers mirror `workflowRun.status` instead). One label per
  row, so a failure masks a Group child's waiting state until acknowledged.
  Derived from the children's watch-status buckets, so it matches per-thread
  display semantics: acknowledging a child's failure settles the group row
  too (and surfaces the next-loudest state). Deleted children drop out of
  both denorms.
- Deleting a container cascades to its children ("children follow").
  Cascades never promote children to standalone threads; the only
  promotion path is the explicit **Remove thread from group** action below.
- Watch Tower shows one row per container and hides its children (OS-1984).
  Child buckets determine placement, independently of workflow run status.
  The desktop feed continues to exclude containers using its kind-based
  index and shows their active/attention children. See `watch-tower.md`.
- **A container is a valid read target for an agent, and answers differently**
  (OS-1162). MCP `get_thread` on a container id returns container metadata only —
  `kind`, `childCount`, `aggregateStatus`, `originThreadId` — and no runtime
  target, because a container has nothing to execute and cannot receive
  messages; handing an agent a target for one would invite exactly the send the
  guards below reject. It returns no `children[]` either: membership is
  `list_threads(containerId)`'s answer (OS-1626), and an ordinary child returns
  `parentThreadId` so the drill-up always exists.

  **A container is also one row in an agent's thread list, never its members**
  (OS-1626). `list_threads` excludes children from the project list — the same
  `eq("parentThreadId", undefined)` the sidebar's index family pins — so a group
  counts once as a unit of work, and `kind`'s presence is what tells an agent the
  id is drillable. Drilling authorizes on the *container*, which is what lets a
  teammate list a shared group's members: `sharedAt` sits on the container and
  covers the children. The rows are still filtered to the container's owner —
  "every child belongs to the container owner" is a write-path invariant, and a
  cross-user read seam does not lean on one (same rule as `isSharedForViewer`
  re-checking `kind`). A container that is not a container answers nothing rather
  than something: passing an ordinary thread's id lists an empty page, not that
  thread.

  **Reading a container's transcript is the one container read that errors**
  (OS-1627). `cli.messages.listRecentSummaries` rejects a container — "Groups and
  workflow runs have no messages — list the group's members instead" — rather than
  returning an empty array. Both other container reads answer with *something*
  (`get_thread` returns container metadata, `list_threads` returns the members),
  and every unreadable id elsewhere in those tools lists nothing because "there is
  nothing here" is true. A group's transcript is neither: it is readable, it has no
  messages, and it never will, so silence would be a permanent lie inviting the
  same call again.

  **Neither of a container's two status fields may mislead.** `aggregateStatus`
  goes out **raw**, never through the sidebar's `containerItemStatus` projection
  (`idle → "completed"`), which would tell an agent a group had finished when it
  is merely quiet — and `status` is **omitted entirely**, because a container's
  own `status` is a stored constant (born `"completed"`, never streams) and would
  reach the same wrong conclusion through the adjacent field. `aggregateStatus`
  is a container's only status.
- **A CLI can never operate on a container** — a backend invariant, not a UI
  stopgap (OS-1556). Three guards, all on a thread doc the handler already
  loaded, so none costs a read:
  - `cli/messages.send` rejects a container ("Groups and workflow runs cannot
    receive messages"), so the pending flag never gets set in the first place;
  - `listPendingThreadsByProfile` drops containers from the claim queue
    whatever set that flag;
  - `claimThread` rejects them outright, and the shared claim gate
    (`cli/lib/claims.ts` `assertThreadClaimedBySession`, used by
    `startRunResponse`, `appendRunContent`, `complete`, `fail`,
    `consumeSteeredMessages` and `interactionRequests.create`) rejects them
    again — "Groups and workflow runs cannot be processed by a CLI".

  The rest of the lifecycle is covered transitively rather than by the shared
  gate: `heartbeatClaim`, `releaseClaim`, `reportExecutionBranch` and
  `reportPullRequest` each hand-roll a `claimedBySessionId` comparison and
  no-op when it fails — which a container's claim always does. `cli.worktrees`
  `resolveCreated` has no claim check at all, so it carries the guard itself.

  Any new CLI or MCP entry point that accepts a `threadId` and **advances a
  run** (OS-971 thread ops, for one) **must** go through the shared gate rather
  than repeat the check. Entry points that only **queue** a message have no
  `sessionId` and therefore cannot use the gate at all; their container
  invariant is the `isContainerThread` check in `cli.messages.send` above. That
  includes the API-key/MCP caller of `send` (OS-1162), which reaches the same
  check on the same loaded thread doc.

A new-subthread draft can start a workflow in an ordinary group, or wrap a
standalone source into a workflow container. Existing children remain manual
threads. Eligibility, sharing, and start behavior are defined in
[workflows.md](workflows.md) → Start. The container can belong to only one run
and keeps that binding after completion or cancellation. Starting the run holds
the submitted draft until a run-owned thread is ready, then activates that
thread directly while preserving the workspace and tab mounts. The thread
strip retains the source and draft tabs while a newly formed group loads.

## Group lifecycle

- **Creation is lazy, on first send.** The **"+" button in the thread
  header** (after the thread name) on a plain thread switches the detail
  area into tabs mode with a **draft tab**: a new-thread composer prefilled
  with the current thread's settings (profile, path/worktree, runtime,
  model, effort, mode, Project agent, attached task), all freely changeable
  before send —
  children are ordinary CLI threads with no shared constraints, not even
  the same machine. A source running in a worktree seeds the draft with
  that **existing** worktree selected (parent repo path + the worktree as
  base-ref) — adding a thread to a group never spawns a new worktree by default. The seed is
  stamped with its source thread (`seededFrom`) and re-applies whenever the
  draft has no typed text and was seeded from a different thread: an edited
  draft's pills survive close/reopen from the same source thread, while
  adding from another Group child never inherits an earlier draft's profile
  or worktree (drafts persist per group under the legacy storage key
  `sibling:<containerId>`, per
  source thread before the group exists).
  Sending the first message creates the container
  (`kind: "group"`, title snapshotted from the first thread), patches the
  original thread's `parentThreadId`, and creates the Group child. Closing the
  draft tab before sending leaves everything untouched — there is no empty
  group and no explicit "create group" action.
- More Group children are added the same way from the group's tab strip.
- **`addThreadToGroup` has a second initiator: an agent, over MCP or the CLI**
  (OS-1162). It accepts an optional `apiKey`, so the caller need not be a signed-in
  browser session. Nothing else changes — the key resolves to its owning user, and
  the lazy container, pin/share transfer, `MAX_GROUP_CHILDREN` cap, one-nesting-level
  rejection of a plain-group container source all apply to that caller.
  Workflow container IDs are valid direct targets, including before any lane
  thread exists. Direct targets use the same owner, project, permission, and
  cap checks. The MCP layer resolves a populated container to a member for
  inherited settings; an empty workflow container needs explicit settings.

  **MCP `create_thread` is that initiator** (OS-1629). It takes an optional
  `sourceThreadId` and routes to `create` without one, `addThreadToGroup` with one — so
  an agent spawning beside its own thread produces exactly the group a user would
  get from the "+" button, including the side effect: **the source thread's sidebar
  row becomes a group row, and its pin and share transfer to the new container.**
  That is ordinary lazy-container behavior with a new trigger, not a bug, and it is
  the accepted cost of reusing the mutation.

  **A container id is accepted at the tool boundary and resolved to a member**
  there, so "add a thread to this group" is sayable without naming an arbitrary
  Group child. The resolution is one `listGroupSummaries` call, preferring the
  container's denormalized `originThreadId` among the rows it returns and falling
  back to the first row (creation order) for containers predating that denorm — used
  as a preference over rows already in hand rather than as a lookup, so a stale
  `originThreadId` self-heals instead of failing the spawn, and the inherited
  profile/path/runtime comes off the same rows. It reads done members too: a done
  thread is still a fine Group child source. Populated workflow containers
  resolve the same way. Added threads share the container without joining a workflow lane
  or step; canceling the run leaves them running. See `workflows.md`, Threads.

  The two lineage fields diverge on this path, and that is their purpose:
  `spawnedByThreadId` records the id **the agent named** (a container, when it named
  one), while `sourceThreadId` records the child **`addThreadToGroup` needed**.

  **A group never spans projects** (OS-1629). `addThreadToGroup` rejects a target
  profile whose project differs from the source thread's (`ADD_TO_GROUP_CROSS_PROJECT`),
  and checks the container's project too, so a group that somehow holds a foreign
  child cannot use it as the next spawn's source. The guard is necessary because two
  authorizations on this path check *different* projects — `addThreadToGroup` the
  source's, `createThreadCore` the target profile's — and `listGroupSummaries`
  authorizes only the container before returning every owner-matching row, so a
  foreign child would leak its title, path, profile, and task to a reader scoped to
  the container's project alone. The web composer only offers profiles from the
  thread's own project; raw MCP ids are what made this reachable.

  **A resolved member is re-verified at write time.** An MCP caller resolves a
  container to a child in one transaction and writes in another, so `addThreadToGroup`
  takes an optional `expectedContainerId` and requires the source's current
  `parentThreadId` to match (`ADD_TO_GROUP_SOURCE_MOVED`). A direct workflow
  container target must itself match `expectedContainerId`. Without it, a concurrent
  removal from the group leaves the call succeeding while lazily creating a *second* container
  around the moved-out thread — the Group child lands outside the group the agent named,
  and its `spawnedByThreadId` still points at the original container.
- **A Group child's auto-title comes from its own prompt, not the attached task**
  (OS-1559). Outside a group an attached task's name wins over the message
  text; inside a group that would give every tab the same title, so the order
  flips — the prompt (or first attachment name) titles the child and the task
  name is only the fallback for a task-only send. An explicit `title` still
  wins everywhere.
- **Branch from here → In a new tab** forks a run into a new Group child of the
  viewed thread's container, forming the group if needed. The workspace adopts
  the container `fork` returns, like an added thread (`cli-thread-fork.md`).
- **Group size is capped** (`MAX_GROUP_CHILDREN = 100`): every child-creating
  path rejects with a `ConvexError` when the container is at the cap, and the
  "+" affordances disable at the cap. The cap counts **all** rows under
  `by_parentThreadId` — soft-deleted children included — so it
  bounds the physical fan-out under one container, not just the live members
  (`childCount` excludes deleted rows and is not the guard's input). Keeps
  the denorm recompute and the tabs view bounded, never a fan-out of
  thousands.
- **Remove thread from group** (code name: move out): a child can return to the root of the
  thread list by unsetting its `parentThreadId`. Manual threads can leave
  workflow containers; workflow-owned threads cannot. An empty workflow
  container persists.
- **The container is deleted automatically when its last child is removed
  or deleted.** Done children still count as members.
- Children remain normal threads everywhere else: direct links, task
  attachments, and `agentThreadWork` summaries are unaffected.

## Rendering

- Sidebar: the group is one thread-styled row — the **same** thread-card
  component, sorted by the container's `lastActivityAt`. The list item
  projects `aggregateStatus` into the item's normal `status` field
  server-side (`running` → `streaming` spinner, `failed` → `failed` red
  Failed, `needs_attention` → `waiting_input` amber Waiting, `idle` →
  `completed`), OS-1476. The row's branch and task-ref chips show the oldest
  live child's execution branch and attached task (the group's origin),
  OS-1476/OS-1557; diff stats and PR badges stay per-child. Selection lands on the container; the sidebar keeps
  highlighting the group row while any of its tabs is open (the thread
  layout derives the active row from the loaded thread's `parentThreadId`,
  exposed on the item/detail payloads since OS-1477). The backend rejects
  sending a message to any container ("Groups and workflow runs cannot
  receive messages") — a permanent invariant so a CLI can never claim the
  container itself; the tabs view never puts a composer on the container.
- Detail area by `kind`:
  - `group` → a **tabs view**, one tab per child, each tab a full thread
    view with its own composer. Same view on desktop and mobile — the mobile
    strip is the same component, collapsed (OS-1479, below). No side-by-side
    panes, and no swipe gesture between tabs: one thread per URL means the
    neighbours aren't mounted. The overflow and Done menus provide access to
    hidden children by name and task ref.
  - a run container (`workflowRunId` set) → the same tabs view once Lane
    threads exist; while the run has no children yet (Lane threads are
    created lazily) its URL renders the **Run view** instead of redirecting
    (see `workflows.md`, Threads page integration).
- Tab strip details (OS-1477):
  - Unfinished tabs keep creation order. Done threads are hidden from the strip
    except for the selected thread, which stays visible even after it is marked
    done (OS-1906). Its title remains struck through and muted. A done thread
    whose run is still `streaming` or `pending` also stays in the strip, with
    its spinner, until the run ends. The sticky mark (OS-2176) would otherwise
    hide a live run behind the Done menu, whose rows have no status glyph.
  - A **Done** button with the `CircleCheckBig` icon sits immediately after the
    thread's `...` actions menu, before the sidebar separator. It opens a menu
    of all done threads, newest `doneAt` first, including the selected thread
    with a current-item checkmark. Rows retain task refs and titles but omit
    status indicators and their empty slots, except a row with unread
    activity. It shows the tab's glyph, usually the unread dot: a done mark is
    sticky (OS-2176), so a thread can get new activity after it is marked done.
    The group row's unread dot counts done children, and without the dot
    here the user could not find which child it meant. A truncated title shows in full on
    hover (native `title`), in this menu and the overflow menu. Marking done acknowledges read
    and attention state; new activity returns the thread to unfinished tabs.
    The button has an accessible name and a tooltip with the count. It is
    absent when no threads are done. On mobile it opens a bottom sheet.
    - Full-width view places Done after `...` in the thread toolbar. While a
      panel or draft covers that toolbar, Done stays accessible in the header.
      Read-only viewers can use Done even though they have no thread actions.
  - Selecting a done thread shows its tab and conversation without changing its
    done status. Switching to another thread hides that tab again. A direct
    link to a done child selects that child, including in an all-done container.
    Selecting a panel keeps the selected thread available in the strip.
  - Marking the final unfinished thread done keeps its conversation open. A new
    thread draft opens only through the existing "+" action. Opening an all-done
    container selects the most recently completed child, ahead of a remembered
    older tab. When no `doneAt` is available, default selection uses activity time.
  - A user turn clears done (OS-2176) and returns the thread to its
    creation-order position. Agent activity does not. The existing reactive payload and
    optimistic updates drive the strip and Done menu together.
  - The strip data is one reactive query (`cli/threads/groups.getGroup`) with a
    deliberately narrow payload — per child just id, title, last activity,
    the raw `associatedTaskId`, and the status indicator's inputs
    (below), no enrichment, one index scan — because
    the subscription re-fires on every child write (streaming bumps activity
    constantly). `totalRowCount` counts
    every row ever parented under the container — deleted included —
    because that is what the `addThreadToGroup` cap guards on, and
    it drives the "+" disable. Mutations issued from the tabs view patch
    this query optimistically alongside the thread's own `get` (tab labels
    and membership never lag the header).
  - **Overflow is cut, not scrolled** (OS-1478): the strip shows the tabs that
    fit its width and collapses the remaining unfinished tabs into a dropdown.
    The Done menu is independent of this width-based overflow. The overflow
    dropdown has no separate button; the
    **last visible tab hosts it**, as a chevron at that tab's trailing edge,
    and clicking that tab while it is already the active one opens the same
    menu (there is nothing else for the click to do). Items carry each hidden
    thread's task ref and title — struck through when done, matching the strip
    — and selecting one is plain tab navigation. Nothing renders while
    everything fits.
  - The cut can have **two equally correct answers** (OS-1658), because the
    chevron is inside the tab whose width decides the cut: a tab already at its
    max width absorbs the chevron for free while a narrower one pays its full
    width, so moving the chevron can free a slot that moves it straight back.
    Each host is measured once per tab set — returning to one that was already
    measured settles there rather than measuring again. The row can then sit a
    chevron's width over its own, which the strip clips.
  - The **active tab is never hidden**: when the cut would drop it, it moves to
    the end of the visible row — where it becomes the dropdown's host. This is
    derived, not stored — a deep link to a cut-off thread lands there for free,
    and clicking a visible tab collapses it back.
  - Deleting the active child from the tabs view lands on the most recently
    active remaining Group child — preferring one that is **not done** — and only
    returns to the thread list when no Group child remains. Same rule resolves the
    container URL to a default tab when there is no remembered selection.
    If all remaining children are done, select the most recently completed one.
  - Every tab shows its own thread's **status glyph** (OS-1618) — the spinner,
    the amber waiting dot, the red failure dot — so a group tells you which of
    its runs is working, which is waiting on you and which broke without
    switching tabs. It is the shared `ThreadStatusIndicator`, the same glyph
    the thread list and the compact row render, folded through the same
    `getThreadDisplayStatus`: a tab must not become a fourth place that decides
    what "working" means. Group child statuses come from `getGroup`; the active tab
    prefers its own `get`, the fresher source and the only one before a group
    exists.
  - A **settled** tab shows the **unread dot** if the run has activity the
    viewer has not opened, and otherwise nothing — no resting dot and, per the
    no-checkmark rule above, no done check either; the struck-through title
    already says done and the slot is needed for width. The unread case is the
    whole point of the glyph on a finished tab: a Group child that completes while
    the viewer is on another tab has no other way to say so, and without it the
    tab went silent at exactly the moment it had something to report. Live
    states outrank unread — a streaming tab shows the spinner, not the dot.
  - `hasUnread` is therefore part of the child payload, derived server-side by
    `hasUnreadThreadActivity` like every other surface's. `readAt` is
    deliberately **not** shipped to the client: comparing it against
    `lastActivityAt` in the tab would be a second copy of that rule.
  - **Every glyph input a tab reads is patched optimistically onto the child
    projection**, not just onto the detail row: `hasUnread` on mark
    read/unread, `requiresAttention` on attention acknowledgement (it is what
    decides whether a failed tab still shows red), and `hasUnread: false` on
    mark-done — done implies read server-side, so a done tab that kept its dot
    would be the one glyph the viewer watches fail to settle, since on a done
    tab the dot is the only thing left to render. The active tab reads the
    detail doc and would look right from that alone, but it stops being the
    active tab the moment the viewer switches away and would take the stale
    glyph back until the round trip landed.
  - The glyph lives in the tab's **leading padding, painted out of flow** — a
    tab that has one widens its leading padding to hold it, with air on both
    sides (at the glyph's bare width the dot came out flush against its own
    task ref and read as one crowded cluster) — for a
    layout reason: the strip re-measures only when the tab set changes, so a
    glyph in normal flow would silently resize a tab as its run finished and
    stale the overflow cut. In the overflow dropdown it renders **in flow** at
    the front of the row instead — a menu row has the width, nothing measures
    it, and a hidden tab's status is the thing that menu most needs to say.
  - Clicking anywhere in a tab — label, padding, or the ref chip beside it —
    selects it. Only the active tab's chip is a link to the task; on the
    others it is plain decoration, so one click never fires both the tab
    switch and a task navigation. The status glyph keeps pointer events for
    its own tooltip; the click still reaches the tab it sits in.
  - Every tab carries its own thread's task-ref chip. The refs come from a
    second query (`tasks.core.getSummariesByIds`) keyed on **task ids**, not
    on the container: resolving them inside `getGroup` — or keying this query
    by container id, which would have to read the child rows (or the
    container, whose `lastActivityAt` every child write bumps) — would put
    the task reads back on the hot subscription. Keyed by task id its read
    set is tasks + projects, so it recomputes only when a task changes. The
    active tab's own ref still comes from the thread's `get` (already
    loaded, and the only source before a group exists).
  - Because that ref query starts only once `getGroup` lands, the tabs stay
    hidden until both resolve and then appear together: tabs rendered without
    their refs resize when the refs arrive, and tabs rendered before the group
    show the active thread alone and then the rest — both read as a flicker
    (OS-1558). The gate is sticky; adding a Group child refetches the summaries,
    and hiding the strip for that round trip would flicker again.
  - While they load the strip holds its shape with one placeholder per child.
    The count comes from the container's `childCount`, and the container is
    where a sidebar group click lands (the redirect above) — its doc is read a
    round trip before `getGroup` even starts. The detail view adopts the
    container as the group scope right there, so `getGroup` runs alongside the
    child's own fetch instead of after it. Entering at a child URL directly
    (a page reload, a deep link) never reads the container, so `cli.threads.core.get`
    mirrors the count onto every child as `containerChildCount` — the placeholders
    are up as soon as the child's own doc lands, instead of the header showing
    title mode for a round trip and then swapping in the whole strip.
  - Placeholders are for a strip that has **never rendered** — cold entry, and
    only until the refs gate opens. They never replace tabs already on screen
    (OS-1718): the first group addition adopts its container a round trip before that
    container's `getGroup` can answer (the reparent rides the same transaction,
    which the client applies *before* it resolves the mutation), and swapping
    the live strip for skeletons there is a flicker in the middle of a send.
    The same half-known scope leaves the "+" alone — a `getGroup` that has not
    answered is `undefined`; `null` means the container is unavailable.
    Workflow containers offer the same "+" composer as ordinary groups.
  - Only the active child's tab carries the row context menu. That menu — and
    the header's "…" menu, which is the same menu — offers **Remove thread from
    group** on manual children of ordinary groups or workflow containers.
    Workflow-owned threads and standalone threads do not offer it. Removing a thread does **not** navigate: the user keeps reading the
    same thread, its strip collapses to single-thread rendering, and the row
    reappears at the root of the sidebar list. The container dissolves
    server-side when that was its last member.
  - Marking the selected thread done updates its styling and the Done menu
    immediately through the optimistic `isDone`/`doneAt` patch. Its tab remains
    visible after the unfinished tabs, and the conversation stays open.
  - A trailing "+" adds another Group child (draft tab, as above). On a plain
    thread the "+" sits after the title (split view) or after the thread
    tab (full-width view) — on mobile too, where the header is otherwise the
    title alone. The draft tab is pure client state with no URL;
    while it is active the previous child stays mounted underneath, so
    closing the draft loses nothing.
  - **Mobile collapses the strip** (OS-1479). The selected tab fills the
    header as its title, with no underline. A chevron on that tab opens a
    bottom sheet when other unfinished tabs exist. The sheet lists unfinished
    tabs in creation order and the selected done tab, if any. It includes and
    highlights the current tab with `aria-current`. Tapping the title tab's
    task or PR ref only follows that link (the task opens in the sidebar); it
    does not open the sheet.
    - The separate Done button opens another bottom sheet with all completed
      threads in completion order. The current done thread is highlighted.
      Both sheets use `MobileSheet` and retain task refs and plain navigation
      on selection. Only the unfinished-thread sheet shows status indicators.
      Spec: `mobile-bottom-nav.md`.
    - The existing "+" stays available to owners. Selecting a done thread
      keeps its done status and makes it the visible title tab.
- Page structure (OS-1558, OS-1660) — four levels, so a tab switch reloads only
  the transcript and a first send reloads nothing but the thread column:
  - **L0 `threads/layout.tsx`**: auth/org/project gates, the thread sidebar,
    the draft and read-state providers. Spans the whole `/threads/*` section.
  - **L0.5 `ThreadWorkspaceHost`** (OS-1660): the state the new-thread composer
    and the workspace *share* — sidebar open/closed, the panel the user picked,
    layout mode, the task-sidebar hook, and the Tasks panel's filters. The
    layout renders it in place of a `threadId ? workspace : children` fork and
    passes the project doc it already resolved; it picks the view from the
    route, so `/threads` → `/threads/<id>` keeps all of that. Before this each
    view owned its own copy, so the new thread arrived with the sidebar
    collapsed and its Tasks panel re-fetched from scratch.
    - The two views still render their own split pane (the composer's has no
      Changes tab — there is no thread to diff yet), so the pane's *component*
      is remounted by the swap; React cannot preserve a subtree across two
      parents. What the user would notice is preserved by lifting the state
      instead: the panel pick, and the Tasks panel's list/archive/status/
      assignee filters, which it accepts as controlled props. Its contents are
      one component (`ThreadTaskPane`) rendered by the host and passed to
      whichever view is showing, so the 18-prop task-detail call exists once.
    - Only the *pick* is shared; the resting panel is resolved per view, since
      it depends on data the host cannot see (a shared thread's viewer rests on
      Tasks — Changes needs the owner's CLI to serve files). The composer's pane
      follows `task=<REF>` rather than the shared pick, so revealing Tasks there
      records the pick explicitly, and a send records the panel the open pane
      shows (Tasks or the task) — a pane opened by `T`, or left open by a thread
      on Changes, would otherwise hand over to the workspace's own default.
    - The `T` shortcut is one shared handler registered by each view, so they
      cannot drift while each still supplies its own readiness gate (the
      composer needs profiles, the workspace needs its messages) and its own
      "reveal Tasks" transition — in the composer that means clearing the task
      selection, which is what actually moves that pane.
    - Sending pushes the created thread's URL as before. Hoisting the shell
      removed the *cost* of that push (no remount), not the need for it: the URL
      is what reload, share, Back and the mobile list/detail gate all read. It
      is pushed once the thread's data is warm — see the creation rule below —
      and carries the task-sidebar params (`task`, `artifact`, `archived`), so
      a task open in the pane stays open. `attachedTask` is dropped: the created
      thread owns that task now.
  - **L1 `ThreadWorkspace`** (`components/blocks/thread/workspace/`): the
    header, group tab strip, panel tabs (Changes/Tasks/Task), add-to-group draft and
    the thread-level mutations/dialogs. The **layout renders it** (through the
    host), above the `[threadId]` segment — both `threads/page.tsx` and
    `threads/[threadId]/page.tsx` are stubs returning `null`, present only so
    the URLs resolve. Rendering it from the page instead would give the
    App Router a new segment key per thread id and remount the whole subtree
    on every tab switch. URLs, Back/Forward, deep links and SSR are unchanged.
  - **L2 the transcript**: `ThreadView` keyed by the active thread id —
    messages, queued strip and composer belong to one thread and swap with the
    tab. Composer text survives via `ThreadDraftProvider` (localStorage);
    its pills and scroll position do not.
  - The active tab is **client state synced to the route param** (render-phase
    prop-derived adjustment): a tab click swaps the transcript and the tab
    highlight immediately and starts that thread's message fetch alongside its
    thread-doc fetch, instead of both waiting for the route to commit. A route
    change (Back/Forward, a sidebar click) drops the override.
  - The group scope (`parentThreadId`) is **sticky while a Group child's doc
    loads**: the incoming tab is a child of the same container, so the strip,
    header and panels keep rendering — the incoming tab's title comes from
    `getGroup`'s child row — and only the message area shows placeholders.
    The full-page skeleton is left for cold entry and cross-group navigation
    (which do remount L1, resetting panel state).
  - **Creating a thread shows no empty or placeholder transitions** (OS-1665).
    A skeleton, an empty transcript, or a tab whose label arrives a beat later
    all read as a flicker: the screen shows real data or it does not change
    yet. Both create paths — root and Group child — follow one rule, since they are
    the same event from the user's side.
    - The composer that sent the message **stays on screen, with its text and
      pills**, until the created thread can render without placeholders. It is
      inert for that window (the composer's existing `isSubmitting`, which now
      spans the wait), so a second send can't start.
    - Ready means **every subscription the workspace is about to read is warm**:
      the thread doc, its first envelope page, and — for a Group child — the group.
      All three are the same queries with the same args the workspace uses, so
      warming them here costs no extra round trip. The doc alone is not enough:
      that mounts the transcript with an empty message list for a beat, the
      user's own message briefly missing.
    - **The navigation is part of the swap**, not ahead of it: the URL commits
      once the data is warm, so reload/share/Back and the mobile list-vs-detail
      gate are correct at every point, and the workspace never mounts onto data
      that isn't there.
    - **The draft tab is the created Group child's tab slot** for the hold's
      duration (OS-907), so the strip never shows both. `addThreadToGroup` commits
      the container, the reparented source and the child in one transaction, and
      the hold *waits on* `getGroup` — so the child's row always arrives while
      the draft is still open, and the two rendered side by side read as
      "Thread 1, Thread 2, New thread" until the swap. Ordering cannot fix that:
      being warm is what resolving the hold means. The strip therefore drops that
      one child id while the draft is open, and the draft tab's close and the
      real tab's appearance land in **one commit**.
      - The same commit also moves the draft's storage scope (`sibling:<id>`)
        from the source thread to the new container. That is the group forming
        *under* the draft, not the user navigating out of it, so this one key
        change does not close the draft.
      - Scoped to that id, not "the newest child": a Group child created from
        another device or by an agent over MCP lands in the same `getGroup` and
        keeps its own tab. And it never outlives the draft — closing the draft
        mid-hold, or abandoning the send, gives the child its tab back rather
        than hiding it for good.
    - **Failure needs no rollback.** The draft never closed, so a rejected
      `addThreadToGroup` (group at cap, raced from another device) just re-enables
      the composer with the text still in it; the `ConvexError` toast says why.
      It never reaches the hold, so no tab slot is reserved either.
    - **Rejected: optimistic seeding.** Faking the doc and user message into the
      Convex cache would render instantly but every faked field can visibly snap
      when the server's version lands — the title would have to match
      `deriveTitleFromSeed` exactly, and a synthetic message id would remount a
      keyed `ThreadView` bubble. A brief honest wait beats instant-but-lying.
  - Adding a thread also **adopts the container `addThreadToGroup` returns**
    (OS-1615): the strip, header and panels keep their mount across the send and
    only the transcript swaps. The mutation's return value is load-bearing — the
    first group addition creates the container, so until `getGroup`
    lands its id exists nowhere else. With the hold above, that subscription is
    already warm at the swap; adoption still covers the beat *after* it, where
    the new child's own doc has yet to arrive. Adoption is applied in the same
    event as the navigation.
    - **Confirmed** by the new child's own doc: its `parentThreadId` is the
      adopted container by construction, so the hold is dropped once that doc
      lands.
    - **Abandoned** if the user navigates elsewhere first (sidebar click,
      Back/Forward, another tab): the hold applies only while the created
      thread is the active one, so no group scope leaks onto an unrelated
      thread.
    - The strip's placeholder count is kept for the case that genuinely has
      nothing to render: **cold entry straight onto a child URL**, where the
      count rides on the child's `containerChildCount`. While adding a thread it must not fire —
      the strip has tabs and the draft is over the thread, so the adopted
      container's still-loading `getGroup` is not a loading state the user has
      any business seeing (OS-1718, the placeholder rule above).
    - The task-ref gate above stays sticky through this: a new Group child whose
      task id the summaries query hasn't seen sends that query `undefined` for
      a round trip, and reopening the gate there would blank the whole strip —
      the very blink this rule removes. One tab renders without its chip for a
      beat instead.
  - The header's thread actions (mark read, mark done, `...`) are
    toggles, so they need a whole thread row, which the child row is not. They
    keep rendering the **outgoing** tab's row for that round trip so they hold
    their place, and go `inert` meanwhile — that row is not the thread they
    would act on. The same menu's other
    hosts — the mobile header and the tab's own context menu — can't be made
    inert, so they simply don't render for that beat: their toggles read the
    row that is rendered but mutate the active thread, which would invert them.
  - The add-to-group draft, when open, stays mounted through a tab switch (it holds
    uploaded attachments); it renders from the outgoing row for that beat,
    which only seeds it.
  - Selecting a tab reveals the thread **only in full view**, where the thread
    is one of the panel tabs. Split view has its own thread column, so the pane
    keeps whatever it was showing (Tasks, a task detail) instead of snapping
    back to Changes (OS-1558).
  - The sidebar highlight is **published by L1**, which knows the container id
    before the incoming Group child's doc resolves. It carries the route it was
    derived from, since it lands in an effect (after paint): the layout falls
    back to the route's own thread id until a matching one arrives, so leaving
    a group never paints the old container highlighted. A second
    `cli.threads.core.get` in the layout would go `undefined` mid-switch and blink
    the group row's selection off.
- Routing: the URL follows the active tab — switching tabs **pushes** the
  child thread's normal URL (Back walks the tab history), preserving the
  current query string (`task`, `artifact`, …). Opening a child's direct
  link renders the group tabs view with that tab active. The container's
  own URL **replaces** to the default tab's URL — the container URL is
  never a resting state. Same on mobile, where picking a tab from the
  collapsed strip's dropdown is the only way to switch.
- Deep-link resolution is thread-doc-driven: the thread detail route reads
  `parentThreadId` from the loaded thread and, when set, fetches the
  container and Group children (`by_parentThreadId`) to render the tabs view and
  highlight the group's sidebar row. Stored thread ids elsewhere — task
  `agentThreadWork` entries, `associatedTaskId` lookups, notifications —
  keep pointing at the child and never need rewriting when a thread joins
  or leaves a group.
- Default tab on opening a group: the last viewed tab (browser-local,
  `convoy.thread-group-last-tab.<containerId>`, written on every tab
  activation), falling back to the most recently active unfinished child.
  When all children are done, the most recently completed child takes precedence
  over that preference. A container whose children are all gone, during a
  deletion race, renders the not-found state.
- Rename is contextual: renaming from the sidebar row renames the **group**;
  renaming from within a thread panel renames that **child**. Ungrouped
  threads keep today's behavior.

## Thread-list features (full parity on the group row)

- Unread/attention state aggregates from children: the group row shows the
  unread dot / attention treatment when any child would.
- Mark as read, mark as done, and delete on the group row cascade
  to all children. Multiselect treats a group row like any other row, with
  the same cascade semantics. Mark as unread and mark as not-done cascade
  too (OS-1475) — the group row's state derives from the children, so a
  container-local toggle would be invisible or one-sided. Cascades keep
  `parentThreadId` on every child (never promoted).
- Batch actions cap the **expanded** fan-out, not just the selection: a
  selected container costs its whole live membership, so the row count cap
  (`THREAD_BATCH_ACTION_MAX = 50`) is joined by
  `THREAD_BATCH_FANOUT_MAX = 1000` rows counted as selection + `childCount`
  (OS-1475). Selecting 50 maxed-out groups would otherwise read ~15k
  documents in one transaction and abort with an error the user cannot act
  on; the cap rejects it with "select fewer groups" instead.
- Cascades skip children already in the target state, so a child's own
  earlier `doneAt`/`readAt` stamps are preserved. The skip does not remember
  pre-cascade state: marking a group not-done clears every member's mark,
  including one the user marked done individually beforehand — accepted
  "children follow" semantics.
- Done-ness is container-local by design: the cascade stamps the container's
  own mark (there is no `hasNotDoneChildren` aggregate). A user turn in any
  child clears the container's mark too (OS-2176). Agent activity in a child
  leaves it done. An explicit mark-not-done on a single child does not move
  the group row out of Done.
- Pin applies to the container itself (children are not individually pinned
  from the list — they aren't in the list). Pinning a group child is
  rejected outright: children are excluded from the flat list but the pinned
  query is not parent-aware, so a pinned child would leak into it. For the
  same reason, when the first Group child forms a group from a pinned thread the
  pin transfers to the container — the pin follows the list row.
- **Sharing transfers to the container** when the first Group child forms a group
  from a shared thread (OS-1579, `cli-thread-sharing.md`): `addThreadToGroup`
  moves `sharedAt` onto the container alongside the pin, for the same reason —
  the shared-threads index is not parent-aware, so the flag has to sit on the
  list row. The link the owner handed out stays alive: the access rule reads
  the container for every child, so the old thread URL still resolves. The
  group is then shared as a unit — a viewer gets the tab strip and every run
  in it.

## Out of scope for v1

- Grouping existing standalone threads after the fact (move **out** exists;
  move **in** does not).
- Nested groups.
- Side-by-side pane layout.
