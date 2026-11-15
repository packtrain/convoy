# Task Activity Log

The per-task change feed rendered in the task detail sidebar. One row per
logged change, attributed to the acting user.

Activity rows are one of three row kinds in the merged task timeline; that
stream — ordering, pagination, and the toggle that turns activity off — is
`docs/specs/task-timeline.md`. This spec owns what gets logged and how a row
reads.

Related specs: `docs/specs/task-external-links.md` (link changes),
`docs/specs/cli-thread-pr-badge.md` (PR capture),
`docs/specs/task-types.md` (type changes),
`docs/specs/task-detail-metadata.md` (Tags/Links rows),
`docs/specs/task-timeline.md` (the feed that renders these rows).

## Scope

- Rows are written to `taskActivityLogs` by `logTaskActivity.*`
  (`convex/tasks/lib/activity/logger.ts`), always via
  `ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, …)`.
- `changeDetails` payloads are **denormalized**: names, labels, and URLs are
  copied in at write time so history survives deletion and renames.
- The client reads rows through the merged `api.tasks.timeline.listByTask` and
  words them with `describeActivity` from
  `components/blocks/activity/activity-item.tsx`. That module is the event
  catalog only — its own avatar-attributed renderers went with the
  `All activity` tab; the rail in `components/blocks/tasks/task-timeline/` is
  the sole host.
- `api.tasks.activity.listByTask` still exists but has **no caller** left — the
  merged query replaced its only one, and unlike `tasks.comments.listByTask` it
  has no `apiKey` argument and no MCP consumer, so it is session-auth surface
  nothing reaches. It is kept because it is a **public** query: a deployed
  client may still be subscribed to it across a rolling deploy, so removing it
  is a deprecation with a deploy cycle, not a cleanup. Retiring it is a separate
  decision from this cutover; `convex/tasks/activity.test.ts` is what keeps its
  permission behaviour honest meanwhile.

## Design rules

- **One event type per subject, not per element.** A single user action
  produces exactly one row. A tag edit that swaps three tags is one
  `tags_changed` row carrying `added`/`removed`, not six rows.
- **Emit only on real change.** Every emitter compares normalized before/after
  values; a no-op update (reorder, identical re-upsert, same resolved task
  type) writes nothing.
- **One row per editing burst.** A debounced autosave is many mutations for one
  human action. Coalescible events collapse into the first row rather than one
  row per keystroke pause — see Coalescing below.
