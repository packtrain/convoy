# CLI Thread List

This document defines the user-visible defaults and preferences for the
project thread list.

## Sort Order

- The thread list defaults to **Last activity** for users without a stored
  sort preference. "Created" is the other option in the settings menu.
- A stored sort choice is preserved, and the client fallback shown while
  preferences load matches the backend default.

## Layout Density

- The thread list defaults to compact layout for users without a stored layout
  preference.
- Users can switch compact layout off from the thread-list settings menu.
- An explicit stored choice is preserved; changing the default does not
  override users who selected the full layout.
- The client fallback shown while preferences load matches the backend default
  so the list does not change density after the preference query resolves.
- The desktop thread sidebar uses the same card surface as normal compact
  thread rows, including the empty area below the list. The active thread's
  primary-tinted background remains distinct from this base surface.
- The currently open compact thread uses only a persistent primary-tinted
  background: it has no selection outline or leading-edge marker. The
  background does not change row geometry or disappear on hover. The thread
  link exposes `aria-current="page"`. This active-thread treatment is
  independent from multiselect state.
- Pending and streaming threads use the same busy spinner through the shared
  `ThreadStatusIndicator`, including compact rows, full rows, and workspace
  tabs. Pending keeps its "Queued" label and "Pending" tooltip. A thread
  waiting for an approval or answer keeps the waiting indicator instead.
- The currently open full-layout thread card is distinguished by a persistent
  primary-tinted background plus a subtle one-pixel inset outline at low
  primary contrast. The background is the dominant cue and remains on hover;
  the outline only defines the rounded card edge. The existing
  unread/working/waiting/failed corner highlight continues to render.
- Full-layout rows render as rounded cards with a subtle background and no
  separator lines between rows. Card anatomy:
  - Top line: optional task ref chip + thread title on the left; on the right,
    either the relative last-activity time (idle threads, with the blue unread
    dot when unread) or a colored status indicator with label ("Working",
    "Queued", "Waiting", "Failed") for non-idle threads — status and time share
    the same top-right slot.
  - Bottom line: branch (icon + mono name) on the left; agent avatar and CLI
    runtime icon on the bottom right. The agent name remains available through
    the avatar tooltip and assistive text, but is not shown inline.
  - On hover, the bottom-right agent/CLI info swaps to the small `...` actions
    button (same trigger style as compact rows), and a top-right status label
    swaps to the relative time — mirroring the compact-row hover behavior.
  - While a row's action menu is open, that hover swap stays latched even after
    the pointer leaves the row, so the `...` trigger keeps both its layout box
    and its visibility for as long as the menu it anchors is open. Compact rows
    remove the resting metadata from layout, so an unlatched trigger would
    measure as a zero-size anchor and the open menu would jump to the top-left
    corner of the viewport (OS-1596). The latch is also what keeps the row from
    showing its resting metadata underneath a menu that is still open.
  - The row action menu closes without an exit animation. The latch above is
    keyed on the open state, but the trigger is marked closed at the start of
    the exit animation while the menu is still mounted and still tracking its
    anchor — so an animated close reopens the same zero-size-anchor window that
    sends the menu to the viewport corner. Dismissing instantly is preferred
    over a 100ms fade that can end in the wrong place. Opening still animates.
  - Unread, working, waiting-for-input, and failed cards carry the Kanban card
    corner-glow treatment: a clipped, blurred color highlight decays inward
    from the bottom-right corner. The glow follows the existing indicator
    colors (blue for unread/working, amber for waiting, red for failed), and an
    active run or attention state takes precedence over unread. Queued and
    completed/read cards have no glow. This treatment is full-layout only.
