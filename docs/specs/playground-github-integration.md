# GitHub integration playground

OS-1852 design prototype at `/playground/github-integration`, linked from
`/playground`. It previews [the integration specification](github-integration.md)
before production implementation. All repositories, PRs, permissions, sync,
and imports are fixtures in memory; reload resets them. No GitHub calls or
Convex writes occur.

The isolated `prototype/` folder exports one component through `index.ts`.
External wiring consists of its route page and the playground index entry.
The existing ESLint import restriction also protects its public entry.
Use shared UI controls and the existing Pierre diff renderer.

The persistent project shell provides Pull requests and Integrations screens.
Integrations supports a repository-selection dialog with explicit member
sharing, admin-only management, disconnect confirmation, and reconnect.
The PR list defaults to open including drafts, with repository/author filters.
Closed history imports a fixture page when visited, with older/newer navigation.
Search spans all states by default and never adds to the stored-metadata set,
including when a result is opened. The prototype inspector exposes this count.
Returning from the reader preserves list filters, search, and pagination.

The reader offers Overview, Guide, and Diff tabs, changed files, split/unified diffs, wrapping,
whole-file content, rename/deletion/binary/oversized examples, and checks/review
summaries. A new-commit simulation leaves the current revision visible until
explicit refresh. Mock task links open the same reader. External GitHub links
are intercepted with a demo notice because these PR numbers are fictional.

An explicitly separate demo toolbar controls project role, the user's GitHub
access, transient sync failure, new commits, and reset. Disconnect immediately removes PR browsing;
reconnect cancels the simulated 30-day deletion. This demonstrates lifecycle
copy and navigation, not real persistence, time-based deletion, authentication,
or webhook behavior. Comments and write actions change only the in-memory fixtures.

Validate connection/disconnection, permission changes, history/search
persistence boundaries, filters, and revision refresh by clicking through the
prototype. Run lint and TypeScript; visually inspect with the existing app server when
available. Do not start a server in the primary checkout.

## PR list layout

Use the shared settings catalog list frame with compact two-line rows,
matching skills, prompts, and workflows. Show title/state above repository,
author, and update metadata, with a trailing label. No category navigation
column. Center the list and its controls in a `max-w-4xl` container. Use the
same full-width page chrome as task and thread pages: a separate `h-14` header
above the centered content, with a bottom border, `px-4`, a flexible truncated
`text-sm font-medium` title, and right-aligned actions. Do not put a large
settings-style heading inside the list container. Keep project navigation intact.
The entire PR row, including top and bottom padding, opens the reader. The
checkbox sits above the row button hit area and only changes selection.

## Sorting, people, and bulk-action preview

Following the supplied GitHub screenshots, the sort menu contains Created on
and Last updated, plus a separate Oldest/Newest order. Last updated/Newest
remains the default. Sorting uses fixture timestamps. The Open count is a badge.
Author and assignee filters use searchable popovers with avatar, login, and
full name, plus a You option that resolves to the demo user; repository filtering also uses a searchable picker. Repository,
author, assignee, and sort buttons match the search input at 32px tall. Selected
people use centered 16px avatars in filter buttons and in author, assignee, and
bulk Assign dropdowns. PR row avatars stay 24px.
Picker search fields use the shared 32px CommandInput, matching the compact
task-list search height. Keep one 4px search-wrapper inset, no additional
Command-container padding, and 4px list padding.

Users with GitHub triage access or higher can select PR rows independently of opening them, select the visible
page, and clear selection. Changing filters, sort, or page clears selection.
A selection toolbar offers Mark as Closed, Archived, Unarchived, and Assign.
Assign supports multiple people, mixed selection states, and Assign to nobody.
Others cannot select or apply actions. Closing removes open PRs from the Open
view; merged PRs cannot be closed. Archived uses GitHub's PR archive
(`archivePullRequest`, triage access): it closes open PRs, keeps merged PRs
merged, and locks the conversation. Archived rows show an Archived badge in
Closed & merged. Unarchived (`unarchivePullRequest`) removes the badge and
leaves the PR closed.
Actions change only in-memory fixtures and show a demo confirmation. Search
and reading still do not import metadata. Reset restores all fixture data.

These actions preview the deferred write phase, OS-2024. Production V1 remains
read-only. This iteration supersedes the earlier statement that write-action
interactions are excluded from the prototype; real authentication, persistence,
and GitHub writes remain excluded.

