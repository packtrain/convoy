# Notifications

Notifications core (OS-1354), inbox UI (OS-1124), the toast channel
(OS-1244), and thread lifecycle notifications (OS-1243): the first consumer
of the internal event bus
(`docs/specs/internal-event-bus.md`). A fan-out handler turns bus events into
per-user `notifications` rows; those rows are the hub every delivery channel
consumes — the in-app inbox and toasts read them reactively, email (OS-1126)
and desktop (OS-1355) build on the same rows. This spec covers the backend (schema, fan-out rules, preferences schema,
retention, inbox API) and the sidebar inbox UI. Behavior rules originate from
the "Notifications — Shaped Requirements" artifact on OS-1003; where that
artifact's architecture section mentions an activity-log seam, it is
superseded by the event bus.

## Data Model

Table `notifications` (`convex/schema.ts`):

- `userId` — the recipient (one row per recipient per notification).
- `type` — a `NotificationType` (`convex/lib/contracts/notifications.ts`): the
  bus event types plus the derived `task.completed` (see Fan-out).
- `actorUserId` (optional) — who caused it; absent for CLI/system-originated
  events (thread lifecycle).
- `organizationId` — the project's org, denormalized at fan-out (OS-1398).
  Every read is org-scoped: the inbox, badge and toasts only ever show the
  organization the user is currently in. Optional in the schema for rows
  predating the field. A one-time backfill (since removed) stamped them and
  deleted rows whose project was gone.
- `projectId`, `subject` (same subject union as bus events: task or thread).
- `read` / `readAt` — unread flag.
- `snapshot` — denormalized render data copied at fan-out time so the inbox
  renders without joins. One shape for both subject kinds, all fields
  optional: task events fill `taskRef` ("ABC-12"), `taskTitle`, `taskTypeKey`,
  `newStatus` (status events only); thread events fill `threadTitle`,
  `threadCliType` (drives the runtime icon) and `threadMessage` (a short
  excerpt of the run's last assistant text, or of the prompt being waited on;
  see thread fan-out below).
  `actorName` is the acting user's name for task events and the agent/runtime
  label for thread events. The client picks by `subject.kind`. Snapshots are
  frozen at fan-out; a later task/thread rename does not rewrite them.
- Indexes: `by_user_and_org` (inbox list, `_creationTime` ordering),
  `by_user_and_org_and_read` (unread list/badge),
  `by_user_and_type_and_subjectId_and_read` (coalescing lookup, fully
  index-backed — coalescing is per subject, so it needs no org key).

Table `notificationPreferences`: sparse per-user overrides
`{ userId, projectId?, type, channel, enabled }` with `by_user`. Only rows
that differ from the defaults exist. `projectId` is reserved for per-project
overrides — v1 reads only rows with `projectId` unset and ignores the rest.
Channels (`convex/lib/contracts/notifications.ts`): `inApp` and `toast` are
independent. A row is created at fan-out when **either** is enabled; with
`inApp` off the row is **born read** (`read: true`, no `readAt`) — it feeds
the toaster and the inbox's "all" view but never the badge or unread view.
`toast` filters the toast feed at read time; `email` delivery is OS-1126.
Defaults (`channelDefault(type, channel)`): `toast` on for every type,
`email` off, `inApp` on for task types but **off for agent-run (`thread.*`)
types** — agent runs are toast-only by default so runs don't pile up in the
inbox; enabling In-app for them is an explicit override.

## Fan-out (`convex/notifications/fanout.ts`)

Registered on the event bus for all task and thread event types (registering
it also wakes the bus — `emitEvents` drops types with no handler). Runs inline
in the ingest mutation; failures are isolated per handler by the bus.

### Task events

1. **Type mapping**: `task.status_changed` with `newStatus` `Done`/`Canceled`
   becomes notification type `task.completed`; every other event keeps its
   type. "Completed" is user-facing later (dedicated preference + immediate
   email), so it is distinct from day one.
2. **Recipients**: task creator + current assignee, deduped, minus the actor
   (**self-actions never notify**). No watcher/subscriber fan-out in v1.
   Agent-originated actions (MCP/CLI run with a user identity) behave exactly
   like human actions. Recipients are not permission-checked at fan-out; the
   inbox degrades rows to "No access" at read time instead (see Inbox API).