- Compact rows with a known branch show a right-aligned hover card containing
  the thread title at the top (wrapped, clamped to three lines, since the row
  itself truncates it to one), the
  Git repository and working directory as separate rows, the full branch
  name, cumulative added/removed line totals, and the absolute date and time of
  the thread's latest activity. The working-directory row uses the configured
  path label and exposes the full local path as its title. The totals use the same
  `cliThreads.git.linesAdded` / `git.linesRemoved` data and presentation as
  Watch Tower;
  threads without recorded totals show an em dash. All fields come from the
  existing enriched thread-list item; opening the card performs no extra query.
  - The card is **pointer-only**: focus never opens it. The whole row is the
    hover trigger, and the row contains a stretched overlay link that holds
    focus after the user clicks the row — so a focus-driven open fires with the
    pointer nowhere near the row, most visibly when the browser re-dispatches
    focus at the stored active element as the window regains focus (returning to
    the tab after the machine unlocks). Such a card also never closes on its
    own: no `pointerleave` arrives and focus never moves, so neither close
    trigger fires. Keyboard users reach the same data from the row's other
    affordances; the card is informational only.

## Pull Request Badge (OS-1370)

Rows with a stored PR snapshot show an icon-only PR badge: compact rows in
the title line after the task-ref chip, full-layout rows in the bottom line
before the branch, and the compact branch hover card gains a **Pull request**
row. Capture, states, and placement rules are specified in
`cli-thread-pr-badge.md`.

## Shared Threads View (OS-1576)

Desktop-only, like multiselect; the mobile thread list omits it.

- The thread-list settings menu has a **Shared threads** entry. It opens a
  **separate view in the same sidebar** — not a filter over the normal list.
  Shared rows are never mixed into the project list, and the view never shows
  unshared ones.
- The view replaces the list body and the header. The header shows a share
  icon, the label **Shared threads**, and an **X** in the settings gear's
  position; the gear is not rendered, so sort/density/grouping and multiselect
  cannot be changed from inside a view that does not honour them. **X** and
  **Escape** leave the view. Escape is ignored while a dialog owns the key.
- Rows render through the same `ThreadListItem` as the normal list and keep
  their full action set, so **Stop sharing** is available from the view itself
  and the row leaves as the subscription updates. There is no **New thread**
  link: the view is a read-out of what is shared, not a place to start work.
  The **N** hotkey still navigates to the new-thread screen, because it is
  registered globally on the threads layout and the view is not modal — the
  link is dropped as an affordance, not as a route.
- The list is flat — no Pinned/Active/Done sections. Ordering is most recently
  shared first (`sharedAt` descending), paginated at
  `SIDEBAR_VIEW_THREADS_PAGE_SIZE` with the same **Load more** button the thread list
  uses. Paginated rather than capped at a `take(N)` ceiling: a cap truncates
  silently, and a shared thread the owner cannot find is a link they cannot
  revoke.
- Empty reads **No shared threads** in the shared empty state, distinct from
  the list's "No threads yet": the view is empty because nothing is shared,
  not because the project is. The empty state is held back while the first
  page is still loading.
- Leaving the view restores the normal list with its already-loaded pages: the
  main list queries stay mounted underneath, so exiting never re-paginates
  from the top.
- The view is browser-local `useState` in `ThreadSidebarContainer`, deliberately
  **not** a stored user preference — it is a place you visit, not a way you
  like your list. Switching projects leaves it.
- `cli/threads/lists.listSharedByProject` (`projectId`, `paginationOpts`) backs it. It
  is a dedicated query rather than a client-side filter over `listByProject`
  for the same reason the pinned query exists — that list is paginated, so
  filtering the loaded pages would silently omit a thread shared deeper than
  what happens to be loaded, and a filter that quietly drops matches is worse
  than no filter.
- It is `userId`-scoped like every other list query: it shows the caller's own
  shares, never threads teammates shared with them. This preserves the sharing
  spec's property that a shared thread never appears in a teammate's list.

### Reactivity and its cost

`useSidebarViewThreads` is a normal `usePaginatedQuery`, mounted only while the
view is open. It is live, so unsharing from inside the view takes the row away
and a share made elsewhere appears on its own — the row menu's "no handler
prop, no optimistic update, the row re-renders from the subscription" rule
holds here like everywhere else.