## Integration detail layout

Use a standalone GitHub icon/title and description, followed by the Connected
organizations heading with an add button and separate organization cards.
There is no integration-wide metadata strip or About action. PR browsing stays
in the project sidebar. Organization identity and sync status sit above compact
repository rows inside a rounded bordered block with between-row dividers.
The sync caption has no divider above it. Each organization overflow menu
contains repository management and disconnect. Preserve admin restrictions,
sharing consent, and reconnect behavior. No personal-account requirement or
code-review toggle is introduced by the visual reference.

## Catalog and organization connections

The project Integrations screen is a catalog of GitHub, GitLab, and Slack rows.
GitHub shows its connected organization count and opens a separate detail
screen with back navigation. GitLab and Slack open planned-integration details
marked Coming soon; they do not pretend to support connection yet. PR settings
links open GitHub details directly.

The Connected organizations header has an icon-only plus button labelled Add
organization. It opens a mock GitHub authorization chooser with contoso and
acme. Connected organizations cannot be added twice. Repository selection and
explicit project-sharing consent are required before saving. Adding an
organization preserves existing connections. Each organization's overflow menu
owns Manage repositories and Disconnect GitHub; management only edits that
organization's repositories and disconnect preserves the other organizations.
Viewer accounts can browse but cannot add, manage, or disconnect. Navigation
preserves connection state; reset restores fixtures. The sync caption reads
PR metadata last synced just now and remains a fixture, not a live guarantee.

Each organization has its own bordered card with spacing between cards. Do not
wrap all organizations in a shared bordered panel or add a PR shortcut card.

## GitHub accounts and permissions

Reading uses the organization's installation, so every project member sees
connected PRs. Anything that writes to GitHub runs as the user through their own
GitHub account (GitHub App user authorization), never as a Convoy bot. GitHub's
role for that user on the repository decides what works, not the Convoy role.
The Convoy role still decides who manages organizations and repositories.

The GitHub detail page shows a Your GitHub account row above Connected
organizations, for every member including viewers: "Connected as @login" with
Disconnect, or "Not connected" with Connect. The demo toolbar's GitHub access
control (not connected, read, triage, write) drives the same state. Connect,
from the row or the reader, sets write access. Reset restores write.

| Access | Allows |
|---|---|
| Not connected | Reading only |
| Read | Comments and Reviewed marks |
| Triage | Also close, reopen, unarchive, and the list's bulk actions |
| Write | Also merge, convert to draft, and ready for review |

Unavailable actions stay visible but disabled with the reason: "Connect GitHub
first" or "Needs triage/write access", next to menu items and as a tooltip on
buttons. The Merge status popover always opens; its footer shows Connect GitHub
when not connected, or "You need write access to merge." Reviewed checkboxes
are disabled when not connected because GitHub stores Viewed marks per user.
The You option in author and assignee filters appears only when connected, and
disconnecting clears a You filter.

Linked GitHub users show their Convoy name (Robin Hale) in the Overview's
author, commits, activity, reviewers, and comments. GitHub users without a
Convoy account keep their login (the fixture `sam-oss` comments on every PR).
A commit whose email isn't on GitHub shows its git name with initials; the
simulated new commit is by Jordan Lee. Pickers keep showing login and name.

## PR reader workspace

### Overview tab

