# GitHub integration and PR browsing

Planning specification for OS-1852 under OS-1371. Product decisions below
are accepted from the planning interviews; the second one (2026-10-24 to
2026-10-26) widened the scope from read-only browsing to the full feature set
designed in the [playground prototype](playground-github-integration.md).
Slices 1 (OS-2178), 2 (OS-2179), 3 (OS-2180), and 4 (OS-2181) are implemented; see
[As built](#as-built). The other technical defaults are still proposals.

## Scope

Provide a project Integrations settings page and a Pull requests page in
the main left navigation. GitHub.com is the first provider, with the same
features on hosted and self-hosted Convoy. Keep the integration code in an
isolated domain so another provider can be added without spreading its
rules through tasks, threads, or project settings.

The plan covers reading (PR metadata, live search, details, diffs, whole
changed-file contents, the Overview, merge status, and stacks), Guides, and
writing to GitHub as each member's own account (comments, reviews, state
changes, merge, and editing). It ships in the priority order under
[Delivery as vertical slices](#delivery-as-vertical-slices).

Outside this plan: GitHub Enterprise Server (OS-2025), comment attachments
through Convoy-hosted links (OS-2172), GitHub events in Watch Tower
(OS-2173), and asking about a Guide step, which waits for shared remote
environments. Future CLI-driven priority and review layers still motivate
persistent PR records; do not add their schemas or execution flows.

## Project Integrations page

Build the Integrations settings content as a dedicated feature subtree,
mounted at the project settings Integrations section. Expose its route
independently of unrelated mock settings. The playground prototype at
`/playground/github-integration` is the design reference and stays as is.
PR browsing remains a separate main-navigation page.

The proposed page provides:

- GitHub connection status and Connect for project admins.
- Installation/account identity and repository selection.
- Initial import progress, last successful sync, and actionable errors.
- Repository removal, Disconnect, and Reconnect, with the 30-day retention
  policy explained before disconnecting. Removal never needs GitHub access.
- A configuration-unavailable state when deployment credentials are absent.

Use existing settings layout, empty-state, and skeleton components. Never
ask project members to enter an App private key in this page. Deployment
operators supply backend configuration separately.

## Authorization and connection ownership

Connecting requires Convoy project-admin permission and GitHub repository
admin permission for every selected repository. There is no additional
Convoy organization-admin approval gate. Verify both identities and bind
the setup flow to the signed-in user and intended project. Possession of an
installation ID is not proof of authority.

Connected content is readable by all project members, including viewers,
without individual GitHub authorization. Writes are different; see
[GitHub accounts and permissions](#github-accounts-and-permissions). Repository selection must make
this sharing behavior clear. Project membership remains mandatory; an
organization role alone does not grant project-content access.

The connection belongs to the project, independently of the installer.
It survives that person's departure or loss of personal GitHub access while
the App retains repository access. Remove the person's access and personal
credentials without stopping installation-based synchronization. Other
admins can connect or extend access after the same authorization checks.
Project admins can disconnect their project's connection.

A repository may connect to several projects. Each project must have its
own authorized association. A stored PR or an installation ID alone never
authorizes another project to read its data.

## Persistence boundaries

| Entry point | GitHub access | PR metadata write |
| --- | --- | --- |
| Open PR list | Initial import and backend sync | Yes |
| Closed/merged history page | Fetch requested page when needed | Yes, deduplicated |
| Search and search pagination | Live backend search | No |
| Open a search result or existing PR link | Live detail/changes as needed | No write caused by browsing |
| Request a Guide | Agent reads with `gh` on the member's machine | Yes, the PR and its Guide |
| Future processing action | Outside this plan | Defined with that feature |

Store PR identity, title/description, author, state/draft flag, labels,
branches and commit identities, timestamps, and sync status. Render the
ordinary PR list from stored metadata. Detailed CI/review data, diffs,
and whole changed-file contents load on demand. Do not synchronize CI or
review summaries for list badges.

Searching or opening a result must not create or update PR metadata. The
reader accepts repository/PR identity without requiring a stored row.
Independently running synchronization may update an already tracked PR;
that is not a side effect of browsing. Requesting a Guide is an explicit
action, so it stores the PR's metadata if it isn't stored yet. Task
references come from the PR's own fields; see
[Pull requests and Tasks](#pull-requests-and-tasks).

See [the storage decision](../adr/0010-store-pr-metadata-fetch-changes-on-demand.md).

## Lists, history, and search

The default list shows open PRs including drafts, newest updated first.
Provide repository, state, and author filters. Search queries GitHub across
all states unless the user explicitly filters it.

Import open/draft PRs in resumable background work when a repository is
connected. Render available records during import and show progress. Keep
tracked PRs when they close or merge.

Opening the closed/merged view loads its newest page and stores that page's
metadata. Navigating older pages loads and stores them on demand. There is
no separate Load older PRs confirmation or full historical backfill.
Subsequent readers reuse imported metadata within its authorized scope.
Concurrent page requests must not create duplicate records.

Page coverage is distinct from PR existence. Having some closed PRs does
not prove a requested page is complete. GitHub pagination can move as PRs
change, so page numbers are not permanent historical snapshots.

Live search must be scoped by the backend to the project's connected
repositories. Do not let user query syntax expand that scope. Check every
returned repository before returning results. Search results are temporary;
they neither import history nor mark history pages complete.

Show GitHub's capped or incomplete search results and invite narrowing by
repository or date. A zero-result search is not proof that a known PR does
not exist. Known task links use direct repository/PR lookup.

## PR reader and existing links

Existing task and thread PR links open Convoy's reader for connected,
authorized GitHub repositories. Keep Open on GitHub available. Unconnected
repositories and other providers retain external navigation.

Use GitHub's file metadata to render the file list, including renames,
binary files, deletions, and changes without text patches. The current
thread patch parser assumes local no-renames diffs and cannot supply this
list reliably. Reuse data-independent split/unified rendering, wrapping,
themes, and collapsed-file behavior. Keep CLI checkpoint fetching and
thread revert/review actions with the thread feature.

Keep the displayed revision stable while reading. On detecting new commits,
show New changes available and let the user refresh. Verify revision context
around live fetches; retry or show a refresh state if it changes. Never label
new code with old stored commit identities. A browser-held revision is not
a promise that arbitrary old GitHub PR patches can be fetched later.

Label oversized, truncated, binary, or unavailable content accurately and
provide a GitHub link. Do not render a missing patch as an empty change.

The reader has Overview, Guide, and Diff tabs, laid out as in the
playground prototype. Overview shows the description, the check cards, a folded Commits card, Activity, and properties: Status, referenced Tasks, Stack, Reviewers, Assignees, Labels, Milestone, and Branch. Changed
files live only in the Diff tab. The header's
Merge status popover shows reviews, checks, behind-base, mergeability
(including GitHub's `UNKNOWN` while it recomputes), and conflicts with a
Resolve on GitHub link, since resolving conflicts has no API. A conflicting
PR also gets a Conflicts card above the check cards, with Fix (a drafted
"rebase and resolve" thread) and Resolve on GitHub, and the PR list marks it.

GitHub checks are the head commit's check runs and commit statuses in one
list, as GitHub shows them: each with its state, name, summary, and a
Details link to its own page, under GitHub's rollup ("1 failing and 3
successful checks"). The Overview's GitHub checks card leaves out Convoy's own
check runs (its App's, from Pull request checks), since the Pull request
checks card already shows them. The Merge status button and popover keep
them, as GitHub's merge box does, so a failed Pull request check there reads
the same as on github.com (`fromConvoy` on each check). The Overview shows them in the main column under
the description, and the Merge status popover shows them too. A failing or pending
check warns in the merge confirmation but does not disable Merge; required
checks block only through the merge state GitHub reports.

A check card with a failed row offers Fix. It drafts a thread in the
Activity composer listing the failed rows and their notes, and the member
sends it. Activity is the task sidebar's timeline
([task-timeline.md](task-timeline.md)) over GitHub's conversation: the same
filter and sort header, commits, reviews, and comments as rows, the threads
attached to the PR, and the comment or thread composer at the newest end.

An Evidence section follows: each referenced Task's Checks
([task-checks.md](task-checks.md)) as the transcript's checks card. Its
summary line reads "OS-1852 task checks" with the ref linking to the Task,
and each row adds the reporting thread and time. The two stay separate. GitHub
checks describe the head commit and can block a merge. Task Checks
describe agent runs, can be "not performed", and never block anything, so
one pass count across both would mislead. Evidence is visible to whoever
can see the Task.

On the Overview every check card shows only what needs attention: failed,
pending, and not performed rows. Passed rows wait until a click on the card
header reveals them, with a chevron showing the state, so
a card whose checks all passed is just its header, and no row opens by
itself, even one with screenshots. An Archived
pull request shows an Archived badge.

Each changed file has a Reviewed checkbox. A **Reviewed mark** lives in the
member's browser local storage, keyed by PR, file, and the file's contents at
that revision, so a new revision that changes the file clears it. It is not
GitHub's Viewed flag and needs no Linked GitHub account. Guide and Diff share
the marks.

### Stacks

Read GitHub's REST `stack { id, number, size, position, base }` on PR
objects. The list and the reader sidebar show a "Stack 2/3" badge that opens
the stack map: every Layer with its state, top first, main at the bottom, as
in GitHub's merge box. The reader header's Stack button and the Merge status
popover show the same map. Shift+K and Shift+J open the Layer above and
below. A Layer's base is the nearest open Layer below, or the base branch
once the Layers below have merged. Convoy never creates or edits Stacks;
agents use `gh stack`.

The implementation must update
[CLI thread PR badges](cli-thread-pr-badge.md) and
[task external links](task-external-links.md) for the new navigation.
Task links remain pointers. CLI snapshots remain valid fallback display
metadata and do not authorize integration access.

## Pull requests and Tasks

A Pull request references a Task when its title, branch name, or labels
contain the Task's ref, matched case-insensitively. The description does not
count. Any project in the organization may match, and each referenced Task
shows only to members who can open it. The reader fetches each matched Task
live, so nothing is stored or indexed for the match. Task external links stay
as they are; they are not queried for this.

## Pull requests in threads

A member can attach a Pull request to a CLI thread the way they attach a
Task ([CLI thread task attachments](cli-thread-task-attachments.md)):

- Each user message carries at most one **Attached pull request**, shown as
  a pill, next to at most one Task. The CLI adds
  `pr(github): contoso/convoy#482 <url>` before the message body; the agent
  reads the PR with `gh`.
- The thread's Attached pull request is the first one sent or attached and
  is never replaced. `attach_pull_request_to_thread` (MCP) and
  `threads attach-pr` (CLI) set it without sending a message, mirroring
  `attachTask`. Store it indexed so the PR page can find its threads.
- The composer's "+" menu adds Attach pull request: a picker over open PRs
  in the project's connected repositories, like the task selector. Pasting a
  GitHub PR URL (or `owner/repo#number`) from any repository into the
  picker's search also works; outside connected repositories it stays a
  plain link pill without metadata. The composer pill is not saved in
  drafts, like the task pill. Editing the last message keeps, swaps, or
  removes its PR; the thread's Attached pull request stays as it was.
- The PR list's row action adds Start thread, which opens
  `/threads?attachedPr=contoso/convoy%23482` with the pill in place. Inside
  the reader, Activity's composer starts threads, and the header's button is
  Refresh, which pulls the latest from GitHub.
- The thread sidebar adds an Attached pull request tab with the PR reader
  (Overview, Guide, Diff), so the member reads the PR beside the agent.
- The Overview gets a Threads property, as on the task sidebar: the viewer's
  own threads, and threads shared with them, whose Attached pull request is
  this PR, with "+" opening the thread composer. Activity shows the same
  threads as rows under its Threads source. Its composer's thread side starts a thread with the
  PR attached, and each card's Fix drafts one there (failed checks, Evidence,
  conflicts).

The Attached pull request is separate from the **Branch pull request**, the
CLI-detected snapshot behind today's [thread PR badge](cli-thread-pr-badge.md).
A review thread has only the first. An agent's fix branch may have both,
even for the same PR: the badge reports what the branch opened, and the
sidebar tab is the PR the member attached, so both stay. The attached PR's
live state shows on its pill (the tab shows its number) and never changes the
thread: merging does not mark it Done. Making that configurable, and waking the agent on PR events, belongs
with OS-2173. A sidebar PRs tab with drag and drop onto the composer is not
planned until it shows a need the "+" picker doesn't cover.

## GitHub accounts and permissions

Every change Convoy makes on GitHub runs as the acting member's own Linked
GitHub account, through a GitHub App user-to-server token, never a bot
([ADR 0012](../adr/0012-pr-writes-act-as-the-users-own-github-account.md)).
A Linked GitHub account belongs to one member in one Convoy organization;
the same person may link different GitHub accounts in different
organizations.

The GitHub integration page shows a Your GitHub account row to every member,
viewers included: Connected as @login with Disconnect, or Not connected with
Connect. An expired or revoked authorization shows Reconnect GitHub.
Disconnecting it never affects the project's installation.

GitHub's role for that account on the repository decides every PR action,
exactly as on github.com; the Convoy role adds nothing and takes nothing
away. The Convoy role still decides integration management (organizations,
repositories, disconnect) and the Guide prompt.

| GitHub access | Allows |
| --- | --- |
| No Linked GitHub account | Reading only |
| Read | Comments, reviews, and the You filters |
| Triage | Also close, reopen, archive, unarchive, assign, and the list's bulk actions |
| Write | Also merge, update branch, draft, ready for review, and editing |

Unavailable actions stay visible but disabled with the reason ("Connect
GitHub first", "Needs triage access"). Bulk actions run as the member, one
PR at a time, and report per-PR failures.

## Writing to GitHub

Delivered in the slice order below:

- Conversation comments, edited and deleted as their author.
- Close, reopen, convert to draft, ready for review (GraphQL only), assign,
  and archive (GraphQL `archivePullRequest` / `unarchivePullRequest`).
  Archiving closes and locks the PR; unarchiving leaves it closed; an
  Archived pull request offers only Unarchive.
- Merge with the repository's allowed methods through `merge-async`. The
  Merge status popover keeps blocking problems; the merge button opens a
  confirm popup holding non-blocking warnings, the commit message (except
  rebase), and Confirm, which reads Merging… until GitHub reports the merge.
  Update branch uses the `update-branch` endpoint. Merging a mid-stack Layer
  merges every open Layer below it; the button reads "Squash and merge 2 pull
  requests", a draft or conflicting Layer below blocks it, and the popup lists
  the PRs in place of a commit message. Deleting the branch after merge is an
  option in the popup.
- Reviews: inline comments on diff lines, approve, request changes, comment,
  and requesting reviewers.
- Editing title, description, and labels.
- Auto-merge, merge queue, and revert (`revertPullRequest`).
- Creating a PR from Convoy.

## Guides

A Guide is an agent-written walkthrough of one PR revision, split into Guide
steps. Every member can read every Guide; members with the CLI thread
permission can request one, so viewers cannot today. Closed and merged PRs
can have Guides.

Status: requesting, reading, switching between, and deleting Guides are
built (OS-2412). Failed guides and Retry (OS-2413), Don't ask again
(OS-2414), the duplicate-run warning (OS-2415), the project's Guide prompt
(OS-2416), Outdated guides and Follow-up guides (OS-2417), and the MCP tools
(OS-2418) are planned.

### Requesting and running

Generate guide works like Run checks: it opens the PR page's thread composer
in a popup (profile, path, worktree, runtime, model, effort, attachments)
with the PR pill locked and the text prefilled with the guide prompt, which
the member may edit before sending. The composer's send button starts the
run. Generate guide is hidden without the CLI thread permission, and
disabled with the reason when no CLI profile is online or Convoy has not
synced the PR. It sits on the Guide tab's No guide yet state, and as New
guide in the corner menu.

- The popup's choices are a draft of their own per member and project
  (draft key `pull-request-guide:<userId>`). Each open replaces the draft's
  text with a fresh prompt, since the prompt names the current head. The
  model picked stays in that draft and never becomes the member's new-thread
  default.
- The run is a normal CLI thread with the PR as its Attached pull request,
  private to the requester unless they share it, so only the requester sees
  Open thread. `cli.threads.core.create` takes `pullRequestGuide: { headSha }`,
  which must still be the stored PR's head ("The pull request has new
  commits. Generate the guide again."), in a connected repository ("Guides
  need a pull request in a connected repository"). The same transaction
  inserts the Guide (`integrationPullRequestGuides`, status writing, the
  stored PR's base and head) and marks the thread
  (`cliThreads.pullRequestGuide.headSha`).
- The agent checks out the PR with `gh`; that needs `gh` signed in with
  access to the repository and a Working path that is a clone of it. The
  prompt has the agent check the remote first and stop with the reason.
  Reading PR data through Convoy-proxied tools instead of `gh` is a later
  version, as is running Guides automatically in a shared remote environment
  when a PR lands.

The agent hands the Guide back with `convoy threads submit-guide <threadId>
<file|->`, a JSON file of `{ headSha, steps }` (an MCP tool
`submit_pull_request_guide` follows in OS-2418). The action
`integrations.github.guides.submit` checks the caller owns the thread and
its Guide is still writing, reads the revision's changed files from GitHub,
and returns every error at once so the agent can fix and resubmit:

- `headSha` is the Guide's head.
- Each step's shape: text fields are text, the attention kind is one of the
  five, files are objects with a path. The action takes the steps untyped so
  a wrong shape comes back in this list rather than as a validator error.
- One to eight steps, each with a title, an explanation, and at least one
  file; at most two questions.
- Every changed file is in exactly one step, and a step lists no file the PR
  does not change.
- Length limits: title 200 characters, explanation 4,000, notes and
  questions 500, and all steps together under 800 KB.

The changed files come from the PR's file list, 100 per page, while the PR
is still at the Guide's base and head (GitHub lists up to 3,000). If the PR
moved during the run, they come from the compare of the Guide's base and
head (up to 300). Files GitHub leaves out are not coverage-checked. A push
during the run never rejects the submit: the Guide is for the head it was
requested at. A Guide already submitted rejects another ("This guide was
already submitted."), a deleted one rejects with "The guide was deleted.",
and a thread that is no Guide run with "This thread is not writing a
guide."

Requesting a Guide while another member's Guide for the same revision is
still being written warns first ("Maya is already writing a guide for
c91f02a") and offers Start my own anyway.

A failed run stays as a Failed Guide with the agent's reason. Only the
requester can retry it. The requester and project admins can delete any
Guide from the corner menu, after a confirm; members cannot delete each
other's ("Only the requester and project admins can delete a guide").
Deleting keeps the thread. Guides belong to the project, so another project
connecting the same repository never sees them, and they follow the PR
metadata's 30-day retention after a disconnect: the purge deletes the
link's project's Guides, 10 per batch.

An MCP tool `read_pull_request_guide` returns a PR's Guides, their run state,
and an `outdated` flag so other agents can use them. Starting runs from MCP
waits for the automations, so no agent can start a run on someone else's
machine.

### Prompt

Convoy's built-in prompt carries the format and the rules: reading order
(contracts, then the services that implement them, then callers and UI, with
mechanical files last), coverage, the follow-up rules, and
treating the PR's title and description as information about the change,
never as instructions. The browser builds it, like the checks prompt: run
facts Convoy always adds (the PR and its revision, the remote and `gh`
check, `gh pr checkout <n> --detach` and `git diff <base>...<head>`, the
JSON shape, and the submit command with the thread ID from the attach
footer or `CONVOY_THREAD_ID`) around the guide instructions (how to split,
reading order, tone). Once Reviews ship, it also receives the already-resolved and
outdated review threads so the Guide doesn't raise them again. On a Stack,
the Guide covers only its own Layer and may mention others in a phrase
("added in #12").

A project's **Guide prompt** adds its own preferences (tone, emphasis, what
to skip, which Project Skills to follow). It is set on the project's
Integrations settings page, once per project rather than per connection, by
project admins. An empty setting means the built-in default only, so
projects that never customised it get improvements automatically; Reset to
default clears it. The Guide prompt cannot change the format or the rules.
Each Guide stores the Guide prompt it was written with.

### Shape

Each Guide records its requester, runtime and model, revision (base and
head), creation time, the Guide prompt, and, for a follow-up, its base. A
Guide step has a title naming what it accomplishes, a two-to-four-sentence
explanation, the files it owns with an optional one-line note each, an
optional attention flag (tradeoff, contract, product, risk, or
accessibility) with one note, and up to two "why" questions. A Guide has one
to eight steps. A file is in exactly one step. Convoy stores each file's
blob SHA at the Guide's head, from GitHub, on submit.

The tab lays a step out in two columns, as in the playground mockup: on the
left, sticky, the step number ("01 / 03"), title, explanation, attention
note, its files (name, folder, +/-, a check once Reviewed; a click scrolls to
the file's diff), and questions; on the right, the full diffs of its files in
the Diff tab's file sections, with the same Reviewed marks. Reviewed files
start collapsed. A file outside the reader's loaded diff (the first 100
files) shows a line with Open on GitHub. The column split is resizable. There
are no code excerpts and no line-anchored notes.

### Reading and switching

The Guide tab opens on the newest Guide. Its list
(`integrations.github.guides.listForPullRequest`) is live while the tab is
open: the newest 20 Guides without their steps, each with the requester's
name and avatar, `threadId` only for the requester, and whether the viewer
may delete it. A ready Guide never changes, so its steps are read once
(`integrations.github.guides.get`) and kept for the session. A menu in the corner of the tab row
(not tabs) names the Guide on screen the way its row does: runtime icon,
model, commit ("8a3e7d1"), the requester's avatar (hover names them), and
short age ("30m"). Opening it lists the Guides one line each, newest first,
with the one on screen highlighted; picking a row shows that Guide. Hovering a row
the viewer may delete swaps its age for Delete, which asks to confirm. New
guide sits under the list and returns the tab to the newest Guide. A
Follow-up guide's row says so. A Guide still being written shows
"Writing the guide", "Requested by Maya Singh" when someone else asked, and
Open thread for the requester.

An Outdated guide on an open PR gets an amber banner under the tab row:
"This guide was written for 8a3e7d1. The commits since then aren't covered."
with Update guide (primary) and New guide. When a newer Guide already covers
the head, it reads "A newer guide covers c91f02a." with Open it. Closed and
merged PRs show no banner.

### Follow-up guides

Update guide writes a Follow-up guide based on the newest Guide on the PR,
whoever requested it. The agent receives the base Guide's steps and diffs
for the whole PR and for base revision to head; after a force-push it
compares the two trees. Each step is Unchanged, Updated, New, or Removed:

- Unchanged steps match the base word for word and own no file changed since
  the base. Convoy enforces this on submit.
- Updated steps add "What changed since 8a3e7d1: …".
- New files go to a New step or join an existing step marked Updated.
- A step left without files is Removed.

A bar names the base ("Follow-up of your guide for 8a3e7d1 · 1 updated,
2 unchanged") with an Only what changed switch that hides Unchanged steps.
Reviewed marks say what a member already read: Unchanged steps whose files
are all still Reviewed start collapsed. There is no separate read state. The
follow-up instructions are built in; the Guide prompt cannot change them.

## Pull request checks

A project can ask an agent extra questions about every pull request: "Are
there major backend changes?", "Is this safe to merge without a second
reviewer?". These are Checks ([task-checks.md](task-checks.md)) the project
writes itself, label and instruction, and the agent answers each with
passed, warning, failed, or not performed, a justification, and Evidence. Convoy adds
no verdict, size label, or rollup of its own beyond the pass count.

Status: built. The run, results, card, and list icons (OS-2400), and
publishing to GitHub (OS-2401), and the project setting to keep results in
Convoy (OS-2406).

- They come from the project's check catalog. The Checks settings
  "Defaults" popup has a Pull requests row after the task types; at most one
  Checklist per project has it (`checklists.pullRequests`). The settings row
  shows it as a Pull requests pill.
- An instruction may tell the agent to run shell commands in the PR's
  worktree (`git diff --stat -- apps/web/convex`). The agent runs them like
  any other step. Command Checks that run without an agent (exit code is
  the status, output is the Evidence) are V2, behind a confirm that shows
  the commands first.
- Results belong to the PR's head revision. After a push they show as
  outdated, like an Outdated guide, until someone runs them again. A row whose
  current result names an older head than the stored PR's `headSha` gets an
  Outdated badge, and the card's subtitle says Outdated.
- They are separate from the referenced Task's Checks and never count
  toward them: a PR may have no Task, or its Task Checks may never have run.
- V1: a member with the CLI thread permission runs them by hand from the PR
  page, on their own CLI profile. Everyone in the project reads them. V2:
  automatic runs on new PRs and pushes, configured as an automation
  (OS-2173).
- A checks run is its own thread, separate from any Guide run, started from
  its own popup: the PR page's thread composer (profile, path, worktree,
  runtime, model, effort, attachments) with the PR pill locked and the text
  prefilled with the checks prompt, which the member may edit before sending.
  The composer's send button starts the run; the popup has no footer. A Guide can fill most of a model's context, so the two run in
  parallel, each on the model that suits it.
  - Run checks sits in the card's header. It is hidden without the CLI thread
    permission, and disabled with the reason when no CLI profile is online or
    the Pull request checklist has no Checks.
  - The popup's choices are a draft of their own per member and project
    (draft key `pull-request-checks:<userId>`), apart from the PR's Activity
    composer draft. Each open replaces the draft's text with a fresh prompt,
    since the prompt names the current head. The model picked is remembered
    like any new-thread composer's.
  - The run is a CLI thread with the PR as its Attached pull request.
    `cli.threads.core.create` takes `pullRequestChecks: { headSha }`, the head
    the card shows, and stores it as `cliThreads.pullRequestChecks.headSha`.
    It must still be the stored PR's head, else "The pull request has new
    commits. Run the checks again." A PR outside the project's connected
    repositories is rejected: "Pull request checks need a pull request in a
    connected repository". Run checks is disabled until Convoy has synced the
    PR.
  - The prompt names that commit and asks the agent to check it out if the
    working tree is elsewhere, then lists each Check in the Pull request
    checklist (key, label, instruction) and points at the attach footer's
    `convoy threads attach` command, as the Checks tab's Run checks does
    ([task-checks.md](task-checks.md#requesting-a-run)).
- Ownership: a checks run's `convoy threads attach --check` writes results
  owned by the project, the PR ref, and the launch head
  (`checkResults.pullRequest`), never by a task, even one attached to the
  thread later. The thread's Checks tab, `convoy threads checks`, and MCP
  `get_checks` read the PR's Checks (`getForThread`), so the CLI needs no
  change. Deleting the thread keeps them.
- Each result publishes to GitHub as its own check run on the result's head
  commit, never one run for the whole checklist: one run would need an overall
  conclusion, a verdict Convoy doesn't give, and a run per Check lets branch
  protection require one Check. The run is named by the Check's label, its
  conclusion maps the status ([task-checks.md](task-checks.md#statuses)), its
  title is the value (or the status, "Failed", without one), and its summary
  is the note (or the title). GitHub renders the summary as Markdown, so a
  note's single line breaks merge there and bare `<tags>` drop out. Its
  `external_id` is the Check's key, its `started_at` and `completed_at` the
  report time, and its Details link the PR's page in Convoy.
  - Only Checks in the project's catalog publish. An off-catalog result's
    label comes from the agent, which reads PR text the author controls, so
    publishing it would let a PR name a green check run on its own commit.
    Off-catalog results stay in Convoy.
  - Renaming a Check leaves the runs under its old name on commits already
    checked, and a branch protection rule on the old name waits for it.
  - A label CI also uses ("Tests") gives the commit two runs of that name from
    two Apps. Pin a required check to the Convoy App, or pick labels CI does
    not use.
  - `checks.results.report` stays a mutation and schedules
    `integrations.github.checkRuns.publish`, an internal action that mints a
    token with only Checks: write on the result's repository and creates the
    run. Every report creates a new run; GitHub shows the newest run of a name
    on a commit by `completed_at`, so a rerun replaces the earlier one there
    even when the two publishes land out of order.
  - A failure never rolls back the result. The action stores why on the result
    (`checkResults.githubPublishError`): the repository is no longer connected,
    GitHub refused (a 403, or a token mint answering 422: "GitHub refused the
    check run. The Convoy GitHub App needs Checks: write on this repository."),
    GitHub access to the repository was removed (404), or GitHub is down or
    limiting. The row
    shows a Not on GitHub badge with the reason, and the card's subtitle says
    Not on GitHub, since a passed row stays folded. There is no retry: the
    next run publishes again.
  - A push leaves the new commit without Convoy's runs until the checks run
    on it.
  - The project setting "Publish results to the Git host"
    (`projects.publishPullRequestChecks`, unset means on, OS-2406) sits under
    Pull requests in the Checks settings once a Checklist is the Pull requests
    default. Off keeps every result in Convoy: `getPublishTarget` returns
    nothing, so no run and no Not on GitHub badge. It covers every Git host
    the project connects, so a GitLab connection would publish under the
    same switch. Turning it off removes nothing already on the host; turning
    it on publishes the next run, not earlier results.
  - Known ceiling: the Overview reads the first 100 check runs of the head
    and drops Convoy's afterwards, so on a commit with more than 100 runs
    Convoy's can push CI runs off the GitHub checks card.
- The PR page shows them as a card before GitHub checks: "Pull request
  checks: 2/3", the checklist and the "1 failed" tail, passed and warning rows
  folded until the header is clicked. It reuses the Evidence card and
  `CheckRow`. With a failed row the card has Fix, which drafts "Fix the failed
  pull request checks:" and one line per failed row in the Activity composer.
  The card is hidden while the project has no Pull request checklist and the
  PR has no results. Anyone who can read the PR reads them
  (`checks.checklists.getForPullRequest`: project access and an active link to
  the PR's repository), with the "Reported by…" rule from
  [task-checks.md](task-checks.md#visibility).
- Each Check has a "Show in pull request list" switch
  (`checkDefinitions.showInPullRequestList`). Up to three shown Checks,
  Pull request checklist order first, are the list's icon columns. A PR with
  any result shows one icon per column, so a column is the same Check on
  every row: an unreported Check is the pending circle ("Not reported on this
  pull request" in its tooltip), and a result from an older head than the
  stored PR's is dimmed ("Outdated: reported on an older commit"). A PR
  nobody checked shows no icons. The tooltip has the label, value, and note.
  Search hits show them too. Only the rows on screen (loaded rows, or the
  search's hits) are read (`checks.results.listForPullRequestList`, at most
  100 refs a call, so the list sends one call per 100 rows): one index read
  per row and shown Check, plus, for a row with results, the stored PR's head
  (the project's links, read once per call, and the PR row).

## Disconnect, revocation, and reconnect

Disconnect immediately hides synchronized PR content from the affected
project and blocks live reads. Detected installation suspension, uninstall,
or repository-access revocation does the same. A remote revocation takes
effect when Convoy detects it; do not promise instantaneous detection of a
missed remote event.

Schedule retained data for deletion after 30 days. A project admin can
delete a disconnected repository's retained data sooner with Delete now.
Authorized reconnect before deletion cancels it and reconciles the retained
metadata. Preserve
existing task links. Another project's active authorized connection must
not lose data when one project disconnects.

Every completion of background work must recheck the active connection.
A stale import, webhook job, or live fetch must not restore disconnected
content. Deletion must recheck the retention deadline and current connection
in its transaction so a reconnect wins over obsolete cleanup work.

Transient GitHub failures are not access revocation. For those failures,
retain previously displayed metadata with a freshness/error indication;
block new content if authorization itself cannot be established.

## Deployment configuration

Operators register a GitHub App and configure backend environment variables
for hosted and self-hosted deployments. A guided registration UI is not
required. The same code runs with each deployment's configured App.

Proposed configuration includes App ID, private key, App slug, OAuth client
ID/secret for verifying the connecting admin, and a webhook secret. Final
variable names belong in the environment examples and public deployment
docs. Secrets must reach the Convex backend, never NEXT_PUBLIC variables.
Use typed optional environment declarations following generated Convex
guidance so deployments without GitHub configured still run normally.

Require a reachable webhook endpoint. Self-hosted operators configure it
and the callback URLs. Document a supported authenticated deployment and
dedicated webhook routing; do not expose unauthenticated local-demo mode
as a shortcut to webhook reachability.

The App requests every permission the plan needs from the first slice:
Pull requests write, Issues write (comments), and Contents write (merge,
branch deletion), Checks write (publishing Pull request checks), plus read
access to commit statuses.
Changing an App's permissions later makes every connected organization's
owner re-approve, and an organization whose owner never approves quietly
stops working. The install screen explains that writes act as the member's
own account, except check runs: only an App can create them, so Convoy
publishes Pull request checks as itself for any member who can run the
checks, with no Linked GitHub account. Otherwise installation credentials
read and synchronize, and user-to-server tokens from each member's Linked
GitHub account write.
Each installation token is minted for one repository with read access to
pull requests, checks, commit statuses, contents, and metadata only. A
token without one of these gets a 403 from that endpoint. Publishing a Pull
request check mints its own token with Checks: write and metadata read only. The
connecting admin's personal credentials only prove setup authority.

## Proposed module boundaries

Use a normal `apps/web/convex/integrations/` domain with one module folder
per provider ([ADR 0013](../adr/0013-one-folder-per-integration-provider.md)).
GitHub lives in `integrations/github/`, so its functions are
`api.integrations.github.<file>.*`. Schema contracts shared by every provider
(`integrationProviderValidator`, `integrationSetupStatusValidator`) live in
`convex/lib/contracts/integrations.ts`; GitHub's own (link and sync status,
PR state, normalized PR) live in `convex/lib/contracts/github.ts`. No
separate Convex component or generic plugin framework is required.

| Location | Ownership |
| --- | --- |
| `integrations/github/core.ts` | Connections: settings status, PR link targets, disconnect, Delete now, Sync again, project deletion, revocation, and the retention purge |
| `integrations/github/setup.ts` | The connect flow: `beginSetup`, the OAuth callback (`completeSetup` action, `claimSetup` and `authorizeSetup` mutations), repository selection (`listSetupRepositories`, `saveRepositories` action, `applyRepositories` mutation), cancel, and expiry |
| `integrations/github/sync.ts` | Background sync: the repository lease, job claim, recovery, and commit, the sync worker, webhook fan-out, and the reconciliation cron |
| `integrations/github/checkRuns.ts` | Publishing a Pull request check result as a GitHub check run (`publish` internal action) and recording why it failed |
| `integrations/github/pullRequests.ts` | Stored PR reads (`list`, `get`, `stack`, `referencedTasks`) and the live `readDiff`, `readOverview`, and `readFile` actions |
| `integrations/github/lib/github.ts` | GitHub REST client and credentials: App JWT, installation tokens, setup token encryption, and the OAuth exchange |
| `integrations/github/lib/parsers.ts` | Narrowing GitHub JSON into normalized PR and diff metadata |
| `integrations/github/lib/lifecycle.ts` | Starting a reconciliation pass and disconnecting a link, shared by connect, disconnect, and the cron |
| `integrations/github/accounts.ts` | Linked GitHub accounts and user-to-server tokens |
| `integrations/github/guides.ts` | Guides: requests, submission, validation, and reads |
| `integrations/github/httpHandlers.ts` | Callback and webhook entry points |
| `integrations/github/lib/*Repo.ts` | One data-access contract per owned table |
| `integrations/github/lib/validators.ts` | Shared validators, inferred types, and projections |
| `integrations/github/lib/permissions.ts` | Shared access rules |
| `integrations/github/errors.ts` | Domain errors |

Only create shared helper files when there are multiple consumers. Grow
modules into folders under the existing entity/helper rules if needed.
Callables use repos for all database access. External API work belongs in
actions, while deduplicated upserts and lifecycle changes are transactional.

Keep meaningful connection/repository/PR shapes provider-neutral. GitHub
installation semantics, webhook events, search syntax, and payload parsing
stay in the GitHub module. Adding GitLab later should add provider behavior
inside this domain, not conditionals throughout tasks and threads. Do not
create unused provider implementations or speculative GitLab fields now.

### UI boundary and external wiring

The UI folder is `apps/web/components/blocks/integrations/`; its `index.ts`
is the only public entry, `project-integrations-page.tsx` holds the catalog
index and routes to a provider page, and everything GitHub-specific lives in
`github/`. Its `index.ts` and exports at most three things:
`ProjectIntegrationsPage`, `PullRequestsPage`, and `PullRequestLink`.
The OAuth callback route mounts `<ProjectIntegrationsPage callback="github" />`,
which the developer toggle does not gate.
The PR page owns both list and reader modes. Its hooks and pure helpers
(`use-integration-status.ts`, `github-patch.ts`) live inside the UI folder
and are private to it, with no separate entry point. Enforce these imports through the existing ESLint restrictions.

Name the external wiring before implementation:

- `lib/navigation/routes.ts` adds the project PR list/reader route helpers
  and `projectGithubIntegration`.
- The project settings config enables Integrations; the existing
  `settings/[section]/settings-page-content.tsx` host mounts
  `ProjectIntegrationsPage` (the index) from the public entry, and
  `settings/integrations/github/page.tsx` mounts it with `provider="github"`.
- The project PR route mounts `PullRequestsPage`; the existing sidebar
  navigation adds a "Pull Requests" item with a pull request icon (GitHub is
  only one possible source) right after the project's Watch Tower item,
  using the route helper.
- Existing thread PR badges (`ThreadPrBadge`, so every thread surface),
  task-table PR icons, and task-detail PR links mount `PullRequestLink` from
  the same public entry. Its lookup is one `integrations.github.core.listLinkTargets`
  subscription per organization, shared by every link on screen, never a
  GitHub call per row.

### Developer toggle

Until the integration ships, the `GitHub integration` developer toggle
(off by default, [user-settings-developer-section.md](user-settings-developer-section.md))
gates its frontend. Off: the Integrations settings section and its project
`...` menu action are hidden, the sidebar has no Pull Requests item, and the
PR and GitHub settings routes say the integration is off without reading any
data. The backend, webhooks, and the OAuth callback route are not gated.
Remove the toggle once the integration ships.

The Guide prompt is a section of `ProjectIntegrationsPage`, so it needs no
fourth export. Attaching PRs to threads adds `AttachedPullRequestPill`,
`PullRequestSelectorDialog` (the composer), and `AttachedPullRequestReader`
(the thread sidebar tab): the thread module mounts each one directly. Guide runs start CLI threads through the threads domain's
existing creation path; the integration domain never creates threads on its
own.

Backend wiring stays at `schema.ts`, `http.ts`, `crons.ts`, and typed env
configuration. The new integration domain owns new integration entities.
Existing task-link tables/repos, CLI snapshots, and CLI op processors stay
with their current owners. Do not create parallel copies in integrations.
When the PR reader becomes a second consumer of diff presentation, extract
that presentation to `components/custom/` in the same slice. CLI fetching
and mutations stay with threads. There is no standalone refactor slice.

## Proposed technical defaults for review

These complete the implementation proposal; they are not additional
product decisions already confirmed in the interview.

- Share provider metadata within a Convoy organization, keyed by provider,
  host, immutable repository ID, and PR ID. Keep authorized project-repository
  associations separate. Never share records or annotations across tenants
  merely because the GitHub IDs match. Preserve per-project disconnect
  deadlines; purge shared metadata only when no authorized or retained
  association still needs it.
- Persist normalized repository/PR metadata and minimal delivery/job state,
  not arbitrary full webhook payloads or file bodies. Keep future priority,
  review layers, and execution records out of provider metadata.
- Validate webhook signatures before enqueueing. Acknowledge after durable
  receipt and process asynchronously. Treat events as refresh signals,
  account for out-of-order delivery, and serialize or version writes so older
  work cannot overwrite newer state. Slice 1 has no delivery-ID
  deduplication: the scheduled job is the receipt, and a duplicate costs a
  refetch, never a second row. Delivery history is a follow-up under OS-1852.
- Reconcile active repository access and open/recently changed metadata in
  bounded jobs, starting with a 15-minute cadence. Respect rate limits and
  back off with retries. Webhooks are the normal update path; this is repair
  work, not UI polling or an unrestricted closed-history crawl.
- Coalesce identical page requests, but guarantee one logical PR through
  indexed transactional upserts. Use independent repository cursors and a
  project-level merged page. Start with 30 visible rows and the accepted
  update-time ordering. Track coverage, invalidate stale page traversal on
  refresh, and label partial/error results rather than claiming completeness.
- Use backend-scoped, rate-limited search per installation and combine
  results in update-time order. Start with 30 results per page. Do not claim
  a global relevance score across installations. Bound automatic fan-out
  and show per-source failures without broadening authorization.
- Recheck connection authorization before returning live results and before
  committing imported metadata. Carry a connection generation through jobs
  and cleanup so disconnect/reconnect invalidates obsolete work.
- Use stored-state subscriptions for tracked PR revision notifications.
  For an untracked search result, recheck metadata on focus or explicit
  refresh without creating a PR record or starting list polling.
- Prefer synchronized state for connected tracked GitHub PR badges; preserve
  CLI snapshots for untracked/disconnected/provider fallback. Resolve
  navigation in batches rather than one GitHub call per badge.

## As built

Slice 1 (OS-2178) connected one repository per project, imported its open
PRs, and added a basic text-diff reader. Slice 2 (OS-2179) widened it to many
repositories per project, the playground's settings and list layouts, PR
links into the reader, and reconciliation. Slice 3 (OS-2180) rebuilt the
reader in the playground's layout; see [The reader](#the-reader). Slice 4
(OS-2181) added closed history and live search; see
[Closed history and search](#closed-history-and-search).

### Data model

Split integration tables by kind where that is natural: these are code-host
tables, and a future Jira or Confluence connection gets its own tables
without repository constraints. Within a kind, every row carries a required
`provider` discriminator from its first insert, and provider-only fields live
in a nested object (`github: { installationId, accountLogin }`). With one
provider, rows use `v.literal("github")` and a plain nested object; a second
provider turns each table into a union of complete discriminated objects.

| Table | Holds |
| --- | --- |
| `integrationRepositoryLinks` | A project's authorized link to one repository: status (`active` or `disconnected`), `generation`, installation identity, retention deadline. A project has up to 100 active links |
| `integrationRepositories` | Repository metadata and sync state (lease token, import page, last success, error, the running and last finished reconciliation pass, closed-history coverage and the page on its way), plus open and closed PR counts, shared by the links of one organization |
| `integrationPullRequests` | Normalized PR metadata, one row per repository and number, with the REST `stack`, `archived`, and the last known `conflicts` |
| `integrationSetups` | A 10-minute connect flow bound to one user and project |
| `integrationPullRequestGuides` | A project's Guide of one PR revision: requester, run thread, status, base and head, runtime and model. Indexed by project, repository, and number, and by thread |
| `integrationPullRequestGuideSteps` | A ready Guide's steps, up to 800 KB, one row per Guide, indexed by Guide. Kept apart so the Guide menu reads 20 small rows, not 20 sets of steps; deleted with the Guide |

`cliThreads.pullRequestGuide.headSha` marks a Guide run's thread, set at creation.

### Connecting

Settings → Integrations is an index with one GitHub row. Its badge reads
Not set up, Not connected, "N repositories connected", or Disconnected, and
the row opens `settings/integrations/github`. Other providers get rows when
they exist, not as "Coming soon" placeholders.
The OAuth callback page centers its message on the screen. The GitHub page
uses the standard settings header with "Back to
integrations", then a Connected organizations heading with an Add
organization "+" for admins. Each GitHub account the App is installed on
(`accountLogin`) gets its own card: an initial avatar, the name, a sync dot
with "Pull requests synced", "Importing pull requests…", "Sync failed", or
"Disconnected", and "· N repositories". Its ··· menu (admins) has Manage
repositories and Disconnect <account>, which disconnects every repository of
that account after a confirmation; a card whose repositories are all
disconnected shows Reconnect GitHub instead. Below the header the
repositories form an edge-to-edge list with full-width separators, then the
footer: lock for private, the name, and a connected check (its tooltip reads
"Connected. Pull request changes on GitHub show up here automatically."), or the sync error
with Sync again. A connected repository's ··· menu (admins) has Disconnect
repository, which confirms and calls `core.disconnect` for that one link.
Removing never goes through GitHub, so an admin who lost GitHub access to
the repository (a transfer, a removed membership) or has no GitHub account
can still remove it. Adding still needs Manage repositories. A disconnected repository is one row: the name with a
Disconnected badge, then on the right "Will be deleted on <date>", a (?)
popover explaining the 30-day retention (and the revocation reason, if
any), and a small Delete now for admins, which confirms first. The footer reads "PR metadata last synced
<time>" for the account's least recently synced repository, or, once all are
disconnected, "Pull requests are hidden. They'll be deleted on <date> unless
you reconnect." Settings shows
the active links and the 30 most recently disconnected ones. With nothing
connected the card reads No repository connected, with Connect GitHub for
admins. The project's sidebar ··· menu links to Integrations for whoever can
manage it.

1. **Connect GitHub** (`integrations.github.setup.beginSetup`, project admins only)
   stores a setup with a hashed random state and sends the browser to
   GitHub's OAuth authorize URL.
2. GitHub redirects to `/integrations/github/callback`, a signed-in app page.
   `integrations.github.setup.completeSetup` claims the setup once (it must belong
   to the caller, be unexpired, and the caller must still be a project admin),
   exchanges the code, and stores the user token encrypted (AES-GCM, key
   derived from the App's client secret) until the setup ends.
3. The GitHub integration page opens the repository picker
   (`?setup=<id>`, `appRoute.projectGithubIntegration`). It lists the
   repositories of every App installation the user can reach. The server
   pages 30 at a time, one installation after another; the picker follows
   every cursor and shows the whole list at once, with no Load more, so the
   user who just granted access sees every repository without another click.
   Ones the user does not administer are disabled, grouped by owner, with the
   project's connected repositories checked. **Manage access on GitHub** opens
   the App's install page in a new tab, where the user installs the App or
   adds repositories to it. The App's Setup URL is the callback page (with
   Redirect on update on), which says the install is done and closes its tab
   when the browser allows; returning to the Convoy tab reloads the list.
   With repositories listed, a Refresh icon reloads them too; with none yet,
   Manage access on GitHub is the dialog's only action.
4. **Save repositories** applies the selection in one transaction: it
   disconnects the connected repositories the user unchecked (a Convoy check
   only, so a repository the user no longer administers on GitHub, or cannot
   see there, can still be removed; the picker lists those too) and connects
   the newly checked ones, after the user accepts that every project member
   can read them. `integrations.github.setup.saveRepositories` rechecks GitHub
   admin permission with the user token for each repository to connect,
   finds its installation, and mints a repository-scoped installation token
   to prove coverage; one failure saves nothing, removals included. The final
   mutation rechecks Convoy authority, accepts only the project's own links
   to remove,
   keeps the project at 100 active links, leaves an already active link
   alone, reactivates the project's retained link to the same repository if
   any, and deletes the setup. When another project's active link already
   keeps the shared repository current, that is all. Otherwise it schedules
   the import when the repository never finished one, and a reconciliation
   pass when it synced before (see Reconciliation).

Setups expire after 10 minutes, and starting a new one replaces the user's
earlier setup for the project. Opening a `?setup=` link whose setup is gone
shows the expiry message and clears the parameter. The callback page never
shows GitHub's `error_description` (anyone can put text in a URL); it shows
the catalog message and a link back to Convoy.

`core.get` reports `canManage` from the project role alone, so a project
admin on a deployment without the App still gets the link from the PR page
to the GitHub integration page, which then explains that the App is missing. The
deployment counts as configured only when all six variables are set and the
private key is PKCS#8; a PKCS#1 key logs a warning and reads as not
configured.

### Reading

- `integrations.github.pullRequests.list` is a live paginated query (30 rows) over
  the project's active links, merged in index order with one stream per
  repository and state (convex-helpers `mergedStream`). It takes the tab
  (Open: open and drafts; Closed: closed and merged), an optional repository
  id, the sort (Last updated or Created on, indexed), and the order.
  `pullRequests.get` is the reader's live metadata. Both require project
  membership and the project's own active link; a repository id alone
  authorizes nothing, and one the project has not connected lists nothing.
- The PR page has an `h-14` header bar with the title and, for admins,
  Manage repositories, then a centered `max-w-4xl` list: Open and Closed
  tabs with counts summed from the repositories in scope (plain muted
  numbers, as counts are elsewhere in the app), the repository
  filter, and the sort menu (Created on or Last updated, Oldest or Newest;
  Last updated, Newest by default). Each row shows the state icon and title
  over "owner/repo #number · author · updated <time>", and up to two labels.
  An empty tab (no PRs, still importing, or a failed import) shows its empty
  state right under the toolbar. Only "No connected repositories" centers on
  the page. The filters survive opening a PR and coming back. A repository whose sync
  failed puts "owner/repo: <error>. Showing the last successful update." in
  a banner above the rows. The Closed tab imports closed history as it pages
  (see [Closed history and search](#closed-history-and-search)), and its count
  shows only once every repository in scope has all of its history.
- `PullRequestLink` matches `https://github.com/<owner>/<repo>/pull/<n>`
  against `integrations.github.core.listLinkTargets` (the active links of the
  organization's projects the caller can read, up to 500), case-insensitively.
  A match opens the reader in that project, preferring the project in view;
  anything else, and every link while the developer toggle is off, opens
  GitHub in a new tab as before.
- `integrations.github.pullRequests.readDiff` is a one-shot action. It reads the PR, its
  files (first 100), and the PR again; if the revision moved, it retries once,
  then asks the reader to refresh. It rechecks access after GitHub answers.
  Patches past 1 MiB of UTF-8 in total come back without text, and the result
  is marked partial when files are missing or omitted.
- When `readDiff` finds that GitHub refuses the repository token for an access
  reason, it schedules the access check for that link and generation, so a
  missed uninstall webhook still hides the stored PRs once GitHub confirms.
- When the live revision differs from the stored row's base or head SHA,
  `readDiff` schedules a refresh of that PR, so a missed event repairs itself.
  A PR with no stored row gets no refresh: browsing it writes nothing.
- The public actions (`readDiff`, `listSetupRepositories`,
  `connectRepository`) turn GitHub failures into catalog messages, because
  Convex hides plain errors from clients in production.
- The PR page shows a failed import as its own empty state with the sync
  error, not as an empty repository.
- The reader holds the diff it loaded and remembers the stored revision
  (base and head SHA) at that moment. It shows New changes available with
  Refresh only when the stored revision moves past both: a stored row that
  lagged the live diff, and then catches up, is not a change. Losing access
  drops the held diff.
- A project the caller cannot read shows No access instead of loading.

### The reader

`?repo=&pr=` turns the PR page into the reader: the PR browser pane on the
left (stacked above on narrow screens) and the reader beside it.
While the project, its connections, or the PR load, both panes show
skeletons in their real shape: the pane's header, search bar, and rows in
the current layout (compact or cards; Closed and search rows always
compact), and the reader's header, tab row, and Overview.

- **Browser pane.** A header with the back arrow and "Pull requests", then
  a search bar, then Open and Drafts groups from `pullRequests.list` (the
  Open tab) with the thread list's Load more, then a Closed section. The
  search bar is `h-[41px]` with a bottom border, the reader's tab-row
  height, so its line meets the one under the tabs. Typing runs live GitHub
  search, and its results replace the groups. Closed works like the thread
  list's Done: collapsed by default (the choice is kept in local storage),
  compact rows whatever the layout, and a Load more of its own. The section
  mounts its list only while open, so a collapsed Closed reads and imports
  nothing. Closed rows and search results carry the state icon, since they
  mix closed, merged, and open. The filter button opens the thread list's settings dropdown: a
  Compact layout switch, then radio items for Sort by, Order, and
  Repository (shown only with more than one connected). Filters are shared
  with the list page.
- **Browser rows** are drawn like thread cards: `#number`, title, and
  updated time, then the head branch with the conflicts icon and stack badge
  (the repository leads that line when more than one is connected). Compact
  layout draws them like compact thread rows instead: one flat line of
  `#number`, title, conflicts icon, stack badge, and a short time ("4d"),
  with the branch in the row's tooltip. The choice is the server-stored user
  preference `pullRequestCompactLayout`, off by default and separate from
  the thread list's. There is no state icon, since the group already names
  it. The open PR gets the thread list's active highlight. The pane is
  resizable (256–560px, default 320) by dragging its right edge or with the
  arrow keys, and the width is kept in local storage.
- **Header** (`h-14`): state icon, the title truncated with a tooltip, the
  Archived badge, the Stack button, the Merge status popover (open PRs
  only), and Open on GitHub.
- **Tab row**: Overview, Guide, and Diff, with the displayed revision
  ("main → 8a3e7d1", the held diff's head) on the right. Guide shows an
  empty state until slice 5. New changes available sits under the tab row;
  Refresh reloads the diff and the Overview together.
- **Overview.** `readOverview` is a one-shot action, read on open and on
  Refresh, never subscribed. It runs after `readDiff` with the diff's base
  and head SHAs, so both describe the revision on screen: it reads the PR, then in parallel its first
  100 commits, reviews, issue comments, and inline review comments, the head commit's check runs and
  combined status, and `compare/<baseSha>...<headSha>` for behind-by (null when
  GitHub can't compare, such as a deleted base branch), then the PR again.
  A PR whose base or head is not that revision on either read fails with the "changed
  while loading" message. Check runs map to
  GitHub's rollup: `completed` with `success`, `neutral`, or `skipped`
  passes, any other conclusion fails, and anything not completed is
  pending. Pending (draft) reviews are dropped. The main column has the
  description (markdown), the Conflicts card when
  GitHub reports `mergeable: false` (with Resolve on GitHub to
  `<pr>/conflicts`), the GitHub checks card (passed rows folded), one
  Evidence card per referenced Task (`TaskEvidenceCard` from the checks
  module: failed, pending, and not performed rows until the header unfolds
  the rest; its thread links use the task's own project), the folded
  Commits card, and Activity: the task timeline's header over opened, commits,
  reviews, and comments, read-only, with no Threads source yet. Comments
  carry the author's GitHub avatar. Images in the description and comments
  sit inline with their text, as on GitHub, so bot tables keep each icon
  beside its label: they get no download button, and a superscript
  holding only an image is dropped so it doesn't lift the image (OS-2403). An inline review comment shows under
  the Comments source laid out like any other comment: avatar, author
  and time, then a bordered card that quotes the file, "Line 3" (or
  "Lines 2–3"), and the commented lines, then the comment. The quote
  is cut from the end of the comment's `diff_hunk`, which GitHub ends at
  the commented line, so it costs no extra request; an outdated comment
  keeps the lines it was left on. A review
  with a body shows as a comment ("maya requested changes"), so its text
  stays readable. While the overview loads, placeholders keep the cards',
  properties', and Activity's shapes (its header, the composer, a comment
  row, and an activity rail); a property with no value shows the task table's
  dash. Properties:
  Status, Tasks, Stack, Reviewers (a re-request wins, then the latest
  approval or change request, then a comment; the author's own review
  comments never list them, as on GitHub), Assignees, Labels, and
  Milestone (each only when GitHub has a value), and Branch ("Based on #482",
  then conflicts, behind, up to date, or "Couldn't compare with main" when
  behind-by is unknown). Below the container width that fits the
  properties column (`@4xl`), the column hides and the header carries them
  instead: a Status badge ends the title row, the branch state ends the
  author · base ← head row, and one row under it holds Tasks, Stack
  (a popover with the stack map), Reviewers, Assignees, Labels, and
  Milestone, each only when it has a value. Threads stay out of that row,
  since Activity lists them. Fix buttons and the composer come
  with slices 5.5 and 6.
- **Merge status** is read-only: the stack map, reviews, the checks list
  under the rollup, behind-base, mergeability ("Checking mergeability…"
  while GitHub reports `null`), and conflicts with Resolve on GitHub. Its
  button's icon is red for conflicts or failing checks, the pending circle
  while either is unsettled, and green otherwise.
- **Diff.** The file tree in the split pane (closable), a bar with "4 files
  +14 -0 · 1 / 4 reviewed", collapse-all, split/unified, and wrap. Each file
  has a Reviewed checkbox; reviewing folds the file and un-reviewing unfolds
  it. A rename shows "Renamed from …", or "File contents are unchanged"
  without a patch. The file button opens the whole file in its own tab
  through `readFile`: the Contents API at the diff's head SHA, or at its
  base SHA for a deleted file. Files over 1 MiB read as too large, and a NUL
  byte reads as binary. `readFile` reads any path at any ref in a connected
  repository, the same scope a project member already has through diffs.
- **Reviewed marks** live in local storage under
  `convoy:github:reviewed:<repositoryId>:<number>`, mapping each path to the
  file's blob SHA from GitHub's files response. A revision that changes the
  file changes its SHA, so the mark clears.
- **Stacks.** Every PR read stores GitHub's REST `stack { id, number, size,
  position }`; a shape the parser doesn't know reads as no stack rather
  than failing the sync. `pullRequests.stack` lists the stored Layers by
  `by_repositoryId_and_stackId`, bottom first. The list row, browser row,
  and header badges read "Stack 2/3" from the row and load the map only when
  opened. Shift+K and Shift+J open the Layer above and below. Layers Convoy
  never stored (closed history not imported yet) are missing from the map.
- **Archived** comes from the REST PR object's `archived` flag.
- **Conflicts mark.** Only a single-PR read carries `mergeable`, so the row's
  `conflicts` is set by webhook refreshes and kept when a list page or a
  still-computing `null` has no answer. GitHub sends no event when
  mergeability settles, or when the base moves, so the mark can be stale;
  `readOverview` schedules a refresh when it sees a different answer.
- **Referenced Tasks.** `referencedTasks` scans the stored title, head
  branch, and labels for `<alias>-<number>` (an alias as in
  `REF_QUERY_REGEX`, not inside a longer word or number), up to 10 refs,
  looks each project up by alias in the organization, and returns the task
  (active, then archived) only when the caller has task view on that
  project. Nothing is stored. A PR without a stored row (a search result)
  has no referenced Tasks yet.

### Closed history and search

- **History pages.** `pullRequests.loadHistory` (project view, so viewers
  too) schedules one page of `state=closed&sort=updated&direction=desc` per
  repository in scope, under the repository lease like every sync job. The
  first call imports page 1 of each repository with no history. With
  `more`, it imports the next page of the repositories whose coverage holds
  the list back. A repository with a page on its way (`historyRequest`) is
  skipped, so two sessions opening Closed at once fetch the page once. The
  usual upsert by repository and number keeps one row per PR. Every page
  after the first also re-reads the page before it: a closed PR reopened
  since the last page shifts the list up and moves rows onto that page. The
  list is sorted by update time, so a window (the two pages) that starts
  older than `coveredThrough` may have rows missing between the two. Then
  the job keeps the coverage, steps the next page back by one, and schedules
  itself for it, until a window starts at or above `coveredThrough` (page 1
  always does). Any number of reopens between pages skips nothing. A request
  whose job ran out of retries or went obsolete releases itself; one older
  than 15 minutes is replaced.
- **Coverage.** The repository's `history` records the next page, the
  update time of the oldest PR imported (`coveredThrough`), and whether
  GitHub returned a short page (`complete`). Every closed PR updated at or
  after `coveredThrough` is stored: webhooks refresh closed PRs, and the
  reconciliation Changed phase inserts closed PRs once history started.
- **The Closed list.** `pullRequests.list` with the Closed tab shows rows
  updated at or after the highest `coveredThrough` among the repositories in
  scope that are not complete. A repository with no history covers nothing,
  so Closed is empty until page 1 lands. This keeps a deeply imported
  repository from listing old rows while another has gaps above them. With
  Created on, the bound filters rows instead of limiting the index range.
  History pages only in newest-updated order, so any other sort or order
  shows the imported window alone, under "Showing closed pull requests
  updated since <date>. Load more to go further back." until every
  repository in scope is complete. The connection reports each
  repository's `coveredThrough` for that date.
- **Load more** on Closed pages the stored rows first. Changing the
  repositories in scope (one connected while Closed is open) asks for the
  new ones' first page. Once they run out
  and history is not complete, it calls `loadHistory` with `more`, and pages
  the new rows in when the import commits. The connection's
  `history { started, complete, loading }` drives the spinner and the
  skeleton shown while page 1 imports.
- **Search.** `pullRequests.search` is a one-shot action across all states.
  It groups the project's connected repositories by installation, mints one
  token per group of up to 10 repositories, and sends one `/search/issues`
  request per group (at most 5, so 50 repositories; the rest are reported as
  not searched). The query is `is:pr`, the group's `repo:` qualifiers, then
  each of the member's words in quotes, so typed qualifiers or operators
  stay literal text. Hits count only for a repository their own request
  covered and that is still connected, at the same generation, after GitHub
  answers. Each page holds page N of every request, 30 hits each, and the
  client sorts every hit it has loaded by the chosen sort, so a later page
  can add newer hits above earlier ones. GitHub's
  `incomplete_results` or a total past 1,000 marks them partial, and a
  failed request names its repositories. Search writes nothing.
- **Search UI.** Both the list page and the browser pane search as you
  type (300 ms debounce), share the query, and page with Load more. A
  failed page, or one where a repository's request failed, shows Retry
  instead of Load more. Retry asks for that page again and replaces it, so
  the failure notice stays until the page succeeds. Changing the query,
  repository, or sort starts the search over from page 1, also when coming
  back to an earlier one. On the
  list page, searching deselects the Open and Closed tabs, and picking a tab
  clears the search.
- **Unstored PRs.** `readDiff` returns the PR it read (`pullRequest`), and
  the reader shows it when `get` has no stored row. Its header, Overview,
  and Diff work as for a stored PR. A PR GitHub doesn't have shows "This
  pull request isn't available" with GitHub's message and Retry.

### Sync and fencing

- Every job carries the link's `generation`. Disconnect, revocation, and
  project deletion bump it, so older jobs cannot write.
- One lease per repository serializes import pages and PR refreshes. A job
  that finds the lease held reschedules itself in 5 seconds with the same
  target, PR number included. Only the holder's commit or its recovery
  (scheduled for 2 minutes after the claim) releases the lease, so a crashed
  job is always retried before another job takes over. A lease held 10
  minutes, or one with no claim time (claimed before slice 2 stored it), is
  abandoned and the next job takes it, so a recovery that never runs (its
  module moved, for example) cannot block the repository. Commits must hold
  the current lease.
- The imported count derives from the page number, so a repeated page never
  double counts.
- **Sync again** does nothing while the repository is importing. Otherwise it
  schedules the import from its unfinished page (or page 1); a held lease
  only queues it.
- Import pages and reconciliation passes are chains. A job claims and
  commits only while it is the repository's current page (`importPage`) or
  pass (`reconcileStartedAt`), so a duplicate chain dies at its next claim.
- An import belongs to the link that started it. When that link disconnects
  mid-import and another project's link is active, the import resumes under
  that link.
- PR upserts skip older provider timestamps and unchanged rows. Equal
  timestamps write, since the lease holder fetched last.
- Connecting a repository that synced before (the same project
  reconnecting, after a disconnect or a revocation, or another project
  reusing retained rows) starts a reconciliation pass, since every event
  after the last pass may be missing, including the ones GitHub stopped
  sending before Convoy noticed a revocation.
- Every commit keeps the repository's open and closed counts from the state
  changes it wrote. A repository from before the counters starts at zero on
  its next commit and backfills its existing rows 30 at a time in PR-number
  order (`countPullRequests`). Until the backfill finishes, a commit applies
  a state change only to rows the backfill already passed, so each row is
  counted once, and the PR page's tabs show no counts rather than partial
  ones. A reconciliation pass whose Open phase lists a different number of
  open PRs than the stored open count recounts the same way, so drifted
  counts repair themselves within a pass.
- A successful PR refresh or reconciliation pass clears the sync error,
  unless an import is still unfinished; then the import's error stays.
- Failed fetches retry with backoff (up to 5 attempts) on rate limits,
  network errors, and 5xx, waiting at least as long as GitHub's
  `Retry-After` or rate-limit reset. A 403 counts as a rate limit when the
  primary quota is spent, it carries `Retry-After`, or its message names a
  rate limit (GitHub's secondary limits). Access errors schedule an access
  check instead.
- Every GitHub request times out after 15 seconds. Each sync job and each
  diff read mints its own repository-scoped token, and `readDiff` has no
  per-user limit. Cache tokens and limit reads when installation quota
  becomes a problem.

### Webhooks

`POST /api/integrations/github/webhook` verifies `X-Hub-Signature-256` over
the raw body before parsing, reduces the event to routing data, schedules
`integrations.github.sync.fanOutWebhook`, and answers 202. The scheduled job is the
durable receipt. Fan-out is a scheduled mutation that reads at most 30
targets, schedules their work, and schedules its own continuation in the same
transaction.

- `pull_request` refreshes that PR in every tenant copy of the repository.
- `installation` and `installation_repositories` schedule an access check per
  active link of the installation. Only a confirmed loss (GitHub refuses a
  repository-scoped token with 403, 404, or 422 that is not a rate limit) revokes, and only for the
  generation that was checked, so a replayed signal after reconnect is
  harmless. Rate limits and transient failures retry.

### Disconnect and retention

Disconnect (project admins) and confirmed revocation hide the project's PRs
at once and set a deletion date 30 days out. A purge job runs at that date
and checks the generation and deadline in its transaction, so a reconnect
wins. It deletes shared PR rows only when no other link, active or retained,
references the repository, in batches of 30. Each batch that leaves rows
clears the repository's counts and its closed-history coverage, so a
reconnect between batches recounts what is left instead of adding to counts
of deleted rows, and imports history again from the newest page. Deleting a project disconnects
its links the same way.

Delete now (`core.deleteRetained`, project admins, disconnected links only)
moves the link's deletion date to now and runs the same purge at once, so a
shared repository keeps its rows for the other projects. A second click while
the purge runs starts no second chain. The original 30-day purge later finds
no link and does nothing.

### Reconciliation

A cron (`integrations.github.sync.reconcile`, every 15 minutes) visits every
repository with an active link, 30 per transaction. A repository with an
unfinished import resumes it from its page. Any other repository starts a
pass unless one started less than an hour ago; an older one died out of
retries and is replaced. A pass runs under the repository lease, like every
sync job:

1. **Changed**: pages of `state=all&sort=updated` PRs back to the start of
   the last finished pass, minus 5 minutes for clock skew. A repository that
   never finished one (synced in slice 1) goes back to the update time of
   its stalest stored open PR instead, since closing any of them updated it
   after that; a single PR refresh never stands in for a pass. It updates stored rows and inserts open
   PRs. It inserts closed PRs only once the repository's closed history
   started, which keeps every closed PR updated since the covered time stored;
   before that, closed history is imported only on request.
2. **Open**: every page of open PRs, inserting any the import skipped, and
   checking the stored open count against how many it listed.
3. The pass records its start as `reconciledAt`. A first import sets it to
   the connect time, so the first pass covers what changed during the import.

Each case webhooks alone left open is covered:

- a webhook GitHub never delivered, or one dropped after retries: the
  Changed phase reads the PR;
- a PR that closed while an import paged past it: its close updates it, so
  the Changed phase reads it, and the Open phase finds the open PR the shift
  made the import skip;
- a crashed job that ran out of retries: the next pass, or the import resume;
- an import page that failed for good: the next tick resumes the import;
- an uninstall or revocation whose webhook was missed: the pass mints a
  repository token, and GitHub's refusal schedules the access check.

Each pass costs one Changed page in a quiet repository plus one request per
30 open PRs, every 15 minutes.

### Attached pull requests

OS-2193 attaches PRs to threads.

- Storage is by name, not by `integrationPullRequests` row: live-search PRs,
  pasted PRs from unconnected repositories, and rows removed by retention
  have no row. `attachedPullRequest` (`{ owner, name, number, ref }`) sits
  on `cliThreads` and as `pullRequest` on `cliMessages`. `ref` is
  `owner/name#number` lowercased, and
  `by_project_attachedPullRequestRef_deleted_lastActivity` finds a project's
  threads for one PR. A renamed repository's earlier threads stop matching.
- `cliThreads.create`, `cliMessages.send`, and `editLastResend` take
  `pullRequestUrl`; `cli.threads.core.attachPullRequest` takes `pullRequest`.
  Each accepts a github.com PR URL or `owner/repo#number` and rejects
  anything else with "Not a GitHub pull request URL". A PR alone is a
  message, like a Task, and titles a new thread `owner/name#number`. A fork
  copies the thread's and each message's PR. The `pr(github):` line needs
  CLI 0.142.0: an older CLI drops the field, so a PR-only message reaches the
  agent empty. Gate the "+" item on the profile's CLI version before the
  developer toggle goes.
- The composer keeps the PR above its keyed content, so attaching a task
  (which remounts it) keeps the PR. A new `initialAttachedPullRequest` from the
  host replaces it. A workflow run can't carry a PR yet, so starting one with
  a PR attached fails with "A pull request can't start a workflow run yet.
  Remove it or deselect the workflow."
- Pills show `#number`; the repository is nearly always the same one, so
  only the tooltip names it, at the end. They resolve title and state with
  `pullRequests.getAttached`, which matches the thread's project's connected
  repositories by name. Elsewhere, e.g. a pasted PR from another
  repository, the pill shows `owner/name#number` with no title, its tooltip
  is the URL, and it links to GitHub.
- Thread rows show the Attached pull request's `#number` beside the task
  ref, muted and linked like the branch PR badge. When it is the branch's
  own PR, only the branch badge shows.
- The thread header shows the same `#number` after the task ref (inside the
  thread tab in full view and the group strip). Like the task ref, a plain
  click opens the sidebar on the `#number` tab; a modified click opens GitHub
  (OS-2405).
- The "+" menu item and live pills sit behind the GitHub integration
  developer toggle.
- The reader header has Refresh, which re-reads the diff and overview from
  GitHub, the same as the new-changes prompt's Refresh. Start thread (a PR
  list row) opens
  `appRoute.projectThreadsWithPreselection(…, { attachedPr })`. The new-thread
  composer parses `attachedPr` with `parseAttachedPullRequest`, and the param
  stays in the URL until the thread is created, like `attachedTask`.
- `cli.threads.lists.listByAttachedPullRequest` reads up to 100 of the
  project's threads from the ref index and keeps the caller's own threads and
  shared ones (`isSharedForViewer`). A teammate's row carries `ownerName`, and
  its read and done state are false. The Threads label carries the "+", so
  the rows keep their full width. The Overview's Threads property and
  Activity's Threads source share that one subscription.
- Activity's composer is `TaskThreadComposer` with `pullRequest` in place of
  `task`, its draft keyed `pr:<ref>`. The PR pill is locked there, and the
  composer has no workflow selector. GitHub comments are read-only, so it has
  no comment side. Fix passes the composer a one-shot `seed`. The composer
  writes it into the draft, pushes it into the mounted editor, and focuses it,
  then `onSeeded` clears it, so a remount (a sort change, Refresh) never
  re-applies it. The Overview scrolls the composer into view. The drafts are:
  "Fix the failing GitHub checks:" or "Fix the failed OS-1 task checks:"
  followed by `- name: note` lines, or "Rebase #N on <base>, resolve the
  conflicts, and push."
- The thread sidebar's `#number` tab shows while the thread has an Attached
  pull request. It renders the reader when the repository is connected to the
  thread's project, and an Open on GitHub empty state otherwise. The stack
  hotkeys (Shift+K/J) are off there, since they would leave the thread. Once
  opened, the reader stays mounted (hidden) while another tab shows, so
  switching back doesn't re-read the diff and overview from GitHub; a newer
  push still shows the reader's new-changes prompt. The Overview
  uses a container query, not a viewport breakpoint, so in the sidebar its
  properties move to the row under the title.

### Error messages

Defined in `apps/web/convex/integrations/github/errors.ts`; tests assert on them.

| Case | Message |
| --- | --- |
| Deployment has no App | GitHub integration is not configured on this deployment |
| Unknown or someone else's setup | This GitHub connection request is no longer valid. Start again from Integrations settings. |
| Expired setup | This GitHub connection request expired. Start again from Integrations settings. |
| Callback replayed | This GitHub connection request was already used. Start again from Integrations settings. |
| Bad OAuth code | GitHub did not authorize this connection. Start again from Integrations settings. |
| Not a GitHub admin | You need admin access to this repository on GitHub to connect it |
| App not on the repository | The Convoy GitHub App is not installed on this repository |
| More than 100 repositories | A project can connect up to 100 repositories |
| Picking before authorizing | Authorize with GitHub before choosing a repository |
| Unknown link | Repository connection not found |
| Delete now on a connected repository | Disconnect this repository before deleting its pull requests |
| Diff without access | This project has no connected repository |
| Bad repository list cursor | Invalid repository list cursor |
| GitHub down or failing | GitHub could not be reached. Try again in a moment. |
| GitHub rate limit | GitHub is limiting requests from Convoy. Try again in a few minutes. |
| Unknown PR number | GitHub has no pull request with this number in the connected repository |
| Whole file missing at that revision | GitHub has no file at this path in this revision |
| PR pushed during every read | The pull request changed while loading. Refresh to load the new revision. |
| Confirmed revocation (shown on the link) | GitHub access to this repository was removed |
| Submit for a deleted Guide | The guide was deleted. |
| Submit from a thread that is no Guide run, or someone else's | This thread is not writing a guide. Start one with Generate guide on the pull request's Guide tab. |
| Second submit of a ready Guide | This guide was already submitted. Use New guide to write another one. |
| Member deletes another member's Guide | Only the requester and project admins can delete a guide |
| Guide run on a PR outside the connected repositories (`cli/errors.ts`) | Guides need a pull request in a connected repository |
| Guide run after a push (`cli/errors.ts`) | The pull request has new commits. Generate the guide again. |

## Delivery as vertical slices

Each slice is one planned commit containing the backend, UI, configuration,
tests, and documentation it needs. Each has a clickable verification path
in the running app. This is a commit plan, not permission to commit; commits
still require an explicit user request on the current branch. The order is
the agreed priority.

1. **Connect a repository and read an open PR.** Configure a test GitHub App
   with the full permission set, build the Integrations settings page,
   authorize both admins, select one repository, import its open PR
   metadata, and mount the main PR page and a basic text-diff reader.
   Include the schema/repos/actions, signed webhook refresh, access checks,
   disconnect hiding, and obsolete-job fencing needed by this path. Extract
   reusable diff presentation within this slice. Click Connect, select a
   repo, open a PR, inspect its diff, and observe a webhook title/state
   update. Verify a viewer cannot connect and another project cannot open
   the data.
2. **Manage multiple repositories and connection lifecycle** (built,
   OS-2179; see [As built](#as-built)). Widen selection,
   list merging and filters, task/thread links, shared metadata access, sync
   progress/errors, bounded reconciliation, and 30-day retention/reconnect.
   Click through two repositories, disconnect one project, reconnect, and
   verify another connected project retains access. Exercise cleanup with a
   controlled clock in tests. Its first commit splits slice 1's
   `integrations/github.ts` (client and crypto, sync worker, public actions)
   with no behavior change, and reconciliation closes the stale-state cases
   listed under [As built](#reconciliation).
   The GitHub integration page takes the playground's layout: a Connected
   organizations heading with an Add organization "+", one card per
   organization (initial avatar, name, sync dot with "Pull requests synced ·
   N repositories", a ··· menu with Manage repositories and Disconnect
   <account>), its repositories nested inside (lock for private, a connected
   check, a ··· menu with Disconnect repository), and a "PR metadata last synced" footer. The PR page takes the
   playground's list design: a header bar with the title and Manage
   repositories, a centered list, rows with the state icon and title over a
   "repo #number · author · updated" line, the Open/Closed state tabs with
   counts, the repository filter, sort, and the empty and stale states.
   Controls whose features land later (assignees, bulk actions, Stack
   badges, live search) arrive with their slices.
3. **Complete the reader** (built, OS-2180; see [The reader](#the-reader)). Renames, binary/deleted files, whole-file
   contents, partial limits, and stable revision refresh; the Overview with
   the folded Commits card, the Conflicts card, GitHub checks, Activity (the
   task timeline's header, filter, and sort over commits, reviews, and
   comments, read-only), reviewers, and branch; the list's Conflicts mark;
   referenced Tasks and their Evidence (once task checks, OS-2222, exist); Reviewed
   marks; the read-only Merge status popover; Stacks with the stack map; and
   the Archived badge. The whole reader takes the playground's layout,
   replacing slice 1's: the PR browser pane on the left, the h-14 header
   (state icon, title, badges, Merge status, Open on GitHub), the Overview,
   Guide, and Diff tab row with the displayed revision, and a Diff tab with
   the closable file tree, a totals and reviewed-count bar, split/unified
   and wrap toggles, and files opened in their own tabs. Open
   representative PRs, push a new commit while reading, and verify the
   refresh prompt leaves the diff stable.
4. **Browse closed history and search GitHub** (built, OS-2181; see
   [Closed history and search](#closed-history-and-search)). History pages with provider
   cursors, coverage tracking, bounded imports, and transactional
   deduplication; scoped live search with reader resolution without a stored
   row. Open Closed in two sessions and verify one record per PR; search for
   an old unimported PR and open it with no metadata writes.
5. **Guides.** The launch popup and its remembered choices, the `gh` run in
   a Thread worktree, `submit_pull_request_guide` (MCP and CLI) with
   validation, the built-in prompt and the project's Guide prompt, the
   corner menu, the duplicate-run warning, failure and retry, deletion, the
   amber Outdated guide banner, Follow-up guides, and
   `read_pull_request_guide`. Guide runs carry their PR as the Attached
   pull request (5.5). Request a Guide, push a commit, and update it
   as a follow-up. Any CLI change bumps the CLI version.
   - **5.5 Attach PRs to threads** (OS-2193, built before slice 5). Message and thread Attached pull requests, the
     `pr(github):` prompt line, `attach_pull_request_to_thread` and
     `threads attach-pr`, the "+" picker and pasted URLs, Start thread from the
     PR page, the sidebar tab with the reader, the Overview's Threads property,
     and Activity's Threads source, thread composer, and Fix buttons. Attach #482 from the "+" menu, send, and see the agent read it;
     start a thread from the PR page and find it under Threads. The CLI change
     bumps the CLI version.
   - **5.6 Pull request checks.** Needs task checks (OS-2222) for the catalog
     and `threads attach --check`. The Pull requests row in Checks settings,
     the Run checks launch popup, results owned by the head revision with
     the outdated state, the card before GitHub checks, the list's status
     icons, the card's Fix, and publishing GitHub check runs. Pick a checklist, run it on
     #482, see the card and the check run on github.com, push, and see it
     outdated.
6. **Linked GitHub account and comments.** The Your GitHub account row,
   user-to-server authorization per organization, Reconnect, access-based
   disabling, and conversation comments with edit and delete: the comment
   side of the Activity composer, and "Connect GitHub to comment..." without
   an account.
7. **State actions.** Close, reopen, draft, ready for review, assign, archive
   and unarchive, and the list's bulk actions.
8. **Merge.** Methods, the confirm popup, `merge-async` with Merging…,
   Update branch, Stack merges, and deleting the branch.
9. **Reviews.** Inline comments, approve, request changes, and requesting
   reviewers; settled review threads start feeding the Guide prompt.
10. **Edit title, description, and labels.**
11. **Auto-merge, merge queue, and revert.**
12. **Create a PR from Convoy.**

Every slice includes its focused tests, required checks, and visual
verification. Deployment instructions ship with the connection slice and
stay current as capabilities widen. There is no final testing-only or
schema/functions/UI-only slice.

## Readiness and live verification prerequisites

The product decisions are settled enough to begin slice 1. Technical
defaults above can guide implementation; no additional product interview
is required before starting. This plan does not assert that external test
configuration has already been provisioned.

Live verification needs a GitHub App registration, backend credentials,
correct callback/webhook URLs, a GitHub-reachable webhook endpoint, and a
test repository where the connecting user is an admin. Confirm availability
without printing secrets. Missing provisioning blocks real connection
verification, not writing the implementation and tests. Do not start a new
app server in the primary checkout or change production App configuration
as part of a readiness check.

## Acceptance criteria

- A project admin with GitHub repository-admin permission can connect a
  repository. A forged callback, viewer, or repo-read-only caller cannot.
- Members can read connected PRs without a personal GitHub token. Other
  projects and tenants cannot obtain that data through list, search, reader,
  or callback paths. Installer departure does not stop installation sync.
- The real Integrations page exposes selection, progress, errors, disconnect,
  and reconnect and works on configured hosted/self-hosted deployments.
- Open PR metadata imports in bounded background jobs. New/updated/closed
  PRs converge through verified events and missed-event reconciliation.
- Duplicate deliveries, concurrent imports, stale responses, and reordered
  jobs produce one logical PR and cannot regress newer data.
- Opening closed history imports only requested pages. Two users opening
  the same page share records without marking unrelated pages complete.
- Search can find unimported PRs. Search, pagination, and opening details
  cause no PR metadata writes. The reader works without a stored row.
- Existing task/thread links open the internal reader only for authorized
  connected repositories, preserving external navigation otherwise.
- Diff/full-file reads preserve rename/binary/deletion entries, label partial
  results, and do not mix revisions. New commits do not replace a read diff
  without the user's refresh.
- Disconnect hides content and blocks pending work. Reconnect cancels the
  30-day deletion. Another project's active connection remains intact.
- Every GitHub write runs as the acting member's Linked GitHub account and
  succeeds exactly when their GitHub role allows it, whatever their Convoy
  role. A member without one can read everything and write nothing.
- A PR shows each Task whose ref is in its title, branch, or labels, only to
  members who can open that Task.
- A Guide can be requested from a chosen profile without changing thread
  defaults, is readable by every member, and is rejected on submit unless
  every changed file is owned by exactly one step. A follow-up's Unchanged
  steps match its base word for word.
- An Outdated guide on an open PR always shows the amber banner.
- GitHub-specific code stays inside its domain. PR browsing has no CLI
  runtime dependency (only Guides run through CLI threads); existing CLI diff
  behavior remains covered.

Run focused Convex tests for access, imports, ordering, history, and cleanup;
frontend tests for navigation, temporary search, and stable diff state; then
`pnpm web:lint`, `cd apps/web && npx tsc --noEmit`, and `pnpm web:test:once`.
Visually verify through the existing app server. Do not start a server in
the primary checkout. Any CLI code change also requires the mandated version
bump. Preserve unrelated working-tree changes and do not commit implicitly.

## Evidence and limits

- [GitHub PR APIs](https://docs.github.com/en/rest/pulls/pulls): repository
  pagination and current PR detail/diffs; changed-files responses cap at
  3,000 files. A PR diff request does not pin an arbitrary historical SHA.
- [Repository contents](https://docs.github.com/en/rest/repos/contents):
  separate Contents permission and file-size limits.
- [Search API](https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests):
  installation-token support, separate search limits, 1,000-result cap,
  and incomplete results. Search payloads are not full PR detail records.
- [Setup URL security](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url):
  installation IDs alone do not establish connector authority.
- [GitHub App ownership](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app):
  organization-installed Apps continue when their installer leaves.
- [Failed webhooks](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries):
  GitHub does not automatically retry failed deliveries; repair is necessary.
