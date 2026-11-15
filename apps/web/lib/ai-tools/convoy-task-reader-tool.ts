import type { DynamicToolUIPart, UIMessage } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import {
  extractMcpToolResult,
  isConvoyMcpTool,
  parseMcpToolName,
} from "@/lib/ai-tools/mcp-tool";
import { isRecord } from "@/lib/type-guards";

export type ConvoyTaskReaderKind =
  | "get_task"
  | "get_tasks"
  | "list_tasks"
  | "search_tasks";

export type ConvoyTaskSummary = {
  refId: string;
  name: string;
  status?: string;
  listName?: string;
};

export type ConvoyTaskReaderPayload = {
  kind: ConvoyTaskReaderKind;
  server: string;
  toolCallId: string;
  state: DynamicToolUIPart["state"];
  /** Compact input echo for the header line: task ref(s) or search query. */
  inputHint?: string;
  /** Parsed result rows; only set once output is available and shape-valid. */
  tasks?: ConvoyTaskSummary[];
  /** get_tasks identifiers that did not resolve to a task. */
  unresolvedIdentifiers?: string[];
  errorText?: string;
};

const READER_KINDS = new Set<string>([
  "get_task",
  "get_tasks",
  "list_tasks",
  "search_tasks",
]);

function parseTaskSummary(value: unknown): ConvoyTaskSummary | null {
  if (!isRecord(value)) return null;
  if (typeof value.refId !== "string" || typeof value.name !== "string") {
    return null;
  }
  const listName =
    isRecord(value.list) && typeof value.list.name === "string"
      ? value.list.name
      : undefined;
  return {
    refId: value.refId,
    name: value.name,
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    ...(listName ? { listName } : {}),
  };
}

function parseTaskSummaryList(value: unknown): ConvoyTaskSummary[] | null {
  if (!Array.isArray(value)) return null;
  const tasks = value.map(parseTaskSummary).filter((task) => task !== null);
  // Non-empty input that yields zero rows is an unrecognized shape.
  if (value.length > 0 && tasks.length === 0) return null;
  return tasks;
}

function buildInputHint(
  kind: ConvoyTaskReaderKind,
  input: unknown
): string | undefined {
  if (!isRecord(input)) return undefined;

  if (kind === "get_task") {
    return typeof input.taskId === "string" ? input.taskId : undefined;
  }
  if (kind === "get_tasks") {
    if (!Array.isArray(input.identifiers)) return undefined;
    const refs = input.identifiers.filter(
      (item): item is string => typeof item === "string"
    );
    if (refs.length === 0) return undefined;
    if (refs.length <= 3) return refs.join(", ");
    return `${refs.slice(0, 3).join(", ")} +${refs.length - 3}`;
  }
  if (kind === "search_tasks") {
    return typeof input.query === "string" ? `“${input.query}”` : undefined;
  }
  // list_tasks: echo the status filter when present.
  return typeof input.status === "string" ? input.status : undefined;
}

type ParsedResult = Pick<
  ConvoyTaskReaderPayload,
  "tasks" | "unresolvedIdentifiers"
>;

function parseReaderResult(
  kind: ConvoyTaskReaderKind,
  output: unknown
): ParsedResult | null {
  const result = extractMcpToolResult(output);

  if (kind === "get_task") {
    const task = parseTaskSummary(result);
    return task ? { tasks: [task] } : null;
  }

  if (kind === "list_tasks") {
    const tasks = parseTaskSummaryList(result);
    return tasks ? { tasks } : null;
  }

  if (kind === "search_tasks") {
    if (!isRecord(result)) return null;
    const tasks = parseTaskSummaryList(result.page);
    return tasks ? { tasks } : null;
  }

  // get_tasks → { results: [{ identifier, task | null }] }
  if (!isRecord(result) || !Array.isArray(result.results)) return null;
  const tasks: ConvoyTaskSummary[] = [];
  const unresolvedIdentifiers: string[] = [];
  for (const item of result.results) {
    if (!isRecord(item)) return null;
    const task = parseTaskSummary(item.task);
    if (task) {
      tasks.push(task);
      continue;
    }
    if (typeof item.identifier === "string") {
      unresolvedIdentifiers.push(item.identifier);
    }
  }
  if (tasks.length === 0 && unresolvedIdentifiers.length === 0) return null;
  return {
    tasks,
    ...(unresolvedIdentifiers.length > 0 ? { unresolvedIdentifiers } : {}),
  };
}

export function parseConvoyTaskReaderToolPart(
  part: UIMessage["parts"][number]
): ConvoyTaskReaderPayload | null {
  if (!isDynamicToolUIPart(part)) return null;

  const name = parseMcpToolName(part.toolName);
  if (!name || !isConvoyMcpTool(name) || !READER_KINDS.has(name.tool)) {
    return null;
  }
  const kind = name.tool as ConvoyTaskReaderKind;

  const input = "input" in part ? part.input : undefined;
  const inputHint = buildInputHint(kind, input);
  const base: ConvoyTaskReaderPayload = {
    kind,
    server: name.server,
    toolCallId: part.toolCallId,
    state: part.state,
    ...(inputHint !== undefined ? { inputHint } : {}),
  };

  if (part.state === "output-error") {
    const errorText =
      "errorText" in part && typeof part.errorText === "string"
        ? part.errorText
        : undefined;
    return { ...base, ...(errorText ? { errorText } : {}) };
  }

  if (part.state === "output-available") {
    const parsed = parseReaderResult(kind, part.output);
    // Unexpected output shape → generic MCP fallback.
    if (!parsed) return null;
    return { ...base, ...parsed };
  }

  return base;
}
