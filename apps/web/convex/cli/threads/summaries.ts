import { query } from "../../_generated/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { getAuthenticatedAccess, getOptionalAuthenticatedAccess } from "../../lib/access/auth";
import { requireAuthorizedProject, hasProjectAccess } from "../../lib/access/permissions";
import { clampPageSize, EMPTY_PAGE } from "../../lib/shared/pagination";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { ONLINE_THRESHOLD_MS } from "../lib/constants";
import { getViewableThread } from "../lib/permissions";
import { paginateServiceThreads } from "./lib/cliThreadsRepo";
import { enrichServiceThreadSummaries, enrichThreadSummaries } from "../lib/threadSummaries";
import {
  cliThreadSummaryValidator,
  toContainerSummary,
  toThreadSummary,
  type CliThreadSummary,
} from "../lib/validators";
import { getCliProfileById } from "../lib/cliProfilesRepo";
import { getLatestActiveSessionForProfile } from "../lib/cliSessionsRepo";
import { listGroupRows, normalizeThreadId, paginateProjectThreads } from "./lib/cliThreadsRepo";
import { isContainerThread, isThreadDone } from "../lib/watchStatus";

/**
* One thread's summary (OS-1162), or null when the caller cannot see it. Serves every external
* caller of the narrow contract (MCP `get_thread`, `convoy threads get`), which is why
* neither name nor payload mentions who is asking. The shape lives in `lib/threadSummaries.ts`.
*
* Reuses `getViewableThread` so a shared thread reads the same as on the web, and passes the
* whole `principal` so a scoped key's project boundary is enforced. Cost: one get, plus — for
* ordinary threads only — a profile get and an indexed session lookup.
*/
export const getSummary = query({
  args: {
    // `v.string()` + `normalizeThreadId`, matching `get`: `v.id("cliThreads")` would
    // reject a well-formed id from another table in the *argument validator*, surfacing
    // over MCP as an opaque internal error instead of this query's "not found" null.
    threadId: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(v.null(), cliThreadSummaryValidator),
  // Annotated rather than inferred: the two returns are disjoint field sets, and an
  // inferred union would make every field a narrowing exercise for callers.
  handler: async (ctx, args): Promise<CliThreadSummary | null> => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return null;
    }

    const threadId = normalizeThreadId(ctx, args.threadId);
    if (!threadId) {
      return null;
    }

    const viewable = await getViewableThread(ctx, auth.principal, threadId);
    if (!viewable) {
      return null;
    }
    const { thread } = viewable;

    if (isContainerThread(thread)) {
      return toContainerSummary(thread);
    }

    const profile = await getCliProfileById(ctx, thread.profileId);
    const session = await getLatestActiveSessionForProfile(ctx, thread.profileId, Date.now() - ONLINE_THRESHOLD_MS);
    return toThreadSummary(thread, profile, session);
  },
});

/**
* A page of the caller's own threads in a project (OS-1626), newest activity first — the list
* beside `getSummary`, same contract and callers.
*
* **A container is one row, not its members.** Group children are excluded, so a 20-row page is
* 20 distinct units of work rather than five members of one group, and `kind` tells the caller
* which ids are drillable. Cost per page: one index scan, plus (ordinary rows only) a batched
* profile load and a session lookup per *distinct profile*.
*/
export const listSummaries = query({
  args: {
    projectId: v.id("projects"),
    // Off by default: "what threads do I have" almost never means the finished ones.
    // (No `includeArchived` — no archived state since OS-1561.)
    includeDone: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
    apiKey: v.optional(v.string()),
  },
  returns: paginationResultValidator(cliThreadSummaryValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return EMPTY_PAGE;
    }

    const hasAccess = await hasProjectAccess(ctx, auth.principal, args.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return EMPTY_PAGE;
    }

    const rows = await paginateProjectThreads(ctx, {
      userId: auth.user._id,
      projectId: args.projectId,
      sortBy: "lastActivity",
      // `undefined` is the ungrouped list; `false` is Active-only. `true` is not a call
      // shape here — nothing asks for *only* the done threads.
      isDone: args.includeDone === true ? undefined : false,
      paginationOpts: args.paginationOpts,
    });

    return { ...rows, page: await enrichThreadSummaries(ctx, rows.page) };
  },
});

/**
* One container's members (OS-1626), as summaries — the drill-down beside `listSummaries`'
* flat page. Empty when the id is not a readable container.
*
* **Not paginated, and takes no `projectId`**, which is why it is a separate query: the
* group is one capped index scan, and the container id plus the principal fully determine
* access. `handleListThreads` wraps the result in a page envelope so `list_threads` answers
* both call shapes alike.
*
* Authorized through `getViewableThread` on the container, which is what lets a teammate
* drill into a shared group and what carries the api key's project scope. Rows are then
* filtered to its owner: children all belonging to that owner is a mutation-side invariant,
* and this is a cross-user read seam, so it doesn't lean on one.
*/
export const listGroupSummaries = query({
  args: {
    // `v.string()` + `normalizeThreadId`, for the reason `getSummary` documents — and
    // an agent holding a `projectId` is a likely caller.
    parentThreadId: v.string(),
    includeDone: v.optional(v.boolean()),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(cliThreadSummaryValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }

    const parentThreadId = normalizeThreadId(ctx, args.parentThreadId);
    if (!parentThreadId) {
      return [];
    }

    const viewable = await getViewableThread(ctx, auth.principal, parentThreadId);
    if (!viewable || !isContainerThread(viewable.thread)) {
      return [];
    }

    const owner = viewable.thread.userId;
    const rows = (await listGroupRows(ctx, parentThreadId)).filter((row) => row.userId === owner);
    return enrichThreadSummaries(ctx, args.includeDone === true ? rows : rows.filter((row) => !isThreadDone(row)));
  },
});

export const listServiceSummaries = query({
  args: { projectId: v.id("projects"), apiKey: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(cliThreadSummaryValidator),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const { project } = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.CLI_THREAD);
    const page = await paginateServiceThreads(ctx, user._id, args.projectId, { ...args.paginationOpts,
      numItems: clampPageSize(args.paginationOpts.numItems, { min: 1, max: 50, default: 20 }) });
    return { ...page, page: await enrichServiceThreadSummaries(ctx, page.page, project) };
  },
});
