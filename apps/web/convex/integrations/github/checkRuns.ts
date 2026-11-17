import { ConvexError, v, type Infer } from "convex/values";
import { internalAction, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { appRoute } from "../../../lib/navigation/routes";
import { href } from "../../../lib/navigation/target";
import { parseAttachedPullRequest } from "../../lib/contracts/github";
import { checkResultStatusValidator, type CheckResultStatus } from "../../lib/contracts/validators";
import { getAppUrlBase } from "../../lib/shared/appUrl";
import { getCheckResultById } from "../../checks/lib/checkResultsRepo";
import { getOrganizationById } from "../../organizations/lib/organizationsRepo";
import { getProjectById } from "../../projects/lib/projectsRepo";
import { errors } from "./errors";
import { GithubError, githubFetch, mintCheckRunToken, repoPath, requireConfig, toUserError } from "./lib/github";
import { listActiveRepositoryLinksForProject } from "./lib/integrationRepositoryLinksRepo";
import { findLinkedRepository } from "./lib/integrationRepositoriesRepo";
import { syncContextValidator, toSyncContext, type SyncContext } from "./lib/validators";

// Pull request checks published as GitHub check runs, one per result (docs/specs/github-integration.md → Pull request checks).

const CHECK_RUNS: Record<CheckResultStatus, { conclusion: string; word: string }> = {
  passed: { conclusion: "success", word: "Passed" },
  warning: { conclusion: "neutral", word: "Warning" },
  failed: { conclusion: "failure", word: "Failed" },
  not_performed: { conclusion: "skipped", word: "Not performed" },
};

const runValidator = v.object({
  checkKey: v.string(),
  label: v.string(),
  headSha: v.string(),
  status: checkResultStatusValidator,
  value: v.optional(v.string()),
  note: v.optional(v.string()),
  reportedAt: v.number(),
  /** The PR's page in Convoy, for the run's Details link. */
  detailsUrl: v.string(),
});
type CheckRun = Infer<typeof runValidator>;

/** A PR result's repository, if the project still connects it; null for a result that is gone or not a PR's. */
export const getPublishTarget = internalQuery({
  args: { resultId: v.id("checkResults") },
  returns: v.union(v.null(), v.object({ error: v.string() }), v.object({ context: syncContextValidator, run: runValidator })),
  handler: async (ctx, { resultId }) => {
    const result = await getCheckResultById(ctx, resultId);
    const pr = result?.pullRequest ? parseAttachedPullRequest(result.pullRequest.ref) : null;
    const project = result && pr ? await getProjectById(ctx, result.projectId) : null;
    const organization = project ? await getOrganizationById(ctx, project.organizationId) : null;
    if (!result?.pullRequest || !pr || !project || !organization) return null;
    const linked = await findLinkedRepository(ctx, await listActiveRepositoryLinksForProject(ctx, result.projectId), pr);
    if (!linked) return { error: errors.NOT_CONNECTED };
    const { checkKey, label, status, value, note, reportedAt } = result;
    const path = href(appRoute.projectPullRequest(organization.slug, project.alias, linked.repository._id, pr.number));
    return {
      context: toSyncContext(linked.link, linked.repository),
      run: { checkKey, label, headSha: result.pullRequest.headSha, status, value, note, reportedAt, detailsUrl: `${getAppUrlBase()}${path}` },
    };
  },
});

/** Never retried: a failure is stored on the result for the card, and the next run publishes again. */
export const publish = internalAction({
  args: { resultId: v.id("checkResults") },
  returns: v.null(),
  handler: async (ctx, { resultId }) => {
    const target = await ctx.runQuery(internal.integrations.github.checkRuns.getPublishTarget, { resultId });
    if (!target) return null;
    const error = "error" in target ? target.error : await createCheckRun(target.context, target.run);
    if (error) {
      await ctx.runMutation(internal.checks.results.recordGithubPublishError, { resultId, error });
    }
    return null;
  },
});

/** Creates the run; returns why it failed, or null. */
async function createCheckRun(context: SyncContext, run: CheckRun): Promise<string | null> {
  let token: string;
  try {
    token = await mintCheckRunToken(requireConfig(), context.installationId, context.providerRepositoryId);
  } catch (error) {
    return publishError(error, true);
  }
  const { conclusion, word } = CHECK_RUNS[run.status];
  const title = run.value ?? word;
  try {
    await githubFetch(
      `${repoPath(context)}/check-runs`,
      { token },
      {
        method: "POST",
        body: {
          name: run.label,
          head_sha: run.headSha,
          conclusion,
          // GitHub shows a name's newest run by completion, so a slow publish never covers a newer report.
          started_at: new Date(run.reportedAt).toISOString(),
          completed_at: new Date(run.reportedAt).toISOString(),
          external_id: run.checkKey,
          details_url: run.detailsUrl,
          output: { title, summary: run.note ?? title },
        },
      }
    );
    return null;
  } catch (error) {
    return publishError(error, false);
  }
}

/** Why GitHub has no run. A 422 from the mint means the installation has not granted Checks: write. */
function publishError(error: unknown, minting: boolean): string {
  // The only trace: no caller sees the error, and the stored reason drops the status.
  console.error("Publishing a check run failed", error);
  if (error instanceof GithubError && !error.rateLimited) {
    if (error.status === 403 || (minting && error.status === 422)) return errors.CHECK_RUN_REFUSED;
    if (error.status === 404) return errors.ACCESS_REMOVED;
  }
  const userError = toUserError(error);
  return userError instanceof ConvexError && typeof userError.data === "string" ? userError.data : errors.GITHUB_UNAVAILABLE;
}
