import { api } from "../../_generated/api";
import { hydrateAvailableClis, toRuntimeSummaries } from "../../lib/contracts/validators";
import type { ToolHandler } from "./context";

/**
 * Target discovery for the CLI thread tools (OS-1162). An agent calls this first,
 * then feeds `profileId` / `pathId` / a `cliType` into `create_thread`.
 *
 * `listByProject` already returns this payload; the handler renames ids to the
 * argument names the write tools expect, drops fields meaningless to an agent
 * (`profileKey`, `createdAt`, `sessionStartedAt`), and summarizes runtimes down to
 * the `cliModel` values `create_thread` accepts — a full opencode catalog is tens
 * of KB, mostly labels and variant keys no argument here takes (OS-1721).
 */
export const handleListCliProfiles: ToolHandler = async ({ ctx, apiKey, getProjectId }) => {
  const projectId = await getProjectId();
  const profiles = await ctx.runQuery(api.cli.profiles.listByProject, {
    projectId,
    apiKey,
  });
  // Catalogs live off the profile row (OS-1721), so discovery reads them here.
  const catalogs = await ctx.runQuery(api.cli.profiles.listRuntimeCatalogs, { projectId, apiKey });

  return profiles.map((profile) => ({
    profileId: profile._id,
    name: profile.name,
    hostname: profile.hostname,
    isOnline: profile.isOnline,
    lastConnectedAt: profile.lastConnectedAt,
    appVersion: profile.appVersion,
    availableClis: toRuntimeSummaries(hydrateAvailableClis(profile.availableClis, catalogs, profile._id), {
      withCliModels: true,
    }),
    paths: profile.paths.map((path) => ({
      pathId: path.id,
      path: path.path,
      label: path.label,
      // Kept so an agent can tell a repo checkout from a worktree and match a
      // path to the repo it is working on.
      gitRemoteUrl: path.gitRemoteUrl,
      kind: path.kind,
      parentPathId: path.parentPathId,
      branch: path.branch,
    })),
  }));
};
