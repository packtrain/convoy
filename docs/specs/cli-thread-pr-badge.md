# CLI Thread PR Badge (OS-1370)

Thread rows show a pull-request badge for the PR whose head branch is the
thread's branch. Detection runs on the user's machine through the forge's
own CLI (`gh` / `glab` / `az` — the CLI agent already sits in the repo with
the user's logged-in tooling); the result is persisted on the thread as a
snapshot, so the badge survives worktree removal, branch switches, and the
CLI going offline. The web app never talks to any forge.

Model: a persisted last-known snapshot refreshed at run completion. A
derive-only model (resolving the PR live per render) was rejected because
convoy threads outlive their worktrees and the CLI is not always
connected.

This snapshot is the thread's **Branch pull request**. A PR a member attaches
because the work is about it is the separate **Attached pull request**; see
[GitHub integration → Pull requests in threads](github-integration.md#pull-requests-in-threads).

## User-visible behavior

- A thread row renders a PR badge when the thread has a stored PR snapshot:
  the state icon followed by the short PR ref (`#123`, GitLab `!123`) in the
  same state color. No snapshot → no badge, no placeholder.
- Badge states (one shared presentation helper,
  `lib/threads/pull-request.ts`, maps state → icon + color + label so every
  surface renders a given state identically):

  | State  | Icon (lucide)           | Color |
  |--------|-------------------------|-------|
  | open   | `GitPullRequestArrow`   | `text-emerald-600 dark:text-emerald-300/90` |
  | draft  | `GitPullRequestDraft`   | `text-muted-foreground` |
  | merged | `GitMerge`              | `text-violet-600 dark:text-violet-300/90` |
  | closed | `GitPullRequestClosed`  | `text-destructive` |

- Placement follows the branch, since the PR is branch-derived:
  - **Compact rows**: leading position in the title line, after the task-ref
    chip (when shown) and before the title, `size-3.5`.
  - **Full-layout rows**: in the bottom line's left group, before the branch
    icon + name.
  - **Thread composer**: the same badge renders in the top context bar,
    immediately after the workspace/branch information and before agent
    controls, so the PR remains reachable from the open thread without
    competing with title and thread actions in the page header.
  - **Changes toolbar**: the badge also renders in the thread sidebar's
    Changes toolbar, before the view toggles.
  - **Watch Tower standalone rows**: in the metadata line, between the project name and
    the branch. Watch Tower rows are themselves links, so the badge uses the
    component's `nestedInLink` variant — a `role="link"` span (anchor-in-anchor
    is invalid HTML) whose click stops propagation and opens the PR in a new
    tab without navigating the row.
- Watch Tower container rows omit PR badges. An origin branch does not imply
  a group-wide PR; see `watch-tower.md` (OS-1984).
- The badge is a link (`pointer-events-auto`) that opens the PR page in a new
  tab, or Convoy's PR reader when the GitHub integration connects the PR's
  repository to a project the viewer can read (`PullRequestLink`, see
  [GitHub integration](github-integration.md#reading)). Clicking it must not navigate to the thread; it is rendered as a
  sibling of the row's overlay `AppLink`, never inside it (see gotcha 17 in
  AGENTS.md). Cursor is `cursor-pointer`.
- Native `title` tooltip: `PR #123 · Open — <PR title>`.
- The compact-row branch hover card (`cli-thread-list.md`) gains a
  **Pull request** row when a snapshot exists: badge icon, state label, and
  `<ref> <PR title>` as an external link.
- The web renders provider-agnostically from `state`; the only
  provider-specific presentation is the reference label: GitLab merge
  requests read `MR !123`, everything else `PR #123`.

## Data model

Optional embedded value-object on `cliThreads` (no new Convex module, per the
entities-vs-embedded-fields guardrail): `cliThreadPullRequestValidator` in
`convex/lib/contracts/validators.ts` — `provider`
(github/gitlab/azure-devops/bitbucket), `number`, `title`, `url`, `state`
(open/draft/merged/closed), `headBranch`, `baseBranch`, `capturedAt`.

- `draft` is folded into the state union at capture time; the web never sees
  a separate `isDraft` flag. Providers that don't report a draft flag simply
  never produce `draft`.
- `bitbucket` is a schema slot only; capture is deferred (see Out of scope).
- Thread list queries (`toThreadItem` in `cli/threads/lib/validators.ts`)
  expose `pullRequest` on list items.
- Phase 2 only: a denormalized top-level `pullRequestState` mirror field
  maintained by the same write path, indexed as
  `by_profile_and_pullRequestState_and_lastActivityAt`, so the refresh sweep
  query is index-backed (nested fields cannot serve the sweep; `.filter()` is
  banned).

## Capture (CLI)

### At run completion (Phase 1)

After each run completes (immediately after the `complete` mutation in
`apps/cli/src/agent/app/thread-processor.ts`, so forge-CLI latency never
delays the visible run completion), the CLI first re-reports the execution
branch (`cli/threads/runControl.reportExecutionBranch` — a run that created/switched
branch must not leave the row showing the pre-run branch; see
`cli-worktrees.md`), then `lookupThreadPullRequest` in
`apps/cli/src/lib/pull-requests.ts`:

1. Skips unless the working directory is a git repo with a checked-out
   branch. Detects the provider from the remote URL host (`github` includes
   GHE-style hosts containing "github", `gitlab` likewise, Azure DevOps
   matches `dev.azure.com` / `*.visualstudio.com`). Unrecognized host →
   skip.
2. Runs the provider's CLI in the thread's cwd (the provider CLI resolves
   the repo from the same cwd; auth piggybacks on the user's existing CLI
   login — the convoy CLI stores no forge credentials):

   | Provider     | Lookup | Head-branch field | State normalization |
   |--------------|--------|-------------------|---------------------|
   | github       | `gh pr list --head <branch> --state all --json …` | `headRefName` | `MERGED`/`mergedAt`→`merged`, `CLOSED`→`closed`, open+`isDraft`→`draft` |
   | gitlab       | `glab mr list --source-branch <branch> --all --output json` | `source_branch` | `merged`, `closed`, open+`draft`→`draft`, else `open` |
   | azure-devops | `az repos pr list --detect true --source-branch <branch> --status all --output json` | `sourceRefName` (strip `refs/heads/`) | `active`→`open` (+`isDraft`→`draft`), `completed`→`merged`, `abandoned`→`closed` |

   Per-provider normalization lives in that one module; adding a provider
   must not touch the capture call site. Malformed rows are skipped
   per-row, never failing the lookup.
3. Candidate selection: rows whose normalized head branch equals the branch
   exactly; prefer an open/draft PR (most recently updated), otherwise the
   most recently updated match.
4. **Default-branch rule**: when the branch is the repo's default branch,
   only an *open* PR is attributed — merged/closed matches on main are
   reverse-merge noise.
5. Reports the snapshot (or an explicit clear) via
   `cli/threads/runControl.reportPullRequest`.

Failure semantics (strictly fail-soft, mirrors diff-summary capture):

- Provider CLI missing, unauthenticated, network error, rate limit → report
  nothing; the existing snapshot is kept (last-known-PR: transient failures
  must not drop an already-shown badge).
- A *successful* lookup that finds no PR clears the stored snapshot.
- PR capture never blocks or fails a run.

### Mid-run refresh on VCS signals (OS-1386, OS-1387)

Runtimes may signal mid-run repo-state changes through
`CliRuntimeDefinition.signalsVcsStateChange(chunk)` (dispatched via the
runtime registry). Claude Code flags `system` chunks with subtype
`vcs_state_changed` (commit created, branch switched) and
`code_change_published` (PR/MR published). When a streamed chunk matches, the
thread processor schedules the same branch + PR snapshot refresh used at run
completion, so the badge appears/updates as soon as the agent commits or
publishes instead of only after the run ends. Concurrent signals coalesce:
one refresh in flight at a time, with a single trailing re-run for signals
that arrived mid-refresh. Same fail-soft rules as completion capture.

### Refresh sweep (Phase 2, not yet implemented)

Open/draft snapshots go stale when the PR is merged or closed outside a run.
While connected, the CLI sweeps:

- On connect and every 5 minutes thereafter.
- Query: threads of the CLI's profile with `pullRequestState` in
  `("open", "draft")`, most recent activity first, capped at 20 per sweep
  (two indexed queries via the Phase 2 index).
- For each thread, resolve cwd from the profile path / worktree, dedupe by
  `(cwd, headBranch)`, and re-run the lookup above. `merged` and `closed`
  are terminal — never re-checked.

Until Phase 2 ships, a stale open badge self-corrects the next time the
thread runs.

## Backend

- `cli/threads/runControl.reportPullRequest` — session-authenticated mutation (same
  auth pattern as `reportExecutionBranch`): validates session ownership,
  profile match, and project permission; ignores reports from a session that
  no longer holds the claim (display metadata, not an error). Present
  snapshot → store, absent → clear. Writes through
  `cliThreadsRepo.setThreadPullRequest`.

### Task links

A present snapshot on a thread with an `associatedTaskId` schedules
`internal.tasks.core.upsertExternalLink` with a `pull_request` link built here
(id `pr:<provider>:<number>`, title truncated to the link text limit), which
logs one `external_link_changed` activity row. A **cleared** snapshot never
removes the link, an unchanged snapshot writes nothing (so the refresh sweep
does not churn task documents), and a link the task cannot accept — e.g. it is
already at the external-link cap — fails only the scheduled mutation, never the
report. The task write rides on this handler's `CLI_THREAD` authorization;
every role granting it also grants `TASK_UPDATE` today. Full rules:
`docs/specs/task-external-links.md`.

## Edge cases

- Worktree threads capture in the worktree cwd with the worktree's branch —
  the common, most reliable case.
- Threads with no branch (detached HEAD, non-git paths) never capture.
- Cross-fork PRs: the head-branch lookups match the branch name in the base
  repo's PR/MR list; fork-of-fork ambiguity is accepted for v1.
- Draft state surfaces wherever the provider's list payload reports it
  (GitHub `isDraft`, GitLab `draft`, Azure `isDraft`).
- Legacy threads predate the field; absence renders nothing.

## Out of scope (v1)

- Conflict / mergeability state — needs `gh pr view --json mergeable` per
  PR; revisit with PR checks.
- Bitbucket capture — no official CLI; a REST integration would require
  storing forge credentials, which breaks the "no forge credentials in the
  convoy CLI" rule, so it needs its own auth decision first. The
  `provider` union and the UI already accept `bitbucket`, so adding it later
  is capture-only work.
- Creating PRs from the app; this spec is display-only.

## Related Specifications

- `cli-thread-list.md` defines the thread-row anatomy the badge slots into.
