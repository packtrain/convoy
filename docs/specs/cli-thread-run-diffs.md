# CLI Thread Run Diffs Specification

Per-run file change tracking for CLI threads (OS-1142), on-demand
patch/whole-file viewing (OS-1143), and inline review comments (OS-1155). After an agent run completes, the
thread shows a "Changes" card summarizing what files the run changed;
clicking a file fetches its patch or full content live from the connected
CLI. Modeled on t3code's checkpoint system (see
`docs/analysis/t3code-checkpoint-diffs.md`), adapted to convoy's run
model: one run (one assistant message) = one run.

## User-visible behavior

- When a completed assistant message has a change summary, a **Changes card**
  renders at the bottom of that message: a header with an icon tile, an
  "Edited N files" title, and roll-up `+additions −deletions` totals beneath
  it, then one row per file showing the path (directory muted, basename
  emphasized; deleted files struck through) with per-file `+/−` counts
  (`binary` for binary files).
- The file list is collapsed to the first 3 rows; a "Show N more files"
  footer toggles the full list ("Show fewer files" collapses it back).
  The card renders under **every** assistant message that has a summary, for
  the whole loaded history. Its header (file count, ±totals) and collapsed rows
  come from the envelope's compact preview; expanding a run with more files
  than the preview carries fetches the full list on demand and shows a
  "Loading files..." footer meanwhile, keeping the preview rows on screen
  (OS-1600).
