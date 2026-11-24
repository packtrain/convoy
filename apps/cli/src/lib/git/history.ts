import { runGit } from "./exec.js";
import { CAPTURE_TIMEOUT_MS, MAX_FILE_OP_BYTES, SHOW_ARGS, capFileOpText } from "./checkpoint.js";

/** Commits per `gitLog` page (OS-2534, docs/specs/cli-worktrees.md → Commit history). */
export const COMMIT_PAGE_SIZE = 50;
const MAX_BODY_CHARS = 20_000;
// `%s` is the whole first paragraph; 50 long ones would pass the 1 MiB op row (OS-2534).
export const MAX_SUBJECT_CHARS = 500;
export const MAX_REFS_PER_COMMIT = 20;
const MAX_FIELD_CHARS = 200;
// Room for `nextCursor` and the JSON wrapper around the commits.
const PAGE_HEADROOM_BYTES = 256;

const HASH = "[0-9a-f]{40}(?:[0-9a-f]{24})?";
const HASH_PATTERN = new RegExp(`^${HASH}$`);
// `<tip>:<skip>`: later pages walk from the first page's HEAD, so new commits don't shift them.
const CURSOR_PATTERN = new RegExp(`^(${HASH}):(\\d+)$`);
const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%ct", "%D", "%s"].join("%x1f");

/** Mirrored by the web in apps/web/lib/worktrees/hooks/use-worktree-history.ts. */
export interface CommitSummary {
  hash: string;
  /** First parent first; two or more for a merge. */
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Committer time, ms since epoch. */
  committedAt: number;
  /** `%D` entries, e.g. `HEAD -> main`, `origin/main`, `tag: v1`. */
  refs: string[];
  subject: string;
}

export interface CommitPage {
  commits: CommitSummary[];
  nextCursor?: string;
}

export interface CommitPatch {
  body: string;
  patch: string;
  truncated: boolean;
}

function parseCommit(record: string): CommitSummary {
  const [hash = "", parents = "", authorName = "", authorEmail = "", time = "0", refs = "", subject = ""] = record.split("\x1f");
  return {
    hash,
    parents: parents ? parents.split(" ") : [],
    authorName: authorName.slice(0, MAX_FIELD_CHARS),
    authorEmail: authorEmail.slice(0, MAX_FIELD_CHARS),
    committedAt: Number.parseInt(time, 10) * 1000,
    refs: refs ? refs.split(", ").slice(0, MAX_REFS_PER_COMMIT).map((ref) => ref.slice(0, MAX_FIELD_CHARS)) : [],
    subject: subject.slice(0, MAX_SUBJECT_CHARS),
  };
}

/**
 * One page of `git log --topo-order HEAD`; an unborn branch has no commits.
 * ponytail: `--skip` re-walks from the tip, so a page costs O(depth); key pages by a commit if huge repos time out.
 */
export async function listCommits(cwd: string, cursor?: string, budgetBytes = MAX_FILE_OP_BYTES): Promise<CommitPage> {
  let tip: string;
  let skip = 0;
  if (cursor !== undefined) {
    const match = CURSOR_PATTERN.exec(cursor);
    if (!match) {
      throw new Error("Invalid history cursor");
    }
    tip = match[1]!;
    skip = Number(match[2]);
  } else {
    const head = await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { allowNonZeroExit: true });
    if (head.exitCode !== 0) {
      return { commits: [] };
    }
    tip = head.stdout.trim();
  }
  const result = await runGit(
    cwd,
    [
      "-c", "log.showSignature=false",
      "log", "--topo-order", "-z", "--no-color", "--decorate-refs-exclude=refs/convoy/*",
      `--format=${LOG_FORMAT}`, `--skip=${skip}`, `--max-count=${COMMIT_PAGE_SIZE + 1}`, tip,
    ],
    { timeoutMs: CAPTURE_TIMEOUT_MS }
  );
  const commits = result.stdout.split("\0").filter(Boolean).map(parseCommit);
  // Stop early when the page would outgrow the op row; the cursor resumes after the last one kept.
  let size = PAGE_HEADROOM_BYTES;
  let kept = 0;
  while (kept < Math.min(commits.length, COMMIT_PAGE_SIZE)) {
    size += Buffer.byteLength(JSON.stringify(commits[kept])) + 1;
    if (kept > 0 && size > budgetBytes) {
      break;
    }
    kept++;
  }
  return kept < commits.length ? { commits: commits.slice(0, kept), nextCursor: `${tip}:${skip + kept}` } : { commits };
}

/** One commit's body and patch; a merge gets git's dense combined diff (`--cc`). */
export async function readCommitPatch(cwd: string, hash: string): Promise<CommitPatch> {
  if (!HASH_PATTERN.test(hash)) {
    throw new Error("Invalid commit hash");
  }
  const exists = await runGit(cwd, ["cat-file", "-e", `${hash}^{commit}`], { allowNonZeroExit: true });
  if (exists.exitCode !== 0) {
    throw new Error("Commit not found in this checkout");
  }
  // NUL can't occur in a commit message, so it splits the body from the patch.
  const result = await runGit(cwd, [...SHOW_ARGS, "--cc", "--format=%b%x00", `${hash}^{commit}`], { timeoutMs: CAPTURE_TIMEOUT_MS });
  const split = result.stdout.indexOf("\0");
  const capped = capFileOpText(result.stdout.slice(split + 1).replace(/^\n+/, ""));
  return { body: result.stdout.slice(0, split).trim().slice(0, MAX_BODY_CHARS), patch: capped.text, truncated: capped.truncated };
}