Overview follows Linear's PR overview: everything comes from GitHub, and
comments post to GitHub as the user and sync back. The main column shows the
title followed by the muted PR number (`#482`) as on GitHub, author, `main ← head branch`, the description, the check cards, and Activity. A Commits card follows the description, folded like the check
cards: its header reads "Commits: 3" over the latest commit's message and
time, and a click on it ("Show 3 commits", then "Hide commits") lists every
commit with no timeline rail: the message, the author's avatar and login,
when it was committed, and the short sha. Every sha opens the commit on
GitHub. The simulated new commit appears in the card and the feed once the
reader refreshes, matching the displayed revision. Pull request checks, GitHub
checks, and Evidence follow the Commits card in that order (see the Merge status checks row
below). The cards sit together with no section headings. Each header's first
line names the card with its pass count ("Pull request checks: 2/3", "GitHub
checks: 4/4", "Evidence: 4/7"), the second is its summary ("Checked 8a3e7d1",
"4 successful checks", "OS-1852 task checks"), and the left icon shows the
card's state: a red cross when anything failed, an amber warning when anything
warned, a green check when everything passed, otherwise pending. #482's "No
major backend changes" is a warning ("adds an index on tasks"); it counts as
passed in `2/3` but stays visible when passed rows are folded. #479's Pull
request checks all pass except one warning, so its card reads "Pull request
checks: 3/3" with the amber icon.
Each card lists only failed, pending, and not performed rows; passed
rows hide until a click on the card header reveals them; a chevron at the
header's right shows the state ("Show N passed", then "Hide passed"), so #482's all-green GitHub checks
are just a header. On this page no row
opens by itself, even one with screenshots. #482 has three Pull request checks, reported at 8a3e7d1 as the
evidence prototype's checks card ("Checked 8a3e7d1"). One fails ("Safe to
merge without a second reviewer"). After a refresh to the new commit the line
reads "Outdated: checked 8a3e7d1" in amber.

A card with a failed row gets a Fix button left of its chevron: #482's Pull
request checks and Evidence, and #479's GitHub checks. Fix doesn't start
anything. It opens the Activity thread composer, fills it with "Fix what the
pull request checks found on #482:" (or "Fix the failing OS-1852 task checks:",
"Fix the failing GitHub checks on #479:") and one line per failed row with its
note, focuses it, and scrolls it into view, so the member can edit the prompt
before sending. Pending and not performed rows stay out of the prompt.

A conflicting PR gets a Conflicts card above the check cards: a red cross,
"Conflicts with main" (or "Conflicts with #482" for a stack layer) over
"Resolve them before this can merge.", then Fix and Resolve on GitHub. Its Fix
drafts "Rebase #475 on main, resolve the conflicts, and push." The Branch
property says the same, and the PR list's meta line adds a red "· Conflicts"
to open PRs.

Activity is the task sidebar's timeline ([task-timeline.md](task-timeline.md))
over the PR. It reuses `TimelineHeader`: "Activity" with the filter menu for
Comments, Threads, and Activity, and Newest first (the default) or Oldest
first. The
stream has the same rows. Consecutive events share one rail: "X opened this
with N commits", "Added to stack #12", each commit ("X committed message" and
its short sha), and approvals, each with its time. Comments are task
`CommentItem`s, and threads are compact thread rows. #482 and #479 show the
completed "Check #482" (or "Check #479") thread that reported their Pull request checks. The composer sits
at the newest end, so on top by default, and its swap matches the sidebar's: the
thread composer opens by default with an "Add comment..." trigger on the stream
side, and "Start a thread..." swaps back.
Both stay mounted, so drafts survive the swap. A sent thread joins the stream
as a running row. Sources and sort are local to the page.

Users can edit and delete their own comments. Without a connected GitHub
account only the thread composer is offered, its trigger reads "Connect GitHub
to comment..." and opens the connect flow, and nobody's comments are editable. Comments persist per PR across PR switches until demo
reset. GitHub's API can't upload comment attachments, so the attach button shows
a notice that Convoy would host the file and link it.

A right column (below the feed on narrow screens) lists Status, Task, Threads,
Reviewers with approved/requested state, and Branch status. Threads follows
the task sidebar's Threads field: compact thread rows (title, status, runtime,
time) with "+" beside the first, or "No threads" and "+". "+" switches Activity
to the thread composer, focuses it, and scrolls it into view. A row shows a
notice that it would open the thread in a new tab. More than five rows fold
to four and "Show N more threads". It lists the same threads as Activity's
Threads source, so #482's "Check #482" and any thread sent from the composer
appear in both. Changed files live only in
the Diff tab.

The Task property shows the linked task's type icon, ref, and name on one line
(the name truncates with an ellipsis), with no
status, using the task `TaskRefWithType` component. The linked task row and
No linked task placeholder both reserve 28px so the Stack section stays in
place when switching PRs. Clicking it would open
the task in the task sidebar; the prototype shows a notice. Convoy finds the
task from a task ref on the PR: a label holding the ref (agents can add one) or
the ref in the title, such as `(OS-1852)`. The backend resolves the ref to the
task's name and type. Only refs in the connected project's own prefix
count. The prototype resolves refs from fixtures.

