import { ConvexError, v } from "convex/values";
import { action } from "../../_generated/server";
import { errors } from "./errors";
import { writeAs } from "./accounts";
import { githubFetch } from "./lib/github";
import { normalizeComment, record, str } from "./lib/parsers";
import { pullRequestCommentValidator, type PullRequestComment } from "./lib/validators";

// Conversation comments, written as the member's own Linked GitHub account (ADR 0012). GitHub decides who may write;
// Convoy also limits edits and deletes to the author's own comments on this PR.

/** GitHub's limit for a comment body. */
const MAX_COMMENT_LENGTH = 65_536;

const refused = { refused: errors.COMMENT_REFUSED };

const target = { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() };

function requireBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new ConvexError(errors.COMMENT_EMPTY);
  if (trimmed.length > MAX_COMMENT_LENGTH) throw new ConvexError(errors.COMMENT_TOO_LONG);
  return trimmed;
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
    return writeAs(
      ctx,
      args,
      async (token, repository) =>
        normalizeComment(await githubFetch(`${repository}/issues/${args.number}/comments`, { token }, { method: "POST", body: { body: text } })),
      refused
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
    }, refused);
  },
});

export const remove = action({
  args: { ...target, commentId: v.number() },
  returns: v.null(),
  handler: async (ctx, { commentId, ...args }): Promise<null> => {
    await writeAs(ctx, args, async (token, repository, githubUserId) => {
      await requireOwnComment(token, repository, githubUserId, args.number, commentId);
      await githubFetch(`${repository}/issues/comments/${commentId}`, { token }, { method: "DELETE" });
    }, refused);
    return null;
  },
});