3. **Preferences**: per recipient, at least one of `inApp`/`toast` must be
   enabled (override rows, else defaults) or the row is skipped. With `inApp`
   disabled the row is inserted born-read (toast-only; see Data Model).
4. **Coalescing**: before inserting, unread notifications for the same
   (recipient, type, subject) are deleted — rapid same-type events on one task
   collapse into a single unread row with the freshest snapshot and creation
   time. Read rows are never touched, so a new event after the user read the
   previous one produces a new row.
5. **Snapshot**: loaded from the live task/project/actor docs at dispatch time
   (milliseconds after the mutation). Soft-deleted tasks still resolve, so
   `task.deleted`/`task.archived` notifications render.

### Thread lifecycle events (OS-1243)

`thread.completed`, `thread.failed`, and `thread.waiting_input` (see
`docs/specs/internal-event-bus.md` for the producer sites):

1. **Recipient**: the thread owner, and only the owner. Deleted threads never
   notify.
2. **Self-action suppression**: CLI-driven transitions arrive with no actor,
   so the owner is notified. Browser-driven wind-downs (cancel run, delete
   thread) set the acting user — the owner — and are suppressed here. The
   same coalescing and `inApp` preference rules as task events apply
   (preference key = the notification type).
3. **Snapshot**: `threadTitle`, `threadCliType`, plus `actorName` = the
   thread's acting-agent label (`getThreadActorLabel` in
   `cli/threads/lib/cliThreadsRepo.ts`: bound Project agent name, else the runtime
   label like "Claude Code"). `threadMessage` is truncated to 240 chars and
   sourced per event type:
   - `thread.completed` / `thread.failed`: the final whole `text` event or completed `proposed-plan` event found
     in the tail chunks of the event's own assistant message (the `messageId`
     in the event payload — never "latest by thread", which could belong to a
     newer run by dispatch time). The scan is pinned to **stored**
     (non-ephemeral) rows through the index, not filtered after reading
     (`listLatestStoredChunksByMessage`): `complete` schedules
     `cleanupEphemeralChunks` and the ingest from the same commit, so a scan
     that spanned the delta rows collided with that janitor's deletes and
     forced write-conflict retries of `events/core:ingest` (OS-1673). Pinning
     also stops a delta-heavy tail from spending the whole window on rows the
     preview would discard. Absent when the payload carries no message, the
     stored tail is all tool traffic, or the run produced no text.
   - `thread.waiting_input`: the prompt itself, read from the pending
     interaction request for that message (first question / plan opening line
     / tool-approval title, see `cli/lib/interactionPreview.ts`). This event
     dispatches mid-run, so reading that message's chunks would overlap the
     index range `appendRunContent` is still inserting into and force
     write-conflict retries of `events/core:ingest`. Absent when the request
     was already answered by dispatch time or its payload carries no text.
4. Rapid mid-run interaction requests coalesce like any same-type events on
   one subject; only *new* requests emit, lease refreshes don't. One wait
   episode emits **once**: when a run completes still waiting for input while
   an interaction request is pending, `complete` skips its own
   `thread.waiting_input` — the request's creation already emitted it, and a
   coalesced reinsert would mint a fresh row id and toast the owner twice.

## Inbox API (`convex/notifications/core.ts`)

Every read is **scoped to one organization**: `list`, `unreadCount`, `recent`
and `markAllAsRead` all take an `organizationId` and only see rows stamped
with it (OS-1398) — switching orgs swaps the whole inbox, badge and toast
feed. The arg needs no membership check: the reads are already keyed on the
caller's own rows, so it can only narrow their own feed. `markRead` /
`markUnread` address one row by id and are org-agnostic.

- `list` — the caller's notifications in that org, newest first, paginated;
  `unreadOnly: true` switches to the unread index (the UI's all/unread
  toggle). Unauthenticated callers get an empty page. Rows are returned as
  **feed items**: the row plus `orgSlug` + `projectAlias` (for the task deep
  link `/o/{orgSlug}/{projectAlias}?task={taskRef}`) and the actor's live
  `actorAvatarUrl` (the snapshot stays frozen; the avatar is live).