- No card appears when: the working directory is neither a git repository nor
  a folder of repos ([multi-repo folders](#multi-repo-folders)), the
  run changed nothing, the run failed, or checkpoint capture failed for any
  reason. Checkpointing is strictly fail-soft — it never blocks or fails a
  run.
- Hovering a Changes-card file row swaps its `+/−` counts for two actions:
  **Mention in reply** (OS-1159) appends the file's `@path` mention pill to
  the thread composer and focuses it, and **Revert file** (OS-1156) restores
  that single file to its pre-run state after a confirmation naming the file
  (run-created files are deleted). The diff viewer's file section headers
  carry the same two actions next to "Open file". Per-file revert runs as a
  `revertFile` op (below) and surfaces its outcome as a toast.
- Renames display as a delete plus an add (diffs run with `--no-renames`).
- The list is capped at 200 files; the header title notes "(truncated)" when
  the cap was hit.
- The card header shows two actions when the thread context is known:
  **Review** opens the sidebar viewer on the run's first file, and **Undo**
  (OS-1151) reverts the working directory to the pre-run checkpoint after a
  destructive confirmation dialog that warns everything changed since the
  run — later runs and the user's own uncommitted edits — is discarded too.
  The revert runs as a `revertRun` op (below); the outcome surfaces as a
  toast. Undo is rejected while a claimed thread is running in the same path
  and errors cleanly when the checkpoint ref was already pruned.
- **Latest run** (OS-1882) is the **default view of the sidebar's Changes
  tab** (see `cli-thread-detail-sidebar.md`): the per-run viewer on the newest
  loaded run that has a change summary, following new runs as they land. The
  newest run's checkpoints are the last the CLI prunes, so a fresh open never
  hits a missing ref. When no loaded run has a change summary (or thread
  context is unknown) the tab shows a "No changes yet." placeholder instead.
- **All changes** (OS-1158) is selectable from the changes toolbar's view
  selector. It shows the sidebar
  viewer on the **cumulative range** — oldest loaded run's `preRef` to the
  newest run's `postRef` — fetched as one whole-range `diffFile` op. The
  loaded window (50 messages) can hold more runs than the CLI keeps
  checkpoints for (≈20, counting no-change runs), so on long threads the
  oldest `preRef` is pruned and the view fails with the "likely pruned"
  message below — which is why it is no longer the default. The
  file list (paths, kinds, ±counts, binary) is derived client-side from the
  fetched patch (`lib/threads/run-diff-patch.ts`), since no summary is
  stored for arbitrary ranges. Runs beyond the loaded message chunks fall
  outside the range. Mention-in-reply, "Open file" tabs, and inline review
  comments work as in the per-run viewer; cumulative comments are stored
  under their own `preRef..postRef` key (bare `postRef` would collide with
  the latest run's slice while deletion-side line numbers reference the
  thread-start state) and join the same composer pill and serialized
  feedback block. Per-file revert stays per-run only. A pruned checkpoint
  surfaces as a friendly "likely pruned" message
  (git's raw `bad revision` error is translated); an empty range shows "No
  changes between these checkpoints."
- **Working tree** (OS-2234) is the third item in the view selector, below
  "All changes". It shows every uncommitted change in the thread's checkout
  against `HEAD`, untracked files included, whoever made them: other threads
  in the same checkout and the user's own edits show up too. It renders the
  worktrees module's sidebar panel (`WorktreeChangesPanel`, see
  `cli-worktrees.md` → Worktree changes view) over the `worktreeChanges` op,
  so nothing is cached and there are no refs. The panel fetches when the view
  opens, on its Refresh button, and again whenever a new run with a change
  summary lands in this thread. A summary row above the sections shows
  `N files +A -D`, Refresh and Revert all. Per-file Revert (`revertWorkingFile`),
  Revert all (`revertWorkingTree`, typed `revert` confirmation), Open file and
  Download work as in the full-page view; Mention in reply works as in the
  run viewer. Review comments are off in this view for now; they need an
  anchor other than `postRef`. The toolbar's collapse-all, diff-style, wrap
  and file-tree toggles apply as in the other views. The item is hidden for a
  read-only viewer; an offline CLI shows the offline placeholder and a CLI
  older than 0.77.0 an update prompt.
- **History** (OS-2535) is the fourth item, below "Working tree", with the
  same visibility rule. It lists the commits of the thread's checkout through
  the worktrees module's History view (`cli-worktrees.md` → Commit history and
  the History bullet), at the panel's 560px in its one-pane layout: compact
  two-line rows, and a tapped commit opens in place. A panel widened past
  600px (full view) gets the two panes. The open commit lives in the thread
  workspace's state (the History view kind), not the URL, so browser Back
  does not step through commits, and a switch to or from full view (which
  remounts the panel) reopens it. One row above the list holds the List |
  Graph toggle (OS-2536: Graph adds a graph column to the two-line rows in
  the narrow panel, and is the table with the commit sidebar in a full view
  of 900px or more;
  `cli-worktrees.md` → Layout) and Refresh; over a commit in one pane "← All commits" takes the
  toggle's place, at Refresh's weight, so the panel spends one row on
  controls, not two. The diff toggles show only while History has a
  commit's diff on screen, which the view reports (`onDiffShownChange`): not
  over the one-pane list or a Graph table until a sidebar file opens a diff, but yes over
  a split panel widened past 600px that shows `HEAD`'s diff. The full-view toggle keeps keyboard focus
  across the switch. The list
  is fetched when the view opens, on Refresh, and again from the first page whenever a
  new run with a change summary lands in this thread (the newest run's
  `postRef`, as Working tree uses), so a commit the agent made shows up after
  its run; the open commit stays open. Patches come from the same per-tab
  cache as the worktree page. The collapse-all, diff-style and wrap toggles
  apply to the open commit; the file-tree toggle is hidden on History.
  Offline, an unsupported CLI (older than 0.171.0), a checkout no longer
  registered on the CLI and errors show the worktree page's copy; the Refresh
  row shows only when the list can be fetched.
- **Run timeline** (OS-1160) lives in the **changes toolbar's view selector
  dropdown** (below the "History" item; the selector button shows the
  active view label): a list of the loaded runs newest-first,
  each row labeled by the user prompt that triggered the run (falling back to
  "Untitled run") with `+/−` totals, file count, and relative time. Rows
  deliberately carry no "Run N" numbers — numbering would lie when older
  message chunks aren't loaded. Clicking a row anchors a **contiguous range
  selection** that live-highlights every row between the anchor and the
  hovered row (either direction); a second click switches the Changes tab to
  a **Runs \<from\>-\<to\>** view (1-based over the loaded runs; `Run <n>`
  for a single run) and closes the dropdown, showing the run-diff viewer on
  the combined range — oldest
  selected run's `preRef` to newest selected run's `postRef`, via the same
  derive-files-from-patch mechanism and `preRef..postRef` review-comment
  keying as the cumulative view (range keys opened in a session stay
  subscribed so pending comments keep pilling after the viewer closes; on
  reload they re-pill when the range is reopened). Clicking the same row
  twice opens that single run's range. Committing a range resets the
  selection. Each row has a hover **Restore
  to before this run** action that closes the dropdown and funnels into the
  existing `revertRun` confirmation and op. Pruned checkpoints aren't detectable client-side;
  the viewer's "likely pruned" error covers stale selections.
- Clicking a file row (binary rows excluded) opens the **run-diff viewer in
  the thread workspace sidebar** (the same right-hand split pane used for
  task details). Its file list is derived client-side from the whole-run patch
  it already fetches (`deriveFilesFromPatch`, the same mechanism as ranges and
  the cumulative view) rather than from the envelope's preview slice
  (OS-1600). Two consequences of deriving rather than reading stored rows:
  ±counts are **recomputed from patch lines**, so a truncated patch can disagree
  with the Changes card's stored roll-up totals for the same run; and a file in
  the stored summary but absent from the patch (truncation) no longer renders a
  row at all, where reading `diffSummary.files` produced a row with "Patch not
  available (run diff truncated)". The viewer's file list has always required
  the patch fetch to land — the Changes tab body is gated on it and falls back
  to the offline/error placeholder — so this is not a new online dependency.
  The viewer's **Changes tab** shows the whole run patch as
  collapsible per-file sections — sticky header per file (path, ±counts,
  collapse chevron, "Open file") — scrolled to the clicked file. "Open file"
  (hidden for deleted/binary files) opens the post-run file content in a
  **tab** next to Changes; the inner Changes/file tab strip (`FileTabStrip`
  in `components/custom/diff/`, shared with the worktree changes view, file
  icon plus base name per tab) only renders while at least one file tab is
  open (otherwise the hosting Changes sidebar tab is the panel's only chrome). Content is fetched on demand from the
  connected
  CLI; when the agent is offline the panel shows an offline placeholder
  instead. Large diffs stay responsive two ways: the fetched result renders
  through `useDeferredValue` (spinner paints first, tree renders
  concurrently), and each file's `PatchDiff` body lazy-mounts via
  IntersectionObserver only when scrolled near the viewport (a line-count
  height placeholder keeps the scrollbar honest; sections stay mounted once
  shown). Clicking a file row sets the Changes tab's view to that run
  (keyed by `postRef`; clicking a file of another run switches the view to
  that run, clicking another file of the same run refreshes the selection)
  and activates the Changes tab — only the active sidebar tab's panel is
  mounted (see `cli-thread-detail-sidebar.md`).

### Optional file tree

The Changes toolbar toggles a right-hand file tree, hidden by default with its
open/closed preference saved in browser local storage. It reuses the worktree
file tree in `components/custom/diff/worktree-file-tree.tsx`, including folder
collapse, file icons, and change counts. Its list follows the current viewer's
patch in latest-run, single-run, all-changes, and range views. No tree renders
while the patch is unavailable or empty. The diff and tree scroll independently.
Drag the divider on the tree's left edge to resize it, or focus it and use
Left/Right arrows, with Shift for larger steps. Width defaults to 224px and
persists in browser storage independently of visibility, bounded to 160–600px.
The displayed tree is capped at 60% of the available pane so the diff stays
visible on narrow layouts.
Selecting a file returns to Changes, expands that file's section, and scrolls
to it. The tree's Open file and Revert actions reuse the viewer's handlers;
Revert remains unavailable for cumulative/range views.

### Checkpoint checkout identity

New checkpoint commits carry `Convoy-Checkout`, containing the persistent local
Git checkout UUID and the relative working-directory prefix. Undo accepts a
moved worktree with the same identity and rejects a different checkout or scope.

For a legacy checkpoint without this trailer, the backend permits Undo only if
its ref identifies a thread in the same profile and current working path that
has never recovered into its parent. Unknown refs and legacy checkpoints from
recovered threads remain readable but cannot be undone. This decision is passed
to the CLI as `allowLegacyCheckpoint`; an absent flag denies legacy Undo.
Modern checkpoints always validate their own identity, regardless of that flag.

The local identity and recovery contracts are defined in `cli-worktrees.md`.

## Code diff theme (OS-1684)

- **User Settings → Appearance** is its own section (own sidebar tab, palette
  icon), holding the app theme picker moved out of General plus a **Code diff
  theme** select above a live preview diff. Picking a preset re-themes the
  preview and every mounted diff surface immediately, no reload and no remount:
  the `@pierre/diffs` React wrapper diffs its `options` (`areOptionsEqual`
  special-cases `theme`) and force-renders in place.
- Presets are curated light/dark pairs: Pierre (default), GitHub, GitHub High
  Contrast, Catppuccin, Vitesse, Ayu, Everforest, Gruvbox, Kanagawa, Material,
  Night Owl, Rosé Pine, Solarized, Slack. Arbitrary theme IDs are deliberately
  not accepted: the library resolves names through Shiki's bundled themes and
  **throws asynchronously** on an unknown one, so an unrecognized stored value
  falls back to Pierre.
- A preset is only admissible when both members are bundled by Shiki,
  self-report the matching `light`/`dark` type, and carry diff +/− colors.
  `diff-theme-prefs.test.ts` asserts all three per preset, so a typo'd or
  unsuitable theme name fails the suite instead of throwing at render time.
- The preview patch lives in `code-diff-theme-preview.ts` and is built from an
  array of lines, not a template literal: every hunk body line needs a diff
  prefix, so a blank context line is a single space — which editors and
  formatters silently strip from a literal. Pierre's `parseLineType` only
  `console.error`s (`Invalid firstChar` / `invalid rawLine`) and skips the line,
  so a malformed patch degrades quietly rather than failing loudly.
  `code-diff-theme-preview.test.ts` runs the patch through pierre's own
  `processFile`, asserts nothing is logged, and checks the hunk header counts
  against the body.
- The preview patch carries both an addition and a deletion on purpose. A
  preset changes more than syntax tokens: pierre derives the +/− and modified
  colors from the theme's `gitDecoration.*` keys, falling back to
  `terminal.ansi*`, and emits nothing when a theme has neither (pierre's own
  defaults then show through). `light-plus`, `one-light`, `dark-plus`,
  `min-dark`, `red` and `vesper` are excluded for exactly this reason.
- The app's appearance setting still chooses which member of the pair renders.
  Every surface passes `themeType` from the resolved `next-themes` value:
  the library default is `system`, which picks light-vs-dark from the OS via
  CSS `light-dark()` and so contradicts an explicit in-app theme.
- Persistence is **device-local** (`localStorage`, key
  `convoy.code-diff-theme`), matching the Appearance section's "on your
  device" copy and the Changes panel's own view preferences. Account-synced
  selection via `userPreferences` remains a possible follow-up.
- Module layout: presets, storage and the change event in
  `lib/threads/diff-theme-prefs.ts`; `useDiffTheme()` (returning the
  `theme`/`themeType` options pair) and `useDiffThemePreset()` in
  `lib/threads/hooks/use-diff-theme.ts`, a `useSyncExternalStore` store so a
  settings change reaches already-mounted diffs in the same tab (custom
  event) and other tabs (`storage`). The settings UI is
  `components/blocks/user/settings/appearance-section.tsx` (registered as the
  `appearance` section in `user-settings-dialog.tsx`) with the select and
  preview in `code-diff-theme-field.tsx`. All four renderers —
  `file-change-tool-part.tsx`, `apply-changes-tool-part.tsx`,
  `convoy-artifact-part.tsx`, `run-file-viewer-panel.tsx` — consume the
  hook instead of a per-file `THEME` constant.
- Markdown code blocks follow the same preset (OS-2256). `useCodeTheme()` in
  the same hook file returns the diff pair and a `[light, dark]` Shiki pair
  for `MessageResponse`. Pierre's themes exist only inside `@pierre/diffs`, so
  the Pierre preset falls back to `github-light` / `github-dark-high-contrast`
  for markdown. Both members are highlighted at once and CSS picks one under
  `.dark`, so code does not re-highlight while the app theme resolves.
- Terminal tool blocks use theme tokens rather than a code theme
  (`cli-thread-tool-parts.md`).

## Diff file tree side

- **User Settings → Appearance → Diff file tree** picks Left or Right (default
  Right) for the changed-files tree beside every diff: the thread Changes tab,
  the worktree changes panel and view, and a pull request's Diff tab.
- Device-local like the code diff theme (`localStorage` key
  `convoy.changes-file-tree-side`, unknown values read as Right). A change
  moves every mounted tree at once through `useFileTreeSide()` in
  `lib/threads/changes-view-prefs.ts`, without a reload.
- On the left the resize handle moves to the tree's right edge and the border
  flips. Mobile drawers are unchanged.
- Every one of these views ends its changes toolbar with the same file tree
  toggle, rendered by `ChangesViewToggles`: "Hide file tree" (pressed) while
  the tree is open, "Show file tree" while closed. It never disappears, and its
  panel icon points to the tree's side.
- Hosts on `ThreadWorkspaceSplitPane` pass `sidebarSide`. The inline trees
  render through `components/custom/diff/file-tree-pane.tsx`, which reads the
  setting itself.
- Every tree opens with the same "Files" row, `FileTreeHeader` in
  `file-tree-pane.tsx`, sized to the row beside it. Beside a changes toolbar
  (pull request Diff tab) it is 41px with the toolbar's `bg-card`. Below a
  full-width toolbar (thread Changes tab, worktree page) it is 37px with no
  background, level with the first diff file header. Split-pane hosts (worktree view, pull request Diff
  tab) add its close button; the inline trees in the thread Changes tab have
  none, because the toolbar's toggle sits right above them.
- No CLI command: this is a per-browser view preference (hard rule 19).

## Fetch errors (OS-2256)

- A failed file or diff fetch in the run file viewer
  (`run-file-viewer-panel.tsx`) and the worktree changes view
  (`worktree-changes-body.tsx`) shows the error with a `Retry` button. Retry
  clears the error and requests the file, diff or changes again.

## Git checkpoints (CLI side)

`apps/cli/src/lib/git/checkpoint.ts`.

- Ref format: `refs/convoy/checkpoints/{threadId}/{runId}/{pre|post}`.
  Hidden refs — invisible to branch listings and the user's normal git
  workflow, but they keep snapshot objects reachable across `git gc`.
- Capture recipe (never touches the user's index, HEAD, or working tree):
  temp dir + `GIT_INDEX_FILE` → `git read-tree HEAD` (or `--empty` when the
  repo has no HEAD yet) → `git add -A -- .` → `git write-tree` →
  `git commit-tree` (with a fixed fallback ident) → `git update-ref`.
  Untracked-but-not-ignored files are included; ignored files are not.
- Capture is idempotent per ref: an existing ref is left untouched.
- **Pre checkpoint**: captured in the thread processor after
  `startRunResponse` succeeds and any pending worktree is resolved (so the
  final working directory is known), before the runner executes.
- **Post checkpoint + summary**: captured after the runner finishes, before
  `cli.messages.complete`. The summary comes from
  `git diff --numstat --no-renames -z pre post` joined with
  `--name-status --no-renames -z` (kind). Binary files report `-` counts and
  are stored with `binary: true` and zero counts.
- An empty diff produces no summary (the `complete` call omits it).
- **Pruning**: after each post capture, refs under the thread's prefix are
  sorted by `-creatordate` and only the newest 40 (≈20 runs) are kept.

### Multi-repo folders

When the working directory holds repos and isn't one itself
([Multi-repo projects](cli-multi-repo-projects.md#discovery)), each repo is
checkpointed on its own, with the same ref names. This holds even when the
folder sits inside another checkout, whose tree wouldn't see the child repos'
files; a folder with no child repos falls back to the single-repo capture. A
thread in one repo of the folder, or in its worktree, checkpoints its own
checkout plus the folder's other repos, with paths relative to the folder
([picking a repo](cli-multi-repo-projects.md#checkpoints)). `captureRunBaseline` and
`captureRunChanges` in `checkpoint.ts` do it; the cost controls are t3code's
(`CheckpointCaptureService.ts`):

- **Clean repos are skipped.** At run start a repo with a clean tree gets one
  `git --no-optional-locks status --porcelain=v2 --branch
  --untracked-files=normal` and no snapshot; its HEAD is kept. The flags keep
  the real index unrefreshed (no `index.lock`) and count untracked files
  whatever `status.showUntrackedFiles` says. At run end it gets one more
  `git status`, and nothing else if it is still clean on the same HEAD. One that
  changed gets its pre ref from the recorded HEAD's tree (with the
  `Convoy-Checkout` trailer, so Revert file works), then the usual post
  capture. A dirty repo is snapshotted at start as a single repo is.
- **6 repos at a time**, at start and at end.
- **5 s per baseline capture**: the status and, for a dirty repo, every git
  command of its snapshot (`git add -A` into the temporary index through
  `update-ref`) share one deadline. After 2
  consecutive timeouts in a repo (a baseline that finishes resets the count),
  the worker stops taking its baseline until it restarts, and logs it once.
- **Fail-soft per repo.** A repo whose capture fails is left out of the card
  and logged. The run's other repos still report, and the run never fails.
- The summary's files carry `repo` (the repo's relative path) and a `path`
  relative to that repo. `repos` lists every changed repo in file order, even
  one whose files the cap cut. The 200-file cap is for the run as a whole, and
  a truncated repo marks the run truncated.
- A backend older than CLI 0.187.0 rejects the new fields. The CLI then
  completes the run once more without a summary, so the run succeeds with no
  card.

`cli.messages.complete` resolves each `repos[]` entry to its repo entry id
(`pathId`) from the thread's folder in the profile (one profile read, only for
a multi-repo summary), joining on the entry's `label`, which is the repo's
relative path. An id sent by the CLI is dropped. A repo with no entry at that
moment (not synced yet, or a repo that is also a configured path) keeps no
`pathId` for good: its files show on the card without diff or revert. The
envelope preview adds each repo's own `fileCount`, `additions` and
`deletions`, counted from the stored files.

On the web:

- The Changes card groups files under a repo header. The header totals cover
  every repo. A row's file diff and Revert file target its repo entry, and
  Mention in reply names `repo/path`. A repo with no `pathId` lists its files
  but offers no diff or revert. Undo is not offered: it restores one checkout,
  and the run has several. Each file's button is named by its `repo/path`, and
  the repo headers stay out of the list's accessibility tree. Row actions show
  on hover and on focus within the row, so Tab reaches them.
- The sidebar's Changes tab shows one repo at a time, picked by the repo
  switcher in front of the view selector
  ([Multi-repo projects](cli-multi-repo-projects.md#repo-switcher)). Latest
  run, All changes, the run timeline and ranges keep only the runs that changed
  that repo, with the repo's own counts. Fetched patches are cached per
  checkout (`profileId`, `pathId`) as well as by refs: every repo of a run
  uses the same checkpoint ref names. The default repo settles once the
  messages load, so a new run in another repo never moves an open view; a
  repo change from any source sends a run or range view back to Latest run. Working tree and History run their ops on the repo entry. Opening a file
  from a card switches to that file's repo. Review comments and the timeline's
  restore action are off in a repo-scoped view: comments name files from the
  working directory, and restore has the same one-checkout problem as Undo.
- Summaries without `repos` (single-repo runs, older CLIs) render as before.

## Data model (Convex)

- `cliMessages.diffSummary` (optional, assistant messages only):
  `{ preRef, postRef, files: [{ path, kind: added|modified|deleted,
  additions, deletions, binary?, repo? }], truncated?, repos?: [{ path,
  pathId? }] }` (`repo`/`repos`: [multi-repo folders](#multi-repo-folders)) — validators in
  `convex/lib/contracts/validators.ts` (`cliRunDiffSummaryValidator`).
- Written by `cli.messages.complete` via the new optional `diffSummary` arg.
  The server re-caps `files` at 200 entries (sets `truncated`) as a guard
  against oversized payloads from older/foreign CLI builds.
- Exposed to the client two ways (OS-1600):
  - `listByThread` (paginated message items) carries the **full** summary.
  - `listEnvelopesByThread` carries a **compact preview**
    (`cliRunDiffSummaryPreviewValidator`): `preRef`, `postRef`, roll-up
    `additions` / `deletions`, the true `fileCount`, `truncated`, and the first
    `DIFF_SUMMARY_PREVIEW_FILES = 5` file rows. That query is subscribed and
    re-runs on every message write in the thread, so shipping 200-file lists
    for every historical run would be re-sent each time.
  - `cli.messages.getRunDiffSummary({ messageId })` returns the full stored
    summary on demand — used when a Changes card is expanded.
- `cliThreads.git.linesAdded` / `git.linesRemoved` (optional, OS-1252): cumulative
  totals across the thread's completed runs, incremented by the same
  `complete` call from the **uncapped** `diffSummary` payload (the 200-file
  cap drops file rows, not line counts). Unset when no run ever carried a
  summary — threads predating the field are never backfilled and render "—"
  in list surfaces (Watch Tower dashboard, OS-1220, and the compact thread
  row's branch hover card). Exposed on the thread
  item shape (`get`, `listByProject`, `listByAssociatedTask`).
- Watch Tower containers omit line totals (OS-1984). Child diffs can overlap,
  and the app does not compute group-wide totals. See `watch-tower.md`.
- Full diff text and file contents are **never durably** stored in Convex;
  only paths, kinds, and line counts. Content retrieval is on-demand via the
  op channel below, whose rows are pruned after 10 minutes.

## On-demand file viewing (OS-1143)

Reuses the `cliWorktreeOps` channel (`docs/specs/cli-worktrees.md`) with two
file-op kinds. The web enqueues an op for the thread's profile + path entry
and watches the row; the connected CLI fulfills it from the checkpoint refs.

- `readFile { filePath, postRef }` → `git show postRef:filePath`. Fails with
  a user-facing message for missing blobs (pruned checkpoint / deleted file),
  binary content (NUL-byte check), or blobs over 5 MB. Without `postRef` it
  reads the working tree instead (`docs/specs/cli-worktrees.md`, OS-2041).
- `diffFile { filePath?, preRef, postRef }` → unified patch
  (`git diff --no-renames preRef postRef [-- filePath]`). Without `filePath`
  it returns the **whole-run patch** — the viewer fetches that once per run
  and splits it per file client-side (on `diff --git` boundaries, path from
  the `+++ b/`/`--- a/` headers).
- `revertRun { preRef }` → restore the working tree to the pre-run
  checkpoint (t3code's recipe): `git restore --source preRef --worktree
  --staged -- .` → `git clean -fd -- .` → `git reset --quiet -- .`. Tracked
  and untracked files revert; HEAD and branches are untouched and the user's
  index ends at HEAD (changes unstaged). Enqueue rejects while any claimed
  thread runs in the path; the CLI errors when the ref was pruned.
- `revertFile { preRef, filePath }` (OS-1156) → restore one file to its
  pre-run state: present in the checkpoint → `git restore --source preRef
  --worktree --staged -- path`; absent (the run created it) → the file is
  deleted from disk; either way `git reset --quiet -- path` leaves the index
  at HEAD. Same guards as `revertRun`. Deliberately a **distinct op kind**
  (not `revertRun` + `filePath`): a pre-0.20 CLI fails an unknown kind
  cleanly instead of silently reverting the whole run.
- Results (`{ content | patch, truncated }`) are capped at 700 kB serialized
  with a `truncated` flag, keeping resultJson under Convex's 1 MB doc limit.
- Checkpoint refs are shared across worktrees of one repo, so ops run in the
  op's snapshot path regardless of where the run executed.
- The client caches results per `(preRef, postRef, filePath, kind)` for the
  session — refs are immutable, so cached content never goes stale. `preRef`
  is part of the key because a range and a run can end at the same `postRef`
  (OS-1883). The whole-run patch caches under an empty `filePath`.
- Version skew: a pre-0.18 CLI receiving a file op fails it (fail-soft; a
  0.17 build rejects whole-run diffs specifically); the viewer surfaces the
  error. Restarting the agent picks up the handlers.

## Inline review comments (OS-1155)

Claude Code-style review loop on the run-diff viewer. Pure web feature — no
backend or CLI changes; the sent thread message is the durable record.

- Clicking any diff line in a Changes-tab file section opens an inline
  comment editor card under that line (diff lines get hover highlighting as
  the affordance). Save with the Comment button or Cmd/Ctrl+Enter; Escape
  cancels. Saved comments render as inline card rows with edit/delete
  actions; one comment per line (saving on the same line replaces it).
- Comment anchors are `(postRef, path, side, lineNumber)` — additions use
  post-run numbering, deletions pre-run numbering, matching the renderer's
  line-click coordinates. A ±2-line diff excerpt is captured from the run
  patch **at comment time** and stored with the comment, so later
  serialization never needs the patch.
- **Persistence**: unsent comments live in localStorage
  (`convoy.run-review-comments`), keyed per run by `postRef` — or by
  `preRef..postRef` for comments made in the cumulative All-changes view —
  pruned to the newest 20 slices, all access fail-soft. A page refresh
  keeps them; they do not sync across devices (OS-1161 moves storage to
  Convex). The thread page subscribes to every historical cumulative range
  key (thread-start `preRef` × each loaded run's `postRef`), so a
  cumulative draft keeps pilling after a newer run lands.
- **Composer pill**: pending comments across all of the thread's loaded
  runs surface as a pill in the composer's attachment row — one comment
  shows its trimmed note (40 chars), more show "N review comments". The
  pill counts as queued content, so send works with an empty input. Its
  remove action asks for confirmation, then deletes all pending comments
  without sending.
- **Sending**: on submit, the serialized feedback block — comments sorted
  by path then line, each `@path (line N):` + the stored ```diff excerpt +
  the note; deletion-side comments read `removed line N` — is appended to
  the outgoing message text after a blank line (or is the whole text when
  the input is empty). Comments clear only after the send succeeds.
  Runtime commands (e.g. `/compact`) are sent verbatim; the pill waits for
  the next normal message.
- Module layout: pure helpers in `lib/threads/run-review-comments.ts`
  (storage, excerpt extraction, message composition, pill label),
  `useThreadRunReviewComments` hook in `lib/threads/hooks/` (owned by the
  thread page; the viewer receives its run's slice via the `review` prop),
  pill in `run-review-comments-pill.tsx`, diff-line UI in
  `run-file-viewer-panel.tsx` via `@pierre/diffs` `lineAnnotations` /
  `renderAnnotation` / `onLineClick`. The composer exposes a generic
  `extraAttachmentPills` slot for this.
- Deferred: multi-line/range comments (OS-1163; pierre's
  `enableLineSelection` is the likely mechanism).

## UI

- `components/blocks/thread/run-changes-card.tsx`, rendered by
  `AssistantCliMessage` between the message parts and the run-stats footer
  when `diffSummary` is present. Rows are buttons when the page provides an
  `onOpenDiffFile` callback (threaded from `thread-workspace`).
- `components/blocks/thread/run-timeline-panel.tsx` — the run timeline
  (OS-1160), now embedded in the changes toolbar's view selector dropdown;
  run list + range math in `lib/threads/run-timeline.ts`.
- `components/blocks/thread/thread-sidebar-tabs.tsx` — the fixed underline
  tab bar (`ThreadSidebarTabBar`: Changes, Tasks, task detail), the
  `ThreadChangesToolbar` (view selector row above the Changes panel), and the
  `ThreadChangesView` union; panel/view state lives in
  `thread-workspace`.
- `components/custom/diff/patch-file-sections.tsx` (OS-2040) — the per-file
  presentation every diff surface shares: `PatchFileSection` (sticky header
  with chevron, muted directory + file name, ±counts or "binary", an
  `actions` slot; body hidden while collapsed, a fixed note for binary
  files, otherwise the caller's `PatchDiff` mounted lazily through an
  IntersectionObserver with an 800px margin and a ~20px-per-line
  placeholder) and `usePatchDiffOptions` (theme, split/unified, wrap, no
  library header). The thread panel and the worktree changes view
  (`cli-worktrees.md`) both render it; the PR reader
  (`github-integration.md`) is the next consumer. Generic UI next to
  `custom/charts`: a feature module may import it, never the reverse.
- `components/blocks/thread/run-file-viewer-panel.tsx` — the sidebar panel:
  the shared `FileTabStrip` (Changes + closable per-file tabs), the Changes
  tab's per-file accordion (`PatchFileSection` with the mention, revert and
  "Open file" actions and the review-comment annotations), full-file tabs
  rendered with `File`, spinner while fetching, error and agent-offline
  placeholders, truncation notes. Panel/view state lives in `thread-workspace`
  (`activePanel`/`changesView`), which renders the active panel as
  `ThreadWorkspaceSplitPane` sidebar content below the tab bar, keyed by
  `postRef` (or `preRef:postRef` for ranges) so tab/collapse state resets
  per run.

## Related

- OS-1144 — `@` file mentions in the composer (OS-1159 added "Mention in
  reply" from Changes-card rows; see `cli-composer-file-mentions.md`).
- OS-1151 — one-click revert to the pre-run checkpoint (OS-1156 added
  per-file revert; supersedes the old OS-653 backlog item).
- OS-1161 — persist run review comments in Convex (follow-up to OS-1155).
- OS-1163 — multi-line/range review comments (follow-up to OS-1155).
- OS-1164 — persistent reverted-state feedback on Changes cards (follow-up
  to OS-1151/OS-1156; today a revert only shows a transient toast).
- `docs/analysis/t3code-checkpoint-diffs.md` — reference implementation.
