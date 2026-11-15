import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ConvoyClient } from "../../lib/config/index.js";

export type ResolvedTaskList = NonNullable<
  FunctionReturnType<typeof api.tasks.lists.resolve>
>;

/**
 * Resolve a List ID or bare project-scoped ref to its List, same contract as
 * the MCP handler. Scoped refs with "/" and system Lists (BACKLOG) don't
 * resolve. Throws a user-facing error on no match.
 */
export async function resolveTaskList(
  client: ConvoyClient,
  projectId: Id<"projects">,
  identifier: string,
  optionLabel = "list"
): Promise<ResolvedTaskList> {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new Error(`${optionLabel} is required`);
  }
  if (trimmed.includes("/")) {
    throw new Error(
      `${optionLabel} "${identifier}" must be a raw List ID or bare List ref (scoped refs with "/" are not accepted)`
    );
  }

  const resolved = await client.query(api.tasks.lists.resolve, {
    projectId,
    identifier: trimmed,
  });
  if (!resolved) {
    throw new Error(
      `${optionLabel} "${identifier}" did not match any List in the project. Run 'convoy lists list' to see available Lists.`
    );
  }
  return resolved;
}