The cost is understood and accepted: a page re-runs on every write inside its
index range, and since pages are ordered by `sharedAt` descending, a recently
shared thread that is still streaming sits on page one, so that page re-sends
its enriched rows for every chunk batch. Pagination narrows this but does not
remove it — it only protects the pages the streaming thread is *not* on. A
view that is opened rarely and deliberately does not need to be optimized
against that.

A skipped paginated query reports `LoadingFirstPage`, so the closed view gates
its loading flag on `enabled`; otherwise it would keep a skeleton behind it for
a read it never issued.

## Background Threads View (OS-2513)

Guide runs and pull request checks runs are threads Convoy starts for a
feature, from the pull request page. Their output lands on that page (the Guide
tab, the Checks card), so in the thread list they are noise. They are
**background threads** and leave the project list for a view of their own.

- `cliThreads.isBackground` (`true` or unset) marks one. `insertCliThread` sets
  it when the thread is created with `pullRequestGuide` or `pullRequestChecks`,
  and nothing changes it afterwards: not a Retry (which clears the old thread's
  `pullRequestGuide`), not a message the user sends it. A future feature that
  starts threads sets the same flag.
- A flag rather than a purpose enum: the view lists every background thread by
  last activity, and an index range over an enum would order by purpose first.
- Each background row shows an icon-only badge naming its purpose, **Guide run**
  (book) or **Checks run** (checklist), in the same slot as the Shared badge.
  `toThreadItem` derives the item's `background` (`"guide"` / `"checks"`) rather
  than storing it: `pullRequestChecks` is never cleared, so a background thread
  without it is a Guide run, including an old one whose `pullRequestGuide` a
  Retry cleared. A third kind of background thread would store its purpose.
- The flat-list index family carries `isBackground` after `parentThreadId`, so
  `paginateProjectThreads` reads the normal list with `eq("isBackground",
  undefined)` and the view with `eq("isBackground", true)` on the same indexes.
  Every caller of that read follows: the sidebar and mobile list,
  `convoy threads list`, and MCP `list_threads`.
- The settings menu has a **Background threads** entry below **Shared
  threads**. It opens a view that behaves exactly like the Shared threads view
  above (desktop only, header with X, Escape, flat list, Load more, live), backed
  by `listByProject` with `background: true` and ordered by last activity.
  Empty reads **No background threads**.
- Background threads still appear everywhere else: Watch Tower and the desktop
  attention feed, the pull request page's thread list, a task's threads, the
  Pinned section if the user pins one, the Shared view if they share one, and by
  URL.
- `convoy threads list --background` lists them instead of the normal list.
  `list_threads` has no such argument: an agent asking what threads it has means
  its own work.
- `migrations.backfillCliThreadIsBackground` marks earlier runs. A Guide's
  pre-Retry thread lost its marker before this existed and stays in the list.

### Shared row badge

Rows whose `sharedAt` is set show an icon-only share badge, **immediately after
the PR badge in both densities** — compact rows in the title line (after the
task ref), full-layout rows in the metadata line (before the branch). Same
relative order either way, so toggling the density preference does not shuffle
two adjacent icons.

It carries the same amber as the thread header's **Shared** pill
(`ARCHIVED_TASK_LIST_ICON_CLASS`, OS-1799) rather than the row's muted grey: one
colour means "shared" everywhere, and the row and the detail view it opens
cannot disagree.

It is inert — sharing is toggled from the row's action menu — but it is not
unreachable. An icon-only badge inside a row body needs two things, both of
which `ThreadPrBadge` beside it already does:

- **`pointer-events-auto`.** Both row bodies are `pointer-events-none` so the
  row's overlay link owns the whole surface. Without opting back in,
  hit-testing skips the badge and its `title` — the only thing that explains
  the glyph to a sighted user — can never fire. The cost is a ~14px dead zone
  in the row link, which that line already pays for the PR badge.
- **`role="img"`.** ARIA ignores `aria-label` on a role-less element and the
  icon itself is `aria-hidden`, so without the role the badge has no
  accessible name at all.

