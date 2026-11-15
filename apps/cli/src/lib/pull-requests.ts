import { execFile } from "node:child_process";
import { getCurrentBranch, getDefaultBranch, getGitRemoteUrl } from "./git/index.js";

/**
 * Last-known PR lookup for a thread's branch (OS-1370). Detects the forge from the origin
 * remote host and lists change requests whose head branch equals the checked-out branch
 * via the user's own forge CLI (`gh`/`glab`/`az`), so auth piggybacks on their logged-in
 * tooling and this module stores no credentials. Bitbucket has no official CLI, so it is
 * detect-only. See docs/specs/cli-thread-pr-badge.md.
 */

export type PullRequestProvider = "github" | "gitlab" | "azure-devops";
export type PullRequestState = "open" | "draft" | "merged" | "closed";

export interface PullRequestSnapshot {
  provider: PullRequestProvider;
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  headBranch: string;
  baseBranch: string;
  capturedAt: number;
}

/** A normalized change-request row plus the recency used for tie-breaking. */
export interface PullRequestCandidate extends Omit<PullRequestSnapshot, "capturedAt"> {
  updatedAt: number;
}

const LOOKUP_TIMEOUT_MS = 30_000;
const LOOKUP_LIMIT = 20;

// ---------------------------------------------------------------------------
// Provider detection (host matching mirrors t3code's sourceControl.ts)
// ---------------------------------------------------------------------------

