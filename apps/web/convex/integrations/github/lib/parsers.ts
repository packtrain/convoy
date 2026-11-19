import type { NormalizedPullRequest, PullRequestStack } from "../../../lib/contracts/github";
import { GithubError } from "./github";
import type { PullRequestComment, PullRequestOverview, PullRequestSearchHit } from "./validators";

/** Diff budget per request: provider file entries past these limits come back without patches. */
export const DIFF_MAX_FILES = 100;
export const DIFF_MAX_PATCH_BYTES = 1024 * 1024;

// Narrowing for provider JSON: never trust the response shape blindly.

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GithubError(null, "Unexpected response from GitHub");
  }
  return value as Record<string, unknown>;
}

export function str(value: unknown): string {
  if (typeof value !== "string") throw new GithubError(null, "Unexpected response from GitHub");
  return value;
}

export function num(value: unknown): number {
  if (typeof value !== "number") throw new GithubError(null, "Unexpected response from GitHub");
  return value;
}

export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new GithubError(null, "Unexpected response from GitHub");
  return value;
}

export function normalizePullRequest(raw: unknown): NormalizedPullRequest {
  const pr = record(raw);
  const head = record(pr.head);
  const base = record(pr.base);
  return {
    providerPullRequestId: num(pr.id),
    number: num(pr.number),
    title: str(pr.title),
    description: typeof pr.body === "string" ? pr.body : "",
    author: pr.user ? str(record(pr.user).login) : "ghost",
    state: pr.merged_at ? "merged" : str(pr.state) === "open" ? "open" : "closed",
    draft: pr.draft === true,
    labels: list(pr.labels ?? []).map((label) => str(record(label).name)),
    assignees: list(pr.assignees ?? []).map(login),
    headRef: str(head.ref),
    baseRef: str(base.ref),
    headSha: str(head.sha),
    baseSha: str(base.sha),
    providerCreatedAt: Date.parse(str(pr.created_at)),
    providerUpdatedAt: Date.parse(str(pr.updated_at)),
    // Always set, so a patch clears a stack the PR left or an archive that was undone.
    stack: parseStack(pr.stack),
    archived: pr.archived === true ? true : undefined,
    conflicts: typeof pr.mergeable === "boolean" ? !pr.mergeable : undefined,
  };
}

/** A search hit with the repository it names (`repository_url` ends in `/repos/<owner>/<name>`). */
export function normalizeSearchHit(raw: unknown): Omit<PullRequestSearchHit, "repositoryId"> & { fullName: string } {
  const item = record(raw);
  return {
    fullName: str(item.repository_url).split("/repos/").pop()?.toLowerCase() ?? "",
    number: num(item.number),
    title: str(item.title),
    author: item.user ? str(record(item.user).login) : "ghost",
    state: item.pull_request && record(item.pull_request).merged_at ? "merged" : str(item.state) === "open" ? "open" : "closed",
    draft: item.draft === true,
    labels: list(item.labels ?? []).map((label) => str(record(label).name)),
    providerCreatedAt: Date.parse(str(item.created_at)),
    providerUpdatedAt: Date.parse(str(item.updated_at)),
  };
}

/** Lenient: a stack shape this parser doesn't know reads as no stack rather than failing the sync. */
function parseStack(value: unknown): PullRequestStack | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, number, size, position } = value as Record<string, unknown>;
  const fields = [id, number, size, position];
  return fields.every((field) => typeof field === "number")
    ? { id: id as number, number: number as number, size: size as number, position: position as number }
    : undefined;
}

type DiffFileStatus = "added" | "removed" | "modified" | "renamed";

/** GitHub's other statuses (copied, changed, unchanged, and any new one) read as modified. */
function diffFileStatus(status: string): DiffFileStatus {
  return status === "added" || status === "removed" || status === "renamed" ? status : "modified";
}

