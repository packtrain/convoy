# CLI Thread Header Specification

This document defines the baseline header behavior for the main CLI thread panel.

## Overview

- The main thread panel includes a top header bar in both:
  - New thread view (`/threads`)
  - Existing thread detail view (`/threads/[threadId]`)
- The header shows a single title.
- Existing thread detail view may also show the thread's associated task ref before the title.
- The header layout supports optional right-side action controls.
- On desktop, existing thread detail view shows **Mark as read** (when it would have an effect) and the **Mark as done**/**Mark as not done** toggle (enabled mid-run, see `docs/specs/cli-thread-read-state.md`) on the right.
- On mobile, those text buttons are replaced by the same complete thread `...`
  actions dropdown used by thread-list rows: Rename, read/unread, done/not done,
  Continue locally, Pin/Unpin, Export to Markdown
  (`docs/specs/cli-thread-markdown-export.md`; open thread only, so list rows
  omit it), and Delete. Rename and Delete retain their existing dialogs.
- While the right sidebar is closed, the responsive thread actions are followed
  by a vertical separator and the sidebar-open toggle. The layout mode toggle is
  not shown — reopening the sidebar brings it back.
- While the right sidebar is open, the thread header omits that separator and
  the toggle. The sidebar tab bar renders the layout mode toggle and the
  collapse toggle at its far-right edge, so both stay at the workspace's
  top-right corner.
- The **layout mode toggle** switches between the split and full-width layouts
  (see `docs/specs/cli-thread-detail-sidebar.md`) and is desktop-only (hidden
  below `md`).
- The header supports an optional **tabs slot**. When set, the tabs replace the
  title after `leading`; the thread's own tab carries the thread title (and the
  associated task ref, which moves out of `leading` and into that tab) and sits
  at the left, while the panel tabs are pushed to the right, separated from the
  thread tabs (and the strip's trailing "+") by a vertical divider. The tab strip
  overlaps the header's bottom border so the active underline sits on that
  divider rather than a pixel above it. Only the full-width layout uses this slot, and inline title
  editing is unavailable while it is active.
- Thread actions (Mark as read, Mark as done) live in the header only
  in the split layout. In the full-width layout they move to the thread tab's
  own toolbar row. Either way they end with a `...` button opening the same
  complete thread actions menu the thread-list rows use.
- A container's Done menu follows that `...` button, before the sidebar
  separator. In full-width view it follows the thread toolbar actions, moving
  to the header when a panel or draft covers the toolbar. Read-only viewers
  retain this navigation control. See `thread-groups.md` for menu behavior.
- New-thread and existing-thread sidebars use the same underline-tab header
  treatment. The new-thread sidebar shows a single **Tasks** tab (plus the task
  detail tab while a task is selected); it does not use a plain title-and-close
  header.
- Persona/workspace metadata is shown near the composer, not in the header.
- Inline title editing is enabled only on existing thread detail view.
- The header carries a **shared/read-only badge** — see below.

## Shared and read-only states (OS-1575)

`ThreadSharedBadge` renders first in the header's `actions` slot — the one slot
both layouts have, since the full-width layout replaces the title with tabs.

| State | Badge | Behaviour |
|---|---|---|
| Owner, `sharedAt` set | "Shared" | tooltip explains project-wide read access; activating it copies the thread link |
| Viewer (`isOwner === false`) | "Read-only" | tooltip "Shared with you by the thread owner — you can watch but not reply" |
| Owner, not shared | — | nothing rendered |

A **tab of a shared group** (OS-1579) shows the same two pills, driven by the
group: the state comes from `containerSharedAt` (the container's `sharedAt`,
mirrored onto every child by `cli.threads.core.get`), the link copies the
**container's** URL, and the tooltips say "group" rather than "thread". A child
never carries `sharedAt` of its own, so reading that field alone would show an
unshared header on every tab of a shared group. The group wording and the
container link are gated on `containerKind === "group"` — a workflow-run tab is a
child too, and is never covered by a share.

The viewer badge is load-bearing, not decoration: without it the missing
composer reads as a broken page.

Both pills are sized and coloured to match the project header's **Archived**
pill — same height (`h-7`), text size, icon size and amber palette, taken from
`ARCHIVED_TASK_LIST_TRIGGER_CLASS` / `ARCHIVED_TASK_LIST_ICON_CLASS` so the two
cannot drift. A default-size badge reads as incidental metadata; these are
mode indicators and must carry the same weight as the app's other one. The
read-only pill re-pins its hover colour to its resting colour, since it is pure
status and the Archived trigger's hover shift would imply it is clickable.

The Shared pill renders a real `<button>` (via the badge's `asChild`), not a
`role="button"` span: it is the header's only copy affordance, and a span takes
focus without answering Enter/Space. Copying goes through the shared
`copyThreadShareLink` helper, so it reports failure — the clipboard rejects in
insecure contexts and on denied permission.

A viewer's header also drops the vertical separator before the sidebar toggle;
with no thread actions to separate, it would divide the badge from a button it
was never meant to divide.

A viewer's header is otherwise stripped (`cli-thread-sharing.md`): no Mark as
read / Mark as done, no `...` menu on either desktop or mobile, no thread-tab
context menu, no add-to-group "+", and **no inline title editing** — the header
derives `isEditable` from `onTitleCommit`, which the workspace omits. The
list-row equivalent of this badge is the icon-only shared badge in
`cli-thread-list.md` — inert there, since the row's action menu already
carries Copy link.

## Title Rules

- New thread view title is `New thread`.
- Existing thread view title uses the thread title from backend data.
- If the thread has an associated task, render its task ref before the title in the detail header.
- Thread list rows also render the associated task ref before the title.
- If the stored thread title is empty after trimming, fallback to `New thread`.
- Long titles are truncated visually in the header row.
- Clicking associated task refs on thread surfaces opens task details inside the shared threads workspace pane.

## Inline Editing Rules (Detail View)

- Editing is available only on `/threads/[threadId]`.
- Clicking the title enters edit mode in-place.
- Keyboard activation is supported when the title has focus:
  - `Enter` starts edit mode
  - `Space` starts edit mode
- Edit mode must keep the same visual typography and spacing as read mode:
  - same font size, font weight, text color, and row spacing
  - no visible “input style” conversion (no borders/background chrome)
  - the title keeps its read-mode footprint so a trailing split `+` action
    stays anchored beside it instead of shifting toward the right-side actions
- Save behavior:
  - blur saves if the trimmed value is non-empty and changed
  - `Enter` saves immediately
  - `Escape` cancels and restores pre-edit value
- Validation and failure behavior:
  - empty/whitespace-only edits are discarded and reverted
  - unchanged edits are discarded (no mutation)
  - failed saves show an error toast and revert the title
- Save success is silent (no success toast).

## Layout Rules

- Header sits above conversation content and composer.
- Header uses the standard panel row height (`h-14`) and bottom border.
- Thread panel layout rows are:
  1. header (`auto`)
  2. thread detail body (`minmax(0,1fr)`)
- In the existing-thread detail body:
  - the main content column contains conversation and composer
  - an optional full-height right sidebar may render alongside the thread detail panel as a sibling pane

## Acceptance Checklist

- Opening `/threads` shows `New thread` in the panel header.
- Opening `/threads/[threadId]` shows that thread's title in the panel header.
- When a thread has an associated task, the detail header shows the task ref before the title.
- Existing-thread detail view can render a right-side header action without shifting the title/leading content behavior.
- Existing-thread detail view renders its thread actions before a vertical
  separator and the sidebar-open toggle while the sidebar is closed.
- Opening the sidebar moves the only collapse toggle to the far-right edge of
  its tab bar and removes the thread-header toggle.
- New-thread view renders **Tasks** as an icon-labelled underline tab and uses
  the same far-right sidebar collapse toggle instead of a close (`X`) action.
- Thread list rows show the associated task ref before the title in both compact and full layouts.
- Clicking a detail-header associated task ref stays on the current thread route and sets `task=<REF>`.
- Clicking a thread-list associated task ref navigates to that thread's detail route with `task=<REF>`.
- Detail view title can be edited inline with click/blur/Enter/Escape behaviors.
- Editing does not visually shift from heading style to input style.
- Entering title edit mode does not move the trailing split `+` action.
- Conversation scroll behavior and composer placement remain unchanged within the main content column.
