import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { errors } from "./errors";
import { withUserToken } from "./accounts";
import { GithubError, githubFetch, toUserError } from "./lib/github";
import { normalizeComment, record, str } from "./lib/parsers";
import { pullRequestCommentValidator, type PullRequestComment } from "./lib/validators";

// Conversation comments, written as the member's own Linked GitHub account (ADR 0012). GitHub decides who may write;
// Convoy also limits edits and deletes to the author's own comments on this PR.

/** GitHub's limit for a comment body. */
const MAX_COMMENT_LENGTH = 65_536;

const target = { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() };

function requireBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new ConvexError(errors.COMMENT_EMPTY);
  if (trimmed.length > MAX_COMMENT_LENGTH) throw new ConvexError(errors.COMMENT_TOO_LONG);
  return trimmed;
}

/** Runs `write` as the caller on the project's connected repository, with GitHub's refusals as catalog messages. */
async function writeAs<T>(
  ctx: ActionCtx,
  args: { projectId: Id<"projects">; repositoryId: string; number: number },
  write: (token: string, repositoryPath: string, githubUserId: number) => Promise<T>
): Promise<T> {
  const live = await ctx.runQuery(internal.integrations.github.pullRequests.getReadableContext, args);
  if (!live) throw new ConvexError(errors.NOT_CONNECTED);
  const repository = `/repositories/${live.context.providerRepositoryId}`;
  return withUserToken(ctx, live.organizationId, (token, githubUserId) => write(token, repository, githubUserId)).catch(
    (error: unknown) => {
      if (error instanceof GithubError && !error.rateLimited && [403, 404, 410, 422].includes(error.status ?? 0)) {
        throw new ConvexError(errors.COMMENT_REFUSED);
      }
      throw toUserError(error);
    }
  );
}

/**
 * GitHub lets anyone with write access edit or delete any comment; Convoy
 * allows only the author's own, and only on this PR.
 */
async function requireOwnComment(token: string, repository: string, githubUserId: number, number: number, commentId: number) {
  const comment = record(await githubFetch(`${repository}/issues/comments/${commentId}`, { token }));
  const author = comment.user ? record(comment.user).id : null;
  if (author !== githubUserId || !str(comment.issue_url).endsWith(`/issues/${number}`)) {
    throw new ConvexError(errors.COMMENT_NOT_YOURS);
  }
}

export const create = action({
  args: { ...target, body: v.string() },
  returns: pullRequestCommentValidator,
  handler: async (ctx, { body, ...args }): Promise<PullRequestComment> => {
    const text = requireBody(body);
    return writeAs(ctx, args, async (token, repository) =>
      normalizeComment(await githubFetch(`${repository}/issues/${args.number}/comments`, { token }, { method: "POST", body: { body: text } }))
    );
  },
});

export const update = action({
  args: { ...target, commentId: v.number(), body: v.string() },
  returns: pullRequestCommentValidator,
  handler: async (ctx, { body, commentId, ...args }): Promise<PullRequestComment> => {
    const text = requireBody(body);
    return writeAs(ctx, args, async (token, repository, githubUserId) => {
      await requireOwnComment(token, repository, githubUserId, args.number, commentId);
      return normalizeComment(await githubFetch(`${repository}/issues/comments/${commentId}`, { token }, { method: "PATCH", body: { body: text } }));
    });
  },
});

export const remove = action({
  args: { ...target, commentId: v.number() },
  returns: v.null(),
  handler: async (ctx, { commentId, ...args }): Promise<null> => {
    await writeAs(ctx, args, async (token, repository, githubUserId) => {
      await requireOwnComment(token, repository, githubUserId, args.number, commentId);
      await githubFetch(`${repository}/issues/comments/${commentId}`, { token }, { method: "DELETE" });
    });
    return null;
  },
});
