# CLI Thread Sharing (read-only)

Status: Phases 1–4 implemented (OS-1574, OS-1575, OS-1576, OS-1579). Parent:
OS-1444 — "V1: See the thread (including live streaming) via the direct link".
Terminology: `CONTEXT.md` (Language).

A thread owner can **share** a thread — or a whole thread **group** — read-only
with their project teammates. A teammate who has the link then sees the full
transcript, including live streaming, but cannot act on it in any way. Sharing
is all-or-nothing to the project; there is no per-person grant.

The feature is usable end to end: the owner shares from the thread actions
menu, the link lands the teammate on a read-only transcript that streams live,
and the owner can see everything they have shared in one place.

## The flag

`cliThreads.sharedAt: v.optional(v.number())`. Presence *is* the flag — set on
share, cleared on unshare. On a **group container** it means "this group is
shared" and covers every child; on a standalone thread, "this one run is
shared". A group child never carries it (OS-1579). A timestamp rather than a boolean so the
shared-threads view orders by "most recently shared" without a second sort
field. Phase 3 added the index it reads,
`by_user_project_deleted_sharedAt: ["userId", "projectId", "isDeleted",
"sharedAt"]`; `gt("sharedAt", 0)` is the "is shared" test, since Convex sorts
an unset optional field before every number.

No migration: absent = not shared, the correct default for every existing row.

## The access rule

One helper owns the rule — `getViewableThread` in
`apps/web/convex/cli/lib/permissions.ts`:

> The **owner**, or a **project teammate with `CLI_THREAD`** when the thread
> has `sharedAt` set — or, for a group child, when its **container** does.

It returns `{ thread, isOwner }` or `null`, and its ordering is deliberate:

1. missing or soft-deleted thread → `null`;
2. non-owner and not covered by a share → `null` (the shared gate runs
   **before** the project check, so an unshared thread never costs a
   membership lookup for a stranger);
3. no `CLI_THREAD` on the project → `null`. The project check runs for the
   owner too, matching what every call site already did.

"Covered by a share" is the thread's own `sharedAt`, else its container's —
and only if that container is a **plain group** (`kind === "group"` with no
`workflowRunId`, OS-1579/OS-1867). That container read is
the **last** thing tried and happens only for a non-owner on an unshared group
child, which is what keeps its cost off every other caller — see **What the
group fallback costs** below. A missing or soft-deleted container fails closed,
so dissolving a group revokes its links.

The plain-group check is deliberate redundancy: `share` already refuses
run containers, but this helper is the single seam deciding cross-user reads
and does not lean on a mutation-side invariant. A `sharedAt` reaching a run
container by backfill or manual patch would otherwise open every run child to
the project — and a run answers only to its starting user.

Consequences, each pinned by a test in
`apps/web/convex/cli/threadSharing.test.ts`:

