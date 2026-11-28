# Multi-repo projects

A project can be one folder with a git repo in each subfolder, e.g.
`~/code/acme/{old-app,new-app,packages/api}`. The project keeps one path, the
top folder. The CLI detects the repos inside it and reports each one to Convoy
as its own path entry. A thread runs in the folder, or in one repo of it
([picking a repo](#picking-a-repo)).

Epic: OS-2520. Slice 0: OS-2521 (detection). Slice 1: OS-2522 (Changes,
History and revert per repo, [repo switcher](#repo-switcher)). Slice 2:
OS-2523 ([branch and pull requests](#branch-and-pull-requests) per repo).
Slice 4: OS-2647 ([picking a repo](#picking-a-repo), with worktrees). OS-2524
was canceled in its favor.

## Related specs

- [Shared environments → Projects](cli-shared-environments.md#projects): mount roots
- [Worktrees](cli-worktrees.md): the path entry model repo entries reuse
- [TUI](cli-tui.md#multi-repo-review-cli-01860-os-2521): the Add project review
- [Thread run diffs](cli-thread-run-diffs.md#multi-repo-folders): per-repo checkpoints and the grouped Changes card
- [Worktrees → Thread List Branch Display](cli-worktrees.md#thread-list-branch-display), [Thread PR badge](cli-thread-pr-badge.md), [Pull request watch](pull-request-watch.md): the single-repo rules this slice extends

## Discovery

`discoverRepositories(folder)` in `apps/cli/src/lib/git/repo.ts` is the only
implementation. `project add`, `project repos`, the TUI and the worker all call
it. The rules come from t3code's `WorkspaceFolders.ts`:

- If the folder has a `.git` entry (directory or file), the folder itself is the
  only repo (relative path `.`). Its children are not scanned, since they are
  submodules or vendored code.
- Otherwise each child folder is checked:
  - a child whose `.git` is a **directory** is a repo;
  - a child with a `.git` **file** is a linked worktree or submodule, not a
    repo, and is not scanned further;
  - a child with no `.git` has its own children checked the same way, one
    level only. So `acme/packages/api` is found and `acme/a/b/c` is not.
- Hidden folders, `node_modules` and `*-worktrees` are skipped at every level.
  Symlinked folders are not followed.
- The list is sorted by path and capped at 128 repos. Folders are checked 8 at
  a time.
- `listRepositoryPaths` finds the paths with `stat` and `readdir` only.
  `describeRepositories` then adds each repo's `origin` remote URL and
  checked-out branch (two git calls per repo). A user and token in a URL remote
  are dropped, so they are never printed, stored or sent.
- Relative paths are `/`-separated on every platform.
- A missing or unreadable folder, at any level, throws. A failed scan never
  reads as "no repos", so it never deletes stored repo entries.
- A folder inside a larger repo (`mono/packages`) has no `.git` of its own and
  reads as zero repos, though git features work there through git's own
  lookup. Accepted for slice 0.

The list is never stored in the CLI config: the folder on disk is the source of
truth. Ignoring a repo is a follow-up (OS-2613).

## When it runs

- **`project add`** prints the list after preparing the folder:
  `Git repositories (3):` and one `<relative path>  <remote>` line per repo; a
  single-repo folder prints `Git repository: <remote>`. With zero repos it
  prints `No git repositories found. Changes, History, branch, PR and worktree
  features won't be available.` It's information only; there's nothing to
  select. A folder the control account can't read (an isolated project) prints
  nothing, and neither does the guided (TUI) add, whose review already listed them.
- **`convoy project repos <path> [--json]`** prints the same list without
  registering. It resolves `<path>` the way `project add` does and, with
  `--env`, runs inside the managed environment.
- **TUI Add project review**, for Reuse existing directory only, on shared
  Local targets and Docker targets. It shows the same lines through `project
  repos` on the target ([TUI](cli-tui.md#multi-repo-review-cli-01860-os-2521)).
- **Worker register, and before each plain run.** For each configured path the
  worker runs `listRepositoryPaths`, which gives the prompt line, and returns.
  Describing the repos and calling `cli.profiles.syncRepos` happen in the
  background, chained per folder so publishes never overlap. A single-repo
  folder sends an empty list, which clears stale entries, and runs no git. The
  worker remembers the last list it sent per folder and skips the call when the
  description matches, so a run normally costs no mutation. A repo cloned later
  shows up on the next run without re-adding the project. A failed scan or
  publish is logged; a failed publish is retried on the next run. Neither
  blocks the run, even when the Convex connection is down.

## Agent context

When the working directory of a plain run is a configured multi-repo folder,
every plain run's prompt (so resumed sessions and every runtime see the current
list) gets one line, appended the same way as the attach command
line: `This folder contains git repositories: old-app, new-app, packages/api.`
There are no branches in it, since there can be many and the agent can read
them. Runtime commands (`/compact`) get no line, and neither does a single-repo
folder or a worktree.

## Server

Each detected repo is a `cliProfiles.paths[]` entry of the existing shape:

```ts
{ id, path, label: "<relative path>", gitRemoteUrl?, kind: "repo", parentPathId: "<top folder id>", branch? }
```

There is no new table or id scheme. `kind` widens to `"worktree" | "repo"`, and
absent still means a configured path; `isConfiguredPath` (next to the kind
validator) is the one test for that, shared by web and Convex.

- `cli/profiles.syncRepos` (public, session-owned, `CLI_THREAD`) takes
  `{ path, relativePath, gitRemoteUrl?, branch? }` per repo. It replaces the
  repo entries of the configured path at `path`, with ids stable by path. The
  label is `relativePath`, so a Windows path works too. It ignores a
  `relativePath` that is empty, `.`, absolute or has a `..` segment, a repo at
  the path of another entry, and an unknown folder. It caps the list at 128 and
  writes only when the merged list changed (`setProfilePathsIfChanged`).
- Paths are stored in one order: configured paths, repos grouped by folder in
  configured order, worktrees. The repo
  merge and the worktree merge both keep it, so neither rewrites the row the
  other just wrote (OS-1721).
- A repo entry is a worktree parent, and a configured folder that holds repos
  is not (`isWorktreeParent`, next to the kind validator). The worktree sync
  merges worktrees under a repo entry, and a repo leaving the folder takes its
  worktree entries with it.
- Register (`mergeProfilePaths`) keeps a folder's repo entries while the folder
  stays configured, and each kept repo's worktrees, the same way it keeps
  worktrees.
- A repo entry is a working directory ([picking a repo](#picking-a-repo)).
- The repo key for worktree setup scripts comes from each entry's
  `gitRemoteUrl`, so Project settings → Worktrees lists every repo's key
  (OS-2572–2574).
- A single-repo project has no repo entries, since the path itself is the repo.
  An older CLI never calls `syncRepos`, and the web behaves as before.

Cost: `syncRepos` reads the session and the profile and writes the profile row
only on a change: a repo added or removed, or a branch switched between runs.

## Web

The working-directory selector shows a folder with repos as `N repos` next to
it (`RepoCount`, `components/blocks/cli/profiles/repo-count.tsx`) and lists
its repos as [picking a repo](#picking-a-repo) says. The Connected CLIs
checkout list and the profile hover card list the repos under the folder,
indented, by relative path. The Connected CLIs row's `+N more` counts
configured paths only, never repo or worktree entries. The data comes from the
profile queries the views already subscribe to.

## Repo switcher

Slice 1 (OS-2522, CLI 0.187.0). Changes and History work on one repo entry at
a time through the existing worktree ops; there are no new ops and no merged
history. `RepoSwitcher` (`components/blocks/cli/profiles/repo-switcher.tsx`)
picks the repo, listing the folder's repo entries in stored order:

- **Thread sidebar, Changes tab.** In front of the view selector, for every
  view ([Thread run diffs](cli-thread-run-diffs.md#multi-repo-folders)). The
  pick is remembered per thread in browser storage
  (`convoy.thread-changes-repo`, newest 100 threads). The default is the first
  repo the newest loaded run changed, else the first repo. The plan said "the
  first repo with uncommitted changes"; knowing that would take an op per repo
  or a dirty flag the CLI keeps current, so the newest run stands in for it.
  The default settles once the thread's messages load and then holds until
  the user picks another repo or opens a file of one. Switching repos keeps
  Working tree and History (History closes its commit) and sends a run or
  range view back to Latest run (`useChangesRepo` in `lib/threads/hooks/`).
- **Worktree page** (`/threads?profileId&pathId&repo=<id>&view=changes|history`,
  built with `appRoute.projectThreadsWithPreselection`). `pathId` stays the
  folder, `repo` names the repo entry, and a missing or unknown `repo` shows the
  first and writes it to the URL. An unknown one also says so in a toast
  ("That repo is no longer in acme. Showing new-app."). The title is the
  folder's label; the toolbar drops the checkout path, since the switcher
  names the repo. Switching replaces the URL and starts the page fresh for
  that repo.
- **Revert dialogs** on a repo entry name the repo: "Revert new-app/readme.md?",
  "Revert all uncommitted changes in new-app?". An empty run timeline or Latest
  run for a repo the runs skipped reads "No run has changed packages/api yet."
- A revert on a repo entry is refused while a thread runs in its folder
  (`isPathInUse` in `convex/cli/worktreeOps.ts`).

No CLI command: the switcher only picks which existing path entry the web
views target.

## Branch and pull requests

Slice 2 (OS-2523, CLI 0.188.0). A thread in a multi-repo folder has a branch
and a Branch pull request per repo. A single-repo folder, a worktree, and a
thread on an older CLI behave as before.

- **Branch.** Where `reportExecutionBranch` runs today (run start, after the
  run, and on a mid-run VCS signal), the CLI sends `repos: [{ repo, branch? }]`
  instead of `branch`: each repo's relative path and checked-out branch, one
  `git rev-parse` per repo, 8 at a time. The repo list is the stat-only scan
  the checkpoints use (`folderRepoPaths`). The server stores the shared branch
  in `git.executionBranch` when every repo is on the same one, so the thread's
  `branch` and every surface that shows it work unchanged. Otherwise
  `executionBranch` is cleared and `git.repoBranches` lists each repo, capped
  at 128. When no repo is on a branch (all detached), both are cleared, as for
  a detached single repo. A report without `repos` clears both lists, and one
  with `repos` clears the single-repo `git.pullRequest`. The server drops a
  `repo` that is empty, `.`, absolute, has a `..` segment or is over 256
  characters, the same rule as `syncRepos`.
- **Display.** Where the thread shows its branch (the full row, the compact
  row's hover card, the composer's branch chip, Watch Tower rows and cards),
  it shows `N branches` while the repos differ (the distinct branches, a
  detached HEAD counting as one), and each repo as `old-app · main` on hover
  (`threadBranchLabel`, `lib/threads/repo-branches.ts`). It counts branches
  because `N repos` already means a folder's repos. A repo on a detached HEAD
  reads `no branch`. The composer's `N branches` chip copies nothing; it is
  focusable and lists the repos in a tooltip, as does the full row's label.
  In a composer bar below its md container width the chip shows the count
  alone, as the environment pill drops its label.
- **Pull requests.** After a run and on a mid-run VCS signal, the CLI runs the
  [PR lookup](cli-thread-pr-badge.md#capture-cli) in each repo with that
  repo's branch and remote, 4 repos at a time (`lookupRepoPullRequests`), with
  one 30-second deadline for the whole folder. A repo that hasn't answered by
  then is left out, and no lookup starts after it. A repo whose git read
  fails (moved or deleted after the scan) is left out alone. A repo on the branch
  `origin/HEAD` names is cleared without a forge call, so a cloned folder whose
  repos sit on `main` costs no `gh` runs; unlike a single repo, an open PR
  whose head is the default branch is not shown. `git clone` sets
  `origin/HEAD` and `git init` + `remote add` does not (`git remote set-head
  origin --auto` adds it), so a repo without it gets a forge call on every
  run. It reports
  `reportPullRequest({ repos: [{ repo, pullRequest? }] })` for the repos whose
  lookup succeeded: a PR sets that repo's, an absent one clears it, and a
  failed lookup leaves the repo out so its last-known PR survives. The
  server merges this into `git.repoPullRequests` (sorted by repo, capped at
  128), and a branch report drops the PRs of repos no longer in the folder.
  `git.pullRequest` is for single-repo threads only.
- **Badges.** Every surface with the PR badge (both row layouts, the composer
  bar, the Changes toolbar, Watch Tower) shows one badge per repo's PR, at most
  3, then `+N` with the rest in a native tooltip and its accessible name
  (`ThreadPrBadges`). Narrow surfaces show 1 and `+N`: a compact row, a
  composer bar below its 2xl container width, and a Watch Tower list row
  below `sm`, so the title, the meters and the task chip keep their room. A fourth
  PR is reachable from the compact row's hover card only, which lists every
  PR; folders with 4+ open PRs in one thread are expected to be rare. A badge's tooltip and
  the hover card's PR rows start with the repo: `new-app · PR #12 · Open — …`.
  The Attached pull request's muted `#N` is hidden when it is any of them.
  The sidebar Changes toolbar shows only the selected repo's PR, since the tab
  shows one repo (`repoScopedPullRequests`).
- **Task links.** A repo's PR mirrors onto the task as
  `pr:<provider>:<repo>:<number>` with identifier `new-app PR #12`, so two
  repos' PR #12 are two links. The link reads `new-app PR #12 · <title>`, the
  identifier first so repos stay apart. In the id, the repo is its path with each run
  of characters outside `[A-Za-z0-9_-]` turned into `-`, cut at 80, then `.`
  and the first 16 hex digits of the full path's SHA-256
  (`packages/api` → `packages-api.<hash>`), so two paths never share a link
  and the id stays within the 160-character rule. Every report of
  a present PR schedules the upsert, as for a single repo: an unchanged link
  writes nothing, and a task attached since the last report gets it.
- **Watch.** The watch stays on the thread's one Attached pull request
  ([Pull request watch](pull-request-watch.md)): the agent names the PR with
  `convoy threads watch-pr <url>`, so there is nothing to pick. When the
  watched PR is one of the thread's repo PRs, every watch message names its
  repo: `Update on pull request #12 (https://…) in new-app, which Convoy is
  watching…`. Its repository must still be connected to the project, as
  before.

No new CLI command or MCP tool: branches and PRs are reported by the worker,
and `watch-pr` already takes a PR URL.

Cost: no new mutation calls, queries or subscriptions. The two reports carry
the per-repo lists in the calls they already make. Thread list items grow by
each repo's branch only while the repos differ, and by each repo's PR. A run
start scans the folder with `stat` twice (branch report and checkpoint). Per
run, the CLI adds one `git rev-parse` per repo at start and end. At the end, a
repo on its default branch adds one `rev-parse` and one `symbolic-ref`; any
other repo adds two more of each plus a forge call. A post-run report
schedules one task-link upsert per repo PR when the thread has a task.

## Picking a repo

Slice 4 (OS-2647, CLI 0.189.0). A thread starts in the folder or in one of its
repos:

| You pick | Thread starts in | Can reach | Worktree option |
|---|---|---|---|
| `acme` (the folder) | `acme/` | all of `acme/` | none: there's no telling which repo you mean |
| `acme / new-app` (a repo) | `acme/new-app` | all of `acme/`, so `acme/old-app` too | the single-repo flow: `acme/new-app-worktrees/<name>` |

The boundary is the folder, not the repo. Picking a repo sets where the agent
starts and which repo the thread's git views follow; it doesn't fence the
agent in. Another repo's worktree: pick that repo, then a worktree. The
thread's working directory is the repo entry's absolute path, so the CLI's
`pathId → workingDirectory` pipeline needs nothing new, and a worktree's setup
script is its repo's (keyed by the repo entry's `gitRemoteUrl`).

- **Picker.** A folder row selects the folder, and its repos are listed as
  indented rows under it, on every screen. The plan had a hover sub-menu on
  desktop; review found it unreachable by touch and keyboard and unbounded for
  big folders, so the list itself carries the repos (decided 2026-11-28). The
  trigger reads `acme / new-app`, so two folders' `api` repos don't read the
  same, and a repo's worktree `acme / new-app / feat/x`. A narrow composer bar
  has room for one segment and shows the repo instead of the profile name
  (the branch chip next to it names a worktree); the full path is the
  trigger's accessible name. The menu opens on the side of the trigger with
  more room and stays there while a search shrinks the list. It opens with
  search focused (not on touch, where it would raise the keyboard). While
  searching, a repo row shows its folder (`acme / new-app`), since the folder
  row may be filtered out. After the menu closes, the profile hover card stays
  shut until the pointer leaves the trigger or focus moves on, so it doesn't
  cover the next control. On a phone it opens below its trigger.
- **Base-ref / worktree selector.** Hidden for a folder with repos, unchanged
  for a repo.
- **Server.** Thread creation, workflow runs, MCP `create_thread` and `convoy
  threads create --path-id` accept a repo entry, with or without a worktree. A
  worktree on a folder that holds repos is refused: "That folder holds several
  git repositories. Pick one of its repos (a kind "repo" path) to create a
  worktree". An agent-driven `move-worktree` from a folder thread is refused
  too, since the folder isn't the worktree's parent.
- **Thread git views.** History, branch, PR badge and PR watch follow the
  picked repo or its worktree, as for any single-repo thread. The Changes tab
  gets the [repo switcher](#repo-switcher) with the thread's own checkout first
  and selected by default (`threadChangesRepos`), then the folder's other
  repos, so a card file in `old-app` opens in its repo. On the own checkout the
  toolbar shows the thread's single-repo PR and review comments stay on. A
  worktree reads as its branch in the switcher, with its path in the folder as
  the title. Its repo's main checkout, listed after it, reads "This thread
  works in the feat/x worktree, so its runs don't track the new-app checkout."
  when empty. The switcher has no repo icon, so a name like `new-app` fits in
  a narrow sidebar; a worktree keeps the branch icon.
  Mentions name files from the agent's checkout: `../old-app/a.ts` from
  `new-app`, on the card (`checkoutLabel`, from the profile) and in the tab. A
  run from a CLI older than 0.189.0 has no `repos` and shows under the own
  checkout only. The per-run Changes
  card shows every repo the run changed (below).
- **Connected CLIs and the profile hover card** list a folder's repos as rows
  under it, each with its worktrees nested. A worktree under a repo shows its
  branch only; the path is the row's title.

### Folder access

The server names a thread's folder: `toExecutionWorkspace` sets
`projectFolder` when the thread is on a repo entry or a worktree of one and
the folder holds repos. `listPendingThreads` and `startRunResponse` carry it,
so the CLI never guesses from path containment (a repo registered on its own
inside a registered folder stays a single repo). Each plain run with a
`projectFolder` gets:

- one prompt line instead of the folder's: `You are working in new-app, inside
  the project folder /code/acme, which contains git repositories: new-app,
  old-app. You can read and edit all of them.`
- the folder as an additional directory (`RunnerExecutionOptions.additionalDirectories`):

| Runtime | Mapping |
|---|---|
| Claude Code | `additionalDirectories`, merged with isolation's writable roots |
| Codex (exec and app-server) | `-c sandbox_workspace_write.writable_roots=[folder]` in sandboxed modes; agent mode has full access already. Under isolation the writable roots are the profile paths, which hold the folder. A `-c` value replaces a `writable_roots` set in `~/.codex/config.toml` for that run, as isolation's already does (not verified on a Codex build) |
| Cursor, OpenCode, Antigravity | No directory flag. Agent mode allows everything; other modes ask, as for any path outside the cwd. Isolation fails fast for them ([sandboxing](cli-sandboxing.md)) |

Under isolation the profile's paths are already the writable roots, so the
folder is writable there with no new rule.

### Checkpoints

A repo or worktree thread checkpoints its own checkout plus every repo in the
folder, with slice 1's cost controls and grouping
([thread run diffs](cli-thread-run-diffs.md#multi-repo-folders)). An edit the
agent makes in `old-app` from a `new-app` thread shows on its card and can be
reverted there.

- Repo paths are relative to the folder: `new-app`, `old-app`, and
  `new-app-worktrees/x` for a worktree thread's own checkout.
- The own checkout keeps the single-repo capture's timeouts: the 5 s budget and
  the two-timeout drop apply to the folder's other repos only.
- A worktree thread skips the main checkout of its own repo (`acme/new-app`):
  the two share one ref store, and a run uses one pre/post ref pair for every
  repo, so the second capture would find the first's ref. An edit there doesn't
  show on the card. Per-worktree refs (`refs/worktree/…`) don't help: `git gc`
  in the main checkout prunes another worktree's.
- `cli.messages.complete` resolves every repo and worktree entry under the
  folder by its path in the folder, the thread's own checkout included.
- Undo: the card offers it when the run changed only the thread's own
  checkout. A run that also changed another repo has no Undo, as for folder
  runs; the Changes tab toolbar offers none.
- Known limit: a parallel thread editing `old-app` during this run shows up on
  this card too, as it does for folder threads.
- A revert in any repo of the folder is refused while a thread runs anywhere
  in it (`isPathInUse(…, "folder")`). Removing a worktree is refused only while
  a thread runs in that worktree.

### Vanished repo

When the picked repo's entry disappears (deleted, moved, past the 128 cap; a
re-clone gets a new id), the thread moves to the folder:

- `toExecutionWorkspace` returns the folder when the thread's entry is gone,
  it has no worktree, and its stored path lies inside a configured path (the
  nearest one, when configured paths nest), with
  `repoRemoved: true` and the old path as `previousPath`.
  `listPendingThreads` hands the CLI the folder, and `startRunResponse`
  repoints the thread (`legacyCheckpointsUnsafe`, so Undo of an older run
  can't restore a single-repo checkpoint into the folder).
- A deleted repo is still listed until a sync runs, so before starting a run
  the CLI checks that a repo thread's directory exists; if it doesn't, it
  awaits the folder's repo publish (`syncRepos(folder, { published: true })`),
  not the worktree scan behind it.
- The run gets a `workspace-recovered` notice with `change: "folder"` (divider:
  "repo removed") and the agent the usual workspace notice.
- A worktree thread whose repo vanished keeps the worktree recovery rules
  ([worktrees](cli-worktrees.md)).

The repo sync that runs before each plain run uses the folder for a repo
thread too, so a repo removed from disk leaves the list on the next run. A
changed list also scans each repo's worktrees (`scanAndSync`), so worktrees
under a repo appear after register and after a clone. The CLI keeps the list
it sent and the list whose worktrees it last scanned apart. Scans run in order
per folder, a scan counts only when every repo answered and no newer list went
out meanwhile, and a new list is always scanned again, so a failed `git
worktree list` or a failed sync is retried on the next run.

`convoy profiles list` prints each path's kind (`(new-app, repo)`), so a repo's
`pathId` for `convoy threads create --path-id` is easy to find.

Cost: no new queries, subscriptions or tables. `startRunResponse` patches the
thread once when its repo is gone. The CLI adds one `stat` per run for a repo
thread, one `git rev-parse` for its main checkout and one `realpath` of the
folder, and the folder's repos' status calls (slice 1's per-repo cost). A
changed repo list adds one `git worktree list` per repo and one
`cli.worktrees.sync` call.

## Verification

Unit tests: `lib/git/repo.test.ts` (discovery rules, cap, missing folder),
`project/validators.test.ts` (mount roots), `thread-processor.test.ts` (prompt
line), `convex/cli/profiles.test.ts` (`syncRepos`, register, thread refusal),
`worktree-list.test.tsx` (repo count), TUI `onboarding-review.tsx reuse-repos`.
Slice 1: `lib/git/checkpoint.test.ts` (multi-repo checkpoints),
`convex/cli/messages.test.ts` (repo ids), `convex/cli/worktreeOps.test.ts`
(repo in use), `run-changes-card.test.tsx` (groups), `run-diff-repos.test.ts`,
`use-changes-repo.test.tsx`, `worktree-changes-view.test.tsx` and
`thread-workspace.test.tsx` (switcher), `thread-processor.test.ts` (older
backend). Slice 2: `convex/cli/threads/runControl.test.ts` (shared and
per-repo branches, PR merge, pruning, task link ids),
`pullRequestWatches.test.ts` (repo in the message), `lib/git/repo.test.ts`
(`folderRepoPaths`, `readRepoBranches`), `lib/pull-requests.test.ts`
(default branch skips the forge, a failed lookup is left out, the deadline),
`thread-processor.test.ts` (per-repo reports), `thread-pr-badge.test.tsx`
(`+N`), `repo-branches.test.ts`. Slice 4: `convex/cli/profiles.test.ts` (repo threads, folder
worktrees refused, repo worktrees, vanished repo), `messages.test.ts` (own
checkout id), `worktreeOps.test.ts` (sibling repo in use),
`checkpoint.test.ts` (repo and worktree threads), `thread-processor.test.ts`
(folder line, extra directory, vanished repo), `worktree-op-processor.test.ts`
(published sync, repo worktrees), Claude Code `sdk.test.ts` and Codex
`runner.test.ts` (folder access).

By hand: in a shared environment, mount `~/code/acme` holding `old-app`,
`new-app` and `packages/api`, then add `~/code/acme` itself in the TUI with
Reuse existing directory. It's accepted, and the review lists all three repos.
The web shows `3 repos` on the working-directory entry. A thread's agent names
the three repos without exploring. Clone a fourth repo into `acme/`, start a
run, and the web shows `4 repos`. Project settings → Worktrees lists the repo
keys with no setup script yet.