function parseRemoteHostname(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }
  // scp-like SSH syntax: git@host:owner/repo.git
  const scpMatch = /^(?:[^@\s]+@)?([^:/\s]+):[^/]/.exec(trimmed);
  if (scpMatch?.[1] && !trimmed.includes("://")) {
    return scpMatch[1].toLowerCase();
  }
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Provider whose CLI we can query, or null for unrecognized hosts and Bitbucket. */
export function detectPullRequestProvider(remoteUrl: string): PullRequestProvider | null {
  const hostname = parseRemoteHostname(remoteUrl);
  if (!hostname) {
    return null;
  }
  if (hostname === "dev.azure.com" || hostname.endsWith(".visualstudio.com")) {
    return "azure-devops";
  }
  if (hostname.includes("github")) {
    return "github";
  }
  if (hostname.includes("gitlab")) {
    return "gitlab";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Untrusted-JSON narrowing helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asTimestamp(value: unknown): number {
  const raw = asString(value);
  if (!raw) {
    return 0;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// ---------------------------------------------------------------------------
// Per-provider normalization (raw CLI JSON row -> PullRequestCandidate)
// ---------------------------------------------------------------------------

export function normalizeGitHubPullRequest(raw: unknown): PullRequestCandidate | null {
  if (!isRecord(raw)) {
    return null;
  }
  const number = asNumber(raw.number);
  const title = asString(raw.title);
  const url = asString(raw.url);
  const headBranch = asString(raw.headRefName);
  const baseBranch = asString(raw.baseRefName);
  if (number === null || !title || !url || !headBranch || !baseBranch) {
    return null;
  }

  const rawState = asString(raw.state)?.toUpperCase();
  const merged = rawState === "MERGED" || asString(raw.mergedAt) !== null;
  const state: PullRequestState = merged
    ? "merged"
    : rawState === "CLOSED"
      ? "closed"
      : raw.isDraft === true
        ? "draft"
        : "open";

  return {
    provider: "github",
    number,
    title,
    url,
    state,
    headBranch,
    baseBranch,
    updatedAt: asTimestamp(raw.updatedAt),
  };
}

export function normalizeGitLabMergeRequest(raw: unknown): PullRequestCandidate | null {
  if (!isRecord(raw)) {
    return null;
  }
  const number = asNumber(raw.iid);
  const title = asString(raw.title);
  const url = asString(raw.web_url);
  const headBranch = asString(raw.source_branch);
  const baseBranch = asString(raw.target_branch);
  if (number === null || !title || !url || !headBranch || !baseBranch) {
    return null;
  }

  const rawState = asString(raw.state)?.toLowerCase();
  const state: PullRequestState =
    rawState === "merged"
      ? "merged"
      : rawState === "closed"
        ? "closed"
        : raw.draft === true
          ? "draft"
          : "open";

  return {
    provider: "gitlab",
    number,
    title,
    url,
    state,
    headBranch,
    baseBranch,
    updatedAt: asTimestamp(raw.updated_at),
  };
}

function stripRefsHeads(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
}

export function normalizeAzureDevOpsPullRequest(raw: unknown): PullRequestCandidate | null {
  if (!isRecord(raw)) {
    return null;
  }
  const number = asNumber(raw.pullRequestId);
  const title = asString(raw.title);
  const sourceRefName = asString(raw.sourceRefName);
  const targetRefName = asString(raw.targetRefName);
  const repositoryWebUrl = isRecord(raw.repository) ? asString(raw.repository.webUrl) : null;
  if (number === null || !title || !sourceRefName || !targetRefName || !repositoryWebUrl) {
    return null;
  }

  const rawStatus = asString(raw.status)?.toLowerCase();
  const state: PullRequestState =
    rawStatus === "completed"
      ? "merged"
      : rawStatus === "abandoned"
        ? "closed"
        : raw.isDraft === true
          ? "draft"
          : "open";

  return {
    provider: "azure-devops",
    number,
    title,
    url: `${repositoryWebUrl.replace(/\/+$/, "")}/pullrequest/${number}`,
    state,
    headBranch: stripRefsHeads(sourceRefName),
    baseBranch: stripRefsHeads(targetRefName),
    updatedAt: asTimestamp(raw.closedDate) || asTimestamp(raw.creationDate),
  };
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

function isOpenState(state: PullRequestState): boolean {
  return state === "open" || state === "draft";
}

function mostRecent(candidates: PullRequestCandidate[]): PullRequestCandidate | null {
  let best: PullRequestCandidate | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.updatedAt > best.updatedAt) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Rows whose head branch equals the branch exactly; prefer an open/draft PR,
 * otherwise the most recently updated. On the repo's default branch only an
 * open PR is attributed — merged/closed matches there are reverse-merge noise.
 */
export function selectPullRequestCandidate(
  candidates: PullRequestCandidate[],
  branch: string,
  isDefaultBranch: boolean
): PullRequestCandidate | null {
  const matches = candidates.filter((candidate) => candidate.headBranch === branch);
  const open = mostRecent(matches.filter((candidate) => isOpenState(candidate.state)));
  if (open) {
    return open;
  }
  if (isDefaultBranch) {
    return null;
  }
  return mostRecent(matches);
}

// ---------------------------------------------------------------------------
// Forge CLI invocation
// ---------------------------------------------------------------------------

const PROVIDER_LOOKUPS: Record<
  PullRequestProvider,
  { command: string; args: (branch: string) => string[]; normalize: (raw: unknown) => PullRequestCandidate | null }
> = {
  github: {
    command: "gh",
    args: (branch) => [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      String(LOOKUP_LIMIT),
      "--json",
      "number,title,url,state,isDraft,mergedAt,headRefName,baseRefName,updatedAt",
    ],
    normalize: normalizeGitHubPullRequest,
  },
  gitlab: {
    command: "glab",
    args: (branch) => [
      "mr",
      "list",
      "--source-branch",
      branch,
      "--all",
      "--per-page",
      String(LOOKUP_LIMIT),
      "--output",
      "json",
    ],
    normalize: normalizeGitLabMergeRequest,
  },
  "azure-devops": {
    command: "az",
    args: (branch) => [
      "repos",
      "pr",
      "list",
      "--detect",
      "true",
      "--source-branch",
      branch,
      "--status",
      "all",
      "--top",
      String(LOOKUP_LIMIT),
      "--only-show-errors",
      "--output",
      "json",
    ],
    normalize: normalizeAzureDevOpsPullRequest,
  },
};

function runForgeCli(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: LOOKUP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

export function parsePullRequestList(
  raw: string,
  normalize: (row: unknown) => PullRequestCandidate | null
): PullRequestCandidate[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    return [];
  }
  // Per-row fail-soft: a malformed row is skipped, never fails the lookup.
  return parsed.map(normalize).filter((candidate): candidate is PullRequestCandidate => candidate !== null);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface PullRequestLookupSuccess {
  /** null = successful lookup that found no PR (caller should clear the snapshot). */
  pullRequest: PullRequestSnapshot | null;
}

/**
 * Resolve the PR attributed to the branch checked out in `cwd`.
 *
 * Null when the lookup could not run or failed (non-git directory, detached HEAD,
 * unrecognized provider, forge CLI missing/unauthenticated/errored) — the caller must
 * then report nothing so the last-known snapshot survives.
 */
export async function lookupThreadPullRequest(cwd: string): Promise<PullRequestLookupSuccess | null> {
  const [branch, remoteUrl] = await Promise.all([getCurrentBranch(cwd), getGitRemoteUrl(cwd)]);
  if (!branch || !remoteUrl) {
    return null;
  }

  const provider = detectPullRequestProvider(remoteUrl);
  if (!provider) {
    return null;
  }

  const lookup = PROVIDER_LOOKUPS[provider];
  let candidates: PullRequestCandidate[];
  try {
    const stdout = await runForgeCli(lookup.command, lookup.args(branch), cwd);
    candidates = parsePullRequestList(stdout, lookup.normalize);
  } catch {
    return null;
  }

  const defaultBranch = await getDefaultBranch(cwd);
  const candidate = selectPullRequestCandidate(candidates, branch, defaultBranch === branch);
  if (!candidate) {
    return { pullRequest: null };
  }

  const { updatedAt: _updatedAt, ...snapshotFields } = candidate;
  return { pullRequest: { ...snapshotFields, capturedAt: Date.now() } };
}
