# Task checks and evidence

Status: in progress. The Checks tab's files shipped in OS-2289; the catalog,
Checklists, the task Checklist selector, and their MCP and CLI entry points shipped
in OS-2290; agent reporting, the transcript checks card, and results in the
Checks tab and task sidebar shipped in OS-2291; the Checks tab's Run checks
menu shipped in OS-2292; results on threads with no task shipped in OS-2293;
a result's value and artifact shipped in OS-2385. Prototype: `/playground/evidence`
(`apps/web/app/playground/evidence/`). Design thread: OS-2216.

An agent shows that its work is done by attaching evidence: screenshots,
recordings, logs, artifacts. A Check is a named question about the work ("All
tests pass", "Merge risk") that the agent answers with a status, an optional
value, a justification, and evidence. Checks live on the Task, so the whole team sees them.

## Terms

- **Evidence**: files or an artifact an agent attaches to its reply to show its
  work. Evidence may answer a Check or stand alone.
- **Check**: one entry in the project's check catalog. It has a key (`tests`),
  a label ("All tests pass"), and an instruction for the agent ("Run the test
  suite and attach the output").
- **Checklist**: a named, ordered set of catalog Checks ("Feature", "Bug fix").
  A Checklist references catalog Checks, it never copies them.
- **Check result**: one answer to one Check, reported in one Thread run. It
  always has a status, and may have a **value**: a short free-text answer
  ("High", "+3", "Frontend only"). The status is the judgment and gives the
  colour, the value is the answer, the note is the reason. The project writes
  the threshold into the instruction ("Low passes, Medium warns, High fails").

## Statuses

A Check result is `passed`, `warning`, `failed`, or `not_performed`. A
`warning` means the claim holds but a human should look ("adds one index on
`tasks`"). A justification is required for `warning`, `failed`, and
`not_performed` ("not possible in this environment", "user asked to skip")
and optional for `passed`. A Check with no result is pending. There is no
human accept or reject step.

- A warning counts as passed in pass counts (`4/7`), since its claim held,
  but its row icon is amber.
- A card or section's icon is red when any Check failed, amber when any
  warned, green when every Check passed, and the pending circle otherwise.
- Published as GitHub check runs (pull request checks), the statuses map to
  conclusions: `passed` → `success`, `warning` → `neutral`, `failed` →
  `failure`, `not_performed` → `skipped`.

## Which Checks apply

- Project settings map each task type to at most one default Checklist. A task
  of that type starts with it. A type with no mapping starts with no Checks.
  Mapping a type to a Checklist takes it off the Checklist that had it.
- Anyone who can edit the Task can switch its Checklist, or pick "No checks",
  from the task sidebar or from the thread's Checks tab.
- The Task stores only its Checklist choice: unset means the type default,
  `null` means no Checks. It never stores a requested set. Picking the type
  default stores unset, so the task follows later mapping changes. A picked
  Checklist that was deleted since reads as unset.
- Changing a task's type in the web app updates the task sidebar's Checks right
  away, before the server answers. `getForTask` also returns each Checklist's keys and
  types, the catalog, and `followsTypeDefault`. The task update's optimistic
  step runs the same pure derivation the server does
  (`convex/checks/lib/resolution.ts` → `retypeTaskChecks`), and a test keeps
  the two equal. Bulk type changes still wait for the server.
- The rows shown are derived: the Checklist's Checks in Checklist order, then
  every other Check that already has a result. So switching never loses work.
  - A Check with a result stays, whatever the new Checklist is.
  - A Check in the new Checklist with no result is added as pending.
  - A pending Check outside the new Checklist drops.
  - Switching to a Checklist that overlaps completely changes nothing.
- The agent may report a Check outside the Checklist when the user asks for it
  in the thread. A key outside the catalog needs a label. The row shows an
  "Added" badge.

## Nothing blocks

Checks never block marking a Thread or Task done, or opening a pull request.
Missing and failed Checks are visible on the Task instead.

## Reporting (agent side)

There is one mechanism. `convoy threads attach` (OS-2091) gains an optional
check:

```bash
convoy threads attach out.log --check tests --passed --note "412 passed"
convoy threads attach shot.png demo.mp4 --check ui --passed
convoy threads attach --check spec --not-performed --note "User asked to skip"
convoy threads attach --check backend --warning --note "Adds an index on tasks"
convoy threads attach mobile.png --check mobile --label "Mobile layout" --passed
convoy threads attach --check merge-risk --failed --value "High" --note "Touches auth middleware"
convoy threads attach --check test-cases --passed --value "12 cases" --artifact <artifactId>
convoy threads attach debug.png    # plain evidence, no check
```

- Files always land on the live reply's `attachments`, exactly as today, so
  the transcript keeps rendering them.
- `--check` also writes a Check result that points at those files. With
  `--check`, zero files is allowed.
- `--warning`, `--failed`, and `--not-performed` without `--note` are
  rejected.
- Reporting the same key again in a later run adds a newer result. The newest
  result is current, older ones are history.
- `convoy threads checks <thread>` lists the Checks that apply (keys, labels,
  instructions, current status). The attach footer in every prompt names this
  command, so a user can just type "run the checks" and the agent can find
  them.
  MCP `get_checks` returns the same list for a task or a thread. Both read
  `checks.checklists.getForThread`, which returns the task's Checks while the
  thread has one and the thread's own otherwise.
- The result and the files commit in one `cli.messages.attachToResponse` call,
  which runs `checks.results.report` as a nested mutation. A rejected check
  attaches nothing.
- On a thread with an attached task, the task must still be readable by the
  thread owner. A thread with no task owns the result (see Ownership).
- The label is the catalog's while the key is in the catalog; `--label` is
  used only for a key outside it. The note is trimmed, up to 2000 characters.
- `--value <text>` is trimmed, up to 500 characters; blank is no value. It
  never replaces a required note. Convoy computes nothing from it: no number
  type, unit, or threshold.
- `--artifact <artifactId>` takes an ID, never a name, since names are unique
  only within a task and the ID survives rename and move. The artifact may be
  on any task in the result's project, not only the result's own task, and
  its task must be readable by the thread owner. The result snapshots the
  artifact's name, like `threadTitle`, so reads never join artifacts. A
  renamed artifact keeps its old name on older results; a moved one still
  resolves. Deleting the artifact or its task leaves the result alone, and
  the pill then opens the artifact page's not-found state.
- `--value` and `--artifact` need `--check`.

| Error | When |
|---|---|
| `A <status> check needs a note` | `warning`, `failed`, or `not_performed` with no note |
| `Check '<key>' is not in the catalog, so it needs a label` | Unknown key, no `--label` |
| `--value needs --check` / `--artifact needs --check` | CLI, either flag with no `--check` |
| `Check value can be at most 500 characters` | Value too long |
| `Artifact '<id>' was not found` | Unknown or malformed ID, its task deleted, or the thread owner cannot read its task |
| `Artifact must belong to this project` | A readable artifact in another project |
| `Check key must start with a lowercase letter or digit and use only a-z, 0-9, - and _` | Bad key format |

## Requesting a run

Nothing is pushed into every prompt. Checks run when someone asks:

- The user types it in the thread. No composer control exists for it.
- The Checks tab's "Run checks" menu sends the thread a prompt for "Pending
  and failed" or "All checks". The prompt lists each Check's key, label, and
  instruction, plus the attach command: one call per Check with a status flag,
  `--note` for anything but passed, and `--value` or `--artifact` when the Check
  asks for one. It tells the agent to write each command out in full, since an
  unquoted shell variable reaches the CLI as one argument in zsh. It goes through `cli.messages.send`
  like a typed message, so it queues behind a running turn and inherits the
  thread's last mode, model, and effort.
  - "Pending and failed" takes Checks with no result or a current `failed`
    one. It is disabled when there are none.
  - The web app builds the prompt from the `getForThread` rows the tab already
    reads (`components/blocks/checks/run-checks-menu.tsx`). A toast confirms
    the send.
  - Only the thread owner gets the menu, since only the owner can send to the
    thread. A viewer of a shared thread sees the rows without it.
  - A Check outside the catalog is listed with the `--label` it needs, since
    the CLI rejects an unknown key without one.
- Later: on pull request creation or review, from a Workflow step.

## Ownership

- A result reported on a thread with an attached Task belongs to that Task.
- A result reported on a thread with no Task belongs to the thread. Such a
  thread picks its own Checklist from the Checks tab's Run checks menu
  (`cli.threads.core.setChecklist`, thread owner only). A thread has no task
  type, so it has no default: unset means No checks.
- Attaching a Task to the thread moves the thread's results to the Task, in the
  same mutation. Both attach paths do it: `cli.threads.core.attachTask` and a
  `cli.messages.send` that names a task (`cliThreadsRepo` →
  `setThreadAssociatedTask`, `markThreadPending`). The Task keeps its own
  Checklist choice; the moved results stay under the derivation rule above. If
  both sides answered the same Check, the newer result is current and the other
  goes to history: the move only sets `taskId`, and reads sort by `reportedAt`.
- A thread's task is attach-once (`cli-thread-task-attachments.md`), so there
  is no replace or detach to handle.
- A fork does not copy results.
- Deleting a thread (`softDeleteThread`) deletes the results it owns (no Task)
  and their `checkResultFiles` rows. The blobs stay, since the soft-deleted
  thread's message refs still hold them. Results that belong to a Task stay, and
  so do their files.

- A Pull request checks run (`cliThreads.pullRequestChecks`) owns nothing: its
  results belong to its PR's head revision
  ([github-integration.md](github-integration.md#pull-request-checks)), so an
  attached Task neither owns nor receives them, and deleting the thread keeps
  them. `getForThread` returns the PR's Checks for such a thread, with
  `pullRequest.headSha` set, and the Checks tab's Run checks menu has no
  Switch checklist.

## Visibility

- Results on a Task are visible to everyone who can see the Task, with their
  files, notes, and artifacts. Reads and signed file URLs are gated by task
  access, not by thread access. `cli.messages.getMessageAttachmentUrls` stays
  owner/share gated and is not used for check evidence.
- Each result records the reporting thread's title and owner at report time.
  The owner sees "Reported *14m ago* in “*thread*”" with a link. Anyone else sees
  "Reported *14m ago* by *name* in “*thread*”" as plain text, because threads are private
  (`cli-thread-sharing.md`). This matches what the task's `agentThreadWork`
  summary already shows teammates. On that thread's own page the line is only
  the time, with no link: the link would only reload the page and close the
  sidebar's task tab.
- Results owned by a thread are visible only to whoever can view the thread
  (owner or share). `getFileUrls` gates them the same way.
- A PR's results are visible to everyone in the project, like the PR.
- A read-only project role sees the Checklist selector disabled.

## UI

### Transcript

An agent reply with results renders a checks card shaped like the run's
Changes card (`run-changes-card.tsx`): a header with the pass count and a
summary ("Feature · 1 failed · 1 pending"), then one divided row per Check
with its status icon and label. Rows carry no time or thread name, since
they all come from this run. Checks the run did not answer show "Not
reported". A row expands to its note and files; image rows start expanded.
Files with no check render below as reply attachments do today.

- The card reads the thread's Checks (`getForThread`: its current task's, or
  its own), filtered to this reply's `messageId`. Results reported on a task the thread has since
  replaced don't show in the transcript. They stay on that task.
- A viewer without task access sees the reply's files as before, with no card.
- A reply that reported a result mounts even with no chunks or files yet, like
  an attachment-only reply, so a check-only report never hides behind the
  waiting indicator.

### Checks tab (thread sidebar)

- Labelled "Checks" (was "Evidence") because the Checks section leads the
  panel. The panel id stays `evidence` in code.
- A fixed tab, always listed, so the tab row doesn't shift once the thread
  loads (OS-2293). The panel shows a skeleton until the files, the thread doc,
  and its Checks have loaded, then empty states:
  - The project has no Checklist and the thread has no results: "No checks
    yet". The thread's owner gets an Add checks button to Settings → Checks if
    they are a project admin, and is told to ask an admin otherwise. A viewer
    gets the text only.
  - The project has a Checklist but the thread's owner picked No checks: the
    Checks heading with "No checks", plus the Run checks menu for the owner.
  - No files outside Checks: the Files heading with "No files attached yet".
- The panel owns its reads (`EvidencePanel` → `useThreadEvidence`), so the
  files and Checks subscriptions run only while the tab is open.
- Thread surfaces (this tab, the transcript's checks cards) read
  `getForThread` by thread id (`components/blocks/checks/use-thread-checks.ts`),
  so the read starts with the thread doc instead of waiting for it to name the
  task, with no second round trip on reload. The panel still waits for the
  thread doc, which says who owns the Checks. Only the task
  sidebar reads `getForTask`, so only it gets the task type change's optimistic
  update; thread surfaces follow the server.
- On a thread with no task, the Run checks menu's prompt says "for this thread"
  and Switch checklist sets the thread's own Checklist, with no "Default".
- Checks section: heading, pass count (`4/7`), and the Run checks menu
  (Pending and failed, All checks, Switch checklist with the current one
  marked). Rows are a plain list, not a table: status icon, label, value,
  "Added" badge when relevant, and time of the current result.
- A row expands to one card; see "The open row" below. Superseded results stay
  reachable under its older-results toggle. Rows whose current evidence includes an image or video start
  expanded, also when the result arrives while the row is on screen, until the
  user toggles the row.
- Other files: evidence attached without a check, newest first, each group
  headed by its time.
- Images and videos open in the existing attachment lightbox.
- Shipped in OS-2292: the Run checks menu. Switch checklist lists No checks,
  then each Checklist with the type default marked "Default", and calls
  `tasks.core.setChecklist` like the task sidebar's selector. A read-only role
  or an archived task disables those items and shows the reason, while
  Pending and failed and All checks stay available. With No checks,
  the owner still sees the Checks heading with the menu, so a Checklist can
  be picked from the tab.
- Shipped in OS-2291: the Checks section and "Other files", which drops files
  that answer a Check.
- Shipped in OS-2289: the tab with files only, headed "Files". A group is one
  agent reply, rendered by the transcript's `ResponseAttachments`. In the
  full-width layout the content is centered and stops growing at the
  transcript's width (`max-w-3xl`). The list
  comes from `cli.messages.listAgentAttachmentsByThread`, which reads the
  thread's newest 500 `cliMessageAttachmentRefs` with `role: "assistant"`
  (`by_threadId_and_role`), so a user's composer uploads never show here and
  never push agent files out of the window. Every ref write stamps the
  message's role; refs written before OS-2289 get it from the
  `backfillCliMessageAttachmentRefRole` migration (in `migrations:runAll`),
  and until it runs their files are missing from the tab.

### The row and its card (OS-2385)

All four surfaces (transcript card, PR page cards, Checks tab, task sidebar) share
`CheckRow`. The design was settled in `/playground/check-rows`.

- The header is one button on one line: status, label, value, badge, time,
  chevron. The value is muted with tabular numbers, truncated with an ellipsis
  and capped at half the free space so the label keeps the rest. The full
  value is its title.
- Open, the row shows one card (`rounded-md bg-muted/50`, the header's radius) as wide as the row,
  split by dividers into sections. Each has a small muted label over content in
  the body's one type size, and shows only when it has something:
  - **Value**: the full value, only when the header cut it off (measured with
    a `ResizeObserver`), so a short value is never shown twice.
  - **Description**: the note, with no "Failed:" prefix; the header's icon
    gives the status.
  - **Attachments**: the artifact pill, then the files. The pill opens
    `appRoute.projectArtifact(...)` and its context menu offers Copy ID, like
    the task's own artifact pills; outside a project route it is plain text.
    Files use the transcript's attachment cards, and inline HTML pages show as
    their card only (the reply shows the page).
  - **Older results**: shown by the footer's toggle. Each is its status icon,
    its value (or status word) and note, its reported line, then its files
    and artifact pill.
  - Footer, last, in small muted text: `Reported 14m ago` for a result
    from the thread being viewed, else `Reported 14m ago in “Thread title”`
    (the time lowercased mid-sentence: `Reported just now`). A
    teammate's result adds `by Name`, and its title is plain text, since
    threads are private. On the right, "N older results" toggles the section
    above.
- The transcript card is one reply's own results, so it has no footer or
  Older results. It is already a framed table, so its parts stack plainly
  under the label, without the tinted card or dividers.
- The PR page's cards (Pull request checks and a task's Evidence,
  `ChecksCard`) use the transcript card's framed layout: full-width rows
  inset 12px, in line with the header's icon box and chevron, and parts
  stacked under the label. They keep the footer and Older results.

### Task sidebar

A Checks section between the metadata rows and Subtasks: heading with the
pass-count badge, a help icon that opens the public Checks docs
(`apps/docs/content/docs/using/checks.mdx`, also on the Checks tab's
heading), and a badge-style Checklist selector (No checks, then each
Checklist, the type default marked "Default"). There is no Run checks control
here. Rows are compact (icon and label) and expand the same way as in the
Checks tab. With no Checks the section shows "No checks". A project with no
Checklists has nothing to pick, so the section is hidden unless the task has
results. A read-only role, or an
archived task, shows the Checklist name as plain text with the reason as its
title.

### Project settings

A Checks section holds the catalog (key, label, instruction) and the
Checklists (name, ordered Checks, task types that default to it). Anyone who can
see the project's tasks can read both; only project admins (`project:update`)
edit them. Clicking a row opens its edit dialog; the `⋯` menu also holds
Delete. A Checklist row shows its default task types as task type pills. The
row's edit button sits under the pills, so the pills are buttons of their own
rather than nested in it. The
Checklist dialog holds the name and the Checks in order, reordered by drag,
with an "Add checks" button below that opens a checkbox dropdown. A
"Defaults" button next to "Create checklist" opens one row per task type, plus
Pull requests, each rendered as its pill with a Checklist picker ("No checks"
or a Checklist). One picker per row makes it visible that a type has one
default; moving a type off a Checklist happens in plain sight, not as a side
effect of ticking it elsewhere. Clicking a default's pill on a Checklist row
opens the same popup. Save sends every row in one `checklists.setDefaults`
mutation, so the defaults change together or not at all.
The Checklists group stays hidden until the project has a Check or a
Checklist, since a Checklist needs Checks to group. Until then the Checks group
drops its heading too, leaving only the "No checks yet" empty state.

- A key is 1–40 characters of `a-z`, `0-9`, `-` and `_`, starting with a letter
  or digit, unique in the project. It cannot change after creation, because
  Checklists and results reference it. The label (up to 100 characters) and
  instruction (up to 2000, may be empty) can.
- Deleting a Check removes its key from every Checklist.
- Checklist names are unique per project, ignoring case and extra spaces. A
  Checklist's Checks must exist in the catalog; duplicates are dropped.
- Deleting a Checklist leaves tasks that picked it on their type default.
- A project holds up to 50 Checks and 20 Checklists.

| Error | When |
|---|---|
| `Check key must start with a lowercase letter or digit and use only a-z, 0-9, - and _` | Bad key format |
| `A check with this key already exists` | Duplicate key |
| `Check label cannot be empty` | Blank label |
| `A checklist with this name already exists` | Duplicate name |
| `Unknown check '<key>'` | A Checklist names a key outside the catalog |
| `Checklist must belong to the task's project` | Picking another project's Checklist |

### Agents (MCP and CLI)

Agents manage the same catalog and a task's Checklist without the UI, with
the same permissions and errors:

- MCP: `list_checks`, `create_check`, `update_check`, `delete_check`,
  `list_checklists`, `create_checklist`, `update_checklist`,
  `delete_checklist` (`docs/specs/mcp-server.md`). A Check is named by ID or
  key, a Checklist by ID or exact name.
- MCP `update_task` takes `checklist` (ID, name, or `null` for no checks).
  `get_task` shows the Checklist in effect and its Checks when the project
  has Checklists, instead of the raw `checklistId`.
- MCP `get_checks` takes a `taskId` or a `threadId` and returns the Checks
  that apply, with instructions and current status (with its note, value, and
  `artifactId`): the MCP twin of
  `convoy threads checks`. Reporting stays CLI only (see Reporting).
- CLI: `convoy tasks update <task> --checklist <id|name>` and `--no-checks`.

## Data model

Shipped (OS-2290):

- `checkDefinitions`: `projectId`, `key`, `label`, `instruction`, indexed
  `by_projectId_and_key`. API: `checks.definitions.{list, create, update, remove}`.
- `checklists`: `projectId`, `name`, `normalizedName`, `checkKeys[]`,
  `taskTypeKeys[]`, indexed `by_projectId_and_normalizedName`. A task type
  appears in at most one Checklist per project. API:
  `checks.checklists.{list, create, update, remove}`.
- `tasks.checklistId`: `v.optional(v.union(v.id("checklists"), v.null()))`, set
  by `tasks.core.setChecklist`. `checks.checklists.getForTask` returns the
  selector options, the Checklist in effect, and the derived rows.

Shipped (OS-2291):

- `checkResults`: `projectId`, `taskId`, `threadId`, `messageId`, `checkKey`,
  `label` (snapshot), `status`, `note?`, `value?`, `files[]` (the reply attachment
  metadata), `artifactId?` and `artifactName?` (snapshot, OS-2385), `threadTitle` and `threadOwnerId` (snapshots), `reportedAt`.
  Indexed `by_taskId_and_reportedAt`. Rows are never edited.
- `checkResultFiles`: `resultId`, `storageId`, indexed by both. It exists only
  so `convex/lib/storageRepo.ts` sees a blob a result still shows: thread
  deletion then keeps the file. Reads use `checkResults.files`, never this table
  or the thread's messages.
- `getForTask` rows carry `instruction`, `added` (outside the Checklist in
  effect, derived on read), and `results` newest first, each with the reporter's
  name and `reportedByViewer`. It reads the task's newest 500 results.
- `checks.results.getFileUrls({ resultId })` signs a result's file URLs for
  anyone who can see its task.
- `tasks.core.permanentlyDelete` deletes the task's results, their file rows,
  and blobs nothing else references.

Shipped (OS-2293):

- `cliThreads.checklistId`: `v.optional(v.id("checklists"))`. Unlike
  `tasks.checklistId` it has no `null`, because a thread has no type default
  for unset to follow.
- `checkResults.taskId` is optional: unset means the reporting thread owns the
  result. Indexed `by_threadId_and_taskId_and_reportedAt`, which serves the
  thread's own results (newest 500), the attach move, and thread deletion.
- `checks.checklists.getForThread({ threadId })` returns the same shape as
  `getForTask`. With no task, `followsTypeDefault` is false and no Checklist
  is the default.

Shipped (OS-2400, pull request checks):

- `checklists.pullRequests` (at most one per project) and
  `checkDefinitions.showInPullRequestList`, both optional booleans.
- `cliThreads.pullRequestChecks: { headSha }`, set only at creation.
- `checkResults.pullRequest: { ref, headSha }`. Indexed
  `by_projectId_and_pullRequestRef_and_reportedAt` for the card's newest 500,
  and `by_projectId_and_pullRequestRef_and_checkKey_and_reportedAt` for the
  list's current result per Check. The thread index is
  `by_threadId_and_taskId_and_pullRequestRef_and_reportedAt`, so a thread's own
  results, the attach move, and thread deletion skip PR results.
- `getForTask`/`getForThread`/`getForPullRequest` rows carry each result's
  `headSha`, and the answer carries `pullRequest: { headSha }` (the stored PR's
  current head, or null) when a PR owns the Checks.

## Later

- Rerunning a Task's Checks from its pull request. The PR page already
  shows them as Evidence ([github-integration.md](github-integration.md)).
- Marking a passed Check stale when a later run changed files.
- A follow-up prompt for missing Checks when a run finishes.
- Evidence-type requirements per Check (for example, `ui` needs an image or
  video).

## Open questions

- A retried or edited run deletes its reply. Should that reply's results go
  with it? Proposed: yes, they prove discarded work.
- An Added Check that is still pending drops on a Checklist switch. Keep it
  instead?