The reader's title bar starts with the task's type icon and ref, styled like the
thread header's task link, followed by the PR status icon and title.

### Reader actions

The title bar ends with GitHub's state actions, which Convoy would run on GitHub
as the signed-in user:

- Open: Merge opens a Merge status popover, modelled on GitHub's Merge status
  panel. A More actions menu has Convert to draft and Close pull request.
- Draft: Ready for review, and Close pull request under More actions. Drafts
  can't merge, as on GitHub.
- Closed: Reopen.
- Merged: no actions.
- Archived (closed or merged): an Archived badge after the title and Unarchive,
  which leaves the PR closed. Reopen only appears once it's unarchived. The
  Overview replaces the composer with "This pull request is archived. Unarchive
  it to comment." and no comment can be edited or deleted.

Merge status lives in the header popover so it is reachable from Overview,
Guide, and Diff; the Overview right column keeps its Reviewers and
Branch summary from the same fixtures. The popover lists these rows, then the
merge button:

- Reviews: "Changes approved" with the approvers, or "Review requested" with
  the pending count and reviewers. Reviews aren't required here, so a pending
  review shows a waiting icon, not a failure.
- Checks: GitHub's rollup title and count ("Some checks were not
  successful", "1 failing and 3 successful checks"), then one row per check
  with its state icon, name, summary, and Details. #479's
  `Vercel – convoy-docs` deploy fails and drafts are still building
  `Vercel – convoy-web`. The popover lists every check. The Overview
  shows the same box, collapsed to what needs attention, followed by Evidence: the referenced Task's Checks
  as the evidence prototype's checks card, summarized as "OS-1852 task
  checks" (the ref opens the Task), with time and "Reported in" on each row.
  Only #482 references a Task, so only it has Evidence. Failing checks don't
  block merging, since required checks aren't modelled.
- Behind: "This branch is out-of-date with the base branch" with Update branch
  (`update-branch`, write access). It doesn't block merging, since branch
  protection isn't modelled. Updating clears the row and the Overview's Branch
  property changes from Behind main to Up to date with main.
- Conflicts: "No conflicts with base branch", or "This branch has conflicts
  that must be resolved" with Resolve on GitHub. Conflicts disable merging, and
  the header button reads Merge blocked.
- Checking: GitHub reports `mergeable` as `UNKNOWN` until it has checked a new
  head, so after Simulate new commit or Update branch the Conflicts row reads
  "Checking mergeability…" for two seconds and merging is disabled.

The merge split button's menu picks Create a merge commit, Squash and merge
(the default), or Rebase and merge, each with a line describing the result and
the PR's commit count. Clicking the merge button closes the popover and opens a
confirm popup (a modal dialog) titled with the method and number, such as
"Squash and merge #482", with the branch below. The popup holds only what the
confirmation needs:

- Warnings that don't block the merge: "1 review is still pending.", "1 check
  failed.", "Checks are still running.", "This branch is out-of-date with main."
- An editable commit message under a visible Commit message label. Squash
  defaults to `Title (#482)`, merge commits to `Merge pull request #482 from
  branch`. Rebase has no message and shows its description instead.
- Cancel and Confirm (Confirm squash and merge, and so on). Confirm calls the
  async merge API, which answers 202, so it reads Merging… and Cancel and the
  close button hide until the PR shows as merged 1.5 seconds later.

Blocking problems (conflicts, a mergeability check in progress, missing
access) stay in the popover and disable the merge button, so the popup never
opens for them.

Fixtures: #482 is ready, #479 has a pending review and is behind main, and
#475 conflicts with main. In stack #12, #483 conflicts with #482 below it, so
#484's Merge status shows "#483 has conflicts" and Merge blocked.

#### Stacked PRs

GitHub's stacked PRs (GA on 2026-10-06) chain branches, so each PR's base is
the branch of the PR below it. REST PR objects carry `stack { id, number,
size, position, base }`. Convoy only reads stacks; agents create and edit them
with `gh stack`.

- Overview shows the stack directly below Task and above Reviewers, without
  opening a popover. Follow the Linear reference: connected status dots, descending
  layer numbers, PR titles, a selected background on the current layer, and a hollow
  main node at the bottom. Each row stays on one line and long titles truncate
  with an ellipsis; hover reveals the full title. There is no Current badge.
  Clicking a layer opens its Overview and moves the selected background. Hide this section for non-stack PRs.
  State colors follow open, draft, merged, and closed, with accessible state labels.
