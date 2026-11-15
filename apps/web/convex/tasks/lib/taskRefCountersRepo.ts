import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/**
* Reserve a contiguous range `[start, start + count)` of task ref numbers for a project and
* return `start`. Bulk flows reserve their whole range in one write (OS-935).
*
* The counter has its own table (OS-934) rather than living on the project doc, so handing out
* refs doesn't invalidate the project's many subscribers. A missing row seeds at `1`:
* pre-OS-934 projects were backfilled, so its absence means a project with zero tasks. Lazy
* creation is OCC-safe — a concurrent first-create reads the empty range and retries.
*
* Contract: per-project, strictly monotonic, contiguous within one reservation.
*/
export async function reserveTaskRefNumbers(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  count: number
): Promise<number> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`reserveTaskRefNumbers: count must be a positive integer, got ${count}`);
  }

  const existing = await ctx.db
    .query("taskRefCounters")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();

  if (existing) {
    const start = existing.nextRefNumber;
    await ctx.db.patch("taskRefCounters", existing._id, {
      nextRefNumber: start + count,
    });
    return start;
  }

  await ctx.db.insert("taskRefCounters", {
    projectId,
    nextRefNumber: 1 + count,
  });
  return 1;
}
