import { v, type Infer } from "convex/values";

// Schema-mirror validators for the GitHub integration (docs/specs/github-integration.md).

export const repositoryLinkStatusValidator = v.union(v.literal("active"), v.literal("disconnected"));
export type RepositoryLinkStatus = Infer<typeof repositoryLinkStatusValidator>;

export const repositorySyncStatusValidator = v.union(v.literal("importing"), v.literal("synced"), v.literal("error"));
export type RepositorySyncStatus = Infer<typeof repositorySyncStatusValidator>;

export const pullRequestStateValidator = v.union(v.literal("open"), v.literal("closed"), v.literal("merged"));
export type PullRequestState = Infer<typeof pullRequestStateValidator>;

/** GitHub's REST `stack` on a PR: a Layer at `position` (1 is the bottom) of `size`. */
export const pullRequestStackValidator = v.object({
  id: v.number(),
  number: v.number(),
  size: v.number(),
  position: v.number(),
});
export type PullRequestStack = Infer<typeof pullRequestStackValidator>;

/** Normalized PR metadata as fetched from the provider; the stored row adds identity and syncedAt. */
export const normalizedPullRequestValidator = v.object({
  providerPullRequestId: v.number(),
  number: v.number(),
  title: v.string(),
  description: v.string(),
  author: v.string(),
  state: pullRequestStateValidator,
  draft: v.boolean(),
  labels: v.array(v.string()),
  headRef: v.string(),
  baseRef: v.string(),
  headSha: v.string(),
  baseSha: v.string(),
  providerCreatedAt: v.number(),
  providerUpdatedAt: v.number(),
  stack: v.optional(pullRequestStackValidator),
  archived: v.optional(v.literal(true)),
  /** Only a single-PR read reports mergeability; undefined there means GitHub is still computing it. */
  conflicts: v.optional(v.boolean()),
});
export type NormalizedPullRequest = Infer<typeof normalizedPullRequestValidator>;

/** A PR attached to a CLI thread or message, by name; title and state resolve live. */
export const attachedPullRequestValidator = v.object({
  owner: v.string(),
  name: v.string(),
  number: v.number(),
  /** `owner/name#number`, lowercased: the thread index key. */
  ref: v.string(),
});
export type AttachedPullRequest = Infer<typeof attachedPullRequestValidator>;

const GITHUB_PULL_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/i;
const GITHUB_PULL_REF = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

type PullRequestName = Pick<AttachedPullRequest, "owner" | "name" | "number">;

export function toAttachedPullRequest({ owner, name, number }: PullRequestName): AttachedPullRequest {
  return { owner, name, number, ref: attachedPullRequestName({ owner, name, number }).toLowerCase() };
}

/** `owner/name#number`, as people write it. */
export function attachedPullRequestName(pr: PullRequestName): string {
  return `${pr.owner}/${pr.name}#${pr.number}`;
}

/** GitHub matches owners and repository names case-insensitively. */
export function isSameRepository(a: { owner: string; name: string }, b: { owner: string; name: string }): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();
}

/** A github.com PR URL or `owner/name#number` as an Attached pull request; null for anything else. */
export function parseAttachedPullRequest(input: string): AttachedPullRequest | null {
  const match = GITHUB_PULL_URL.exec(input.trim()) ?? GITHUB_PULL_REF.exec(input.trim());
  if (!match) return null;
  const [, owner, name, digits] = match;
  const number = Number(digits);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return toAttachedPullRequest({ owner, name, number });
}

export function attachedPullRequestUrl(pr: PullRequestName): string {
  return `https://github.com/${pr.owner}/${pr.name}/pull/${pr.number}`;
}

// --- Guides (docs/specs/github-integration.md → Guides) ---

export const guideAttentionKindValidator = v.union(
  v.literal("tradeoff"),
  v.literal("contract"),
  v.literal("product"),
  v.literal("risk"),
  v.literal("accessibility")
);
export type GuideAttentionKind = Infer<typeof guideAttentionKindValidator>;
/** Every attention kind, for messages and checks on what the agent sent. */
export const GUIDE_ATTENTION_KINDS = Object.keys({
  tradeoff: true,
  contract: true,
  product: true,
  risk: true,
  accessibility: true,
} satisfies Record<GuideAttentionKind, true>) as GuideAttentionKind[];

/** Limits Convoy enforces on submit; the prompt states them. */
export const GUIDE_MAX_STEPS = 8;
export const GUIDE_MAX_QUESTIONS = 2;
/** A project's Guide prompt, in characters. */
export const GUIDE_PROMPT_MAX = 8000;

/** How a Follow-up guide's step relates to its base; a Removed step is kept by title only (OS-2417). */
export const guideStepChangeValidator = v.union(v.literal("unchanged"), v.literal("updated"), v.literal("new"));

/** A stored step: each file carries its blob at the Guide's head, filled in by Convoy on submit. */
export const guideStepValidator = v.object({
  title: v.string(),
  explanation: v.string(),
  attention: v.optional(v.object({ kind: guideAttentionKindValidator, note: v.string() })),
  files: v.array(v.object({ path: v.string(), note: v.optional(v.string()), sha: v.optional(v.string()) })),
  questions: v.array(v.string()),
  /** Set on a Follow-up guide's steps only; `whatChanged` on Updated ones. */
  change: v.optional(guideStepChangeValidator),
  whatChanged: v.optional(v.string()),
});
export type GuideStep = Infer<typeof guideStepValidator>;

/** A Follow-up guide's step counts, for its bar. */
export const guideChangesValidator = v.object({ unchanged: v.number(), updated: v.number(), added: v.number(), removed: v.number() });
export type GuideChanges = Infer<typeof guideChangesValidator>;

export const guideStatusValidator = v.union(v.literal("writing"), v.literal("ready"), v.literal("failed"));
export type GuideStatus = Infer<typeof guideStatusValidator>;