- The stack map, as in GitHub's merge box, lists every layer with its state,
  the top layer first and main at the bottom. Clicking a layer opens that PR.
- The PR list and the reader sidebar show a "Stack 2/3" badge on each layer.
  Clicking it opens the stack map.
- The reader header has a Stack button after the title that opens the stack
  map, and the Merge status popover shows the map under its title.
- Shift+K opens the layer above and Shift+J the layer below, like GitHub's
  stack shortcuts. GitHub's docs don't say which key goes which way; this
  follows j/k list order on a map drawn top first.
- The base is the branch of the nearest open layer below, or main once every
  layer below has merged. The Overview header shows it, the Branch property
  adds "Based on #482", which opens that PR, and Activity has "Added to stack
  #12".
- GitHub merges a stack bottom up, and merging a mid-stack PR merges every open
  layer below it too. The Merge status popover adds a Stack row naming those
  layers, and the merge button reads "Squash and merge 2 pull requests". A
  draft or conflicting layer below blocks the merge.
- The confirm popup lists the PRs being merged in place of the commit message,
  so each keeps its default message. Whether `merge-async` takes a message per
  layer is unknown.
- After the merge, the layers above stay in the stack and their base moves
  down, to main when nothing open is left below.

Fixtures: stack #12 in contoso/convoy is #482 (1/3), #483 (2/3), and #484
(3/3, a draft).

Actions change the in-memory fixture, so the header icon, Status property, and
sidebar group update together. The user's GitHub access decides which ones
work (see GitHub accounts and permissions). Branch protection, required reviews, failing checks, review
submission, branch deletion, and revert are not modelled.

### Guide tab

Guide follows Linear's guided review: the diff split into numbered steps
("01 / 03"). Each step has a title, a short explanation, and its files on the
left, and those files' diffs on the right. Every changed file belongs to exactly
one step. GitHub has no guide; Convoy would write it from the diff and PR
description and keep it per head commit. The prototype uses fixture steps.

A guide exists only once a member asks for one. With no guide, an empty state
explains it and offers Generate guide. Generate guide (and New guide) opens a
"Generate a guide" popup: CLI profile, working path, Run in a new worktree (on
by default), and model. In V1 the agent checks out the PR with `gh` in a CLI
thread on that machine. The popup remembers the last choices for guides only,
so the member's CLI thread defaults never change.

While the agent runs, the tab shows a spinner, "Writing the guide", "Requested
by Maya Singh" when someone else asked, and Open thread. When the thread
finishes, the steps appear. Every member can read every guide, and anyone can
request another one. The newest guide shows first. A menu in the corner of the
reader tab row (not tabs) names the guide on screen: requester (You for your
own), model, and age, prefixed with Older when it isn't the newest. Opening it
shows who requested it, the model, and "Written for 8a3e7d1", then See older
guides (n), which lists the rest to switch to, and New guide. Guides are per PR
and survive PR and tab switches until demo reset.

A guide written for an older revision than the PR's head (after Simulate new
commit, or Alex's on #479) gets an amber banner under the tab row, amber
because nothing is broken: "This guide was written for 8a3e7d1. The commits
since then aren't covered." with Update guide (primary) and New guide. If a
newer guide already covers the head, the banner reads "A newer guide covers
c91f02a." with Open it. Update guide opens the same popup titled "Update the
guide" and writes a follow-up of the newest guide: a bar names the base ("Follow-up
of your guide for 8a3e7d1 · 1 updated, 2 unchanged") with an Only what changed
switch that hides Unchanged steps. Each step carries an Updated or Unchanged
badge, and an Updated step adds "What changed since 8a3e7d1: …". The corner
menu adds "Follow-up of …'s guide".

Steps follow t3code's guide shape: an optional attention flag (Contract,
Tradeoff, Product, Risk, Accessibility) with one note, a one-line note per
file, and up to two "why" questions. The prototype still shows whole file diffs
where the production Guide would show excerpts. #479 starts with two guides
by Maya and Alex, Alex's for an older revision. The prototype fakes the thread
with a 3 second timer.

Guide diffs use the same file section and Reviewed checkbox as Diff, so marks
are shared between the tabs. Reviewed files are collapsed and show a check in
the step's file list. Clicking a file in the list expands its diff and scrolls
to it. Guide always renders unified, wrapped diffs with no whole-file tabs.