- **No rows are hidden.** Accessibility is resolved per subject kind, matching
  what the link's destination enforces: task rows require `TASK_VIEW`, thread
  rows require `CLI_THREAD` (a project viewer keeps task links but gets
  "No access" thread rows). If the recipient lacks that permission on the
  project (membership lost or downgraded, project or org deleted), the feed
  item just comes back without `orgSlug`/`projectAlias` and the client renders
  it as a "No access" row — no link, snapshot content replaced by the
  placeholder. Task state is never read: soft-deleted tasks render from the
  frozen snapshot like any other row (the deep link may land on a
  gone task, which the task view handles). This keeps `list` and
  `unreadCount` cheap and keeps the badge trivially consistent with the
  list.
- `unreadCount` — the caller's unread count for the bell badge: one bounded
  indexed read (`UNREAD_COUNT_CAP`, 100), no joins or permission checks;
  the UI renders 100+ as "99+". A reactive query, so the badge updates
  without polling — and since it only reads the unread index, it only
  recomputes when the caller's unread set changes.
- `markRead` / `markUnread` — toggle one own notification's read state;
  missing rows are a no-op, another user's row throws
  `NOTIFICATION_NOT_FOUND` (existence not leaked). `markUnread` clears
  `readAt`.
- `recent` — the toast channel's feed: `{ items, watermark }`. `items` is
  the newest `TOAST_RECENT_LIMIT` (5) toastable rows regardless of read
  state, enriched exactly like `list`; the read scans
  `TOAST_RECENT_SCAN_LIMIT` (20) rows before filtering so toast-muted types
  cannot starve the window. `watermark` is the newest row's creation time
  **before** filtering (0 when empty) — the client cursor follows it so
  muted rows still advance the cursor (see Toast channel). Bounded and
  reactive; the client does the "what's new" filtering.
- `markAllAsRead` — marks every unread notification of the caller **in that
  organization** read, so clearing one workspace's inbox leaves another's
  badge alone. Bounded per transaction: the first `MARK_ALL_READ_BATCH`
  (500) rows are marked synchronously (so the badge reacts instantly); a
  full batch schedules `markAllAsReadSweep`, which repeats until the unread
  index drains. The unread index is the cursor, so the sweep is idempotent
  and restart-safe — but an over-batch inbox flips in waves, not
  atomically.

## Inbox UI (sidebar panel)

Notion-style inbox living in the app sidebar
(`components/blocks/sidebar/notifications-subpage.tsx`), following the
settings sub-sidebar pattern (`docs/specs/app-sidebar.md`):

- The **Notifications bell** in the main sidebar nav toggles the panel; a
  red pill badge shows the unread count ("99+" cap). Unlike the
  route-driven settings subpages, the panel is **state-driven**: it opens
  over any page without navigating, and the back button restores the normal
  sidebar leaving the main content untouched. When open on desktop it renders
  in the split layout (icon rail + panel) and takes precedence over a
  settings subpage; on mobile it opens in the shared bottom drawer from the
  mobile menu's bell.
- On desktop, clicking outside the inbox closes it and still activates the
  clicked control on the first click. The bell remains a toggle. The inbox
  body, its filter menu, and its per-row settings menus count as inside,
  including menu content rendered in portals. Read actions and pagination
  leave the inbox open. Dismissal never changes read state.
- Inbox dropdowns are non-modal. Opening either menu with the pointer must
  leave the trigger interactive through pointer-up and click. A modal menu
  disables page pointer events on pointer-down, which can redirect the
  opening click to the document and incorrectly dismiss the inbox.
- Pathname or query-string navigation closes the inbox, including opening a
  task through `?task=...`, keyboard navigation, and browser Back/Forward.
  Hash-only changes leave it open. Closing restores any route-driven settings
  sidebar and preserves the saved expanded/collapsed preference. Mobile keeps
  its existing drawer backdrop and row-navigation dismissal.
- Outside clicks use a document capture listener while the desktop inbox is
  open, so stopped propagation cannot leave it stuck. Dismissal runs in the
  next timer task after click activation; closing or unmounting cancels pending
  dismissal. A per-instance boundary identifies the inbox, its menus, and bell.
  Main sidebar controls stay mounted across split-layout changes, and open
  project List menus remain mounted until dismissed or selected.