/** Normalize provider file entries, dropping patches past the byte budget. */
export function normalizeDiffFiles(rawFiles: unknown[]) {
  let bytes = 0;
  let omitted = false;
  const files = rawFiles.map((raw) => {
    const file = record(raw);
    let patch = typeof file.patch === "string" ? file.patch : undefined;
    if (patch !== undefined) {
      bytes += new TextEncoder().encode(patch).byteLength;
      if (bytes > DIFF_MAX_PATCH_BYTES) {
        patch = undefined;
        omitted = true;
      }
    }
    return {
      path: str(file.filename),
      previousPath: typeof file.previous_filename === "string" ? file.previous_filename : undefined,
      status: diffFileStatus(str(file.status)),
      additions: num(file.additions),
      deletions: num(file.deletions),
      /** The blob at this revision: Reviewed marks key on it. */
      sha: typeof file.sha === "string" ? file.sha : undefined,
      patch,
    };
  });
  return { files, omitted };
}


// --- Overview ---

const login = (user: unknown) => (typeof user === "object" && user !== null && typeof (user as { login?: unknown }).login === "string" ? (user as { login: string }).login : "ghost");
const text = (value: unknown) => (typeof value === "string" ? value : "");
const avatarUrl = (user: unknown) => text(record(user ?? {}).avatar_url) || null;

type CheckState = PullRequestOverview["checks"][number]["state"];
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

function checkRunState(run: Record<string, unknown>): CheckState {
  if (run.status !== "completed") return "pending";
  return PASSING_CONCLUSIONS.has(text(run.conclusion)) ? "success" : "failure";
}

function statusState(state: string): CheckState {
  return state === "success" ? "success" : state === "pending" ? "pending" : "failure";
}