On wide screens a full-height divider splits the explanations from the diffs.
Dragging it (or arrow keys on it) resizes the left column, using the thread
sidebar's `useResizePanel` and `SidebarResizeHandle`; the width persists in
local storage. Each step's left column stays in view while its diffs scroll.
Diffs run edge to edge from the divider to the panel's right edge, and a step's
files stack directly like Diff's sections; steps are separated by space. Each
step after the first starts with a rule across both columns, level with its
files' top border; the first step sits directly under the tab bar's border.
Every second step row has a light muted tint across both columns, including
the sticky file headers, which stay opaque in the row's color. On
narrow screens the columns stack and the divider is hidden.

Opening a PR keeps a compact PR browser on the left and the selected PR on the
right. The sidebar is a compact view of the PR list: both share one filter
state (tab, search, filters, sort, page), so opening a PR shows the list you came
from and changes in the sidebar carry back. The sidebar tabs are the list's
Open/Closed & merged tabs; searching deselects them and spans all states, as on
the list. Closed history and search results page with Load more, which imports
each newly visited closed page like Older does on the list. Group visible rows by Open,
Drafts, and Closed & merged. Selected rows are highlighted. Filtering does not
close the current PR, including when no rows match. Switching PRs preserves
sidebar filters and resets the reader to Overview and its initial file/revision.

The right panel has a compact h-14 title bar and uses the shared Tabs,
TabsList, TabsTrigger, and TabsContent components for Overview, Guide, and
Diff.
Overview is selected initially. Diff retains file selection,
whole-file mode, unified/split rendering, wrapping, special file states, and
explicit revision refresh. Each file header has a Reviewed checkbox after its
+/- counts, mirroring GitHub's per-user "Viewed" state (GraphQL
`markFileAsViewed`). Checking a file collapses it and unchecking expands it; the
toolbar shows "N / M reviewed". Marks persist per PR across tab and PR switches
until demo reset. Refreshing to a new revision clears the mark on files whose
content changed, as GitHub does. Both reader tab bars use the shared underline variant, matching Active/Archived
in task search. Diff uses the worktree view's shared PatchFileSection,
ChangesViewToggles, FileTabStrip, WorktreeFileTree, and resizable split pane.
Render all files as stacked collapsible sections, with counts and compact
collapse-all, split/unified, and wrap toggles. The right Files tree scrolls to
and expands a selected section. Closing the tree exposes a Show files button.
Whole files open in closable tabs; deleted files show their prior contents.
Binary and oversized files retain GitHub fallbacks: each shows a centered empty
state in the file block ("Binary file" or "This file is too large to display")
with an outline View on GitHub button, and the header has no GitHub icon. The
shared PatchFileSection takes an optional `binaryBody` for this; other callers
keep its default binary note. No revert operations are
connected. On mobile, sections remain available without the right tree. On narrow screens the PR browser stacks above the reader.
The sidebar back button returns to the original list with its filters intact.
No background imports, GitHub calls, or real guide generation are introduced by
this layout; write actions change fixtures only.

## Reader sidebar controls

Place the sidebar title and icon-only back button in its 56px top header.
Both panes have a fixed 41px tab row directly below their headers; incoming
revision notices appear below the reader tabs so the rows stay aligned.
A right-aligned filter icon opens a shared Popover with search at the top, followed by the main page's
repository, author, assignee, and sort pickers; State appears only while
searching, as on the list. Filters persist across PR selection and never close
the selected PR. Highlight the icon while filters, search, or sorting differ from
defaults; Reset filters keeps the tab, clears search, and restores all
repositories/people/states and last-updated/newest.
Use aligned label/value rows: Sort by and Order, a divider, then Repository,
Author, Assignee, and State (while searching). Labels sit left and controls sit right at their
natural width, styled as the badge select trigger used in settings rows.
Controls show the selected value, including All values; long repository names
truncate. Search and reset have separate divided
areas. No wrapping button cluster, display properties, or additional filters.
Reuse ThreadCollapsibleSection for Open, Drafts, and Closed & merged: compact
32px muted labels, hover chevrons, no count badges, and independent persisted
collapse preferences scoped to this playground. Empty groups remain hidden.
