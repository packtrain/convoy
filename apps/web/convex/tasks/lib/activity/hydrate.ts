import type { Infer } from "convex/values";
import type { Doc } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { join } from "../../../lib/shared/join";
import { getUsersByIds } from "../../../users/lib/usersRepo";
import type { taskActivityLogListItemValidator } from "./validators";

type TaskActivityLogRow = Infer<typeof taskActivityLogListItemValidator>;

/**
 * Enrich activity logs with the acting user's display fields. Left join: the
 * actor may have been deleted, in which case the row falls back to "Unknown".
 *
 * Shared by `tasks.activity.listByTask` and the merged
 * `tasks.timeline.listByTask` so both render identical activity rows.
 */
export async function hydrateTaskActivityLogs(
  ctx: QueryCtx,
  logs: readonly Doc<"taskActivityLogs">[]
): Promise<TaskActivityLogRow[]> {
  return join(logs)
    .on((log) => log.userId)
    .with((ids) => getUsersByIds(ctx, ids))
    .selectAll((log, actor) => ({
      ...log,
      userName: actor?.name ?? "Unknown",
      userAvatarUrl: actor?.avatarUrl ?? null,
    }));
}
