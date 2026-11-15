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

The web composer is not the only initiator: MCP `create_thread` forwards the
same spec, unsanitized and shape-checked only, to `create` and `addThreadToGroup`
alike (OS-1222). An agent spawning beside a thread that already runs in a
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
"revertWorkingFile" | "revertWorkingTree" | "downloadFile", pathId }` plus
  `filePath`/`preRef`/`postRef` for file/revert ops, `filePaths` for
  `revertWorkingTree`, and `query` for searches. `readFile` needs only `filePath`:
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
in v1). On success it runs `git worktree remove`, re-syncs the parent (entry
disappears from the profile), and completes the op. The local branch is not
deleted. Threads keep their path snapshot until the next run validates and,
when necessary, repairs their execution target.

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
  parent. A matching administrative directory identifies a moved worktree even
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
    (laptop icon) / `Worktree` (branch icon) / `New worktree` (plus icon).
    Dropdown (no search input): "Work locally" (badge shows the current
    branch when known), the parent's worktrees (each with the inline
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
show a branch icon with `Worktree`. A separate branch chip uses the detail
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
`/threads?profileId&pathId&view=changes`, recognised by
`parseWorktreeChangesTarget` in `lib/navigation`. `ThreadWorkspaceHost`
renders it in place of the new-thread composer; a thread URL still wins. The
threads layout uses the same helper, so on mobile the view is a full-screen
conversation like a thread, not the list. The view's grid column is
`minmax(0,1fr)`: an auto column takes the longest diff line's width and pushes
every row, header included, past a phone viewport. The right pane is the file tree
(below); the task pane is absent, and a `task=` param is ignored while
`view=changes` is present.

- Header: the worktree's branch (or the checkout's label) and a Refresh
  button. Below it a 41px toolbar row (same height as the thread Changes
  toolbar, so it lines up with the sidebar's "New thread" row) with the full
  path, `N files +A -D` once the patch is in, and the Changes tab's three
  toggles on the right: collapse/expand all, split/unified, word wrap
  (`components/custom/diff/changes-view-toggles.tsx`, shared with
  `ThreadChangesToolbar`). Diff style and
  wrap read and write the same localStorage preferences as the thread tab.
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
- File tree (OS-2037, `components/custom/diff/worktree-file-tree.tsx`): the changed files nested by
  folder in `ThreadWorkspaceSplitPane`'s sidebar, titled "Files". Folders come
  first, in patch order, each with the ±sum of its files and a chevron that
  collapses it; single-child folder chains are joined into one row
  (`components/custom/diff/file-tree.ts`). File rows show the name, ±counts (or
  "binary"), deleted files struck through. Clicking a file marks it selected,
  expands its section if collapsed, and scrolls the middle pane to it. The
  pane only appears once the patch has files, hides on mobile, and its close
  button is undone by a "Show files" button in the header.
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
- Selecting a worktree, then switching the working directory, resets the
  selection to the current checkout.
- Non-git paths show no base-ref selector.
