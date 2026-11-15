import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ConvoyClient } from "../../lib/config/index.js";
import type { ProjectLabel } from "./formatters.js";

/** Mirror of the backend `normalizeLabelName` (convex/tasks/lib/taskLabelsRepo.ts). */
export function normalizeLabelName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Resolve a label ID or exact name (case/whitespace-insensitive) to a label ID,
 * same contract as the MCP handler. Throws a user-facing error on no match.
 */
export async function resolveLabelId(
  client: ConvoyClient,
  projectId: Id<"projects">,
  identifier: string,
  optionLabel = "label"
): Promise<Id<"projectLabels">> {
  const labels: ProjectLabel[] = await client.query(api.tasks.labels.list, { projectId });
  const byId = labels.find((label) => label._id === identifier);
  if (byId) {
    return byId._id;
  }

  const normalized = normalizeLabelName(identifier);
  const byName = labels.find((label) => normalizeLabelName(label.name) === normalized);
  if (byName) {
    return byName._id;
  }

  throw new Error(
    `${optionLabel} "${identifier}" did not match any label in the project. Run 'convoy labels list' to see available labels.`
  );
}