const REVIEW_STATES: Record<string, PullRequestOverview["reviews"][number]["state"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

type QuoteLine = PullRequestOverview["reviewComments"][number]["quote"][number];
const QUOTE_KINDS: Record<string, QuoteLine["kind"]> = { "+": "add", "-": "del", " ": "context" };

/** The last `count` lines of a review comment's diff hunk, which GitHub ends at the commented line, numbered on `side`. */
function quoteLines(hunk: string, side: "old" | "new", count: number): QuoteLine[] {
  const [header = "", ...body] = hunk.split("\n");
  const start = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(header);
  if (!start) return [];
  let [old, next] = [Number(start[1]), Number(start[2])];
  const lines = body.flatMap((raw): QuoteLine[] => {
    const kind = QUOTE_KINDS[raw[0]];
    if (!kind) return [];
    const number = kind === "add" ? (side === "new" ? next : null) : kind === "del" ? (side === "old" ? old : null) : side === "old" ? old : next;
    if (kind !== "add") old++;
    if (kind !== "del") next++;
    return [{ kind, number, text: raw.slice(1) }];
  });
  return lines.slice(-Math.max(1, count));
}

/** An issue comment on the PR's conversation. */
export function normalizeComment(value: unknown): PullRequestComment {
  const comment = record(value);
  const userId = comment.user ? record(comment.user).id : null;
  return {
    id: num(comment.id),
    author: login(comment.user),
    authorId: typeof userId === "number" ? userId : null,
    authorAvatarUrl: avatarUrl(comment.user),
    body: text(comment.body),
    createdAt: Date.parse(str(comment.created_at)),
    url: text(comment.html_url),
  };
}

function mergeSettings(repository: Record<string, unknown>): PullRequestOverview["mergeSettings"] {
  const methods = (["merge", "squash", "rebase"] as const).filter(
    (method) => repository[{ merge: "mergeCommitAllowed", squash: "squashMergeAllowed", rebase: "rebaseMergeAllowed" }[method]] === true
  );
  return { methods, deleteBranchOnMerge: repository.deleteBranchOnMerge === true };
}

/** GitHub's PR, commits, reviews, comments, check runs, combined status, and compare, narrowed for the Overview. `appId` marks Convoy's own runs. */
export function normalizeOverview(appId: string, raw: {
  pr: unknown;
  commits: unknown;
  reviews: unknown;
  comments: unknown;
  reviewComments: unknown;
  checkRuns: unknown;
  status: unknown;
  compare: unknown;
  /** GraphQL's PullRequest node with its `repository`; null when unread. */
  repository: unknown;
}): PullRequestOverview {
  const pr = record(raw.pr);
  const checkRuns = list(record(raw.checkRuns).check_runs ?? []).map((value) => {
    const run = record(value);
    const output = typeof run.output === "object" && run.output !== null ? (run.output as Record<string, unknown>) : {};
    return {
      id: `run:${num(run.id)}`,
      name: str(run.name),
      state: checkRunState(run),
      summary: text(output.title) || text(run.conclusion) || text(run.status),
      url: text(run.html_url) || text(run.details_url) || null,
      fromConvoy: String(record(run.app ?? {}).id) === appId,
    };
  });
  const statuses = list(record(raw.status).statuses ?? []).map((value) => {
    const status = record(value);
    return {
      id: `status:${num(status.id)}`,
      name: str(status.context),
      state: statusState(str(status.state)),
      summary: text(status.description),
      url: text(status.target_url) || null,
      fromConvoy: false,
    };
  });
  return {
    headSha: str(record(pr.head).sha),
    baseRef: str(record(pr.base).ref),
    htmlUrl: str(pr.html_url),
    mergeable: pr.mergeable === true ? "clean" : pr.mergeable === false ? "conflicting" : "unknown",
    behindBy: raw.compare === null ? null : num(record(raw.compare).behind_by),
    mergeBlock: pr.mergeable_state === "blocked" || pr.mergeable_state === "behind" ? pr.mergeable_state : null,
    mergeSettings: raw.repository === null ? null : mergeSettings(record(raw.repository)),
    commitCount: typeof pr.commits === "number" ? pr.commits : list(raw.commits).length,
    commits: list(raw.commits).map((value) => {
      const commit = record(value);
      const detail = record(commit.commit);
      const author = typeof detail.author === "object" && detail.author !== null ? (detail.author as Record<string, unknown>) : {};
      return {
        sha: str(commit.sha),
        message: str(detail.message).split("\n")[0],
        author: commit.author ? login(commit.author) : text(author.name) || "unknown",
        committedAt: Date.parse(text(author.date)) || 0,
        url: text(commit.html_url),
      };
    }),
    checks: [...checkRuns, ...statuses],
    // A pending review is the reviewer's unsubmitted draft; GitHub never shows it to others.
    reviews: list(raw.reviews).flatMap((value) => {
      const review = record(value);
      const state = REVIEW_STATES[text(review.state)];
      return state ? [{ id: num(review.id), author: login(review.user), authorAvatarUrl: avatarUrl(review.user), state, submittedAt: Date.parse(text(review.submitted_at)) || 0, body: text(review.body), url: text(review.html_url) }] : [];
    }),
    requestedReviewers: [
      ...list(pr.requested_reviewers ?? []).map(login),
      ...list(pr.requested_teams ?? []).map((team) => text(record(team).name) || text(record(team).slug)),
    ],
    comments: list(raw.comments).map(normalizeComment),
    reviewComments: list(raw.reviewComments).map((value) => {
      const comment = record(value);
      const line = [comment.line, comment.original_line].find((candidate) => typeof candidate === "number");
      const start = [comment.start_line, comment.original_start_line].find((candidate) => typeof candidate === "number");
      const count = typeof line === "number" && typeof start === "number" ? line - start + 1 : 1;
      return {
        id: num(comment.id),
        author: login(comment.user),
        authorAvatarUrl: avatarUrl(comment.user),
        body: text(comment.body),
        createdAt: Date.parse(str(comment.created_at)),
        url: text(comment.html_url),
        path: str(comment.path),
        line: typeof line === "number" ? line : null,
        quote: quoteLines(text(comment.diff_hunk), comment.side === "LEFT" ? "old" : "new", count),
      };
    }),
    assignees: list(pr.assignees ?? []).map((user) => ({ login: login(user), avatarUrl: avatarUrl(user) })),
    milestone: pr.milestone ? { title: str(record(pr.milestone).title), url: text(record(pr.milestone).html_url) } : null,
  };
}
