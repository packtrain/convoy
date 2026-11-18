import { api } from "../../../_generated/api";
import { submitGuide } from "../../../integrations/github/guides";
import { should, throwInvalidParams } from "../../lib/should";
import type { ToolHandler } from "../context";

/** `convoy threads submit-guide` over MCP: the Guide's `headSha` and `steps`, or `failure`. */
export const handleSubmitPullRequestGuide: ToolHandler = async ({ ctx, apiKey, args }) => {
  const threadId = should.beId<"cliThreads">(args, "threadId");
  const headSha = should.beOptionalString(args, "headSha");
  const failure = should.beOptionalString(args, "failure");
  const steps: unknown = args.steps ?? undefined;
  if (steps !== undefined && !Array.isArray(steps)) {
    throwInvalidParams("steps must be an array");
  }
  return submitGuide(ctx, { threadId, headSha, steps, failure, apiKey });
};

export const handleReadPullRequestGuide: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const pullRequest = should.beTrimmedString(args, "pullRequest");
  const guideId = should.beOptionalId<"integrationPullRequestGuides">(args, "guideId");
  const result = await ctx.runQuery(api.integrations.github.guides.read, { projectId: await getProjectId(), pullRequest, guideId, apiKey });
  if (!result) {
    throwInvalidParams(`${pullRequest} is not in a repository connected to this project`);
  }
  return result;
};
