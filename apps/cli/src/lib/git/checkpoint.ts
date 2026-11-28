import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCommandError, runGit } from "./exec.js";
import { folderCheckoutPaths, folderRepoPaths, getCheckoutIdentity, mapLimited, repoRelativePath } from "./repo.js";

/**
 * Hidden-ref git checkpoints around a thread run (OS-1142).
 *
 * A checkpoint is a commit built from a temporary index (GIT_INDEX_FILE), so the user's
 * real index, HEAD and branches are never touched. Refs under
 * refs/convoy/checkpoints/ keep the objects reachable across gc; old refs are pruned
 * per thread.
 */

export interface RunDiffFile {
  /** Relative to `repo` when set, else to the working directory. */
  path: string;
  /** The repo's relative path in a multi-repo folder. */
  repo?: string;
  kind: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary?: boolean;
}

export interface RunDiffSummary {
  preRef: string;
  postRef: string;
  files: RunDiffFile[];
  truncated?: boolean;
  /** Multi-repo folder: the repos with changes, in `files` order. */
  repos?: { path: string }[];
}

export const MAX_DIFF_FILES = 200;

// Refs per thread to retain (2 per run). Older checkpoints become
// unreachable and are eventually gc'd with their objects.
const MAX_REFS_PER_THREAD = 40;

export const CAPTURE_TIMEOUT_MS = 120_000;
const WORKSPACE_TRAILER = "Convoy-Checkout: ";

async function checkpointWorkspace(cwd: string, deadline?: number): Promise<string> {
  const prefix = await runGit(cwd, ["rev-parse", "--show-prefix"], { timeoutMs: timeLeft(deadline) });
  return JSON.stringify([await getCheckoutIdentity(cwd, timeLeft(deadline)), prefix.stdout.trim()]);
}

/** Time left before `deadline` for one git command, else `fallback` (the command's default). */
function timeLeft(deadline: number | undefined, fallback?: number): number | undefined {
  return deadline === undefined ? fallback : Math.max(1, deadline - Date.now());
}

// Snapshot commits need an ident even in repos without user.name/email.
const IDENT_ARGS = ["-c", "user.name=convoy", "-c", "user.email=cli@convoy.build"];

export function checkpointRef(threadId: string, runId: string, phase: "pre" | "post"): string {
  return `refs/convoy/checkpoints/${threadId}/${runId}/${phase}`;
}

async function refExists(cwd: string, ref: string, deadline?: number): Promise<boolean> {
  const result = await runGit(cwd, ["rev-parse", "--verify", "--quiet", ref], { allowNonZeroExit: true, timeoutMs: timeLeft(deadline) });
  return result.exitCode === 0;
}

async function isGitWorkTree(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], { allowNonZeroExit: true });
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

/**
 * Stage the whole working tree (tracked + untracked-but-not-ignored files)
 * into a temporary index and hand its env to `fn`. The user's real index is
 * never touched. Shared by checkpoints and the worktree changes view. A
 * `deadline` (epoch ms) bounds every git command in it.
 */
export async function withWorkingTreeIndex<T>(
  cwd: string, fn: (env: { GIT_INDEX_FILE: string }) => Promise<T>, deadline?: number,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), "convoy-index-"));
  const env = { GIT_INDEX_FILE: join(tempDir, "index") };
  try {
    const head = await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], { allowNonZeroExit: true, timeoutMs: timeLeft(deadline) });
    if (head.exitCode === 0) {
      await runGit(cwd, ["read-tree", "HEAD"], { env, timeoutMs: timeLeft(deadline) });
    } else {
      await runGit(cwd, ["read-tree", "--empty"], { env, timeoutMs: timeLeft(deadline) });
    }
    await runGit(cwd, ["add", "-A", "--", "."], { env, timeoutMs: timeLeft(deadline, CAPTURE_TIMEOUT_MS) });
    return await fn(env);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Snapshot the working tree into a commit stored at `ref`. Idempotent: an
 * existing ref is left untouched. A `deadline` (epoch ms) bounds every git command.
 */
