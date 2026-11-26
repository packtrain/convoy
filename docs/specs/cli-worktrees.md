# CLI Git Worktrees Specification

Threads can run in isolated git worktrees: the user picks an existing
worktree or a base ref for a new one when starting a thread; the CLI creates
the worktree on claim, discovers externally-created worktrees, and fulfills
web-requested worktree operations.

Ticket: OS-1106.

## Related Specs

- Context selectors (base-ref selector UI): `docs/specs/cli-thread-context-selectors.md`
- Draft persistence: `docs/specs/cli-thread-drafts.md`
- Runtime architecture: `docs/specs/cli-runtime-architecture.md`

## Core Model

A worktree is a regular `cliProfiles.paths[]` entry with metadata:

```ts
{ id, path, label, gitRemoteUrl?, kind: "worktree", parentPathId, branch }
```

The existing `pathId → workingDirectory → spawn cwd` pipeline is unchanged.
Worktree entries are managed by the CLI's worktree sync, never by the user's
configured-path list:

- `cli/worktrees.sync` merges CLI-scanned worktrees per parent repo path.
  Entries keep stable ids (matched by path string). Worktrees under a scanned
  parent that are gone from disk are pruned; worktrees under unscanned
  parents are kept. Entries whose parent path left the profile are pruned.
- Reconnect path registration (`mergeProfilePaths`) preserves worktree
  entries whose parent survives; a path reported as a regular configured path
  wins over an old worktree entry at the same path.
- The main checkout (first row of `git worktree list`) must never become a
  worktree entry — filtered CLI-side and guarded server-side.

## Thread Creation Flow

`cli.threads.core.create` accepts an optional worktree spec:

```ts
worktree: { parentPathId, branch, baseRef?, startFromOrigin? }
```

Validation: `parentPathId` must equal the thread's `pathId`; the parent must
not itself be a worktree entry; `branch`/`baseRef` must pass the conservative
branch-name check in `apps/web/lib/threads/worktree-branches.ts`
(server-validated in `create`; the CLI never sanitizes).

