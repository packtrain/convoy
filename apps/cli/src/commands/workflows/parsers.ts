import type { FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api.js";
import { readTextFile } from "../../lib/text-input.js";

export type WorkflowDefinitionInput = FunctionArgs<typeof api.workflows.core.create>["definition"];

/**
 * A definition JSON file: either the bare definition or a `workflows get` dump,
 * whose `draftDefinition` is taken. Only the outline is checked here; the
 * backend validates the tree.
 */
export function readDefinitionFile(path: string): WorkflowDefinitionInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readTextFile(path, "definition"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse definition file "${path}": ${message}`);
  }
  const candidate =
    typeof parsed === "object" && parsed !== null && "draftDefinition" in parsed ? (parsed as { draftDefinition: unknown }).draftDefinition : parsed;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !Array.isArray((candidate as { lanes?: unknown }).lanes) ||
    !Array.isArray((candidate as { stages?: unknown }).stages)
  ) {
    throw new Error(`Definition file "${path}" needs \`lanes\` and \`stages\` arrays (see \`workflows get --output json\`).`);
  }
  return candidate as WorkflowDefinitionInput;
}