export async function captureCheckpoint(cwd: string, ref: string, deadline?: number): Promise<void> {
  if (await refExists(cwd, ref, deadline)) {
    return;
  }

  await withWorkingTreeIndex(cwd, async (env) => {
    const tree = (await runGit(cwd, ["write-tree"], { env, timeoutMs: timeLeft(deadline) })).stdout.trim();
    await writeCheckpointCommit(cwd, ref, tree, deadline);
  }, deadline);
}

async function writeCheckpointCommit(cwd: string, ref: string, tree: string, deadline?: number): Promise<void> {
  const message = `convoy checkpoint ${ref}\n\n${WORKSPACE_TRAILER}${await checkpointWorkspace(cwd, deadline)}`;
  const commit = (await runGit(cwd, [...IDENT_ARGS, "commit-tree", tree, "-m", message], { timeoutMs: timeLeft(deadline) })).stdout.trim();
  await runGit(cwd, ["update-ref", ref, commit], { timeoutMs: timeLeft(deadline) });
}

/**
 * Capture the pre-run baseline for a run. Returns false when the working
 * directory is not a git repo (post-run capture should then be skipped too).
 */
export async function capturePreRunCheckpoint(cwd: string, threadId: string, runId: string): Promise<boolean> {
  if (!(await isGitWorkTree(cwd))) {
    return false;
  }
  await captureCheckpoint(cwd, checkpointRef(threadId, runId, "pre"));
  return true;
}

/**
 * Capture the post-run checkpoint and diff it against the run baseline.
 * Returns null when nothing changed. Also prunes old checkpoint refs for the
 * thread as a side effect.
 */
export async function captureRunDiffSummary(cwd: string, threadId: string, runId: string): Promise<RunDiffSummary | null> {
  const preRef = checkpointRef(threadId, runId, "pre");
  const postRef = checkpointRef(threadId, runId, "post");
  await captureCheckpoint(cwd, postRef);
  await pruneCheckpointRefs(cwd, threadId);

  // ponytail: --no-renames keeps parsing uniform (renames show as
  // delete+add); switch to -M plus a previousPath field if that reads poorly.
  const [numstat, nameStatus] = await Promise.all([
    runGit(cwd, ["diff", "--numstat", "--no-renames", "-z", preRef, postRef], { timeoutMs: CAPTURE_TIMEOUT_MS }),
    runGit(cwd, ["diff", "--name-status", "--no-renames", "-z", preRef, postRef], { timeoutMs: CAPTURE_TIMEOUT_MS }),
  ]);

  const files = parseDiffSummary(numstat.stdout, nameStatus.stdout);
  if (files.length === 0) {
    return null;
  }
  if (files.length > MAX_DIFF_FILES) {
    return { preRef, postRef, files: files.slice(0, MAX_DIFF_FILES), truncated: true };
  }
  return { preRef, postRef, files };
}

/** What a run's pre-run capture covered: the working directory's repo, or the repos of a multi-repo folder. */
export type RunBaseline = { kind: "repo" } | { kind: "folder"; repos: RepoBaseline[] };

/** A repo of a multi-repo folder at run start. A clean one has no pre checkpoint yet, only its HEAD. */
export interface RepoBaseline {
  path: string;
  relativePath: string;
  head: string | null;
  clean: boolean;
}

// Spec: docs/specs/cli-thread-run-diffs.md#multi-repo-folders (t3code's CheckpointCaptureService limits).
const REPO_CAPTURE_CONCURRENCY = 6;
const BASELINE_TIMEOUT_MS = 5_000;
const MAX_BASELINE_TIMEOUTS = 2;
// Consecutive timeouts per repo path; a baseline that finishes resets it.
const baselineTimeouts = new Map<string, number>();

/**
 * Pre-run capture for the working directory: its own repo, or each repo of a
 * multi-repo folder. `folder` is the project folder of a repo or worktree
 * thread, whose checkouts are all captured. Null when there is no repo to checkpoint.
 */
