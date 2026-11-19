import { v, type Infer } from "convex/values";
import { action } from "../../_generated/server";
import { errors } from "./errors";
import { writeAs } from "./accounts";
import { githubFetch, githubGraphql } from "./lib/github";
import { record, str } from "./lib/parsers";

// PR state changes, written as the member's own Linked GitHub account (ADR 0012). GitHub's role decides who may.

const stateChangeValidator = v.union(
  v.literal("close"),
  v.literal("reopen"),
  v.literal("draft"),
  v.literal("ready"),
  v.literal("archive"),
  v.literal("unarchive")
);
type StateChange = Infer<typeof stateChangeValidator>;
type Write = (token: string, repository: string, number: number) => Promise<unknown>;

const setState =
  (state: "open" | "closed"): Write =>
  (token, repository, number) =>
    githubFetch(`${repository}/pulls/${number}`, { token }, { method: "PATCH", body: { state } });

/** Draft, ready, and archive exist only in GraphQL, which names the PR by its node id. */
const viaGraphql =
  (mutation: string): Write =>
  async (token, repository, number) => {
    const pr = record(await githubFetch(`${repository}/pulls/${number}`, { token }));
    return githubGraphql(token, `mutation($id: ID!) { ${mutation}(input: { pullRequestId: $id }) { clientMutationId } }`, { id: str(pr.node_id) });
  };

const WRITES: Record<StateChange, Write> = {
  close: setState("closed"),
  reopen: setState("open"),
  draft: viaGraphql("convertPullRequestToDraft"),
  ready: viaGraphql("markPullRequestReadyForReview"),
  // Archiving closes the PR (a merged one stays merged) and locks its conversation; unarchiving leaves it closed.
  archive: viaGraphql("archivePullRequest"),
  unarchive: viaGraphql("unarchivePullRequest"),
};

/** One state change; the stored row follows through a sync of this PR. */
export const update = action({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number(), change: stateChangeValidator },
  returns: v.null(),
  handler: async (ctx, { change, ...args }): Promise<null> => {
    await writeAs(ctx, args, (token, repository) => WRITES[change](token, repository, args.number), {
      refused: errors.PULL_REQUEST_WRITE_REFUSED,
      refresh: true,
    });
    return null;
  },
});
