# Multi-repo projects

A project can be one folder with a git repo in each subfolder, e.g.
`~/code/acme/{old-app,new-app,packages/api}`. The project keeps one path, the
top folder, and threads run there. The CLI detects the repos inside it and
reports each one to Convoy as its own path entry.

Epic: OS-2520. Slice 0: OS-2521 (detection). Slice 1: OS-2522 (Changes,
History and revert per repo, [repo switcher](#repo-switcher)). Later slices
point branch, PR and worktree features at repo entries.

## Related specs

- [Shared environments → Projects](cli-shared-environments.md#projects): mount roots
- [Worktrees](cli-worktrees.md): the path entry model repo entries reuse
- [TUI](cli-tui.md#multi-repo-review-cli-01860-os-2521): the Add project review
- [Thread run diffs](cli-thread-run-diffs.md#multi-repo-folders): per-repo checkpoints and the grouped Changes card

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
native `title`: the count sits inside a link or menu item that owns focus).
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
  first. The title is the folder's label; the path in the toolbar is the
  repo's. Switching replaces the URL and starts the page fresh for that repo.
- A revert on a repo entry is refused while a thread runs in its folder
  (`isPathInUse` in `convex/cli/worktreeOps.ts`).

No CLI command: the switcher only picks which existing path entry the web
views target.

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
backend).

By hand: in a shared environment, mount `~/code/acme` holding `old-app`,
`new-app` and `packages/api`, then add `~/code/acme` itself in the TUI with
Reuse existing directory. It's accepted, and the review lists all three repos.
The web shows `3 repos` on the working-directory entry. A thread's agent names
the three repos without exploring. Clone a fourth repo into `acme/`, start a
run, and the web shows `4 repos`. Project settings → Worktrees lists the repo
keys with no setup script yet.
