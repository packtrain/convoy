import type { DynamicToolUIPart, UIMessage } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import {
  extractMcpToolResult,
  isConvoyMcpTool,
  parseMcpToolName,
} from "@/lib/ai-tools/mcp-tool";
import { isRecord } from "@/lib/type-guards";

export type ConvoyArtifactToolKind =
  | "create_task_artifact"
  | "get_task_artifact"
  | "update_task_artifact"
  | "move_task_artifact"
  | "delete_task_artifact"
  | "list_task_artifacts"
  | "replace_in_task_artifact";

export type ConvoyArtifactSummary = {
  id?: string;
  name: string;
  contentType: string;
};

export type ConvoyArtifactToolPayload = {
  kind: ConvoyArtifactToolKind;
  server: string;
  toolCallId: string;
  state: DynamicToolUIPart["state"];
  /** Verb phrase; tense follows completion state. */
  action: string;
  /** From input (create/update) or output (get). */
  artifactName?: string;
  /** From input (id-based tools) or output (create); links to the artifact page. */
  artifactId?: string;
  /** Task ref from input.taskId (create/list). */
  taskRef?: string;
  /** Artifact body from input (create/update) or output (get). */
  content?: string;
  contentType?: string;
  /** replace_in_task_artifact input. */
  oldString?: string;
  newString?: string;
  /** replace_in_task_artifact soft failure ({ ok: false }). */
  replaceError?: string;
  /** list_task_artifacts rows. */
  artifacts?: ConvoyArtifactSummary[];
  errorText?: string;
};

const ARTIFACT_KINDS = new Set<string>([
  "create_task_artifact",
  "get_task_artifact",
  "update_task_artifact",
  "move_task_artifact",
  "delete_task_artifact",
  "list_task_artifacts",
  "replace_in_task_artifact",
]);

type ParsedAction = Omit<
  ConvoyArtifactToolPayload,
  "kind" | "server" | "toolCallId" | "state" | "errorText"
>;

function contentFields(input: Record<string, unknown>) {
  return {
    ...(typeof input.content === "string" ? { content: input.content } : {}),
    ...(typeof input.contentType === "string"
      ? { contentType: input.contentType }
      : {}),
  };
}

function parseArtifactAction(
  kind: ConvoyArtifactToolKind,
  input: Record<string, unknown>,
  output: unknown,
  done: boolean
): ParsedAction | null {
  if (kind === "create_task_artifact") {
    if (typeof input.name !== "string" || typeof input.taskId !== "string") {
      return null;
    }
    const result = done ? extractMcpToolResult(output) : undefined;
    return {
      action: done ? "Created artifact" : "Create artifact",
      artifactName: input.name,
      taskRef: input.taskId,
      ...(typeof result === "string" ? { artifactId: result } : {}),
      ...contentFields(input),
    };
  }

  if (kind === "list_task_artifacts") {
    if (typeof input.taskId !== "string") return null;
    const base = {
      action: done ? "Listed artifacts" : "List artifacts",
      taskRef: input.taskId,
    };
    if (!done) return base;
    const result = extractMcpToolResult(output);
    if (!Array.isArray(result)) return null;
    const artifacts = result
      .filter(isRecord)
      .filter((item): item is Record<string, unknown> & { name: string } =>
        typeof item.name === "string"
      )
      .map((item) => ({
        ...(typeof item._id === "string" ? { id: item._id } : {}),
        name: item.name,
        contentType:
          typeof item.contentType === "string" ? item.contentType : "markdown",
      }));
    // Non-empty output that yields zero rows is an unrecognized shape.
    if (result.length > 0 && artifacts.length === 0) return null;
    return { ...base, artifacts };
  }

  // Remaining kinds all target a single artifactId.
  if (typeof input.artifactId !== "string") return null;
  const artifactId = input.artifactId;

  if (kind === "get_task_artifact") {
    const base = { action: "Read artifact", artifactId };
    if (!done) return base;
    const result = extractMcpToolResult(output);
    if (!isRecord(result) || typeof result.content !== "string") return null;
    return {
      ...base,
      ...(typeof result.name === "string"
        ? { artifactName: result.name }
        : {}),
      content: result.content,
      ...(typeof result.contentType === "string"
        ? { contentType: result.contentType }
        : {}),
    };
  }

  if (kind === "update_task_artifact") {
    return {
      action: done ? "Updated artifact" : "Update artifact",
      artifactId,
      ...(typeof input.name === "string" ? { artifactName: input.name } : {}),
      ...contentFields(input),
    };
  }

  if (kind === "move_task_artifact") {
    if (typeof input.taskId !== "string") return null;
    return {
      action: done ? "Moved artifact" : "Move artifact",
      artifactId,
      taskRef: input.taskId,
    };
  }

  if (kind === "delete_task_artifact") {
    // No link for deletes — the target no longer exists.
    return { action: done ? "Deleted artifact" : "Delete artifact" };
  }

  // replace_in_task_artifact
  if (typeof input.oldString !== "string" || typeof input.newString !== "string") {
    return null;
  }
  const result = done ? extractMcpToolResult(output) : undefined;
  const replaceError =
    isRecord(result) && result.ok === false && typeof result.message === "string"
      ? result.message
      : undefined;
  return {
    action: done ? "Edited artifact" : "Edit artifact",
    artifactId,
    oldString: input.oldString,
    newString: input.newString,
    ...(replaceError ? { replaceError } : {}),
  };
}

export function parseConvoyArtifactToolPart(
  part: UIMessage["parts"][number]
): ConvoyArtifactToolPayload | null {
  if (!isDynamicToolUIPart(part)) return null;

  const name = parseMcpToolName(part.toolName);
  if (!name || !isConvoyMcpTool(name) || !ARTIFACT_KINDS.has(name.tool)) {
    return null;
  }
  const kind = name.tool as ConvoyArtifactToolKind;

  const input = "input" in part ? part.input : undefined;
  if (!isRecord(input)) return null;

  const output = "output" in part ? part.output : undefined;
  const done = part.state === "output-available";
  const parsed = parseArtifactAction(kind, input, output, done);
  // Unexpected input/output shape → generic MCP fallback.
  if (!parsed) return null;

  const errorText =
    part.state === "output-error" &&
    "errorText" in part &&
    typeof part.errorText === "string"
      ? part.errorText
      : undefined;

  return {
    kind,
    server: name.server,
    toolCallId: part.toolCallId,
    state: part.state,
    ...parsed,
    ...(errorText ? { errorText } : {}),
  };
}
