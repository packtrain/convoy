import { getTasksByIds } from "../../tasks/lib/tasksRepo";
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { join } from "../../lib/shared/join";
import { getCliProfilesByIds } from "./cliProfilesRepo";
import { getLatestActiveSessionsByProfiles } from "./cliSessionsRepo";
import { ONLINE_THRESHOLD_MS } from "./constants";
import { toContainerSummary, toThreadSummary, type CliThreadSummary } from "./validators";
import { isContainerThread } from "./watchStatus";

/**
 * Loading for the **summary** tier of threads (OS-1162): the shape and its
 * projections live in `validators.ts`; this owns how their dependencies load.
 *
 * The tier's rules live in `docs/specs/mcp-server.md` under "The summary tier",
 * which is authoritative. Sibling: `messageSummaries.ts`.
 */

/**
 * Resolve summary fields for a whole page: profiles in one batched load, online
 * state once per distinct profile.
 *
 * Resolved **by profile** like the single read, so the two cannot disagree about
 * `targetOnline` — see `getLatestActiveSessionsByProfiles`. Containers skip both
 * lookups, so an all-container page reads nothing extra.
 */
export async function enrichThreadSummaries(ctx: QueryCtx, threads: Doc<"cliThreads">[]): Promise<CliThreadSummary[]> {
  const targets = threads.filter((thread) => !isContainerThread(thread));
  const sessionsByProfile = await getLatestActiveSessionsByProfiles(
    ctx,
    targets.map((thread) => thread.profileId),
    Date.now() - ONLINE_THRESHOLD_MS
  );

  return join(threads)
    .on((thread) => (isContainerThread(thread) ? undefined : thread.profileId))
    .with((ids) => getCliProfilesByIds(ctx, ids))
    .selectAll((thread, profile) =>
      isContainerThread(thread)
        ? toContainerSummary(thread)
        : toThreadSummary(thread, profile, sessionsByProfile.get(thread.profileId) ?? null)
    );
}

/** Service-only task references, deduplicated per page. See docs/specs/cli-tui.md. */
export async function enrichServiceThreadSummaries(ctx: QueryCtx, threads: Doc<"cliThreads">[], project: Doc<"projects">): Promise<CliThreadSummary[]> {
  const summaries = await enrichThreadSummaries(ctx, threads);
  return join(summaries)
    .on(row => row.associatedTaskId)
    .with(ids => getTasksByIds(ctx, ids))
    .selectAll((row, task) => ({ ...row,
      associatedTaskRef: task && !task.isDeleted && task.projectId === project._id
        ? `${project.alias}-${task.refNumber}` : undefined,
    }));
}