- **The frontend unions are hand-maintained mirrors.** `ActivityEventType` and
  `ActivityChangeDetails` in `apps/web/lib/tasks/types.ts` must be widened in
  the same change as the Convex validators in
  `convex/tasks/lib/activity/validators.ts`. A missing frontend literal falls
  through to the "performed an action" fallback (this was OS-1455's bug).

## Event catalog

| Event type | Trigger | `changeDetails` | Rendered as |
|---|---|---|---|
| `created` | task created | — | created this task |
| `status_changed` | status differs | `status` | changed status from A → B |
| `priority_changed` | priority differs | `priority` | changed priority from A → B |
| `assignee_changed` | owner differs | `assignee` | changed assignee … |
| `delegation_changed` | executor agent differs | `delegation` | delegated to / removed delegation |
| `list_changed` | List differs | `list` | moved from A → B |
| `label_changed` | label differs | `label` | set / removed / changed label |
| `parent_changed` | parent differs | `parent` | moved from A → B |
| `due_date_changed` | due date differs | `due_date` | changed due date from A → B |
| `name_edited` | name differs | `name` | updated the name |
| `description_edited` | description differs | — (see below) | updated the description |
| `deleted` / `restored` | soft delete / restore | — | deleted this task / restored this task |
| `archived` / `unarchived` | archive / unarchive | — | archived this task / restored this task from the archive |
| `comment_added` | **retired — no longer written** | `comment` | nothing (see below) |
| `attachment_added` / `attachment_removed` | attachment change | `attachment` | verb + file name |
| `artifact_added` / `artifact_updated` / `artifact_removed` | artifact change | `artifact` | verb + file name |
| `tags_changed` | tag set differs | `tags` | see Tags below |
| `type_changed` | resolved task type key differs | `task_type` | changed type from A → B |
| `external_link_changed` | one link added/removed/updated | `external_link` | verb + kind noun + label |
| `thread_attached` | thread attached after creation (OS-1713) | `thread` | attached thread + title |

`unarchived` deliberately reads "restored this task from the archive" —
`restored` already owns the plain wording for soft-delete restores.

## Coalescing (OS-1668)

Both the description editor and the artifact editor autosave on a debounce, so
typing one paragraph used to write a dozen rows and bury every other event in
the timeline. Coalescing is the fix; the debounce raise (650 ms → 3 s) only
reduces mutation volume and cannot fix row count on its own — any debounce still
fires once per typing pause.

`logActivity` reads the task's newest row first and returns its id unchanged when
all of

- both rows have the same non-null **coalesce subject**,
- same `userId`,
- `now - createdAt < ACTIVITY_COALESCE_WINDOW_MS` (5 min)

hold. Otherwise it inserts. `coalesceSubject` and the window live in
`convex/tasks/lib/activity/coalesce.ts`.

### The key is a subject, not an event type

A subject is what the row is *about*, and `null` means "never coalesce":

| Event | Subject | Why |
|---|---|---|
| `description_edited` | the event type | one description per task |
| `name_edited` | the event type | one name per task |
| `artifact_updated` | event type + `fileName` | a task has many artifacts |
| everything else | `null` | see below |

`artifact_updated` is why the key is not just the event type. A task holds many
artifacts, so keying on the type alone would collapse edits to `plan.md` and
`design.md` into one row displaying only whichever came first — a row that
actively lies about the other file. A **rename** likewise ends the burst, since
it changes the name the row renders.

Only events whose row is fully described by its subject may coalesce. An event
whose row shows a before/after value (status, priority, type) must never join:
collapsing `To Do → In Progress` with `In Progress → Done` would lose a real
transition. `description_edited` and `name_edited` qualify because they render a
flat "updated the X"; `artifact_updated` qualifies because its only rendered
detail, `fileName`, is *in* the subject.

Three deliberate properties:

- **Only the newest row is examined.** Any other event in between ends the burst,
  so "edited, moved list, edited again" correctly reads as three rows.
- **The kept row is never patched, and `createdAt` is never bumped.** The subject
  is what matched, so the row already reads correctly and has nothing to refresh;
  a bump would move it under the timeline's hand-rolled
  `(createdAt, _creationTime)` cursor — reordering rows mid-pagination is the same
  defect that rules out read-side filtering. The row therefore anchors at the
  **start** of the burst.
- **Coalescing happens at the write site**, inside `logActivity`, so every caller
  (session mutation, MCP, CLI) gets it. Read-side grouping was rejected: dropping
  rows after the read breaks the pagination contract (take 20, return 14, consume
  20 cursor positions), the reasoning already recorded for `comment_added` below.

Cost is one index-only `.first()` on `by_task_and_createdAt` per coalescible
write, and none at all for every other event type.

### Description (`description_edited`)

Carries **no `changeDetails`**. The row renders as "updated the description" and
neither side was ever read, so storing `oldValue` + `newValue` wrote two full
description bodies per row — the dominant cost of the OS-1668 row storm.

The `{ type: "description" }` member stays in `changeDetailsValidator` and in the
`ActivityChangeDetails` union: historical rows carry it and must keep validating
on read. Both fields are already `v.optional`, so nothing needs a migration.

### Comments (`comment_added`) — retired

**No longer emitted.** The merged timeline renders the comment itself, so an
"added a comment" row beside it is a duplicate. The
`logTaskActivity.commentAdded` call was removed from `tasks.comments`; the
`task.comment_added` internal event (notifications) is a different mechanism and
still fires.

Retired at the **write** site, not filtered at read: Convex cannot index a
`!=`, and a post-read filter breaks the pagination contract (take 20, drop 6,
return 14, but consume 20 cursor positions).

The literal is **retained** in `eventTypeValidator`, in the
`ActivityChangeDetails` union, and in `changeDetailsValidator` — historical rows
exist and must keep validating on read. Nothing can be backfilled from them:
`changeDetails` carries only a `commentId`. Same rule as
`cliMessageStatusValidator`'s legacy statuses; removing the literal needs an
explicit migration that rewrites or deletes those rows.

Historical rows render as **nothing** in the timeline, which is why a page can
show fewer rows than it fetched on an old task. `logTaskActivity.commentAdded`
itself is gone, so nothing can start writing them again by accident.

Renderers gate on the shared `isRenderableActivity` predicate rather than each
switching on the event type, and they skip the row's whole chrome — avatar,
attribution, timestamp — not merely its description text.

### One catalog of event copy

Every surface that words an activity row goes through `describeActivity`
(`components/blocks/activity/activity-item.tsx`) — the avatar-attributed log and
the task timeline's rail both. It returns `{ icon, text }` with the glyph kept
separate, because those two hosts place it differently (inline vs. a rail
gutter); see `docs/specs/task-timeline.md`. Adding a new event type means one
case here, not one per surface. Never reimplement the wording locally: the
timeline prototype did that as seed data, which is exactly how two copies of a
catalog start disagreeing.

### Tags (`tags_changed`)

- Payload: `{ type: "tags", added: string[], removed: string[] }`. Both arrays
  are always present; at least one is non-empty.
- The diff is set-based and case-sensitive (matching storage), so a pure
  reorder logs nothing.
- Copy: `added tag(s) …` / `removed tag(s) …` when only one side changed;
  `changed tags` with `+`/`−` chips when both did.
- Emitted from `tasks.core.update` only. `tasks.core.bulk.update` takes no
  `tags` argument.

### Task type (`type_changed`)

- Payload: `{ type: "task_type", oldKey?, oldName?, newKey, newName }`. Names
  are denormalized inside `logTaskActivity.typeChanged` (callers pass resolved
  keys only) so renaming a built-in type does not rewrite history.
- Both sides are compared **after** `resolveTaskTypeKey`, because the update
  patch normalizes the key — otherwise `undefined → "task"` would log a
  phantom change.
- Emitted from `tasks.core.update` and `tasks.core.bulk.update`.
- The renderer shows the built-in type glyph when the key is still built-in,
  and falls back to the stored name as plain text otherwise.

### External links (`external_link_changed`)

- Payload:
  `{ type: "external_link", op: "added" | "removed" | "updated", linkId, kind, label, url? }`.
  `label` is `getExternalLinkLabel(link)` at write time; `linkId` correlates
  rows about the same link across ops.
- `op` is derived from the before/after arrays inside
  `applyAndLogExternalLinkOp` (`convex/tasks/lib/externalLinks.ts`), **not**
  from the caller's `op` argument. Consequences:
  - deleting a missing id writes nothing and logs nothing;
  - an identical re-upsert (the normal MCP/CLI idempotency pattern, and what
    the PR refresh sweep does) writes nothing and logs nothing —
    `updatedAt` alone is not a change.
- This is the single write-plus-log path for `tasks.externalLinks`; every
  caller (`api.tasks.core.updateExternalLink`,
  `internal.tasks.core.upsertExternalLink`) goes through it.
- The label renders as an external anchor when a URL is present and the op is
  not `removed`; kind icon/noun come from
  `lib/tasks/external-link-presentation.ts`.

### Thread attached (`thread_attached`)

- Payload: `{ type: "thread", threadId, threadTitle }`. The title is copied at
  write time so the row survives thread deletion.
- Emitted only by `cli.threads.core.attachTask`, on the first attach. A
  same-task retry logs nothing. Threads created with a task, or bound by their
  first task-bearing message, log nothing: the thread row already sits at the
  right time.
- Why it exists: the timeline places a thread row at the thread's start time.
  An attached thread started before its task, so without this row the attach
  has no entry at the time it happened (`cli-thread-task-attachments.md`).

## Grouping

Consecutive rows share one vertical rail in the timeline; a comment or thread row
breaks the group. Grouping does **not** additionally split on the acting user or
a time window — every rail row carries its own icon, actor, and timestamp, so a
split would only break the line (`docs/specs/task-timeline.md`).

The `All activity` tab's same-user-within-~1s rule went with the tab, along with
the `useTaskActivity` hook that owned it.

## Attribution

`taskActivityLogs.userId` is required, so PR-derived link rows are attributed
to the thread owner rather than the agent that opened the PR. Agent
attribution would need an actor-kind field on the table — out of scope.

## Out of scope

- Text search within the feed.
- Retroactive backfill for changes made before an event type existed.
- The merged feed itself — its ordering, pagination, and the on/off toggle that
  hides activity rows are `docs/specs/task-timeline.md`.