- Header: back button + "Notifications" title, a mark-all-as-read button
  (disabled at zero unread), and a filter dropdown with "Unread" (default) /
  "Unread & read". The filter choice persists in localStorage
  (`lib/notifications/filter-storage.ts`) — a client-side preference only;
  storage failures fall back to the unread default.
- An empty inbox renders the shared empty state
  (`docs/guidelines/frontend-development.md#empty-states`) centered in the
  panel: "You're all caught up" in the unread view, "No notifications yet" in
  the all view.
- Rows show the actor avatar (initial fallback) and three lines: (1) the
  actor name (truncates) with relative time + unread blue dot on the right;
  (2) the verb from the notification type (wraps — it is the payload), e.g.
  "commented on", "completed"; status changes render "moved to" followed by
  the shared status pill (`StatusBadge` with icon + text); (3) the task
  line from the snapshot: the shared type-icon + ref component
  (`TaskRefWithType`, type resolved from the snapshot's `taskTypeKey`,
  non-interactive) plus the title, which truncates. Thread rows (OS-1243)
  use the CLI runtime icon as the avatar (initial fallback for runtimes
  without one — the icon alone marks the actor as an agent), show the agent
  label as the actor, a plain verb ("finished", "failed",
  "is waiting for your input" — failed-run rows render the verb in the
  destructive color, and while unread the whole row gets a faint destructive
  wash (deepened on hover, dropped once read) so failures don't scan as
  routine), and a subject block with the thread title
  plus the snapshot's `threadMessage` excerpt clamped to two lines, linking
  to the thread detail
  (`/o/{orgSlug}/{projectAlias}/threads/{threadId}`). Rows whose feed
  item lacks `orgSlug`/`projectAlias` (recipient lost project access) keep
  the actor/verb/time line but replace the task ref + title with an italic
  "No access" placeholder and are not clickable; their mark-read toolbar
  still works. Clicking a normal row only navigates to
  the task deep link and
  closes the panel — it never changes read state. Read state changes only
  through explicit actions: a per-row toolbar with a mark read/unread
  toggle (revealed on hover with fine pointers, always visible on touch —
  coarse pointers have no hover), and the header's mark-all-as-read. No
  archive action (not in v1). The toolbar also holds a bell button opening
  the per-row settings dropdown (see Preferences below).
- Pagination: 20 per page with a "Show more" button while more pages exist.

## Toast channel (OS-1244)

`components/blocks/notifications/notification-toasts.tsx`, mounted once in
the authenticated org shell (`app/o/[organizationSlug]/layout.tsx`), so
toasts fire on any app page. It renders nothing; it subscribes to `recent`
and keeps a client-side creation-time cursor:

- On mount the cursor snaps to the server watermark — existing rows are
  inbox backlog, never toasted. The org shell keys the component by org id,
  so switching organizations remounts it and the cursor re-snaps to the new
  org's watermark: that org's backlog is backlog too.
  Rows created after mount toast oldest first,
  unless a user already read them (`readAt` set, e.g. on another device);
  born-read toast-only rows (read without `readAt`) still toast — the toast
  is their only delivery. The notification `_id` doubles as the sonner toast
  id (dedup). The cursor always advances to the watermark, which covers
  toast-muted rows too — so re-enabling a muted type later cannot replay its
  old rows as toasts.
- **Nothing older than `MAX_DELIVERY_AGE_MS` (2 min) is delivered** (OS-1754),
  toast or sound. The cursor is a *watermark*, not an expiry: a tab that mounted
  this morning treats every row since as new, so the moment the browser thaws it
  and the query catches up it would fire the whole backlog as one burst. Rows
  that old are history — the inbox already has them. This is the guard that
  covers rows **no tab ever claimed**: created while every tab was frozen, or
  while the browser was closed. The claim ring below only dedupes what some
  tab did deliver (or consumed on a visible thread page, see below). Age is
  measured against the client clock, so a machine running more than 2 min fast
  delivers nothing; a monotonic sleep detector is the upgrade if that ever bites.
- **One toast per row across tabs** (OS-1754). The cursor is per-tab and
  in-memory, which only holds while the tab keeps running: a browser-frozen
  background tab processes the update whenever it thaws, so it re-toasted rows
  another tab had already delivered — minutes later, on wake. Delivery is
  therefore claimed in a `localStorage` ring of the 20 most recently delivered
  ids (`lib/notifications/delivery-storage.ts`,
  `convoy.notifications-delivered.toast`), shared by every tab of the profile
  and outliving any freeze. A claimed row is silently skipped; it is still in
  the inbox. Consequence, accepted: with two windows side by side only the tab
  that processes first toasts. The claim is read-then-write, not atomic, so
  same-tick tabs can both win — harmless for a toast.