The web composer is not the only initiator: MCP `create_thread` and
`convoy threads create --worktree-branch` (OS-2488) forward the same spec,
unsanitized and shape-checked only, to `create` and `addThreadToGroup` alike
(OS-1222). An agent spawning beside a thread that already runs in a
worktree must send the parent repo's `pathId` explicitly, since the inherited
one is a worktree. See [mcp-server.md](mcp-server.md#create_thread).

The thread stores `worktree: { ...spec, status: "pending" }` with `pathId`
pointing at the **parent** repo path. On claim, before the first run of the
run, the CLI:

1. Appends an `convoy_notice` chunk ("Creating worktree …") to the
   assistant message (bridge-level chunk type, normalized runtime-agnostically
   to a `runtime-notice` event).
2. Creates the worktree (see semantics below).
3. Calls `cli/worktrees.resolveCreated`, which upserts the worktree path
   entry, repoints the thread (`pathId`, `path` snapshot), and sets
   `worktree.status = "created"`. Idempotent.
4. Executes the runtime with the worktree as `cwd`.

Failure at any step fails the assistant run with the git error through the
existing retryable-failure path; `worktree.status` stays `pending` and retry
re-attempts creation.

## Creation Semantics (`createWorktree`, apps/cli/src/lib/git/worktrees.ts)

- A worktree already checked out on the branch is **reused** (retry path,
  and branch-collision behavior).
- An existing local branch without a worktree gets a worktree attached
  (`baseRef` ignored).
- Otherwise a new branch is created from `baseRef` → repo default branch
  (`origin/HEAD`) → `HEAD`. With `startFromOrigin`, the CLI fetches and bases
  on `origin/<baseRef>`; fetch failure fails creation (retryable).
- Location (v1, not configurable): sibling folder
  `<repoDirname>/<repoName>-worktrees/<branch-with-slashes-as-dashes>`.
- A target directory that exists as a worktree of another branch is an error.
  Known v1 limitation: the slash→dash mapping means `feat/x` and `feat-x`
  collide on the same directory — guarded (creation errors, no data loss) but
  the two branches can't both have default-located worktrees. Revisit with a
  disambiguating suffix when the v2 configurable `worktrees_dir` lands.
- Creation never touches the parent checkout's state.

This function is the v2 seam: custom create commands (worktrunk) and
post-create hooks (copy `.env`, install deps) plug in here via local CLI
config (`~/.config/convoy/config.toml`). The server only ever sends intent
(branch, base, parent path) — shell commands never cross the wire.

## Discovery

- At registration the CLI scans each configured path with
  `git worktree list --porcelain` (location-independent — reads
  `.git/worktrees/` metadata) and calls `cli/worktrees.sync`.
- Scans exclude the main checkout and detached-HEAD worktrees.
- Scans exclude worktrees whose directory is missing on this machine (pruned
  or locked worktrees, or host paths seen from a devcontainer that shares the
  repo's `.git`). Git still lists them; opening one would run git in a missing
  directory. `runGit` reports a missing cwd as
  `Working directory does not exist: <path>`, not Node's `spawn git ENOENT`.
- A path that fails to scan (not a repo, transient git error) is excluded
  from `scannedParentPaths` entirely so its entries are never pruned on bad
  data.
- Rescan also happens after fulfilling any worktree op.

## Worktree Ops Channel (`cliWorktreeOps`)

Web-enqueued filesystem operations fulfilled by the profile's CLI, mirroring
the pending-threads subscription pattern. Rows are ephemeral (scheduler-pruned
after 1h TTL; 10 min for file ops, whose results carry file contents).

- `enqueue` (web): `{ profileId, kind: "rescan" | "remove" | "readFile" |
"diffFile" | "revertRun" | "revertFile" | "searchFiles" | "worktreeChanges" |
"revertWorkingFile" | "revertWorkingTree" | "downloadFile" | "gitLog" |
"commitPatch", pathId }` plus
  `filePath`/`preRef`/`postRef` for file/revert ops, `filePaths` for
  `revertWorkingTree`, `query` for searches, and `cursor` for `gitLog`. `readFile` needs only `filePath`:
  without `postRef` it reads the working tree (OS-2041).
  The server resolves and snapshots `path` (and `parentPath` for removals) so
  the CLI stays stateless. Rescan ops dedupe against a pending rescan of the
  same path. Remove ops require a `kind: "worktree"` entry and reject when an
  actively claimed thread points at it. File ops (`readFile`/`diffFile`) and
  run reverts (`revertRun`) serve the run-diff viewer and Undo button — see
  `docs/specs/cli-thread-run-diffs.md`. `searchFiles` serves the composer's
  @-file-mention autocomplete — see
  `docs/specs/cli-composer-file-mentions.md`. `worktreeChanges`,
  `revertWorkingFile`, `revertWorkingTree`, `downloadFile` and ref-less
  `readFile` serve the worktree changes view below and the thread Changes
  tab's Working tree view (`cli-thread-run-diffs.md`).
- `get` (web): watch a single op row; only the requesting user can read it.
- `listPending` (CLI): standing realtime subscription per profile.
- `complete` (CLI): marks `done` (with optional `resultJson`, or `storageId`
  for a download) or `failed`.
- `generateUploadUrl` (CLI): storage upload URL for one pending `downloadFile`
  op of the session's profile (OS-2050).
- `discard` (web): deletes a settled op and its blob; requester only (OS-2050).

### Rescan

Fired when the base-ref selector opens (deduped). The CLI returns
`resultJson = { refs: [{ name, isCurrent, remoteOnly }] }` — local branches
plus `origin/*` branches deduped onto local names, most recent committer date
first, capped at 500 — and re-syncs the parent's worktrees. Refs are
deliberately NOT stored in `cliProfiles` (realtime-subscribed doc; hundreds of
entries would churn it).

### Remove

The CLI refuses to remove a dirty worktree (surfaced as op failure; no force
in v1). On success it runs `git worktree remove` with a 10-minute timeout
instead of the 30-second git default: git deletes ignored files such as an
installed `node_modules` before it unregisters the worktree, and a kill
partway through leaves a registered worktree with most tracked files deleted.
It then re-syncs the parent (entry
disappears from the profile), and completes the op. The local branch is not
deleted. Threads keep their path snapshot until the next run validates and,
when necessary, repairs their execution target.

The web removes a worktree from three places (OS-2459): the composer's
environment dropdown (two-step inline confirm), the Connected CLIs worktree
row, and the worktree changes view header. The last two sit inside the
worktrees module and share `useWorktreeRemoval` (`lib/worktrees/hooks/`) and
a confirm dialog; each toasts "Worktree removed" or the CLI's error. There is
no `convoy` command for it: the CLI runs on the machine that owns the
worktree, where `git worktree remove` already does the job and the next
rescan prunes the entry.

### Worktree changes (OS-2036)

`{ kind: "worktreeChanges", pathId }` for any path entry, main checkout or
worktree. The CLI returns `resultJson = { patch, truncated }`: one unified
patch of the working tree against `HEAD`, untracked (not ignored) files
included, produced from a temporary index (`GIT_INDEX_FILE` → `read-tree
HEAD` → `add -A` → `diff --cached`, the checkpoint capture recipe in
`apps/cli/src/lib/git/working-tree.ts`). The user's index, HEAD and branches
are never touched. Every diff the CLI produces for the web pins its format
(`DIFF_ARGS` in `checkpoint.ts`: no prefix overrides, no mnemonic prefixes,
no color, no external diff, no renames) so user git config cannot change the
`a/`/`b/` headers the web parser keys on. Results are capped by serialized
size, not characters: `capFileOpText` trims the text so the JSON result stays
under 700 kB (`MAX_FILE_OP_BYTES`), shared with `readFile`/`diffFile`; rows
use the 10-minute file-op TTL. A distinct kind: a CLI older than 0.77.0 has
no handler for it and completes the op with `Unsupported operation … update
@useconvoy/cli`, and the web does not enqueue it at all when the profile's
reported `appVersion` is older. The web never caches the result: the working
tree is mutable.

### Commit history (OS-2534)

Two read-only kinds for any path entry, on the 10-minute file-op TTL. The CLI
side lives in `apps/cli/src/lib/git/history.ts`.

- `{ kind: "gitLog", pathId, cursor? }` returns `resultJson = { commits,
  nextCursor? }`: 50 commits of `git log --topo-order HEAD <origin default>
  <local default>`, newest first. `<origin default>` is the first of
  `refs/remotes/origin/HEAD`, `origin/main` and `origin/master` that resolves
  to a commit (OS-2536); `<local default>` is the first of `refs/heads/main`
  and `refs/heads/master` (OS-2586). Each is left out when none resolves or
  when it is the same commit as an earlier tip. Both are walked because Convoy
  doesn't store which ref a worktree was created from: `createWorktree`
  branches from local `main` by default, or from `origin/main` when
  `startFromOrigin` fetches first. So a worktree shows its branch splitting
  off the default branch and merging back: when local `main` has moved on, it
  gets its own lane that joins the branch at the fork point, and when it
  hasn't, its ref badge sits on the commit the branch started from. The main
  checkout shows the default branch plus unpushed commits. Other branches stay hidden; their names can still show as
  ref badges on commits in the walk. Both layouts get the same pages. Git's
  topo order puts the tip with the newer commit first, so commits on the
  default branch newer than `HEAD` come above it, and a branch far behind a
  busy default branch can have its own commits on page 2; History then
  pages on to `HEAD` (Layout, below).
  Each commit has `hash`, `parents` (full hashes, first parent first),
  `authorName`, `authorEmail`, `committedAt` (committer time, ms), `refs`
  (`%D` entries such as `HEAD -> main`, `origin/main`, `tag: v1`; Convoy's
  `refs/convoy/*` checkpoint refs are excluded, at most 20) and `subject`
  (git's first paragraph). Display fields are cut: the subject at 500
  characters, author name, email and each ref at 200. The page also has a
  byte budget, the file ops' 700 kB: when the serialized commits would pass
  it, the page ends early and `nextCursor` resumes after the last commit
  returned. The parents and
  refs are there for the commit graph (OS-2536), so the graph needs no new
  request. `nextCursor` is `<tip>[,<tip>[,<tip>]]:<skip>` (`HEAD`, then the
  origin and local default branches), present when more commits follow. Later pages walk from the first
  page's tips, so commits made or fetched while the user pages don't shift or
  repeat rows. `enqueue` and the CLI both reject
  any other cursor shape. An unborn branch returns `{ commits: [] }`.
  The web caches the loaded rows per browser tab (20 checkouts, oldest
  dropped). A History remount within 60 s of the first page, with no run
  finished since, shows them with no request; otherwise it shows them while
  the first page is fetched again. The age is checked when History can first
  fetch. Refresh and a finished run always fetch; a failed one leaves the age.
- `{ kind: "commitPatch", pathId, postRef }` returns `resultJson = { body,
  patch, truncated }` for the commit in `postRef`. `enqueue` accepts a full
  40- or 64-character lowercase hex hash only, and the CLI checks it again
  before git sees it. The patch is `git show --cc` with the pinned diff format
  (`SHOW_ARGS`, the `git show` form of `DIFF_ARGS`) on `<hash>^{commit}`, so
  an annotated tag's hash shows its commit, capped by `capFileOpText`. A
  patch past `runGit`'s 10 MiB output cap (a huge root commit) is not an
  error: `allowTruncatedOutput` keeps the first part, and the result is
  `truncated` like any patch past the display cap. The body and the patch
  come from two `git show` calls (`-s --format=%b` and `--format=`), so a
  huge commit message can't use up the patch's output budget.
  A merge commit gets git's dense combined diff (`diff --cc`), which holds only
  conflict resolutions, so a clean merge has an empty patch. A root commit
  shows its files as added. `body` is the message after the subject, cut at
  20,000 characters.

A CLI older than 0.171.0 fails both kinds with `Unsupported operation`, and the
web shows an update prompt instead of enqueueing. A CLI older than 0.172.0
walks `HEAD` only, and one older than 0.175.0 leaves out the local default
branch; the graph draws whatever tips it gets, so there is no version gate for
either. There is no `convoy`
command for history: anyone at the terminal already has `git log`.

### Revert a working file (OS-2043)

`{ kind: "revertWorkingFile", pathId, filePath }` discards one file's
uncommitted changes; no refs, file-op TTL, and the same in-use guard as the
checkpoint reverts (rejected while a claimed thread runs in the path). The
CLI (`revertWorkingFile` in `working-tree.ts`) refuses a path that resolves
outside the checkout, then: a file present in `HEAD` is restored from it in
both worktree and index (`git restore --source HEAD --worktree --staged`),
so a deleted or staged file comes back too; a file absent from `HEAD` is
deleted and its staged entry dropped. Unlike the thread tab's checkpoint
revert there is nothing to restore from afterwards, which is why the web
confirms first. A CLI older than 0.78.0 fails the op with the "update
@useconvoy/cli" error; the web does not hide the action for it.

### Revert all working changes (OS-2234)

`{ kind: "revertWorkingTree", pathId, filePaths }` discards the uncommitted
changes of exactly the listed files, the ones the user saw in the patch when
confirming. A file changed after the view loaded but missing from the list is
left alone. `filePaths` is required, non-empty and capped at 2000 entries.
File-op TTL and the same in-use guard as `revertWorkingFile`: enqueue rejects
while a claimed thread runs in the path, whichever thread it is. The CLI
(`revertWorkingTree` in `working-tree.ts`) checks every path before touching
any, refusing the whole op if one resolves outside the checkout, then reverts
each file with the `revertWorkingFile` recipe in list order. A failure midway
leaves earlier files reverted; the error names the file it stopped on. A
distinct kind: a CLI older than 0.125.0 fails it with the "update
@useconvoy/cli" error, and the web hides Revert all for it.

### Automatic working directory recovery

The CLI validates the working directory before checkpoints or runtime launch
on every run. Recovery needs no UI action or agent tool call and also covers
worktrees removed through a shell command.

- New and existing-worktree selections snapshot the parent path id, path, and
  Git remote on the thread's worktree metadata. Discovery can prune the profile
  entry without removing this relationship.
- `messages.startRunResponse` returns the canonical workspace under the live
  claim, reusing the profile already loaded for ownership checks. Ordinary
  worktree runs do not issue a separate workspace query. The CLI refreshes via
  `worktrees.getExecutionWorkspace` after creation or for a launch-race retry.
  A stale pending snapshot must not recreate an already-resolved worktree.
  Run-start responses without the workspace field use the query fallback.
- The CLI stores an opaque UUID in `convoy-identity` inside the Git common
  directory and each worktree administrative directory. Creation publishes a
  complete file atomically. These identities survive remounts, metadata restores,
  and `git worktree move`. A replacement clone or checkout gets a new identity.
  No device, inode, or filesystem timestamp is persisted. Copying all Git
  metadata also copies its identity, so a full metadata copy is treated as the
  same repository. These files never enter the working tree or a commit.
- Registered parents may be repository subdirectories. Git membership is
  validated from that configured directory, which remains the fallback target.
- A missing worktree is resolved through `git worktree list` on the recorded
  parent. A folder at the path that Git no longer sees as a checkout counts as
  missing: a dev server still running from a removed worktree can recreate its
  cache folders there. A matching administrative directory identifies a moved worktree even
  if its branch changed. Otherwise the CLI uses the original parent checkout,
  on whatever branch is currently checked out. It never switches branches,
  copies changes, creates a replacement directory, or infers that work was merged.
- Legacy threads with a creation spec can recover through its recorded parent
  path id. The CLI verifies the parent is inside a Git working tree and checks
  the recorded Git remote when available, then records its local Git identity. This
  cannot retrospectively distinguish a replacement clone with the same remote.
  Legacy existing-worktree threads can acquire this metadata while their profile
  entry survives. If both the entry and the recorded relationship are absent,
  recovery stops rather than guessing from directory names.
- `worktrees.resolveExecutionWorkspace` validates ownership, project access,
  live claim, expected source path, registered parent, and saved identity. It
  updates the path id, path snapshot, worktree metadata, previous path, and
  current branch together. Recovering to the parent clears the worktree spec.
  Continuation ids, conversation content, and task associations stay intact.
- The assistant run shows a `workspace-recovered` notice. The runtime receives
  the new working directory as context, including on resumed runs. The pending
  notice survives process restarts until an ordinary run completes and
  acknowledges that exact directory change in the same transaction. Commands
  and script runs leave it pending. Raw commands are never prefixed with it.
  A runtime that cannot resume fails explicitly; recovery never silently starts
  a fresh conversation.
- If deletion races with launch, a confirmed spawn failure can trigger one
  recovery attempt within the same assistant run, only before any runtime chunk
  arrives and while the claim remains valid. Runners carry `launchFailed` from
  the process-start boundary. Claude observes the SDK spawn callback; Codex and
  Cursor preserve native spawn errors. The processor never matches SDK error
  wording. Cursor emits command inventory only after successful spawn.
  Antigravity sets `launchFailed` when `agy acp` never got a pid, before any chunk.
  OpenCode uses a shared HTTP server and retains preflight recovery; ambiguous
  server/request failures are not replayed. A new checkpoint ref suffix keeps
  the recovered checkout's baseline separate. Other runtime failures are not
  replayed automatically.
- Missing ordinary directories, unavailable/unregistered parents, permission
  failures, and repository identity mismatches stop with a directory-specific
  error.

Checkpoint commits record the checkout identity and relative working-directory
prefix. Moving the same worktree preserves Undo. Legacy Undo is allowed only
when the checkpoint ref identifies a thread still targeting the requested
checkout and that thread has never fallen back to its parent. The permanent
`legacyCheckpointsUnsafe` marker survives notification acknowledgment. New
checkpoints carry their own identity and remain usable after parent recovery.
See `cli-thread-run-diffs.md`.

### Recovery request cost

With the workspace included in run start, healthy worktree runs add no backend
requests or document reads. The workspace projection uses already-loaded rows.
The explicit workspace query and repair mutation reuse the profile loaded for
session ownership instead of fetching it again.

| Scenario | Extra backend calls compared with execution without recovery |
|---|---|
| Ordinary checkout or healthy worktree with saved identity | None |
| First run in an existing worktree without saved identity | One identity mutation |
| First run creating a new worktree | One post-creation query and one identity mutation |
| Recovery before launch | Target mutation and notice append |
| Deletion during launch | One heartbeat, workspace query, target mutation, notice append, and branch report beyond initial preparation |

Notice acknowledgment uses the existing completion mutation. These counts
exclude existing worktree creation calls, periodic claim heartbeats, and
subscription re-executions. No polling or subscription is added.

### Download a file (OS-2050)

`{ kind: "downloadFile", pathId, filePath }` saves a file's current on-disk
bytes through the browser, binary files and files past the 700 kB op cap
included. Op results are Convex documents, so the bytes cannot ride the row:
the CLI (`readWorkingFileBytes` in `working-tree.ts`, path-escape refusal,
50 MB cap, no binary check) asks `generateUploadUrl` for an upload URL tied
to this pending op, POSTs the bytes to file storage, and completes the op
with the `storageId`. `complete` is the trust boundary for the cap: a blob
over `MAX_DOWNLOAD_FILE_BYTES` (50 MB, `cli/lib/constants.ts`) is deleted and
the op fails with "File is too large to download". `get` adds a signed
`downloadUrl` for the requesting user. A blob any attachment flow claims is
refused ("not this operation's upload") and left alone, and the op row is
itself a storage reference (`storageRepo.ts`, `by_storageId`), so no
attachment flow can claim a download blob; a completion arriving after the
op was pruned deletes its unreferenced blob before failing. Once the browser
has fetched it the
web calls `discard`, which deletes the blob and the row at once (requester
only, never a pending op); `prune` does the same on the file-op TTL as the
fallback for a closed tab, so nothing outlives ten minutes. The web gates
the action on CLI 0.83.0 or newer.

### Open a file from disk (OS-2041)

`{ kind: "readFile", pathId, filePath }` with no `postRef` returns the file's
current on-disk content (`readWorkingFile` in `working-tree.ts`): the same
path-escape refusal as the revert, "File not found in the working tree" for
a missing path, and the binary (NUL byte) and 5 MB guards of `readFileAtRef`.
A CLI older than 0.82.0 fails the op with its missing-ref message, so the
web hides the action when the profile's `appVersion` is older.

## Web UI

### Base-Ref Selection UI (`components/blocks/thread/base-ref-selector.tsx`)

New-thread composers only and only when the selected path has a
`gitRemoteUrl`. Every composer surface uses the same layout (single shared
composer layout, see `docs/specs/cli-thread-context-selectors.md`): the split
**environment + branch** selectors (`WorkspaceSelectors`, OS-1218) in the
context bar **above** the input, right after the working-directory selector.
  - **Environment selector** ("Start in"): trigger shows `Work locally`
    (laptop icon) / `Worktree` (folder-git icon) / `New worktree` (plus icon).
    The branch icon belongs to the branch chip alone: a narrow composer bar
    hides the environment label, and two branch icons side by side read as
    one control.
    Dropdown (no search input): "Work locally" (badge shows the current
    branch when known), the parent's worktrees (folder-git icon, each with the inline
    two-step-confirm remove action), "New worktree" (selecting it commits a
    bare `{ type: "branch" }` selection — new worktree from the repo's
    default branch with an auto-derived name), then below a separator a
    **disabled "Cloud" row with a "Soon" badge** — a preview of the cloud
    execution environment, not selectable until that runtime exists. The
    row and its separator only render under [`Show unfinished items`](user-settings-developer-section.md#unfinished-items).
  - **Branch control**: for `Work locally` a read-only chip with the
    locally checked-out branch (hidden until a scan reports it); for an
    existing worktree a read-only chip with the worktree's branch; for
    `New worktree` an editable dropdown — searchable base-branch list
    (`current`/`origin` badges; picking a base updates `baseRef` and keeps
    any explicit branch name), a "Start from origin" toggle that updates the
    selection in place, and "＋ Create new branch…" opening the named-branch
    dialog (which preserves the picked `baseRef`). Trigger label: the
    explicit branch name, else `From <base>`, else "Default branch".
The former **compact combined single-dropdown selector** (`BaseRefSelector`,
icon-only trigger, two in-place pages) was retired with the single composer
layout on 2026-07-24 — no composer renders it anymore (the component and its
tests still exist pending removal).

When the selected path has no detected `gitRemoteUrl`, the composer shows a
static "Work locally" summary in the context bar instead of the selectors. The
summary has a hover/focus tooltip explaining that worktree options require a
detected Git origin and that the user should add an origin remote, then
reconnect the CLI. The tooltip uses a 500 ms delay so it does not flash during
incidental pointer movement.

Started-thread composers show read-only environment and branch chips
(OS-1988). Local checkouts show a laptop icon with `Work locally`; worktrees
show a folder-git icon with `Worktree`. A separate branch chip uses the detail
query's canonical `branch`, with the precedence defined below in Thread List
Branch Display, and updates when the CLI reports a changed branch. The
thread's stored worktree metadata preserves its environment when its profile
path is unavailable. Legacy worktree paths can supply the environment when
stored worktree metadata is absent.

Creating a local thread carries the displayed scan's current branch into the
thread's initial branch snapshot through the optional `initialBranch` create
argument. The shared submit pipeline reads the same scan cache as the draft
selector, scoped by profile and target path. This also applies to new group
children. Worktree targets ignore this local hint and use their own branch.
The snapshot affects display only; it never selects or switches a Git branch.

The first CLI execution report replaces the snapshot, or clears it when no
branch is reported. Follow-ups do not fall back to browser scan data after
that report. If no branch was known at creation, omit the branch chip until
one is reported. No extra scans run for follow-ups. Non-Git paths still show
only the environment chip. Workspace controls remain locked after creation.

**Named-branch dialog** ("Create branch in new worktree",
`create-worktree-branch-dialog.tsx`): opened by the bottom button (the
dropdown closes first — a modal dialog never nests inside the open
dropdown). Branch-name input with live validation messages
(`getWorktreeBranchNameError`), Close / "Create worktree" (disabled while
empty or invalid). Commits `{ type: "branch", branch, baseRef: undefined }` —
an absent `baseRef` means the CLI bases the branch on the repo's default
branch. A name matching an existing branch attaches the worktree to it.

Refs load stale-while-revalidate: a background rescan fires on mount/path
change (preload) and again on each open; the last completed scan keeps
rendering while a refresh runs, and is also persisted to `localStorage`
(keyed by profile + path) so a fresh page load renders the full list
instantly. A loading state is shown only before the first-ever scan.
Row badges/actions/check render right-aligned in the `command-shortcut` slot
so unselected rows reserve no trailing check space.

### Selection Model (`lib/threads/base-ref-selection.ts`)

`BaseRefSelection = current | worktree(pathId) | branch(baseRef,
startFromOrigin, branch?)`, persisted on the composer draft (`draft.baseRef`)
and scoped to the working directory: changing the working directory clears
it, and stale selections (worktree removed / different parent) resolve back
to `current`. `resolveThreadTarget` maps the selection to the
`threads.create` payload at submit.

### Working Directory Selector

Worktree entries never appear in the working-directory selector list (they
are selected via the base-ref selector). The trigger label still resolves
worktree entries for existing threads pointing at one.

### Thread List Branch Display

Thread query results expose an optional canonical `branch` field, resolved in
precedence order:

1. `cliThreads.git.executionBranch` — initially seeded from the composer's
   known local branch when supplied, then replaced by the branch checked out when the
   CLI last started executing the thread (OS-1247). The CLI detects it with
   `getCurrentBranch` after the working directory is final (post worktree
   resolution) and reports it via `cli/threads/runControl.reportExecutionBranch` on
   every run start **and again after each run completes** (a run that
   switches or creates a branch — e.g. the agent branches off to open a PR —
   must not leave the row showing the pre-run branch), so the snapshot always
   reflects the most recent run — including "Work locally" threads and
   worktrees where the user checked out a different branch than the worktree
   was created on. Detached HEAD and
   non-Git paths report no branch, which clears the snapshot. Reporting is
   fail-soft on both sides: git or mutation failures never block the run,
   and reports from a session that no longer holds the claim are ignored.
2. The thread's resolved profile path entry (synced worktree entries carry a
   `branch`).
3. `cliThreads.git.worktree.branch` — while a worktree is pending or after its
   synced profile path has been removed.

Threads that predate the snapshot (or whose CLI has not run since) fall back
to 2/3 and may show no branch at all — rows fail soft. Resolving this field
reuses the existing grouped thread-to-profile enrichment; it does not add
another database join.

- Non-compact thread rows show the branch inline in their metadata row.
- Compact thread rows keep the row dense and show the branch in a hover/focus
  card positioned to the right of the row.
- Rows omit branch UI when the optional field is unavailable.

### Worktree changes view (OS-1980, `components/blocks/worktrees/`)

Opened from an expanded Connected CLIs row (see
[cli-thread-list.md](cli-thread-list.md#connected-clis-os-1993)) at
`/threads?profileId&pathId&view=changes` (`view=history` for the History
tab), recognised by
`parseWorktreeChangesTarget` in `lib/navigation`. `ThreadWorkspaceHost`
renders it in place of the new-thread composer; a thread URL still wins. The
threads layout uses the same helper, so on mobile the view is a full-screen
conversation like a thread, not the list. The view's grid column is
`minmax(0,1fr)`: an auto column takes the longest diff line's width and pushes
every row, header included, past a phone viewport. The right pane is the file tree
(below); the task pane is absent, and a `task=` param is ignored while
`view=changes` is present.

- Header: the worktree's branch (or the checkout's label) and a Refresh
  button. While a refresh runs the button is `aria-disabled` (not
  `disabled`, which would drop keyboard focus) and its icon spins. Below it a 41px toolbar row (same height as the thread Changes
  toolbar, so it lines up with the sidebar's "New thread" row) with a
  Changes | History tabs (underline tabs, as in the PR reader; Changes carries the file count once the patch
  has files), the full path (not on a phone, where only a few characters
  fit), `N files +A -D` once the patch is in (Changes
  only), and the Changes tab's three
  toggles on the right: collapse/expand all, split/unified, word wrap
  (`components/custom/diff/changes-view-toggles.tsx`, shared with
  `ThreadChangesToolbar`). Diff style and
  wrap read and write the same localStorage preferences as the thread tab.
- Remove worktree (OS-2459): for a worktree entry, a `⋯` menu after Refresh
  holds "Remove worktree". It is disabled with the hint "Commit or revert
  changes first" while the patch on screen has files; while the patch loads
  or after a failed fetch the CLI's own dirty check decides. The item opens
  the confirm dialog (path deleted from disk, branch kept). On success the
  page goes to the threads page. A main checkout has no menu.
- Body: one `PatchFileSection` per file (OS-2040,
  `components/custom/diff/patch-file-sections.tsx`, shared with the thread
  Changes tab, see `cli-thread-run-diffs.md` → UI): sticky header with
  chevron, path and ±counts, the `@pierre/diffs` patch below, mounted lazily
  as it scrolls into view. Files come from the patch itself
  (`splitRunPatch` / `parseRunPatchFiles`, `--no-renames`). Binary files show
  a note instead of a diff; a clean tree shows "No uncommitted changes".
- Fetching: a `worktreeChanges` op is enqueued on open and on each Refresh
  (`lib/worktrees/hooks/use-worktree-op.ts`). Each request carries a
  generation; a stale op never overwrites a newer outcome, and a pending row
  pruned before the CLI answers settles as an error with Refresh enabled.
  The previous patch stays on screen while a refresh runs and when a refresh
  fails, with the error as a banner above it. Reload refetches; nothing is
  cached. The CLI offline shows the same placeholder copy as the thread
  Changes tab; a CLI older than 0.77.0 shows an update prompt instead of
  enqueueing. A path no longer on the profile shows "This checkout is no
  longer registered on the CLI."
- Files without content lines (empty files, mode-only changes) are listed
  with zero counts and a "No content change" note instead of a diff.
- Open file (OS-2041): an "Open file" button in each section header (not for
  deleted or binary files, hidden on CLIs older than 0.82.0), or the same
  entry in every file-tree row's right-click menu (disabled in those cases
  instead of hidden), adds a tab to a
  strip above the sections — "Changes" plus one closable tab per file, the
  thread Changes tab's `FileTabStrip` (`components/custom/diff/`), with the
  file icon and base name. A tab shows the file's on-disk content read-only;
  it is re-read on every activation and on Refresh, never cached. Closing
  the active tab returns to Changes; a file-tree click does too. Tabs live in
  component state and are gone after a reload. Reverting an added file closes
  its tab, since the file is deleted.
- Download (OS-2050): a download button in each section header, or
  "Download" in a file-tree row's right-click menu (neither for deleted files,
  hidden or disabled on CLIs older than 0.83.0), enqueues `downloadFile`;
  once the op settles the browser saves the file under its base name
  (`downloadFile` in `lib/tasks/files.ts` fetches the storage URL and clicks
  an object-URL link, since a cross-origin URL ignores `download`). The CLI's
  error lands in a toast. One such op at a time: revert and download buttons
  are disabled until it settles.
- Revert (OS-2043): a revert button in each section header, or "Revert" in a
  file-tree row's right-click menu, opens an
  `AlertDialog` naming the file ("The file will be deleted" for an added
  file, "Uncommitted changes … discarded" otherwise, "This cannot be
  undone"). Confirming enqueues `revertWorkingFile`; every revert button is
  disabled until the op settles, then a toast reports success or the CLI's
  error and the view refreshes, so the file leaves the list.
- Revert all (OS-2234): a "Revert all" button beside the file count, shown
  once the patch has files and hidden on CLIs older than 0.125.0. It opens a
  dialog listing the counts that will be lost ("N files: M modified, K new
  files deleted, D deleted files restored") and "This cannot be undone." The
  Revert all button stays disabled until the user types `revert` into the
  dialog's field. Confirming enqueues `revertWorkingTree` with the paths of
  the patch on screen. It shares the busy state with per-file revert and
  download; a toast reports the outcome and the view refreshes. A truncated
  patch disables Revert all, since the file list on screen is incomplete.
- History (OS-2534, `worktree-history.tsx`, mockup `/playground/git-history`):
  the commit list on the left (`clamp(240px, 40%, 420px)`) and the selected
  commit on the right, for a worktree and the main checkout alike. The
  thread Changes tab shows the same view (OS-2535, `cli-thread-run-diffs.md`
  → History). Rows are
  two lines: subject, then author (cut at 8rem), relative time, short hash
  and ref badges (the `HEAD ->` branch highlighted, a tag as a tag icon and
  its name; badges shrink before the author does); a merge row has a merge
  icon and a muted subject. Clicking a row's badges, in either layout, opens
  a menu titled "Branches and tags at <short hash>" instead of the commit
  (OS-2586): every ref as plain text with a branch or tag icon, no badges.
  Picking one copies its name (the branch for `HEAD -> x`, the tag for
  `tag: x`) and toasts "<name> copied to clipboard". The trigger is a `role="button"` span inside the row's
  option, out of the Tab order; closing the menu puts focus back on the row. The open row has `bg-muted` and a 2px primary
  bar on its left edge. `origin/HEAD` (that exact ref) gets no badge, since
  it repeats the default branch's. A row's accessible name is its subject (cut at 120
  characters), its refs in words (`HEAD, branch main`, `remote branch origin/main`,
  `tag v1`), "merge"
  for a merge, author, date and short hash, since the graph and badges are
  visual only. The newest commit opens first. The detail shows subject, body
  (git's hard-wrapped lines joined into paragraphs; a paragraph with list or
  indented lines keeps its breaks, except a list item's wrapped lines indented
  to the item's text, which join it), author (email on hover), date, a copy
  button for the full hash, and the parents as dotted-underlined links with
  a 24px hit area. A parent in the loaded list opens that commit; one past
  the loaded pages is found by paging (below), and is disabled only when no
  page is left. Below,
  `N files +A -D` (no counts when every file is binary) and one
  `PatchFileSection` per file with `PatchDiff`, using the toolbar's toggles.
  A combined (`diff --cc`) section shows as text under "Combined diff of the
  merge resolution, shown unified.", since the diff viewer reads two-sided
  patches only: git's `diff --cc`/`index`/`---`/`+++` lines are dropped, a
  line with a `+` in its parent columns gets a green row tint, one with a
  `-` a red tint, with the foreground text color for contrast, and it
  wraps with the toolbar's word wrap; its ±counts read every parent column,
  and a binary resolution keeps its row with the binary note. "Load more"
  under the list fetches the next page, keeps the rows above, and moves focus
  to the first new row.
  - URL: the tab and the open commit are `view=history&commit=<hash>` on the
    worktree page URL (`appRoute.projectThreadsWithPreselection`,
    `parseWorktreeChangesTarget`), so a reload or a shared link reopens them.
    Switching tabs replaces the URL; Changes drops `commit` and History
    brings it back. Selecting a commit replaces the URL in the two-pane
    layout and pushes it in the one-pane layout, so Back returns to the
    list, and "All commits" pops that entry instead of adding one. A full or
    short (7+ characters) `commit` that is not in the loaded pages is paged
    to: Load more runs until its row arrives, and meanwhile the detail shows
    a spinner status "Finding commit <short>… N commits searched" (or keeps
    the commit that was open). After 1,000 rows, or when no page is left,
    the param is dropped, the newest commit opens (or the one that was open,
    if it is still in the loaded history; a rebase or reset can drop it),
    and a note above the list says "Commit <short> isn't in this
    checkout's history." until the next commit is opened. In one-pane mode a
    failed page during that search shows its error and Retry in the commit
    pane too, since the list (where Load more's error sits) is hidden.
  - `gitLog` is first sent when History opens, and the list stays across tab
    switches; opening another checkout starts from a fresh view. Refresh on
    the History tab starts over from the first page; with one page loaded the
    rows stay while it runs and the button spins. The open commit stays open
    through a Refresh, and the list pages back to its row. A commit's patch
    is fetched once per browser tab and served from an in-memory cache after
    that (100 commits, oldest dropped), since a commit never changes.
  - Keyboard: the list is a `listbox` with one Tab stop (the last focused
    row, else the open one, else `HEAD`'s, else the first). ↑/↓, j/k, Home and End move
    through it; in the two-pane layout the move also opens the commit.
    Escape in the Graph table leaves a file's diff for the graph first,
    then closes the commit sidebar, and in one pane goes back to the list,
    like "All commits"; focus returns to the row. A
    parent click focuses that commit's row (its heading, in one-pane mode),
    once the row has loaded.
  - States: skeleton rows of the loaded row's height while the first page
    loads, "No commits on this branch yet.", "This checkout is no longer
    registered on the CLI." (nothing is fetched), the offline and update-prompt
    copy, and the CLI's error with Retry, which re-sends the failed page. A
    malformed CLI answer is that error too. The first-page skeleton covers
    both panes: list rows, and the detail's header and file bars. The file
    tree and its "Show files" button are hidden on History.
  - One-pane layout, on a phone or when the History pane is narrower than
    600px (the list's 240px plus a 360px detail): the list, then the tapped commit full width under an "← All
    commits" back row. The list stays mounted but hidden behind the commit,
    so it keeps its scroll position; focus moves to the commit's heading on
    open and back to its row on return, by the back row or browser Back, and
    that row stays marked as selected. Browser Forward to a commit focuses
    its heading too, unless focus sits on a control outside the view (the
    thread's layout toggle, whose switch remounts the view). On a phone both scrollers end with
    `--mobile-nav-clearance` padding, so the floating nav covers nothing.
    On a phone the 41px toolbar shows the layout toggle over the list and
    the diff toggles only over a commit, so it fits 390px. On a desktop the
    diff toggles follow the view's report of a diff on screen
    (`onDiffShownChange`): left out over the Graph table (a commit's
    sidebar included, until a file opens its diff) or a one-pane list with
    no commit open. List | Graph is always last in the toolbar, so the diff
    toggles come and go on its left and it never moves.
    A Refresh that drops later pages scrolls the list back to the top when
    no commit is picked.
  - Layout (OS-2536, `commit-graph.tsx`, `lib/worktrees/commit-graph.ts`): a
    List | Graph toggle of two icon buttons with tooltips and aria-labels,
    styled like the project header's List | Board switch, List by default,
    kept per browser in localStorage
    (`convoy.history-layout`) and shared by the worktree page (in the 41px
    toolbar, at its right end after the diff toggles) and the thread Changes tab (in its
    Refresh row). List is the view above, over the same commits (default
    branch included); with no commit picked it opens `HEAD`'s commit (the
    row with `HEAD` or `HEAD -> `). When the default branch fills the first
    page, both layouts load more pages (up to 1,000 rows) until `HEAD`'s row
    arrives, List's detail says "Finding HEAD… N commits searched", and the
    row scrolls to the middle of the list. With no `HEAD` in reach the first
    row opens. Graph in a History pane of 900px or more is a table that
    fills the pane, with the columns Refs (up to 180px: the first ref badge,
    then "+N" whose title names the rest, right-aligned against the graph;
    both open the copy menu with every ref),
    Graph, Description (at least
    160px), Date (up to 150px, the year only outside the current one),
    Author (up to 120px) and Commit, 28px rows under a sticky header; Refs,
    Date and Author give way before Description does. No commit is open
    until a row is picked. A picked row opens a right sidebar
    (`commit-sidebar.tsx` in `ThreadWorkspaceSplitPane`, resizable from 320
    to 480px, 360px by default, its width kept per browser as
    `worktree-commit-sidebar-width`): a "Commit" header level with the
    table's, with "Close commit"; the author, date, email (no row without
    one), the full hash (a copy button) and every ref badge; the message under a
    "Message" toggle that collapses it; then "N Changed Files" with ±counts
    and the files in `WorktreeFileTree` (no context menu: a commit has
    nothing to open, download or revert). The patch is `useCommitPatch`'s,
    fetched once. A file click puts the commit's whole diff in the table's
    place, every file in patch order, scrolled to that file (expanded first if
    collapsed), under a "← Back to graph" row with the subject and a "Close
    diff" X level with the sidebar's; the sidebar stays and marks the file.
    Back, the X or Escape shows the table again with the
    row still selected and focused; the table stays mounted but hidden
    meanwhile, so it keeps its scroll position. The diff scroller takes
    focus on a click, so Escape works after a click into the diff's text.
    The diff is local state, not in the URL, and closes when the commit
    changes or the table gives way (List, a narrower pane). A linked commit
    (`commit=`) opens the sidebar and scrolls its row to the middle of the
    table, once; later picks scroll only as far as needed. While no commit is open, ↑/↓ only move
    focus; Enter or a click opens one, and after that the keys open the next
    commit in the sidebar. The table
    scroller has a 32px `scroll-padding-top`, so a row reached by keyboard
    stops below the sticky header. Graph in one pane (the thread panel, a phone, a pane
    under 900px) keeps the two-line rows and puts the graph column where the
    commit icon was, with no row borders so the lines run on; lane 0 sits
    12px in, where List's icon is, and the first-page skeleton draws those
    rows (a lane stub, no borders). There a tapped commit opens the one-pane
    commit view above (meta, message, every file's diff): on a phone that
    view stands in for the sidebar. The two-pane Graph skeleton is the table
    rows, plus the sidebar's meta, message and tree rows when `commit=` is
    set.
  - Lane layout: a pure function over the loaded, newest-first commits. It
    keeps a list of open lanes, each waiting for a parent hash. A commit
    takes the leftmost lane waiting for it, or the first free one; other
    lanes waiting for it join it there. The first parent continues the
    lane, and each extra parent opens a lane unless one already waits for
    it. The layout runs over every loaded page, so lines open at the end of
    a page run off the bottom edge and continue when Load more adds rows.
    The column only widens while the view is mounted, so a Refresh back to
    page 1 does not shift the rows.
    Each row draws one SVG at the row height: 14px per lane, colors cycling
    through `--info`, `--warning`, `--success`, `--chart-4`, `--chart-5` by
    lane, a filled node for `HEAD`, a smaller node for a merge.
  - Copying the hash toasts "Commit hash copied"; where the clipboard is
    missing or denied it toasts "Failed to copy the hash" ("The full hash is
    selected beside it. Press Ctrl+C."), and a read-only field with the full
    hash takes the button's place, selected for Ctrl+C.
- File tree (OS-2037, `components/custom/diff/worktree-file-tree.tsx`): the changed files nested by
  folder in `ThreadWorkspaceSplitPane`'s sidebar, titled "Files". The split
  pane sits below the header and the Changes | History tabs row, so both span
  the full width and switching tabs never moves them; the tree starts under
  the tabs with its "Files" row (`FileTreeHeader`), as tall as the first diff
  file header beside it and, like it, without the toolbar's background. Folders come
  first, in patch order, each with the ±sum of its files and a chevron that
  collapses it; single-child folder chains are joined into one row
  (`components/custom/diff/file-tree.ts`). File rows show the name, ±counts (or
  "binary"), deleted files struck through. Clicking a file marks it selected,
  expands its section if collapsed, and scrolls the middle pane to it. The
  pane only appears once the patch has files and hides on mobile. A file tree
  toggle at the end of the changes toolbar stays put and shows whether the
  tree is open; clicking it closes or reopens the tree, as does the pane's
  close button.
- Icons (OS-2039, `lib/file-icons.ts`): the vscode-icons theme.
  `vscode-icons-js` maps a lowercased file name or a folder's last segment to
  an SVG name (open folders use the `_opened` variant, unknown names the
  default file or folder icon); the SVGs are plain `<img>` tags served from
  `apps/web/public/file-icons/` so the bundle never carries them. That folder
  is generated by `pnpm exec tsx apps/web/scripts/syncFileIcons.ts <checkout>`
  from a `github.com/vscode-icons/vscode-icons` clone (MIT, LICENSE copied
  alongside), limited to the names the package can return; a name upstream has
  renamed since gets the default file icon instead of a broken image.
- The module is a deep module (`docs/guidelines/architecture.md`): only
  `@/components/blocks/worktrees` is importable from outside, enforced by
  `no-restricted-imports` in `apps/web/eslint.config.mjs`.

## V2 (Follow-Up, Not Implemented)

Custom worktree commands and setup hooks in local CLI config: a
`create_command` template (e.g. `wt switch --create {branch}`), `post_create`
steps, `worktrees_dir` override, and an optional `remove_command`. Config is
local-only by design (a compromised web account must not become a
remote-command channel). See OS-1106's Plan artifact for the full sketch.

## QA Checklist

- Create a thread with "New worktree from branch" → worktree created next to
  the repo, thread runs in it, entry appears in the base-ref selector.
- Retry after a failed creation reuses the branch/worktree (no duplicate).
- `wt`/manually created worktrees appear after opening the selector (rescan)
  and at CLI reconnect.
- Removing a dirty worktree fails with a toast; a clean one disappears from
  the selector.
- Removing a clean worktree from its Connected CLIs row or its changes view
  menu removes the row; with its changes view open, the page returns to the
  threads page. A dirty one is refused with a toast whose "View changes" opens
  its changes view (row) or is disabled up front (changes view menu).
- Selecting a worktree, then switching the working directory, resets the
  selection to the current checkout.
- Non-git paths show no base-ref selector.