The badge renders on **every surface that renders `ThreadListItem`** — the
sidebar list, the mobile thread list, the task detail sidebar's thread tab and
field, and the task table's agent-work cell — not only the
shared view, where every row is shared by definition. All the space-constrained
ones render compact rows, where the badge joins the task ref and PR badge
already in the title line and the title truncates before it.

`sharedAt` is therefore compared by both memo gates over the row — see **Row
freshness** below for the rule that guarantees it.

## Thread Actions

- Right-clicking an actionable thread row opens the same action set as the
  row's `...` menu in both compact and full layouts.
- Thread rows rendered without actions do not mount a right-click action menu.
- The dropdown and context menu share one canonical action implementation so
  availability, labels, disabled states, and callbacks stay synchronized.
- The items sit in four separator-delimited groups, top to bottom:
  1. **State** — Rename, Mark as read/unread, Mark as done, Pin. What the
     thread *is*. Never empty (Mark as done is unconditional), so it carries no
     leading separator.
  2. **Handoff** — Continue locally, Copy thread ID, the sharing items,
     Export to Markdown. Everything that moves the thread somewhere outside
     Convoy: a terminal command, an ID, a link, a file. Copy thread ID is
     unconditional, so this group always renders its separator.
  3. **Placement** — Remove thread from group.
  4. **Destructive** — Delete.
  Groups 3–4 each render their separator only when the group has an item, so an
  absent handler cannot leave an orphaned line.
- The menu is a fixed `w-60`, wide enough for "Remove thread from group" on one
  line.
- The action set carries the read-only sharing toggle (OS-1575,
  `cli-thread-sharing.md`), in the Handoff group:
  - **Share with project team** when the thread is not shared. It shares *and*
    copies the link in one step, toasting "Link copied — anyone on this project
    can open it" — sharing without handing over the link is a dead end.
  - **Copy link** and **Stop sharing** when `sharedAt` is set.
  - A group is shared as a unit (OS-1579), so on a **group container** the
    items read **Share group** / **Stop sharing group** — short on purpose, to
    pair with "Stop sharing group", which never named the audience either; the
    toast and the header badge tooltip name it instead. They act on
    the container — the shareable row. On a **group child** (a tab, never a
    list row) they carry the same labels but target `parentThreadId`, read the
    group's state from `containerSharedAt`, and copy the *container's* URL. Hiding
    them there would leave the group's own row as the only place to stop
    sharing, and a child has no row.
  - **Workflow runs** offer nothing — neither the container nor its
    **children**: the backend rejects them (`SHARE_WORKFLOW_RUN`) because
    `getGroup` is group-only, so a viewer would land on a container with
    neither a transcript nor a tab strip. The menu must not offer an action
    that can only fail. A run *child* is told apart from a group child by
    `containerKind`, not by its own `kind`, which a child never carries.
  - The items call `cli.threads.core.share` / `unshare` directly through
    `useConvex()` — no handler prop, no optimistic update; the menu closes on
    click and the row re-renders from the subscription. `share`/`unshare` patch
    `sharedAt` alone, with no `lastActivityAt` bump, so the row's freshness
    rests entirely on that field being compared (see **Row freshness**).
  - Sharing and copying report separately. The clipboard write fails in
    insecure contexts and on denied permission, and the thread is already
    shared by then — the failure notice has to say so rather than read as
    "sharing failed", or the user retries something that worked.
  - The same builder backs the row dropdown, the row right-click menu and the
    detail header's `...`, so all three inherit the toggle together. The
    detail header additionally shows a **Shared** badge that copies the link
    (`cli-thread-header.md`).
