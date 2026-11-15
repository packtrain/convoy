import { toCliAccountUsage, type CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { isRecord } from "@/lib/type-guards";
import type { RawCliChunk } from "../contracts";
import { planProgressEvent, type PlanProgressStep } from "../shared/planProgress";
import {
  getCodexAppServerThreadId,
  isCodexAppServerChunk,
  normalizeCodexAppServerChunk,
} from "./appServerEvents";

/**
 * Normalize `codex exec --json` JSONL events into provider-agnostic CLI events.
 * Top-level types: `thread.started`, `turn.started|completed|failed`, `error`, and
 * `item.started|updated|completed` wrapping typed items (`agent_message`,
 * `command_execution`, `file_change`, ...).
 *
 * The opt-in `codex app-server` transport uses slash-separated JSON-RPC methods and
 * is delegated to `normalizeCodexAppServerChunk`.
 */

function safeJsonParse(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function unknownEvent(chunk: RawCliChunk, reason: string): CliNormalizedEvent {
  return {
    kind: "unknown",
    reason,
    rawType: chunk.type,
    rawData: chunk.data,
  };
}

function silentMetadata(payload: Record<string, unknown>): CliNormalizedEvent {
  return { kind: "metadata", otherJson: JSON.stringify(payload) };
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeCommandExecutionItem(phase: string, item: Record<string, unknown>): CliNormalizedEvent {
  const toolCallId = getString(item.id);
  if (phase === "item.started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName: "Shell",
      inputJson: JSON.stringify({ command: item.command ?? "" }),
    };
  }
  if (phase !== "item.completed") {
    return silentMetadata({ event: phase, item });
  }

  const exitCode = typeof item.exit_code === "number" ? item.exit_code : null;
  const output = getString(item.aggregated_output) ?? "";
  if (item.status === "failed" || (exitCode !== null && exitCode !== 0)) {
    const exitText = exitCode !== null ? ` with exit code ${exitCode}` : "";
    return {
      kind: "tool-error",
      toolCallId,
      errorText: `Command failed${exitText}.${output ? `\n${output}` : ""}`,
    };
  }
  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify({ output, exitCode }),
  };
}

function normalizeFileChangeItem(phase: string, item: Record<string, unknown>): CliNormalizedEvent {
  const toolCallId = getString(item.id);
  const changes = Array.isArray(item.changes) ? item.changes : [];
  if (phase === "item.started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName: "Apply changes",
      inputJson: JSON.stringify({ changes }),
    };
  }
  if (phase !== "item.completed") {
    return silentMetadata({ event: phase, item });
  }
  if (item.status === "failed") {
    return {
      kind: "tool-error",
      toolCallId,
      errorText: "Codex failed to apply the file changes.",
    };
  }
  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify({ changes, status: item.status ?? null }),
  };
}

function normalizeMcpToolCallItem(phase: string, item: Record<string, unknown>): CliNormalizedEvent {
  const toolCallId = getString(item.id);
  const server = getString(item.server);
  const tool = getString(item.tool);
  const toolName = [server, tool].filter(Boolean).join(".") || "MCP tool";
  if (phase === "item.started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName,
      inputJson: JSON.stringify(item),
    };
  }
  if (phase !== "item.completed") {
    return silentMetadata({ event: phase, item });
  }
  if (item.status === "failed") {
    return {
      kind: "tool-error",
      toolCallId,
      errorText: `MCP tool ${toolName} failed.`,
    };
  }
  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify(item),
  };
}

function normalizeWebSearchItem(phase: string, item: Record<string, unknown>): CliNormalizedEvent {
  const toolCallId = getString(item.id);
  if (phase === "item.started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName: "Web search",
      inputJson: JSON.stringify({ query: item.query ?? "" }),
    };
  }
  if (phase !== "item.completed") {
    return silentMetadata({ event: phase, item });
  }
  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify(item),
  };
}

/**
 * `todo_list` items are full plan snapshots (`items: [{ text, completed }]`)
 * emitted on every `update_plan` call. Unlike the app-server transport, exec
 * JSON only distinguishes completed from incomplete — there is no in-progress
 * status, and this deliberately does not guess which step is active.
 */
function normalizeTodoListItem(phase: string, item: Record<string, unknown>): CliNormalizedEvent {
  const items = Array.isArray(item.items) ? item.items : [];

  const steps: PlanProgressStep[] = items.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const text = getString(entry.text)?.trim() ?? "";
    if (text.length === 0) {
      return [];
    }
    return [{ text, status: entry.completed === true ? ("completed" as const) : ("pending" as const) }];
  });

  return planProgressEvent(steps) ?? silentMetadata({ event: phase, itemType: "todo_list", item });
}