- Toast content is plain text from the frozen snapshot: "{actor} {verb}
  {taskRef}" (e.g. "Ada moved OS-12 to In Progress") with the task title as
  description and a "View" action navigating to the task deep link. Thread
  rows read "{agent label} finished a run / failed / is waiting for your
  input" with the thread title plus the `threadMessage` excerpt as
  description and View opening the thread detail. On those rows the CLI
  runtime icon (from the snapshot's `threadCliType`) leads the headline and
  **replaces** the actor label when the label is just the generic runtime name
  — a Project agent's own name still renders, since the icon only stands in
  for the runtime. The verb and the excerpt are muted; the thread title is the
  one emphasized line. Runtimes with no registered icon keep the plain text
  form. A thread notification is
  **not toasted while its thread detail page is open** — the reply is already
  on screen (the row still lands in the inbox unread). When that page's tab is
  *visible*, the suppression also **claims** the row for both purposes: the
  user saw the reply, so a frozen sibling tab must not replay it as toast or
  sound when it thaws on the next tab switch. A *hidden* tab parked on the
  page skips without claiming — the tab the user is actually in still
  delivers.
- Rows without `orgSlug`/`projectAlias` ("No access" in the inbox) are
  skipped — a toast about an unviewable task is noise.
- Self-actions never toast (already suppressed at fan-out). `recent` drops
  rows whose type has the `toast` channel disabled — "in the inbox but not
  as a toast" — so the toaster never sees them; the reverse ("as a toast but
  not unread in the inbox") is the born-read row from fan-out.
- **Events in other organizations never toast** (OS-1398), deliberately: the
  toaster follows the org you are in, like the inbox and the badge. Such a
  row is not lost — it waits in that org's inbox — but by the time you switch
  it is backlog, so it arrives silently. Agent-run rows (toast-only by
  default, born read) therefore show up only in that org's "all" view
  without raising its badge. Cross-org delivery is email/push/desktop's job,
  not the toaster's.

## Sound (OS-1754)

`lib/notifications/sound.ts`, called from the toast loop, so sound inherits
every toast rule: org scope, the mount watermark, muted types, "No access"
rows, and **no sound while that thread's page is open** (the toast's `continue`
covers both, and a visible thread page claims the sound too — see Toast).
The one rule it does not inherit is the toast's delivery claim —
it takes its own (see below), because the tab that toasts may be one autoplay
policy forbids from playing. It fires for agent-run rows only — task
notifications stay silent. Not a delivery channel: there is no `sound` in
`NotificationChannel`, no preference row, and no effect on fan-out; the
notification type alone picks the sound.

- Preference: a per-device `localStorage` flag (`convoy.notification-sound`,
  default on), like the inbox filter and the desktop app's native-notification
  pref — a sound belongs to the machine you are at, not the account. Exposed as
  a single switch at the top of the settings Notifications tab; turning Toast
  off for an agent-run type silences it there too, since sound follows the
  toast.
- **Two tiers, two sounds.** `thread.failed` and `thread.waiting_input` need a
  look now, so they share the louder repeated-beep
  `public/sounds/attention.wav`; `thread.completed` is an FYI and gets the
  quieter rising `public/sounds/run-finished.wav`. Both are ~0.5s WAVs played
  through a throwaway `Audio` element — placeholder tones, swap the files if
  design supplies real ones. Playback failures (autoplay policy, muted device)
  are swallowed.
- **One sound per row, ever**: the row is claimed in its own ring
  (`convoy.notifications-delivered.sound`, see Toast channel) before any
  playback. That is the durable half of the dedup — it survives a tab freeze,
  where the Web Lock hold below does not, so a tab thawing minutes later on the
  same row stays quiet (OS-1754).