- Project sidebar rows promote the done toggle into the row's hover controls:
  - Compact rows swap their whole trailing metadata cluster — relative time,
    agent avatar (bound threads only) and CLI runtime icon, in that order —
    for a text-only **Done** / **Not done** micro-pill followed by `...`, with
    a deliberate gap between the controls. Nothing from the resting state
    survives the swap, so no metadata can sit under the hover controls.
  - The controls sit inline in the row's trailing column and are never painted
    over the title, which simply truncates against whichever layer is showing.
    The swapped-out layer leaves layout entirely, so a resting row spends no
    width on the hover controls and the title truncates as late as possible.
    Both controls keep transparent backgrounds, including their hover states,
    so the row surface shows through without a background-color patch.
  - Full-layout rows swap the bottom-right agent/runtime metadata for a small
    `...` action. On the top line, the relative time/status swaps to the same
    text-only **Done** / **Not done** micro-pill, placing it directly above the
    `...`. Its accessible label remains **Mark as done** or **Mark as not
    done**.
  - Running and queued threads keep the shortcut visible but disabled, matching
    the existing menu action.
- A done row is dimmed (reduced opacity).
  Compact rows show a checkmark in the leading status gutter. Full-layout rows
  show the checkmark at the start of the title line, before any task ref and
  the title. Hover restores full opacity so the row and its actions remain easy
  to inspect.
- Done/not-done toggles update the active thread-list queries (the single
  ungrouped list, or both section queries when done grouping is on) and the
  pinned-thread query optimistically. Marking done immediately clears the row's unread and
  attention presentation because the backend action also marks it reviewed;
  marking not done immediately changes only `isDone`. Convex rolls the cache
  update back if the mutation fails.
- `cli/threads/lists.listByProject` takes an optional `isDone` argument (OS-1451) so
  a done and a not-done section can each be paginated on their own, with their
  own Load more. It reads the indexed `statusProjection.isDone` (see
  `watch-tower.md`) under both sort orders.
  Omitting the argument keeps the single ungrouped list, which is what mobile
  and the other callers use. Both sections still return pinned rows; the client
  filters them out exactly as it does for the ungrouped list.
- The promoted shortcut is specific to the desktop project sidebar. Shared
  thread rows used by task surfaces, and the mobile list retain the
  existing `...` menu toggle without adding the hover shortcut.

## Done Grouping (OS-1394)

- The thread-list settings menu has a **Group done threads** switch next to
  "Compact layout". It is a server-stored user preference
  (`userPreferences.threadGroupDone`), **on by default** since OS-1561 made
  the collapsed Done section the place threads are put away (it replaced the
  removed Archived state), and applies to both the desktop sidebar and the
  mobile thread list screen.
- Off: today's single ungrouped list (one query, one Load more), with the
  **Threads** header appearing only when the pinned section is visible.
- On: three sections in fixed order — **Pinned** / **Active** / **Done**.
  Active and Done are separate paginated queries
  (`listByProject` with `isDone: false` / `true`), each with its own Load
  more; the Load more for Done sits inside the collapsible section. Pinned
  keeps its own non-paginated query and needs no Load more. Done loads a
  smaller first page (20 vs 60) since the section starts collapsed.
- The list queries wait for the grouping preference to resolve before the
  first fetch, so a grouped user never briefly loads and renders the
  ungrouped list on navigation.
- The **Active** label renders whenever either section has rows, so an
  all-done project shows "Active" (empty) above the Done section instead of
  a bare "Done" header.
- Desktop sidebar and the mobile thread list render the sections through one
  shared component (`ThreadListSections`); only row rendering differs per
  surface.
- **Done** is a collapsible section like Pinned, but collapsed by default
  (localStorage `convoy.thread-done-section-collapsed`).
- Done rows always render in compact layout regardless of the "Compact
  layout" preference — the section is a put-away pile, not a working list.
  Pinned and Active rows follow the preference.
- Both section queries also return pinned rows; the client filters them out
  exactly as for the ungrouped list. The two pages are merged, deduped by
  `_id`, and re-split by `isDone` client-side, so the existing optimistic
  done toggle moves a row between Active and Done instantly and the server
  converges when both queries re-run. The merge re-sorts by the active sort
  key (created / last activity, descending) so a row that moved sections
  lands in its final position immediately instead of jumping again on
  convergence.

## Pinned Threads (OS-1173)

