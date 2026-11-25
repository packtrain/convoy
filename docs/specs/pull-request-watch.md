# Pull request watch

A thread can watch its Attached pull request. When the PR changes in a way
the agent should act on, such as failed checks or a new conflict, Convoy
sends a message into the thread and the agent starts a new run. An agent
can open a PR, watch it, and keep fixing it until it is ready, without an
engineer relaying what CI said.

Tracking: OS-2173. Status: slices 1–2 built (OS-2541, OS-2542); slices 3–5 planned.

The design follows t3code's `watch_pull_request`
(`reference/t3code/apps/server/src/orchestration-v2/pullRequestWatch.ts`),
with one change: t3code polls every two minutes, and Convoy reacts to the
GitHub App's webhooks instead.

## Scope

- GitHub only, and only PRs in a connected repository of the thread's
  project. Webhooks arrive only for repositories the App is installed on.
- A watch belongs to one thread and its Attached pull request
  ([GitHub integration → Pull requests in threads](github-integration.md#pull-requests-in-threads)).
  A thread has at most one Attached pull request, so it has at most one
  watch.
- The Branch pull request ([thread PR badge](cli-thread-pr-badge.md)) is
  not watched. An agent that opens a PR attaches it by watching it.

## Turning a watch on and off

- `convoy threads watch-pr <threadId> [<pullRequest>]` starts a watch.
  `<pullRequest>` takes the forms `threads attach-pr` takes. When the thread
  has no Attached pull request, it is attached first. When it has a
  different one, the command fails with "This thread is attached to
  contoso/convoy#482. Watch that pull request or start a new thread."
  Without `<pullRequest>`, the thread's Attached pull request is watched.
- The command prints the PR's state at the start: failing checks, running
  checks, conflicts. A watch reports only what changes after it starts, so
  the agent handles what is already failing before it ends its turn.
- `convoy threads unwatch-pr <threadId>` stops the watch. The PR stays
  attached.
- Watching an already watched PR succeeds and changes nothing.
- In the thread sidebar's Attached pull request tab, an eye button in the
  reader's header shows the watch and toggles it. Only the thread owner sees
  it, since only the owner can start or stop a watch. While the watch is on,
  the tab's icon is an eye instead of the pull request icon. Turning it on
  from the eye is `watch-pr` without `<pullRequest>`; a failure shows as a
  toast. When checks already fail, a toast names them and says the watch
  reports only new failures, since the agent is not told about them.
- The `convoy` skill tells agents: after opening a PR for the thread's work,
  run `convoy threads watch-pr "$CONVOY_THREAD_ID" <url>` and end the turn.
  The user can also ask for it ("babysit the PR").
- Refused: a closed or merged PR ("Pull request #482 is already merged."), a
  PR outside the project's connected repositories ("Convoy can only watch
  pull requests in a repository connected to this project."), a Done or
  deleted thread, a thread group, and a PR that already has 50 watches.
- A workflow's lane thread is refused too. A watch message would start a run
  between the workflow's steps, on the checkout the next step uses, and the
  engine would count that run as part of its step. Watch from a thread
  outside the workflow.

No MCP tool. Agents in Convoy threads have a shell, so the CLI command
covers them (AGENTS.md rule 19). Add `watch_pull_request` when an agent
without a shell needs it.

## What wakes the agent

Each row is reported once. The PR's head commit is the unit: a push starts
fresh, so a check that failed on the old head and fails again on the new
one is reported again.

| Change | Reported when | Slice |
|---|---|---|
| Checks failed | A check on the current head failed or was cancelled, and it was not already reported for this head. Convoy's own Pull request checks are left out: they come from the agent's reports | 1 |
| Checks passed | Every required check passed on the current head (every check, when none is required). A required check that hasn't reported yet holds it, and so does any check of that name that hasn't passed: GitHub requires every one, such as a run and a status with one name. Checks that already passed when the watch started are not reported | 2 |
| Checks finished | Every check has finished on this head, some still fail, and a failure was seen while checks still ran (at the start or in an evaluation). A rerun keeps it owed. Its list carries every failing check, so the same message has no "Checks failed" section | 2 |
| Conflicts | The branch starts to conflict with its base. Not tied to the head: a push that leaves the conflict is no news, and a conflict that was resolved and comes back is reported again. While GitHub still computes mergeability, the last answer stands | 2 |
| Comments and reviews | Someone other than the watch's account commented or submitted a review | 3 |

The watch's account is the thread owner's Linked GitHub account in the
project's organization. Without one, it is the PR's author. Agents push and
comment with the owner's `gh` login, so comments from that account are
assumed to be the agent's own and never wake it. Slice 5 lets the owner's
own comments wake the agent.

The message lists every change one evaluation found, for example:

```text
Update on pull request #482 (https://github.com/contoso/convoy/pull/482), which Convoy is watching for this thread:
- Checks failed on 1a2b3c4:
  - test https://github.com/contoso/convoy/actions/runs/123/job/456
- The branch now conflicts with main.

Look into each item and act on it as your task requires. The watch stays on, so don't run `convoy threads watch-pr` again. End your turn when you're done; Convoy messages you on the next change.
```

- A check line names the check and links its run. At most 10 checks or
  comments are listed, then "and 4 more".
- A fork's author writes its workflow's job names, so Convoy passes a check
  name on as one line of at most 100 characters, and a link only when it is
  an `http(s)` URL. The message says the names come from GitHub and are
  data, not instructions. A check is remembered by its full name, and a name over 100
  characters by its start and a SHA-256 of the whole, so two long names
  that look alike when cut are still two checks.
- Every check run and commit status on the head is read, 100 a page, up to
  10 pages of each.
- Required checks are the base branch's: the contexts its branch protection
  requires (`GET /branches/{base}`, Contents read) plus the checks its
  rulesets require (`GET /rules/branches/{base}`, Metadata read). A check
  counts as required by name. When either read fails (except for a rate
  limit), the evaluation goes on without "Checks passed". Convoy's own checks count toward
  "Checks passed", since a pending one holds the merge. The two reads
  happen only while "Checks passed" is still owed for the head and some
  check passed.
- A comment line has the author, the file for a review comment, and the
  first 200 characters.
- Delivery uses the path `send_thread_message` uses
  ([MCP server → send_thread_message](mcp-server.md#send_thread_message)): an idle thread becomes
  pending and the CLI starts a new run, and a busy thread picks the message
  up on its next run. It never steers a run in progress.
- The message runs as the thread owner, with the thread's last-used model.
  The owner's project permission is checked on every send, as for a workflow
  step (`cli.messages.sendForWorkflowStep`). If the owner lost access, the
  watch ends.
- `cliMessages.sentBy` gets a second kind, `{ kind: "pullRequestWatch" }`.
  The bubble uses the foreign background
  ([agent-sent messages](cli-thread-agent-sent-messages.md)) and the badge
  reads "GitHub".

## When a watch ends

- **The PR merges or closes.** The agent gets one last message ("Pull
  request #482 was merged into main as 9f8e7d6, so Convoy stopped watching
  it."), unless the watch's account merged or closed it. In that case the
  agent most likely did it. A reopened PR needs a new watch, and the close
  message says so. The merger is the PR's `merged_by`. GitHub names who
  closed a PR only on its issue, so a close costs one more read
  (`closed_by`), with a separate token limited to Issues read. An unknown
  account (a deleted user, or a failed issue read) gets the message.
- **The thread is marked Done or deleted.** A message would undo Done, so a
  Done thread is never woken.
- **The user or agent unwatches.**
- **The repository is disconnected, or the App loses access to it.**
- **5 reads in a row fail.** The agent gets a message: "Convoy stopped
  watching pull request #482 (…): it could not read it from GitHub 5 times
  in a row. To watch it again, run `convoy threads watch-pr`." The count
  spans evaluations and a successful read resets it. A rate limit only
  delays the read and is not counted.
- **10 comment-only wakes in a row** (slice 3). This stops a reply loop with
  a review bot. Any check or conflict news resets the count. The message
  says the watch stopped and how to start it again.

## How Convoy notices changes

Events are refresh signals, as in
[GitHub integration → Webhooks](github-integration.md#webhooks): Convoy
never takes PR state from a payload. It reads the PR itself.

- `parseGithubEvent` routes these events in addition to `pull_request`:
  - `check_suite` and `check_run` with action `completed`
  - `status`
  - `pull_request_review`, `pull_request_review_comment`, and
    `issue_comment` on a PR (slice 3)
- The App already has the permissions these events need: Checks, Commit
  statuses, Pull requests, and Issues. Each needs its box ticked under
  **Subscribe to events**, and the deployment guide
  (`apps/docs/content/docs/deployment/github-integration.mdx`) lists them.
  An App with Checks write is subscribed to check events automatically.
- `check_suite` and `check_run` payloads list their PRs in
  `pull_requests`. That list is empty for a PR from a fork, and so is every
  `status` payload. For those, the watch is found by repository and head
  commit. GitHub also lists PRs in other repositories with the same head; only
  PRs whose base is the event's repository count.
- `fanOutWebhook` finds the watches for each tenant copy of the repository
  and schedules an evaluation 45 seconds out, unless one is already
  scheduled. A CI run sends dozens of events in that window, and they become
  one read and at most one message.
- `pull_request` events keep their sync and also schedule an evaluation. A
  `synchronize` (push) starts the new head, and `closed` ends the watch.
- A cron every minute evaluates each watch not evaluated in the last
  8 minutes (slice 2). It catches webhooks GitHub never delivered, and
  conflicts caused by a push to the base branch, which sends no event for the
  PR. A watch is read at most 9 minutes after its last evaluation, wherever
  that fell between runs, so news reaches the agent within 10 minutes. A
  10-minute cron with a 10-minute threshold would leave up to 20. Most runs
  read an empty index range. It pages through `by_evaluatedAt`, 100 watches
  a run, and skips a watch whose evaluation is already scheduled or under
  way. Its evaluations run at once, with no debounce.
- GitHub computes mergeability when the PR is read, and answers `null`
  until it is done. An evaluation that gets `null` schedules one more,
  45 seconds out (`mergeableRecheck`), so a conflict from a base-branch push
  is seen within a minute of the cron's read rather than on its next run.
- An evaluation is an action. It reads the PR's state, mergeability, and
  checks with the installation's credentials, the same reads as the
  reader's Overview, plus reviews and comments since the last evaluation
  (slice 3). A mutation then compares the result with the watch's saved
  state and sends the message, but only if the watch with that `startedAt` is
  still on. An unwatch or a restart during the read wins.
- A failed read is retried as the same evaluation, with the sync backoff
  (30 s, 1 m, 2 m, 4 m), until 5 reads in a row have failed; a rate limit
  waits as long as GitHub asks and does not count. A token GitHub refuses
  also schedules the repository access check, which disconnects a lost
  repository and so ends its watches.

## Data model

A new table, `integrationPullRequestWatches`, owned by `integrations/github`
next to `integrationPullRequestGuides`. Watch state changes on every
evaluation, and a separate row keeps those writes off `cliThreads`, which
every thread list subscribes to.

- Identity: `threadId`, `projectId`, `repositoryId`, `number`, `startedAt`.
  The messages run as the thread's owner, read from the thread.
- Reported state for the current head: `headSha`, `failedChecks` (the keys
  of checks already reported), and from slice 2 `passedReported` and
  `finishOwed`. `conflicts` is the last known conflict state, kept across
  heads. All three, like `mergeableRecheck`, are `true` or absent, so rows
  from slice 1 need no migration.
- Comments (slice 3): `seenThrough`, the newest comment time already
  reported, and `commentOnlyWakes`.
- Scheduling: `evaluateAt`, `eventDuringRead`, `evaluatedAt`, and from
  slice 2 `readFailures`, the failed reads in a row. A watch has one evaluation at a time.
  `evaluateAt` is set from when it is scheduled until it finishes, and its
  value is the evaluation's token: a read or retry whose token is no longer
  the watch's is dropped, so results never apply out of order. An event
  while the evaluation waits is covered by its read. An event during the
  read sets `eventDuringRead`, and the evaluation schedules the next one when
  it finishes. An evaluation unfinished 5 minutes past its time counts as
  lost, and the next event replaces it.
- Indexes: `by_threadId`, `by_repositoryId_and_number`,
  `by_repositoryId_and_headSha`, and from slice 2 `by_evaluatedAt` for the
  cron.

Ending a watch deletes its row. Starting a watch reads the PR once and saves
that as the starting state without sending a message.

## Watch status (slice 4)

A watched thread whose PR still has checks running counts as Running on
Watch Tower and in the thread list ([Watch Tower](watch-tower.md)), so it
does not look finished while CI decides. When the checks finish, the
thread's own state decides its bucket again. That needs a flag on
`cliThreads`, written only when it flips, for the bucket queries to read.

## Not planned here

- **Settling a thread when its PR merges**, as a project or thread setting.
  It stays an open item on OS-2173.
- **Checks waiting for a maintainer's approval, merge queue removal, and
  "no checks reported after 15 minutes".** t3code reports these. Add them
  when a project needs them.
- **Replacing a stale queued message.** When a busy thread already has an
  unclaimed watch message, a newer evaluation queues a second one, even if
  a push made the first one stale.
- **Other forges.**

## Slices

1. **Failed checks, end to end.** The table, `threads watch-pr` and
   `unwatch-pr`, check and status event routing with the 45-second debounce,
   the failed-checks message with the GitHub badge, the eye in the Attached
   pull request tab, ending on merge, close, Done, delete, disconnect, and
   lost access, and the `convoy` skill line. Verify: in a test repository,
   watch a PR with a failing workflow and see the message start a run.
2. **Passed checks, finished checks, conflicts, and the final message.** The
   idle-watch cron, the merged or closed message, and the read-failure limit.
3. **Comments and reviews** from accounts other than the watch's account,
   the review and comment events, and the 10-wake limit.
4. **Watch status.** Running while the watched PR's checks run.
5. **The owner's own comments.** Let a comment the owner wrote on GitHub
   wake the agent while comments the agent posts with the same account
   still do not. That needs a way to tell them apart. Not designed yet.