function normalizeCodexItemEvent(chunk: RawCliChunk, obj: Record<string, unknown>): CliNormalizedEvent {
  const item = isRecord(obj.item) ? obj.item : null;
  if (!item) {
    return unknownEvent(chunk, "codex-item-event-without-item");
  }

  const itemType = getString(item.type) ?? "unknown";
  const phase = chunk.type;

  switch (itemType) {
    case "agent_message": {
      if (phase !== "item.completed") {
        return silentMetadata({ event: phase, itemType });
      }
      return { kind: "text", text: getString(item.text) ?? "" };
    }
    case "reasoning": {
      if (phase !== "item.completed") {
        return silentMetadata({ event: phase, itemType });
      }
      const text = getString(item.text) ?? getString(item.summary) ?? "";
      return text.length > 0 ? { kind: "reasoning", text } : silentMetadata({ event: phase, itemType });
    }
    case "command_execution":
      return normalizeCommandExecutionItem(phase, item);
    case "file_change":
      return normalizeFileChangeItem(phase, item);
    case "mcp_tool_call":
      return normalizeMcpToolCallItem(phase, item);
    case "web_search":
      return normalizeWebSearchItem(phase, item);
    case "todo_list":
      return normalizeTodoListItem(phase, item);
    case "error":
      return {
        kind: "warning",
        code: "codex-item-error",
        message: getString(item.message) ?? "Codex reported an error.",
      };
    default:
      return unknownEvent(chunk, `unrecognized-codex-item:${itemType}`);
  }
}

export function normalizeCodexChunk(chunk: RawCliChunk): CliNormalizedEvent {
  if (isCodexAppServerChunk(chunk)) {
    return normalizeCodexAppServerChunk(chunk);
  }

  const parsed = safeJsonParse(chunk.data);
  const obj = isRecord(parsed) ? parsed : null;
  if (!obj) {
    return unknownEvent(chunk, "unparseable-codex-chunk");
  }

  switch (chunk.type) {
    case "thread.started": {
      const threadId = getString(obj.thread_id);
      return {
        kind: "metadata",
        sessionId: threadId,
        otherJson: JSON.stringify({ event: "thread.started", threadId }),
      };
    }
    case "turn.started":
      return silentMetadata({ event: "turn.started" });
    case "turn.completed":
      return silentMetadata({
        event: "turn.completed",
        usage: isRecord(obj.usage) ? obj.usage : null,
      });
    case "turn.failed": {
      const error = isRecord(obj.error) ? obj.error : null;
      return {
        kind: "runtime-notice",
        code: "codex-turn-failed",
        title: "Codex turn failed",
        message: getString(error?.message) ?? "Codex could not complete the turn.",
        detailsJson: chunk.data,
      };
    }
    // Load-bearing for BOTH transports: "error" is the one chunk type with
    // no slash, so app-server error notifications also dispatch here (see
    // isCodexAppServerChunk). Keep both payload shapes covered.
    case "error":
      return {
        kind: "warning",
        code: "codex-error",
        // exec events carry a top-level `message`; app-server `error`
        // notifications nest it under `error.message`.
        message:
          getString(obj.message) ??
          (isRecord(obj.error) ? getString(obj.error.message) : undefined) ??
          "Codex reported an error.",
      };
    case "item.started":
    case "item.updated":
    case "item.completed":
      return normalizeCodexItemEvent(chunk, obj);
    case "convoy.account_usage": {
      const usage = toCliAccountUsage(obj);
      return usage ? { kind: "account-usage", usage } : unknownEvent(chunk, "Invalid account usage snapshot");
    }
    // Synthetic slash-command inventory from the CLI runner (OS-1582).
    // Dispatches here rather than to the app-server normalizer because the
    // type has no slash; nothing renders.
    case "convoy.commands":
      return silentMetadata({ event: "convoy.commands" });
    default:
      return unknownEvent(chunk, "unrecognized-codex-event");
  }
}

/**
 * Codex thread id from stored raw chunks: first exec `thread.started`
 * (`thread_id`) or app-server `thread/started` (`thread.id`).
 */
export function getCodexContinuationIdFromIncomingChunks(chunks: RawCliChunk[]): string | null {
  for (const chunk of chunks) {
    const appServerThreadId = getCodexAppServerThreadId(chunk);
    if (appServerThreadId) {
      return appServerThreadId;
    }
    if (chunk.type !== "thread.started") {
      continue;
    }
    const parsed = safeJsonParse(chunk.data);
    const threadId = isRecord(parsed) ? getString(parsed.thread_id) : undefined;
    if (threadId && threadId.length > 0) {
      return threadId;
    }
  }
  return null;
}