- **One sound across tabs**: every open tab receives the same reactive `recent`
  update in the same tick, and the ring claim is read-then-write, so it alone
  would let all of them play. Each tab therefore also races for a Web Lock
  (`navigator.locks.request(..., { ifAvailable: true })`) and only the winner
  plays, holding the lock ~2s to cover the delivery skew between tabs. The hold
  is **per tier**, not per notification: a burst of runs finishing together
  beeps once, but a finished run cannot mute an attention event landing in the
  same window (the two can overlap — accepted, the urgent one must never be
  swallowed). Locks release when a tab closes, so there is no stale owner.
  Browsers without Web Locks (Firefox <96, Safari <15.4) skip the claim and
  may beep per tab.
- A tab with no user activation (`navigator.userActivation.hasBeenActive ===
  false`, Chrome-only) skips **both** claims, ring and lock: autoplay policy
  would block its playback, and winning either would swallow the sound for the
  tab that could have played it. A session-restored background tab is the real
  case — it is live and reactive but has never been touched.
- Dedup is per browser profile, so the desktop app's native notification
  (OS-1240, its own OS sound) and a browser tab can both fire.

## Preferences (OS-1125)

API (`convex/notifications/preferences.ts`):

- `preferences.list` — the caller's **effective** type × channel matrix
  (defaults applied over the sparse override rows). Unauthenticated: empty.
- `preferences.set({ entries })` — batch upsert (1 to matrix-size entries;
  duplicates last-write-wins). Storage stays sparse: an entry matching its
  (type, channel) default deletes its override row instead of storing it, so
  the table only ever holds diffs from defaults.

UI — two surfaces, both driven by
`lib/notifications/hooks/use-notification-preferences.ts` (list subscription
+ optimistic `set`, so toggles flip instantly) and the shared group catalog
`lib/notifications/preference-groups.ts` ("Tasks" and "Agent runs" groups
with per-type labels):

- **Settings section** (`components/blocks/user/settings/notifications-section.tsx`,
  the user settings dialog's Notifications tab): one row per type (agents-
  section row style) with a badge-style **channel multiselect dropdown** —
  checkbox items with channel icons; the trigger summarizes the selection
  ("In-app, Toast" / "Off", "Mixed" on group rows with disagreeing types).
  Active channels: In-app and Toast, independently togglable. Future channels
  (Email, Push, Desktop) are listed but disabled until their tickets ship;
  each ships by wiring its item, no redesign. The group header carries the
  same dropdown applying a channel to every type in the group at once.
  Grouping and the group control are presentation only — the write is
  always per-type rows. Each type row also has an info popover explaining
  exactly when the caller is notified. Task copy names the concrete recipient
  rule (a task the caller created or is currently assigned to), and creation
  clarifies that it only notifies the assignee; agent-run copy clarifies that
  the thread must be owned by the caller. The copy consistently excludes the
  caller's own task actions, matching fan-out suppression. Above the groups sits
  the per-device sound switch (see Sound) — the one control here that is not a
  server-stored channel.
- **Per-row dropdown** (inbox rows, bell button in the hover toolbar):
  Notion-style menu listing the row's whole group with per-type checkboxes.
  Items keep the menu open (multiple flips per visit). The whole hover
  toolbar is a sibling of the row link, never a child: next/link navigates on
  any React-bubbled click (including clicks inside a portalled menu)
  regardless of DOM containment, so toolbar/menu clicks must never pass
  through the anchor.

Disabling a type's In-app channel stops its unread rows: new events arrive
born-read while Toast stays on (toast-only), and stop entirely once both
channels are off. Coalescing only touches unread rows, so a burst of
toast-only events leaves multiple read rows in the "all" view instead of one
— accepted. Existing rows always stay; preference changes are never
retroactive.

## Retention

A daily cron (`convex/crons.ts` → `internal.notifications.core.retentionSweep`)
deletes notifications older than `NOTIFICATION_RETENTION_MS` (90 days),
read or not, in bounded batches via the built-in `by_creation_time` index.

## Out of scope (follow-up tickets)

Emails (OS-1126), mentions (OS-1127/1128), push (OS-1245), desktop (OS-1355),
per-project preference overrides and project-wide subscriptions, notification
archiving.

## Error Messages

From `convex/notifications/errors.ts`:

- `Notification not found` — `markRead` on a row owned by another user (also
  the hypothetical missing-row message; actual missing rows are a no-op).
- `Invalid notification preference entries` — `preferences.set` with an empty
  or oversized entry list.