export async function captureRunBaseline(
  cwd: string, threadId: string, runId: string, options: { baselineTimeoutMs?: number; folder?: string } = {},
): Promise<RunBaseline | null> {
  // A folder that is a repo itself (a worktree nested in a single repo) falls back to the cwd's own capture.
  const checkouts = options.folder ? await folderCheckoutPaths(options.folder, cwd) : null;
  const root = checkouts && options.folder ? options.folder : cwd;
  const paths = checkouts ?? await folderRepoPaths(cwd);
  if (!paths) {
    return (await capturePreRunCheckpoint(cwd, threadId, runId)) ? { kind: "repo" } : null;
  }
  const ref = checkpointRef(threadId, runId, "pre");
  const budget = options.baselineTimeoutMs ?? BASELINE_TIMEOUT_MS;
  const repos = await mapLimited(paths, async (path): Promise<RepoBaseline | null> => {
    // A repo thread's own checkout keeps the single-repo capture's timeouts and is never dropped.
    const own = checkouts !== null && path === cwd;
    if (!own && (baselineTimeouts.get(path) ?? 0) >= MAX_BASELINE_TIMEOUTS) return null;
    // One budget for the repo's status and snapshot.
    const deadline = own ? undefined : Date.now() + budget;
    try {
      const state = await readRepoState(path, own ? undefined : budget);
      if (!state.clean) await captureCheckpoint(path, ref, deadline);
      baselineTimeouts.delete(path);
      return { path, relativePath: repoRelativePath(root, path), ...state };
    } catch (error) {
      if (error instanceof GitCommandError && error.timedOut && !own) {
        const timeouts = (baselineTimeouts.get(path) ?? 0) + 1;
        baselineTimeouts.set(path, timeouts);
        if (timeouts === MAX_BASELINE_TIMEOUTS) console.warn(`[Checkpoint] ${path}: baseline timed out twice; its changes are no longer tracked`);
      } else {
        console.warn(`[Checkpoint] ${path}: baseline failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return null;
    }
  }, REPO_CAPTURE_CONCURRENCY);
  return { kind: "folder", repos: repos.filter((repo): repo is RepoBaseline => repo !== null) };
}

/**
 * Post-run capture and change summary for a baseline from `captureRunBaseline`.
 * A repo still clean on the same HEAD costs one `git status`; a failed repo is left out.
 */
export async function captureRunChanges(
  cwd: string, baseline: RunBaseline, threadId: string, runId: string,
): Promise<RunDiffSummary | null> {
  if (baseline.kind === "repo") {
    return captureRunDiffSummary(cwd, threadId, runId);
  }
  const preRef = checkpointRef(threadId, runId, "pre");
  const summaries = await mapLimited(baseline.repos, async (repo) => {
    try {
      if (repo.clean) {
        const now = await readRepoState(repo.path);
        if (now.clean && now.head === repo.head) return null;
        if (!(await refExists(repo.path, preRef))) await writeCheckpointCommit(repo.path, preRef, repo.head ? `${repo.head}^{tree}` : await emptyTree(repo.path));
      }
      return await captureRunDiffSummary(repo.path, threadId, runId);
    } catch (error) {
      console.warn(`[Checkpoint] ${repo.path}: post-run capture failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }, REPO_CAPTURE_CONCURRENCY);
  const files = baseline.repos.flatMap((repo, i) => (summaries[i]?.files ?? []).map((file) => ({ ...file, repo: repo.relativePath })));
  if (files.length === 0) {
    return null;
  }
  // The cap is for the run's files as a whole; `repos` still names every changed repo.
  const changed = new Set(files.map((file) => file.repo));
  return {
    preRef,
    postRef: checkpointRef(threadId, runId, "post"),
    files: files.slice(0, MAX_DIFF_FILES),
    ...(files.length > MAX_DIFF_FILES || summaries.some((summary) => summary?.truncated) ? { truncated: true } : {}),
    repos: baseline.repos.filter((repo) => changed.has(repo.relativePath)).map((repo) => ({ path: repo.relativePath })),
  };
}

/**
 * HEAD and cleanliness from one `git status`. Untracked files count whatever the user's config says,
 * and the real index is never refreshed (no `index.lock`).
 */
async function readRepoState(cwd: string, timeoutMs?: number): Promise<{ head: string | null; clean: boolean }> {
  const args = ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "--untracked-files=normal", "-z"];
  const entries = (await runGit(cwd, args, { timeoutMs })).stdout.split("\0").filter(Boolean);
  const oid = entries.find((entry) => entry.startsWith("# branch.oid "))?.slice("# branch.oid ".length);
  return { head: oid && oid !== "(initial)" ? oid : null, clean: entries.every((entry) => entry.startsWith("# ")) };
}

async function emptyTree(cwd: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "convoy-index-"));
  try {
    return (await runGit(cwd, ["write-tree"], { env: { GIT_INDEX_FILE: join(tempDir, "index") } })).stdout.trim();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Join `git diff --numstat -z` (line counts) with `--name-status -z` (change
 * kind) into per-file entries. Exported for tests.
 */
export function parseDiffSummary(numstatOutput: string, nameStatusOutput: string): RunDiffFile[] {
  const kindByPath = new Map<string, RunDiffFile["kind"]>();
  // -z name-status output alternates: status NUL path NUL ...
  const nameStatusParts = nameStatusOutput.split("\0");
  for (let i = 0; i + 1 < nameStatusParts.length; i += 2) {
    const status = nameStatusParts[i]?.trim();
    const path = nameStatusParts[i + 1];
    if (!status || !path) {
      continue;
    }
    kindByPath.set(path, status.startsWith("A") ? "added" : status.startsWith("D") ? "deleted" : "modified");
  }

  const files: RunDiffFile[] = [];
  // -z numstat entries: "additions\tdeletions\tpath" NUL-separated; binary
  // files report "-" for both counts.
  for (const entry of numstatOutput.split("\0")) {
    const [additionsRaw, deletionsRaw, path] = entry.split("\t");
    if (!path || additionsRaw === undefined || deletionsRaw === undefined) {
      continue;
    }
    const binary = additionsRaw === "-";
    files.push({
      path,
      kind: kindByPath.get(path) ?? "modified",
      additions: binary ? 0 : Number.parseInt(additionsRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(deletionsRaw, 10) || 0,
      ...(binary ? { binary } : {}),
    });
  }
  return files;
}

// Result payload cap for the on-demand file ops (OS-1143). Serialized JSON
// bytes, not characters: resultJson lands in a Convex document (1 MiB), and
// multibyte text plus escaping push bytes above characters.
export const MAX_FILE_OP_BYTES = 700_000;
const FILE_OP_WRAPPER_HEADROOM = 64;
// Blobs past this size are refused outright instead of streamed+sliced.
export const MAX_FILE_OP_BLOB_BYTES = 5 * 1024 * 1024;

// Pinned diff format: user config (diff.noprefix, mnemonicPrefix, external
// diff, color) must not change the headers the web parser keys on.
const DIFF_CONFIG = ["-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false"];
const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-renames"];
export const DIFF_ARGS = [...DIFF_CONFIG, "diff", ...DIFF_FLAGS];
/** The same pinned format for one commit's patch (OS-2534). */
export const SHOW_ARGS = [...DIFF_CONFIG, "-c", "log.showSignature=false", "show", ...DIFF_FLAGS];

/** Trim `text` so the JSON-encoded result stays under MAX_FILE_OP_BYTES. */
export function capFileOpText(text: string): { text: string; truncated: boolean } {
  const budget = MAX_FILE_OP_BYTES - FILE_OP_WRAPPER_HEADROOM;
  const bytes = (value: string) => Buffer.byteLength(JSON.stringify(value));
  if (bytes(text) <= budget) {
    return { text, truncated: false };
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (bytes(text.slice(0, mid)) <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { text: text.slice(0, low), truncated: true };
}

export interface FileAtRef {
  content: string;
  truncated: boolean;
}

export interface FileDiff {
  patch: string;
  truncated: boolean;
}

/**
 * Read one file's content at a checkpoint ref (`git show ref:path`). Throws
 * with a user-facing message for missing blobs (pruned ref / deleted file),
 * binary content, or oversized files.
 */
export async function readFileAtRef(cwd: string, ref: string, filePath: string): Promise<FileAtRef> {
  const spec = `${ref}:${filePath}`;
  const exists = await runGit(cwd, ["cat-file", "-e", spec], { allowNonZeroExit: true });
  if (exists.exitCode !== 0) {
    throw new Error("File not found at this checkpoint (the checkpoint may have been pruned)");
  }
  const size = Number.parseInt((await runGit(cwd, ["cat-file", "-s", spec])).stdout.trim(), 10);
  if (Number.isFinite(size) && size > MAX_FILE_OP_BLOB_BYTES) {
    throw new Error(`File is too large to view (${Math.round(size / 1024 / 1024)} MB)`);
  }
  const content = (await runGit(cwd, ["show", spec])).stdout;
  if (content.includes("\0")) {
    throw new Error("Binary file");
  }
  const capped = capFileOpText(content);
  return { content: capped.text, truncated: capped.truncated };
}

/**
 * Unified patch between the pre and post checkpoint refs — for one file when
 * `filePath` is given, otherwise for the whole run.
 */
export async function diffBetweenRefs(cwd: string, preRef: string, postRef: string, filePath?: string): Promise<FileDiff> {
  const result = await runGit(
    cwd,
    [...DIFF_ARGS, preRef, postRef, ...(filePath ? ["--", filePath] : [])],
    { timeoutMs: CAPTURE_TIMEOUT_MS }
  );
  const capped = capFileOpText(result.stdout);
  return { patch: capped.text, truncated: capped.truncated };
}

/**
 * Restore the working tree (tracked + untracked files) to a checkpoint
 * (OS-1151). Discards everything that happened after the checkpoint,
 * including the user's own uncommitted edits; HEAD and the index end up
 * unchanged/unstaged. t3code's revert recipe. With `filePath` (OS-1156) only
 * that one path is restored — or deleted, when the run created it.
 */
export async function revertToCheckpoint(
  cwd: string, ref: string, filePath?: string, options?: { allowLegacy?: boolean },
): Promise<void> {
  if (!(await refExists(cwd, ref))) {
    throw new Error("Checkpoint no longer exists (it may have been pruned)");
  }
  const message = (await runGit(cwd, ["show", "-s", "--format=%B", ref])).stdout;
  const directory = message.split("\n").find((line) => line.startsWith(WORKSPACE_TRAILER))?.slice(WORKSPACE_TRAILER.length);
  if (!directory && !options?.allowLegacy) throw new Error("This checkpoint predates working directory tracking and cannot be safely undone.");
  if (directory && directory !== await checkpointWorkspace(cwd)) throw new Error("This checkpoint belongs to a different working directory and cannot be undone here.");

  if (filePath !== undefined) {
    const inCheckpoint = await runGit(cwd, ["cat-file", "-e", `${ref}:${filePath}`], { allowNonZeroExit: true });
    if (inCheckpoint.exitCode === 0) {
      await runGit(cwd, ["restore", "--source", ref, "--worktree", "--staged", "--", filePath], {
        timeoutMs: CAPTURE_TIMEOUT_MS,
      });
    } else {
      // The run created this file — pre-run state is "absent".
      await rm(join(cwd, filePath), { force: true });
    }
    // Leave the user's index at HEAD (changes show as unstaged, not staged);
    // also drops a staged index entry for a deleted run-created file.
    await runGit(cwd, ["reset", "--quiet", "--", filePath], { timeoutMs: CAPTURE_TIMEOUT_MS, allowNonZeroExit: true });
    return;
  }

  // Worktree+index → checkpoint tree; files absent from it become untracked…
  await runGit(cwd, ["restore", "--source", ref, "--worktree", "--staged", "--", "."], { timeoutMs: CAPTURE_TIMEOUT_MS });
  // …and are removed here.
  await runGit(cwd, ["clean", "-fd", "--", "."], { timeoutMs: CAPTURE_TIMEOUT_MS });
  // Leave the user's index at HEAD (changes show as unstaged, not staged).
  await runGit(cwd, ["reset", "--quiet", "--", "."], { timeoutMs: CAPTURE_TIMEOUT_MS, allowNonZeroExit: true });
}

/** Keep the newest checkpoint refs for a thread, delete the rest. */
export async function pruneCheckpointRefs(cwd: string, threadId: string): Promise<void> {
  const prefix = `refs/convoy/checkpoints/${threadId}/`;
  const result = await runGit(cwd, [
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname)",
    prefix,
  ]);
  const refs = result.stdout.split("\n").filter((ref) => ref.startsWith(prefix));
  for (const ref of refs.slice(MAX_REFS_PER_THREAD)) {
    await runGit(cwd, ["update-ref", "-d", ref], { allowNonZeroExit: true });
  }
}