- Project **`VIEWER`** cannot read shared threads — `VIEWER` has no
  `CLI_THREAD` permission (`apps/web/lib/authz/permissions.ts`). Widening that
  would loosen every thread query, not just shared ones. The web UI hides the
  threads area from viewers instead
  ([read-only-viewer-ux.md](read-only-viewer-ux.md#threads-workflow-runs-and-worktrees-slice-5-os-1545)).
- **Org owners/admins** with no `projectMembers` row cannot read a shared thread
  in that project. OS-1536 removed the implicit-access bypass app-wide and
  sharing inherited the change for free, because this helper delegates to
  `hasProjectAccess` rather than checking org roles itself.
- A **soft-deleted** thread is unreadable regardless of `sharedAt`.

## Reads that follow the rule

Seven public queries, all unchanged in args and return shape:

| Query | Notes |
|---|---|
| `api.cli.threads.core.get` | additionally returns `isOwner` |
| `api.cli.messages.listByThread` | paginated |
| `api.cli.messages.listEnvelopesByThread` | |
| `api.cli.messageChunks.listWindowByThread` | via `resolveReadableThread` |
| `api.cli.messageChunks.listLiveByThread` | via `resolveReadableThread` |
| `api.cli.messageChunks.listNormalizedByMessages` | via `resolveReadableThread` |
| `api.cli.threads.groups.getGroup` | group containers only; gives the viewer the tab strip (OS-1579) |

`api.costs.core.getThreadCostSummary` was already project-scoped and needed no
change.

`isOwner` also appears on Watch Tower summary rows (OS-1745). Project thread
lists remain user-scoped. The project Watch Tower's All threads mode can show a teammate's
summary without permission to open the conversation, following the task Runs
column. These rows have no navigation or actions and contain no execution-path
or transcript data. See `watch-tower.md` for the summary contract.

A viewer receives the owner's `pathLabel` / `pathString` / `gitRemoteUrl` /
`branch` / `profileName`, i.e. the owner's absolute local path and machine
name, because `get` resolves them from the owner's `cliProfiles` doc. Accepted
for V1: the viewer is a teammate on the same project, and the transcript is
full of absolute paths anyway.

## Reads that deliberately do not

These stay owner-only (`getAccessibleThread`); every consumer already handles
the empty result:

- `cli.interactionRequests.listPendingByThread` — answering is a write
- `cli.facts.getThreadRuntimeCommands` — composer-only
- `cli.messages.getLatestContinuationForThread` — "Continue locally" would leak
  the owner's local session
- `cli.messages.listUnprocessedUserMessages`,
  `cli.messages.listSteerRequestedUserMessages` — CLI-worker queries
- `cli.sessions.getSessionCapabilities`, `cli.worktreeOps.*`

## Writes: unchanged, and that is the point

**No write path follows the sharing rule.** Mutations keep using
`requireThreadOwnership` / `getAccessibleThread` / an explicit
`chat.userId !== user._id` check, and this holds structurally because no
mutation calls `getViewableThread`. A teammate on a shared thread is rejected
by `send`, `retry`, `requestSteer`, `editLastResend`, `removeQueued`,
`cancelProcessing`, `markRead`, `markUnread`, `updateTitle`, `remove`, `pin`,
`unpin`, `backfillLegacyContentForThread`, and
`interactionRequests.respond`; the batch mutations skip non-owned ids silently,
as they do for any other user's thread. An exhaustive table-driven test covers
this — it is the phase's safety property.

The viewer path performs **zero writes** — the two client mutations that fire
on their own are gated in Phase 2 (below) — so N teammates reading a live
thread add no write contention on a doc the CLI is already writing constantly.

## Two properties that must not regress

1. **A shared thread never appears in a teammate's project thread list.**
   `listSharedByProject` shows the caller's own shares. The project Watch Tower's All
   threads mode separately shows informational team summaries, whether shared
   or not, without granting conversation access.
2. **The viewer path performs no writes.**

## The toggle

- `api.cli.threads.core.share` — args `{ threadId }`, returns `null`.
- `api.cli.threads.core.unshare` — args `{ threadId }`, returns `null`.

Both are owner-only (`NOT_AUTHORIZED` otherwise), require `CLI_THREAD` on the
project, and are idempotent — a missing thread returns `null` rather than
throwing, matching `pin` / `unpin`.

A **group container** is shareable and shares the whole group (OS-1579).
`share` rejects two things:

- **workflow runs** (`workflowRunId` set, OS-1867) — `SHARE_WORKFLOW_RUN`,
  "Workflow runs cannot be shared". A run answers only to its starting user
  (`workflows.md` → Who acts on a run), and the read rule re-checks the same
  binding: a `sharedAt` reaching a run container by backfill still covers
  nothing.
- **group children** (`parentThreadId` set) — `SHARE_GROUP_CHILD`, "Threads
  inside a group cannot be shared". Not a policy so much as an index
  constraint: `by_user_project_deleted_sharedAt` is not parent-aware, so an
  individually-shared child would surface in the shared-threads view as a
  standalone row — the same bug `pin` avoids by rejecting children. Containers
  are already list rows, so allowing those costs nothing.

That is why the flag lives on the container and the *read* rule walks up to it,
rather than being mirrored down onto children: a mirror would have to be
indexed to be free, and any indexed copy on a child is exactly the leak.

### Adding a thread to a shared thread transfers the share

When the first group addition reparents the source, `addThreadToGroup` moves
`sharedAt` onto the container beside the existing pin transfer
and for the same reason — both follow the list row. The container replaces the
source in the list, and neither `listPinnedByProject` nor the shared-threads
index is parent-aware.

The link the owner already handed out **keeps working**: it points at a thread
that is now a child, and the access rule resolves it through the container.
That removed the OS-1575 wart. `addThreadToGroup` no longer returns
`unsharedSource`, and the client no longer shows a warning because sharing continues.

## Phase 2: the viewer's UI (OS-1575)

### Reaching the thread

The threads layout used to render the CLI setup screen whenever `hasProfiles`
was false. `useCliProfiles` is user-scoped, so a teammate opening a shared link
has zero profiles in that project and would never see the thread. The gate now
also requires that the route is **not** already pointing at a thread; on a
thread route with no profiles the workspace renders full-width and the sidebar
is suppressed (see `cli-no-profiles-onboarding.md`). A teammate who does have
profiles keeps their normal sidebar — and the shared thread is not in their
list, which is property 1 above.

### What the viewer cannot do

`chat.isOwner === false` is the single signal; every host derives `readOnly`
from it and nothing else. It removes:

- the composer and everything it hosts (selectors, cost indicator,
  context-window meter), the queued-messages strip and the interaction cards;
- every message-level action: edit-last, retry, continue-failed, plan
  decisions, AskUserQuestion submit, mention-in-reply, delete-held. The
  failed-run **error text stays** — see `cli-thread-embeddable-view.md` for the
  full `readOnly` contract and the three subscriptions it skips;
- every thread-level action: rename (including inline title editing), mark
  read/unread, done, pin, remove from group, delete, and the add-to-group "+" — all of which
  flow from one null `threadActionProps`;
- the run cards' file links and Undo, **and the run timeline's "Restore to
  before this run"**, all via `runFileOpContext = undefined`. The inline "N
  files changed +x −y" **summary stays** — it is denormalized on the message, so
  it needs no backend call.

`ThreadView` spreads its write handlers into `ThreadMessageList` as a single
`readOnly ? {} : {…}` bundle rather than gating each prop separately, so a new
write action has to be added to the bundle to reach the transcript at all.

The **Changes panel** is disabled rather than removed, and the viewer's default
panel becomes Tasks; see `cli-thread-detail-sidebar.md`. The **Tasks panel**
stays fully available — it is the project's task table, which a project member
can already read and edit.

The **Artifact panel** (`threadArtifact`, OS-1569) is likewise available but
rendered `disabled`: the editor, the name field, comment creation and the
send-to-thread menu are all inert. Opening it is a read, and a project member
with `TASK_VIEW` can already read the same artifact through the project route.
Its comment subscription (`useArtifactComments`) stays live for a viewer — a
subscription is a read, so this does not weaken "zero writes", which is about
mutations. The same `disabled` flag also covers an **archived** owning task, so
owner-on-archived and viewer-on-live are indistinguishable in the UI today.

### The two client mutations that fire on their own

These are what make "the viewer path performs zero writes" true, and they are
load-bearing rather than cosmetic — they are why watching a live run adds no
OCC pressure:

- **auto mark-read** — gated inside `useCliThread` on `isOwner !== false`, so
  every host inherits it (`cli-thread-read-state.md`);
- **legacy-content backfill** — `useCliMessages(threadId, { canWrite })`,
  default `true`.

Hosts derive both signals from `lib/threads/sharing.ts`, which deliberately
exposes **two** predicates rather than one:

- `threadCanWrite(thread)` — `isOwner === true`. Gates *firing* a mutation, so
  an unresolved thread counts as not-writable. Guessing "owner" here fires an
  owner-only mutation in the load window; the effects re-run once ownership
  resolves, so an owner's write is deferred a render, never skipped.
- `threadIsReadOnly(thread)` — `isOwner === false`. Gates *hiding* UI, so an
  unresolved thread counts as owned. Guessing "viewer" here strips an owner's
  composer and actions for a frame on every thread open.

They are not negations of each other and must not be collapsed into one.

### Telling the user

The detail header carries a **Shared** / **Read-only** badge
(`cli-thread-header.md`). The owner's toggle lives in the shared thread actions
menu — row dropdown, row right-click and the detail header's `...` — as
**Share with project team** / **Copy link** / **Stop sharing**
(`cli-thread-list.md`). Sharing copies the link in the same action.

## Phase 3: finding what you shared (OS-1576)

The owner's side of the loop. `cli.threads.lists.listSharedByProject` plus a
dedicated **Shared threads** view in the thread sidebar, entered from the
settings menu and left with X or Escape — a separate view, not a filter mixed
into the project list — and an icon-only shared badge on normal list rows.
`cli-thread-list.md` owns the behaviour, the pagination, and the subscription's
cost.

No change to the access rule, the write rules, or the viewer's UI: this phase
reads `sharedAt` and nothing else.

## Phase 4: sharing a group as a unit (OS-1579)

A group is shared from its **container**, and the share covers every run in it.
No schema change, no new index, no backfill — everything above is the same flag
in a new place.

What a viewer of a shared group gets, beyond a shared standalone thread:

- the **tab strip**, because `getGroup` now follows the access rule. Without it
  the group's other runs would be unreachable from the link, which is most of
  the point of sharing a group;
- **read-only on every tab**, derived per child from that child's own
  `isOwner`, so nothing about the strip weakens the Phase 2 rules. The "+"
  add-to-group action and the per-tab context menu were already gone for a viewer — they hang
  off `readOnly` and a null `threadActionProps`;
- one **Read-only** badge covering the group (`cli-thread-header.md`).

The owner's surfaces read the group's flag rather than the child's: `get`
mirrors the container's `sharedAt` onto every child as **`containerSharedAt`**, and
its `kind` as **`containerKind`**, both taken from the container document it
already fetches for `containerChildCount` — so the badge and the menu items cost no
extra read. From a tab, **Share group** / **Stop sharing group**
target `parentThreadId` and copy the container's URL (`cli-thread-list.md`).

The mirrored detail fields use the `container` prefix to identify their source:
`containerChildCount`, `containerSharedAt`, `containerKind`, and
`containerWorkflowRunId`. These are derived response fields, with no stored
columns or data migration. OS-1585 renames the count and sharing fields directly,
without compatibility aliases. Product labels still use "group" where appropriate;
sharing eligibility remains an access rule.

`containerKind` is what makes a tab's share action safe. A child carries no `kind`
of its own — only containers do — so a **workflow-run** tab is otherwise
indistinguishable from a group tab, and would offer to share a container the
backend refuses. Any surface deciding shareability for a child must read
`containerKind`, never the child's `kind`.

### What the group fallback costs

Worth stating plainly, because it is the only new cost in the phase and it is
an invalidation cost, not a read cost.

Per call the fallback is **one extra `db.get`** — O(1), and only for a
non-owner on an unshared group child. `share`/`unshare` stay a single patch
with no cascade; `getGroup` is the same one index scan it always was.

The consequence is that the container document joins the read set of the six
viewer-facing queries that resolve a child (`cli.threads.core.get` already read it).
`syncContainerDenorms` writes the container on every child write, so a viewer
watching one tab re-executes those queries whenever **any Group child** writes.
Three things bound it: the trigger is run-lifecycle events, not chunks
(`appendRunContent` never patches the thread); the results are unchanged, so
Convex sends nothing to the client; and **owners pay nothing**, because the
fallback sits strictly behind `!isOwner`.

The alternative — denormalizing the flag onto children on share — would remove
that fanout at the price of O(children ≤ `MAX_GROUP_CHILDREN`) writes per
toggle across documents the CLI writes constantly, plus a drift class that does
not exist today. Rejected, but it is the escape hatch if the fanout ever shows
up in practice.

### What a group does *not* do

- **Moving a child out of a shared group does not hand it the share.** Its link
  stops working; the group's link still does. This matches the pin, which a
  dissolving group also does not give back.
- The **container's own row** is what appears in the shared-threads view, never
  its children — that is the index constraint above, holding.

## Still out of scope

- A cap on how many threads one user may share in a project.
- Sharing a single run *out of* a group (the index is not parent-aware).
- Sharing a workflow run.
- Any notification that a thread was shared.
- Per-person sharing, public/anonymous links, and expiring links.

## Related specs

`cli-thread-embeddable-view.md` owns the `readOnly` contract;
`cli-thread-detail-sidebar.md` owns the disabled Changes tab;
`cli-thread-header.md` owns the badge and the stripped header;
`cli-thread-list.md` owns the share menu items, the shared-threads view and
the row badge;
`cli-thread-read-state.md` owns the owner-only auto mark-read;
`cli-no-profiles-onboarding.md` owns the layout gate;
`cli-thread-failed-message-actions.md` owns the failed-run actions;
`thread-groups.md` owns the container model — including the pin and share
transfer on the first group addition.
