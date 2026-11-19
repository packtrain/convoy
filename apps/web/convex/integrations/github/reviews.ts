import { ConvexError, v, type Infer } from "convex/values";
import { action } from "../../_generated/server";
import { errors } from "./errors";
import { writeAs } from "./accounts";
import { githubFetch } from "./lib/github";
import { list, normalizeReview, normalizeReviewComment, record, requestedReviewers } from "./lib/parsers";
import { pullRequestReviewCommentValidator, pullRequestReviewValidator, type PullRequestReviewComment } from "./lib/validators";

// Reviews, inline comments, and reviewer requests, written as the member's own Linked GitHub account (ADR 0012).

/** GitHub's limit for a comment body, which holds for a review's body and each inline comment. */
const MAX_BODY_LENGTH = 65_536;
/** Inline comments in one review; GitHub sets no limit, so this bounds the request. */
const MAX_REVIEW_COMMENTS = 100;

const target = { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() };

const EVENTS = { approve: "APPROVE", request_changes: "REQUEST_CHANGES", comment: "COMMENT" } as const;

const sideValidator = v.union(v.literal("LEFT"), v.literal("RIGHT"));
/** A comment on one line, or on `startLine` through `line` when the range spans more. */
const inlineCommentValidator = v.object({
  path: v.string(),
  startLine: v.optional(v.number()),
  startSide: v.optional(sideValidator),
  line: v.number(),
  side: sideValidator,
  body: v.string(),
});

const submittedValidator = v.object({ review: pullRequestReviewValidator, comments: v.array(pullRequestReviewCommentValidator) });
type Submitted = Infer<typeof submittedValidator>;

function trimmed(body: string): string {
  const text = body.trim();
  if (text.length > MAX_BODY_LENGTH) throw new ConvexError(errors.COMMENT_TOO_LONG);
  return text;
}

/**
 * GitHub's answer to a review has no inline comments; the PR's newest ones, filtered to the review, carry their lines and hunks.
 * The review is already posted, so a failed read returns none (Refresh shows them) rather than failing, which would invite a second post.
 */
async function reviewComments(token: string, pulls: string, reviewId: number): Promise<PullRequestReviewComment[]> {
  try {
    return list(await githubFetch(`${pulls}/comments?sort=created&direction=desc&per_page=100`, { token }))
      .filter((comment) => record(comment).pull_request_review_id === reviewId)
      .map(normalizeReviewComment)
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Submits a review at `headSha`, the revision the member read, with its inline comments.
 * A comment review needs a body or an inline comment, and Request changes needs a body, as on GitHub.
 */
export const submit = action({
  args: {
    ...target,
    headSha: v.string(),
    event: v.union(v.literal("approve"), v.literal("request_changes"), v.literal("comment")),
    body: v.string(),
    comments: v.array(inlineCommentValidator),
  },
  returns: submittedValidator,
  handler: async (ctx, { headSha, event, body, comments, ...args }): Promise<Submitted> => {
    const text = trimmed(body);
    if (comments.length > MAX_REVIEW_COMMENTS) throw new ConvexError(errors.REVIEW_TOO_MANY_COMMENTS);
    const inline = comments.map(({ path, startLine, startSide, line, side, body }) => ({
      path,
      ...(startLine === undefined ? {} : { start_line: startLine, start_side: startSide ?? side }),
      line,
      side,
      body: trimmed(body),
    }));
    if (inline.some((comment) => !comment.body)) throw new ConvexError(errors.COMMENT_EMPTY);
    if (event === "request_changes" && !text) throw new ConvexError(errors.REVIEW_CHANGES_NEED_BODY);
    if (event === "comment" && !text && !inline.length) throw new ConvexError(errors.COMMENT_EMPTY);
    return writeAs(
      ctx,
      args,
      async (token, repository) => {
        const pulls = `${repository}/pulls/${args.number}`;
        const posted = await githubFetch(pulls + "/reviews", { token }, { method: "POST", body: { commit_id: headSha, event: EVENTS[event], body: text, comments: inline } });
        const review = normalizeReview(posted);
        if (!review) throw new ConvexError(errors.COMMENT_REFUSED);
        return { review, comments: inline.length ? await reviewComments(token, pulls, review.id) : [] };
      },
      { refused: errors.COMMENT_REFUSED }
    );
  },
});

/** Requests or withdraws one person's review; returns the people GitHub has requested after, without teams. */
export const requestReviewer = action({
  args: { ...target, login: v.string(), requested: v.boolean() },
  returns: v.array(v.string()),
  handler: async (ctx, { login, requested, ...args }): Promise<string[]> =>
    writeAs(
      ctx,
      args,
      async (token, repository) => {
        const pr = await githubFetch(`${repository}/pulls/${args.number}/requested_reviewers`, { token }, { method: requested ? "POST" : "DELETE", body: { reviewers: [login] } });
        const reviewers = requestedReviewers(record(pr)).users;
        // GitHub answers 200 even when it drops the change, as for assignees.
        if (reviewers.includes(login) !== requested) throw new ConvexError(errors.PULL_REQUEST_WRITE_REFUSED);
        return reviewers;
      },
      { refused: errors.PULL_REQUEST_WRITE_REFUSED }
    ),
});