- Every thread row's action set (dropdown and context menu) offers **Pin** /
  **Unpin** depending on the thread's current pin state. Pin state is
  per-thread server state (`cliThreads.isPinned` / `pinnedAt`); only the
  thread creator can pin.
- Pinned threads render in a **Pinned** section above the general list — in
  the desktop sidebar and the mobile thread list screen (the threads index on
  mobile; see `docs/specs/mobile-bottom-nav.md`) — and are removed from the
  general list while pinned. The section is hidden when no threads are pinned.
  While the pinned section is visible, the general list gets a plain
  non-collapsible **Threads** header so the boundary between the sections is
  unambiguous.
- In compact layout, the **Pinned** and **Threads** section headers use the
  same card surface color as compact thread rows. Full layout keeps the
  section headers on their existing standalone surface.
- Ordering inside the section is most recently pinned first (`pinnedAt`
  descending). Pinned threads come from a dedicated non-paginated query
  (`cli/threads/lists.listPinnedByProject`), so a pinned thread stays visible even
  when it is older than the loaded pages of the general list.
- The query reads at most `PINNED_THREADS_MAX` rows. Pins are user-curated and
  few, so this is a safety ceiling rather than a real limit — but it truncates
  silently, so it must stay well above any plausible pin count.
- The section header shows a chevron to the right of the "Pinned" label that
  appears on hover and rotates with the open state. Collapsing/expanding is a
  browser-local preference persisted in localStorage
  (`convoy.thread-pinned-section-collapsed`), deliberately not stored on the
  server. The Done section (OS-1394) reuses the same collapsible component and
  storage helper with its own key.
- Pin and unpin apply optimistically: the row moves between the sections
  instantly and rolls back with an error toast if the mutation fails.
- Pinned and done are **not** exclusive (OS-1561, superseding the OS-1554
  pinned/archived rule): the Pinned query has no `isDone` filter, so a pinned
  done row stays visible in the Pinned section. The invisible-row hazard that
  motivated the old exclusivity rule cannot occur.
- Pinned rows participate in desktop multiselect like any other visible row.

## Connected CLIs (OS-1993)

- The desktop sidebar shows a **Connected CLIs** section between the New
  thread link and Pinned. It replaced the dropdown on the project-header
  Threads button. That button is gone too: the threads page opens from the
  project's Threads sub-item in the app sidebar (OS-1957, see
  [project-sidebar-pinned-lists.md](project-sidebar-pinned-lists.md)).
- Named "Connected CLIs", not "agents", because **Agent** means the
  organization-owned template (see `CONTEXT.md`).
- It lists the caller's own online CLI sessions in the project
  (`cli/sessions.listByProject`, filtered to `isOnline`), sorted by profile
  key, falling back to the name. Other members' CLIs are never listed
  (OS-2321); shared remote environments will be listed on purpose by OS-2245.
  Clicking a row toggles its checkouts, the same as the chevron (below); it
  no longer opens the composer, which the working-directory selector covers.
  Rows use `bg-accent` on hover (`bg-muted` is invisible on `bg-card` in
  dark theme).
- Hovering a row opens the shared CLI profile hover card (same card as the
  working-directory selector). It includes a "CLI version" line with the
  connected `@useconvoy/cli` version (`v{appVersion}`, reported at
  register/reconnect via `cliSessions.appVersion`); CLIs older than 0.29.0
  report none and the line is hidden.
