import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { getProjectAgentById, getProjectAgentsByIds } from "../../../agents/lib/projectAgentsRepo";
import { toThreadAgent, type CliThreadAgent } from "../../lib/validators";

/**
 * Resolution for a thread's immutable Project agent binding (OS-1138). Live from
 * `cliThreads.projectAgentId`; agents that no longer resolve fail soft to the
 * placeholder in `validators.ts` (same pattern as task assignee hydration in
 * `tasks/lib/assignees.ts`). The thread keeps running on its
 * `agentPromptSnapshot` either way.
 */

export interface CliThreadAgentLookup {
  get(projectAgentId: Id<"projectAgents"> | null | undefined): CliThreadAgent | undefined;
}

const EMPTY_LOOKUP: CliThreadAgentLookup = { get: () => undefined };

/** Resolve one thread's bound agent display; placeholder when the agent no longer resolves. */
export async function resolveCliThreadAgent(ctx: QueryCtx | MutationCtx, projectAgentId: Id<"projectAgents">): Promise<CliThreadAgent> {
  const projectAgent = await getProjectAgentById(ctx, projectAgentId);
  return toThreadAgent(projectAgentId, projectAgent);
}

/** Batch-resolve bound agent displays for a list of threads' `projectAgentId`s. */
export async function resolveCliThreadAgents(
  ctx: QueryCtx | MutationCtx,
  projectAgentIds: ReadonlyArray<Id<"projectAgents"> | null | undefined>
): Promise<CliThreadAgentLookup> {
  const uniqueIds = [...new Set(projectAgentIds.filter(isDefinedProjectAgentId))];
  if (uniqueIds.length === 0) {
    return EMPTY_LOOKUP;
  }

  const projectAgents = await getProjectAgentsByIds(ctx, uniqueIds);
  const agentById = new Map(
    projectAgents
      .filter((projectAgent): projectAgent is Doc<"projectAgents"> => projectAgent !== null)
      .map((projectAgent) => [projectAgent._id, projectAgent])
  );

  const resolved = new Map<Id<"projectAgents">, CliThreadAgent>();
  for (const projectAgentId of uniqueIds) {
    resolved.set(projectAgentId, toThreadAgent(projectAgentId, agentById.get(projectAgentId) ?? null));
  }

  return {
    get: (projectAgentId) => (projectAgentId != null ? resolved.get(projectAgentId) : undefined),
  };
}

function isDefinedProjectAgentId(projectAgentId: Id<"projectAgents"> | null | undefined): projectAgentId is Id<"projectAgents"> {
  return projectAgentId !== null && projectAgentId !== undefined;
}
