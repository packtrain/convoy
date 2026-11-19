import { ConvexError, v, type Infer } from "convex/values";
import { action } from "../../_generated/server";
import { errors } from "./errors";
import { writeAs } from "./accounts";
import { GithubError, githubFetch } from "./lib/github";
import { record } from "./lib/parsers";
import { mergeMethodValidator } from "./lib/validators";

// Merge and Update branch, written as the member's Linked GitHub account (ADR 0012).
// Spec: docs/specs/github-integration.md → Merge and update branch.

const MAX_LAYERS_BELOW = 50;
/** How long a stack merge waits for GitHub before reporting it still running. */
const STACK_MERGE_WAIT_MS = 120_000;

const mergeStatusValidator = v.union(v.literal("merged"), v.literal("enqueued"), v.literal("pending"));
type MergeStatus = Infer<typeof mergeStatusValidator>;

const mergeResultValidator = v.object({
  status: mergeStatusValidator,
  /** PRs whose branch Convoy was asked to delete but couldn't. */
  branchesKept: v.array(v.number()),
});
type MergeResult = Infer<typeof mergeResultValidator>;

const withDetail = (message: string, detail: string | null) => (detail ? `${message} ${detail}` : message);

/**
 * 405 (or 400 from `merge-async`) is GitHub refusing the merge, with its reason. 409 is a head that moved
 * past what the member reviewed, or for `merge-async` a merge already pending.
 */
function mergeError(error: unknown, stacked: boolean): unknown {
  if (!(error instanceof GithubError) || error.rateLimited) return error;
  if (error.status === 409) return new ConvexError(stacked ? errors.MERGE_IN_PROGRESS : errors.MERGE_HEAD_CHANGED);
  // `merge-async` refuses a closed or draft PR with a 400 instead.
  if (error.status === 405 || (stacked && error.status === 400)) return new ConvexError(withDetail(errors.MERGE_FAILED, error.detail));
  return error;
}

/** `merge-async`'s answer: `pending` carries the uuid to poll, `failed` GitHub's reason. */
function asyncAnswer(value: unknown): { status: MergeStatus; uuid: string | null } {
  const answer = record(value);
  const details = record(answer.details ?? {});
  if (answer.status === "failed") {
    throw new ConvexError(withDetail(errors.MERGE_FAILED, typeof details.message === "string" ? details.message : null));
  }
  if (answer.status !== "merged" && answer.status !== "enqueued" && answer.status !== "pending") {
    throw new GithubError(null, "Unexpected merge-async answer from GitHub");
  }
  return { status: answer.status, uuid: typeof details.uuid === "string" ? details.uuid : null };
}

/** A stack merges through `merge-async`, which takes the open Layers below along; GitHub answers before it finishes. */
async function mergeStack(token: string, path: string, body: Record<string, unknown>): Promise<MergeStatus> {
  let answer = asyncAnswer(await githubFetch(`${path}/merge-async`, { token }, { method: "PUT", body }));
  const deadline = Date.now() + STACK_MERGE_WAIT_MS;
  for (let attempt = 0; answer.status === "pending" && answer.uuid && Date.now() < deadline; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 10_000)));
    answer = asyncAnswer(await githubFetch(`${path}/merge-async/${encodeURIComponent(answer.uuid)}`, { token }));
  }
  return answer.status;
}

/** Deletes a merged PR's branch; false when it stays. A fork's branch is never in this repository, so it stays. */
async function deleteBranch(token: string, repository: string, providerRepositoryId: number, number: number): Promise<boolean> {
  const pr = record(await githubFetch(`${repository}/pulls/${number}`, { token }).catch(() => null) ?? {});
  const head = record(pr.head ?? {});
  if (!pr.merged_at || typeof head.ref !== "string" || record(head.repo ?? {}).id !== providerRepositoryId) return false;
  const ref = head.ref.split("/").map(encodeURIComponent).join("/");
  return githubFetch(`${repository}/git/refs/heads/${ref}`, { token }, { method: "DELETE" }).then(
    () => true,
    // Already gone, as when the repository deletes merged branches itself; any other refusal keeps it.
    (error: unknown) => error instanceof GithubError && error.status === 422 && error.detail === "Reference does not exist"
  );
}

/**
 * Merges the PR at `headSha`. A stacked PR goes through `merge-async`, which
 * also merges `layersBelow` (the open Layers under it, bottom first), each
 * with its default message. The stored rows follow through a sync of each.
 */
export const merge = action({
  args: {
    projectId: v.id("projects"),
    repositoryId: v.string(),
    number: v.number(),
    method: mergeMethodValidator,
    headSha: v.string(),
    /** A single PR's commit title and body; GitHub's defaults when empty. */
    commitTitle: v.optional(v.string()),
    commitMessage: v.optional(v.string()),
    /** Set for a stacked PR, even when nothing open is below it. */
    layersBelow: v.optional(v.array(v.number())),
    deleteBranch: v.boolean(),
  },
  returns: mergeResultValidator,
  handler: async (ctx, { method, headSha, commitTitle, commitMessage, layersBelow, deleteBranch: deleteAfter, ...args }): Promise<MergeResult> => {
    if (layersBelow && layersBelow.length > MAX_LAYERS_BELOW) throw new ConvexError(errors.MERGE_FAILED);
    const merged = [...(layersBelow ?? []), args.number];
    return writeAs(
      ctx,
      args,
      async (token, repository, _githubUserId, live) => {
        const path = `${repository}/pulls/${args.number}`;
        const title = commitTitle?.trim();
        const message = commitMessage?.trim();
        const texts = { ...(title ? { commit_title: title } : {}), ...(message ? { commit_message: message } : {}) };
        const status = await (layersBelow
          ? mergeStack(token, path, { merge_method: method, merge_action: "default", sha: headSha })
          : githubFetch(`${path}/merge`, { token }, { method: "PUT", body: { merge_method: method, sha: headSha, ...texts } }).then(
              () => "merged" as const
            )
        ).catch((error: unknown) => {
          throw mergeError(error, Boolean(layersBelow));
        });
        const branchesKept: number[] = [];
        // ponytail: a queued or still-running merge keeps its branches; persist the request and delete them on merge if members ask.
        for (const number of deleteAfter ? merged : []) {
          if (status !== "merged" || !(await deleteBranch(token, repository, live.context.providerRepositoryId, number))) branchesKept.push(number);
        }
        return { status, branchesKept };
      },
      { refused: errors.PULL_REQUEST_WRITE_REFUSED, refresh: () => merged }
    );
  },
});

/** GitHub's Update branch: merges the base into the head, refused if the head moved past `headSha`. */
export const updateBranch = action({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number(), headSha: v.string() },
  returns: v.null(),
  handler: async (ctx, { headSha, ...args }): Promise<null> => {
    await writeAs(
      ctx,
      args,
      (token, repository) =>
        githubFetch(`${repository}/pulls/${args.number}/update-branch`, { token }, { method: "PUT", body: { expected_head_sha: headSha } }).catch(
          (error: unknown) => {
            // 422 is GitHub's answer for a conflict or a moved head, with its reason.
            if (error instanceof GithubError && error.status === 422 && error.detail) {
              throw new ConvexError(withDetail(errors.UPDATE_BRANCH_FAILED, error.detail));
            }
            throw error;
          }
        ),
      { refused: errors.PULL_REQUEST_WRITE_REFUSED, refresh: true }
    );
    return null;
  },
});