- The row's avatar is a toggle (OS-2036): it turns into a chevron on hover
  or keyboard focus and stays a chevron, pointing down, while expanded. Expanded, the row lists
  the profile's checkouts alphabetically (OS-2038) — every repo path (laptop
  icon, sorted by label) followed by its worktrees (branch icon, sorted by
  branch name), each with a shortened path — rendered by the worktrees module
  (`components/blocks/worktrees`). Checkout rows take the compact thread
  row's type and height; rows are rounded only in the non-compact layout.
  The checkout whose changes view is open is highlighted like the active
  thread row (`aria-current="page"`). Clicking a checkout opens its changes
  view (`?view=changes`, see
  [cli-worktrees.md](cli-worktrees.md#worktree-changes-view-os-1980-componentsblocksworktrees)).
  Expanded profiles persist in
  localStorage (`convoy.worktree-list-expanded-profiles`).
- Worktree rows (never main checkouts) end in a trash button, shown on
  hover, keyboard focus, and on the selected row (OS-2459). It opens a confirm
  dialog: the worktree's path is deleted from disk, its branch is kept, and a
  worktree with uncommitted changes can't be removed. While the op runs the
  button spins and the row dims. On success the row disappears with the CLI's
  re-sync, and if its changes view was open the page goes to the threads
  page. A refusal toasts the CLI's error with a "View changes" action. See
  [cli-worktrees.md](cli-worktrees.md#remove).
- With no connected CLIs it shows a copyable command: `connect` when the
  project has profiles, the interactive `setup` command when it has none.
- Collapsible like Pinned, collapsed by default, persisted in localStorage
  (`convoy.thread-connected-clis-section-collapsed`). Hidden while sessions
  load and in the shared-threads view.
- The mobile thread list screen (`MobileThreadListPanel`) shows the same
  section at the top, above Pinned. Tapping a CLI row toggles its checkouts;
  tapping a checkout opens its changes view full-screen.

## Bulk Actions (Multiselect)

Desktop-only; the mobile thread list screen has no multiselect mode.

- Multiselect is an explicit mode entered via the **Select multiple** entry in
  the thread-list settings menu. The entry exists only in the desktop sidebar;
  the shared settings component omits it when no enable callback is provided
  (mobile).
- Checkboxes never appear from row hover. While the mode is enabled, every
  loaded thread row shows a persistent checkbox as a standalone leading
  column in both compact and full layouts, without changing row height. The
  status indicator stays visible (leading in compact, top-right in full
  layout) so status-based selections (e.g. all failed threads) remain easy to
  spot.
- Clicking a checkbox toggles selection and never navigates; Shift+click
  selects the visible range from the last clicked row. Ordinary row clicks,
  task links, dropdown menus, and context menus behave exactly as in normal
  mode. Running/pending rows are selectable.
- Selection is limited to currently loaded visible rows and silently clamped
  at the shared batch cap (50); the header count shows "(max)" at the cap.
- While the mode is enabled the header keeps its fixed height and shows a
  selected-count label plus four icon-only actions in fixed order: Mark as
  read, Mark as done, Delete, then Exit (X) in the settings gear's position.
  The gear is not rendered in this mode, so sort/density/grouping settings
  cannot change mid-mode. All four buttons stay visible; actions derive
  disabled states instead of disappearing:
  - **Mark as read** is enabled when at least one selected row is unread or
    requires attention. It uses the existing batch mutation, which also
    acknowledges failed/waiting attention.
  - **Mark as done** is enabled whenever at least one row is selected. When
    every selected row is already done the button flips to **Mark as not
    done** (dashed-circle icon) and calls `batchMarkNotDone`; otherwise it
    calls `batchMarkDone` for the whole selection (already-done rows are
    idempotent no-ops).
  - **Delete** is enabled whenever at least one row is selected and always
    opens a count-aware confirmation dialog. Cancel returns to the same
    selection.
- The selection clears as soon as a bulk action is fired — together with the
  optimistic list update, not after the server round trip — while the mode
  stays enabled. On failure a toast is shown and the selection is restored so
  the action can be retried.
- The X button and the Escape key clear the selection, exit the mode, and
  restore the status indicators and settings gear. Escape is ignored while a
  dialog is open (the dialog owns the key). Switching projects resets the
  mode.
- Bulk actions reuse the Watch Tower batch mutations (`batchMarkRead`,
  `batchMarkDone`, `batchMarkNotDone`, `batchRemove`) and the single-thread
  navigation rules: if the currently open thread is deleted, the app navigates
  to the project thread index. Bulk mark-read clears active-thread auto-read
  suppression before the mutation.
- Selection math (toggle, Shift range, cap, visible-id intersection) is the
  shared pure helper `lib/threads/thread-batch-selection.ts`, also used by
  Watch Tower.

## Group Rows (OS-1476)

- A thread-group container renders through the **same** `ThreadListItem`
  component as a plain thread — same card, same layouts, no group-only
  visuals (no child-count badge). See `thread-groups.md` for the container
  model.
- The backend projects the container's `aggregateStatus` into the item's
  normal `status` field (`running` → `streaming`, `failed` → `failed`,
  `needs_attention` → `waiting_input`, `idle` → `completed`), so the
  spinner, red Failed, amber Waiting, unread dot, and done-gating work with
  zero client-side special-casing. A failed child outranks a waiting one
  (one label per row); acknowledging the failure surfaces the waiting
  state. `hasUnread`/`requiresAttention` aggregate from children
  server-side.
- The group row's branch chip shows the **origin branch**: the oldest live
  child's execution branch (the founding thread, unless it moved out or was
  deleted), denormalized as `originBranch` at the write seam alongside the
  other container denorms, falling back to the container's snapshotted
  profile-path branch. Diff stats, the PR badge, and worktree state stay
  child-specific and never render on the group row.
- The row menu hides **Continue locally** for containers (no transcript to
  resume). Every other action — rename, read/unread, done, pin, delete —
  uses the normal handlers, which cascade server-side.
- Delete confirmations are group-aware: the single-delete dialog titles
  "Delete group?" and says the group **and all threads in it** will be
  deleted; the batch dialog adds the same warning when the selection
  contains a group.
- Bulk-action failures surface the server's `ConvexError` message (e.g. the
  fan-out cap's "select fewer groups") instead of a generic failure toast.
- Sending a message to a container is rejected server-side ("Groups and
  workflow runs cannot receive messages") — a permanent invariant, not a
  stopgap: containers have no transcript. Since OS-1477 a group container's
  URL never rests on a composer anyway — it redirects to a child tab (see
  `thread-groups.md`, Rendering). The status projection is list-only:
  `cli/threads/core.get` returns the container's real (terminal) status so the
  detail view never mistakes a group for a running thread.
- While a group child's detail route is open, the sidebar highlights the
  **group row** (children are not in the list): the layout derives the
  active row id from the loaded thread's `parentThreadId`.

## Row Freshness (OS-1581)

Two memo gates sit between a realtime list update and a repainted row: the
sidebar's, over the whole list, and the row's own. Convex sends structurally new
objects on every update, so both compare field by field — and a field neither
gate reads is a field the user never sees change. The sidebar's gate runs first,
so a field missing *there* keeps the row stale however careful the row's own
comparator is.

- **One comparator, derived from the row's data type.** Both gates call
  `areThreadListItemsEqual` (`lib/threads/thread-list-item-equality.ts`), whose
  field list is a mapped type over `keyof ThreadListItemData` with every entry
  mandatory. Adding a field to that interface fails the build until the field is
  given a comparison. Hand-written lists in each gate are what let `sharedAt`
  and four other fields drift out of the sidebar's copy; a new one must not be
  introduced.
- **Value objects compare by value, never by identity** — the PR snapshot and
  the agent chip key by key at runtime, the associated task through
  `areThreadTasksEqual`. Identity always differs, so identity comparison would
  make the gate a no-op for those fields.
- **A gate is only as good as the props around it.** One unstable callback among
  the sidebar's props defeats its comparator entirely, whatever the comparator
  says. Everything `useCliThreads` and `useUserPreferences` hand the sidebar
  therefore keeps its identity across a re-render that changed nothing — which
  for a Convex mutation means memoizing it, since `withOptimisticUpdate` returns
  a new mutation on every call.

## Related Specifications

- `cli-thread-sidebar-resizing.md` defines desktop sidebar sizing behavior.
- `cli-thread-header.md` defines thread-row task context.
- `thread-groups.md` defines the container model and cascade semantics.
