import type { DynamicToolUIPart, UIMessage } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import {
  extractMcpToolResult,
  isConvoyMcpTool,
  parseMcpToolName,
} from "@/lib/ai-tools/mcp-tool";
import {
  isTaskExternalLinkKind,
  type TaskExternalLinkInput,
} from "@/lib/tasks/external-links";
import { isRecord } from "@/lib/type-guards";

export type ConvoyTaskWriterKind =
  | "create_task"
  | "update_task"
  | "delete_task"
  | "move_task"
  | "move_tasks_to_list"
  | "update_task_link";

export type ConvoyTaskWriterPayload = {
  kind: ConvoyTaskWriterKind;
  server: string;
  toolCallId: string;
  state: DynamicToolUIPart["state"];
  /** Verb phrase before the ref; tense follows completion state. */
  action: string;
  /** Task identifier from input (create_task: refId from output once known). */
  refId?: string;
  /** Rest of the one-line summary after the ref. */
  detail?: string;
  /** Task name (create_task), for the linked body row. */
  taskName?: string;
  /** Changed status/priority (update_task), rendered with the real task badges. */
  status?: string;
  priority?: string;
  /** Changed label name (update_task); null means the label was cleared. */
  label?: string | null;
  /** Remaining changed fields (update_task) as plain text. */
  changes?: string[];
  /** All moved identifiers (move_tasks_to_list body rows). */
  taskRefs?: string[];
  /** The written external link (update_task_link), rendered like the sidebar. */
  link?: TaskExternalLinkInput;
  errorText?: string;
};

/** Project alias (2-5 chars) + number, e.g. "OS-1250". */
export const TASK_REF_PATTERN = /^[A-Za-z]{2,5}-\d+$/;

const WRITER_KINDS = new Set<string>([
  "create_task",
  "update_task",
  "delete_task",
  "move_task",
  "move_tasks_to_list",
  "update_task_link",
]);

// Status, priority, and label render through the real task components.
function describeUpdateChanges(input: Record<string, unknown>): string[] {
  const changes: string[] = [];
  if (typeof input.name === "string") changes.push(`Renamed to “${input.name}”`);
  if ("taskTypeKey" in input) {
    changes.push(
      typeof input.taskTypeKey === "string"
        ? `Type → ${input.taskTypeKey}`
        : "Type reset"
    );
  }
  if ("assignee" in input) {
    changes.push(input.assignee === null ? "Unassigned" : "Assignee updated");
  }
  if ("dueDate" in input) {
    changes.push(input.dueDate === null ? "Due date cleared" : "Due date updated");
  }
  if (Array.isArray(input.tags)) {
    const tags = input.tags.filter((tag): tag is string => typeof tag === "string");
    changes.push(tags.length > 0 ? `Tags: ${tags.join(", ")}` : "Tags cleared");
  }
  if ("description" in input) changes.push("Description updated");
  return changes;
}

type ParsedAction = Pick<
  ConvoyTaskWriterPayload,
  | "action"
  | "refId"
  | "detail"
  | "taskName"
  | "status"
  | "priority"
  | "label"
  | "changes"
  | "taskRefs"
  | "link"
>;

/**
 * The tool input's `link` mirrors `TaskExternalLinkInput`; keep only shapes the
 * label/icon helpers can read, so a malformed input renders no link at all.
 */
function parseLinkInput(value: unknown): TaskExternalLinkInput | undefined {
  if (!isRecord(value)) return undefined;
  const { kind } = value;
  if (typeof kind !== "string" || !isTaskExternalLinkKind(kind)) return undefined;
  const text = (key: string) =>
    typeof value[key] === "string" ? (value[key] as string) : undefined;
  const url = text("url");
  const title = text("title");
  const identifier = text("identifier");
  const sha = text("sha");
  const name = text("name");
  if (kind === "commit") {
    return sha
      ? { kind, sha, ...(title ? { title } : {}), ...(url ? { url } : {}) }
      : undefined;
  }
  if (kind === "branch") {
    return name ? { kind, name, ...(url ? { url } : {}) } : undefined;
  }
  if (!url) return undefined;
  return kind === "pull_request"
    ? { kind, url, ...(title ? { title } : {}), ...(identifier ? { identifier } : {}) }
    : { kind, url, ...(title ? { title } : {}) };
}

function parseWriterAction(
  kind: ConvoyTaskWriterKind,
  input: Record<string, unknown>,
  output: unknown,
  done: boolean
): ParsedAction | null {
  if (kind === "create_task") {
    if (typeof input.name !== "string") return null;
    const result = extractMcpToolResult(output);
    const refId =
      isRecord(result) && typeof result.refId === "string"
        ? result.refId
        : undefined;
    return {
      action: done ? "Created task" : "Create task",
      ...(refId ? { refId } : {}),
      detail: `“${input.name}”`,
      taskName: input.name,
    };
  }

  if (kind === "move_tasks_to_list") {
    if (!Array.isArray(input.taskIds) || typeof input.listId !== "string") {
      return null;
    }
    const refs = input.taskIds.filter(
      (item): item is string => typeof item === "string"
    );
    if (refs.length === 0) return null;
    const action = done ? "Moved" : "Move";
    if (refs.length === 1) {
      return { action, refId: refs[0], detail: `to ${input.listId}` };
    }
    return {
      action,
      detail: `${refs.length} tasks to ${input.listId}`,
      taskRefs: refs,
    };
  }

  // Remaining kinds all target a single taskId.
  if (typeof input.taskId !== "string") return null;
  const refId = input.taskId;

  if (kind === "update_task") {
    return {
      action: done ? "Updated" : "Update",
      refId,
      ...(typeof input.status === "string"
        ? { detail: `→ ${input.status}`, status: input.status }
        : {}),
      ...(typeof input.priority === "string"
        ? { priority: input.priority }
        : {}),
      ...("label" in input
        ? { label: typeof input.label === "string" ? input.label : null }
        : {}),
      changes: describeUpdateChanges(input),
    };
  }

  if (kind === "delete_task") {
    return {
      action: done ? "Deleted" : "Delete",
      refId,
      ...(input.cascadeMode === "keep_children"
        ? { detail: "(keeping subtasks)" }
        : {}),
    };
  }

  if (kind === "move_task") {
    if (!("parentId" in input)) return null;
    return {
      action: done ? "Moved" : "Move",
      refId,
      detail:
        input.parentId === null
          ? "to top level"
          : typeof input.parentId === "string"
            ? `under ${input.parentId}`
            : undefined,
    };
  }

  // update_task_link
  if (input.op !== "upsert" && input.op !== "delete") return null;
  const link = parseLinkInput(input.link);
  const action =
    input.op === "delete"
      ? done
        ? "Removed link from"
        : "Remove link from"
      : done
        ? "Updated link on"
        : "Update link on";
  return {
    action,
    refId,
    ...(link ? { link } : {}),
  };
}

export function parseConvoyTaskWriterToolPart(
  part: UIMessage["parts"][number]
): ConvoyTaskWriterPayload | null {
  if (!isDynamicToolUIPart(part)) return null;

  const name = parseMcpToolName(part.toolName);
  if (!name || !isConvoyMcpTool(name) || !WRITER_KINDS.has(name.tool)) {
    return null;
  }
  const kind = name.tool as ConvoyTaskWriterKind;

  const input = "input" in part ? part.input : undefined;
  // The summary is built from the input; without it fall back to generic MCP.
  if (!isRecord(input)) return null;

  const output = "output" in part ? part.output : undefined;
  const done = part.state === "output-available";
  const parsed = parseWriterAction(kind, input, output, done);
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
