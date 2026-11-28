# Multi-repo projects

A project can be one folder with a git repo in each subfolder, e.g.
`~/code/acme/{old-app,new-app,packages/api}`. The project keeps one path, the
top folder, and threads run there. The CLI detects the repos inside it and
reports each one to Convoy as its own path entry.

Epic: OS-2520. Slice 0: OS-2521 (detection). Slice 1: OS-2522 (Changes,
History and revert per repo, [repo switcher](#repo-switcher)). Slice 2:
OS-2523 ([branch and pull requests](#branch-and-pull-requests) per repo).
Slice 3 points worktree features at repo entries.

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
- Only configured paths are worktree parents in this slice: the worktree sync
  ignores a worktree under a repo entry, and passes repo entries through.
- Register (`mergeProfilePaths`) keeps a folder's repo entries while the folder
  stays configured, the same way it keeps worktrees.
- A repo entry is not a working directory. Thread creation, workflow runs and
  MCP `create_thread` refuse one with "That path is a git repository inside a
  project folder. Start the thread on its parentPathId". The web's draft and
  preselection checks skip one the same way. `list_cli_profiles` says so in its
  description.
- The repo key for worktree setup scripts comes from each entry's
  `gitRemoteUrl`, so Project settings → Worktrees lists every repo's key
  (OS-2572–2574).
- A single-repo project has no repo entries, since the path itself is the repo.
  An older CLI never calls `syncRepos`, and the web behaves as before.

Cost: `syncRepos` reads the session and the profile and writes the profile row
only on a change: a repo added or removed, or a branch switched between runs.

## Web

Repo entries never appear as their own rows. The working-directory selector,
the Connected CLIs checkout list and the profile hover card show a folder with
repos as `N repos` next to it, and hovering the count lists the repos by
relative path (`RepoCount`, `components/blocks/cli/profiles/repo-count.tsx`, a
native `title`: the count sits inside a link or menu item that owns focus). The
names also join that row's accessible name through visually hidden text. The
Connected CLIs row's `+N more` counts configured paths only, never repo or
worktree entries.
The data comes from the profile queries the views already subscribe to.

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
(`+N`), `repo-branches.test.ts`.

By hand: in a shared environment, mount `~/code/acme` holding `old-app`,
`new-app` and `packages/api`, then add `~/code/acme` itself in the TUI with
Reuse existing directory. It's accepted, and the review lists all three repos.
The web shows `3 repos` on the working-directory entry. A thread's agent names
the three repos without exploring. Clone a fourth repo into `acme/`, start a
run, and the web shows `4 repos`. Project settings → Worktrees lists the repo
keys with no setup script yet.
