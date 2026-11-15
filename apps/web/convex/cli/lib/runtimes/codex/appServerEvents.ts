import type { CliNarrativeSource, CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { isRecord } from "@/lib/type-guards";
import { readBackgroundTasks } from "../shared/parsing";
import type { RawCliChunk } from "../contracts";
import { planProgressEvent, type PlanProgressStep } from "../shared/planProgress";

/**
 * Normalize `codex app-server` chunks (OS-1109 opt-in transport) into
 * provider-agnostic CLI events.
 *
 * Chunk contract: `type` = the JSON-RPC notification method (`item/completed`, ...),
 * `data` = the params JSON. Methods contain `/`, distinguishing them from `codex
 * exec --json`'s dot-separated types. Approval and user-input requests never arrive
 * as chunks — the executor routes them through the interaction bridge.
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

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getMilliseconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : undefined;
}

/** Streaming delta chunks are superseded by the completed item's full text. */
export function isCodexAppServerEphemeralChunk(chunk: RawCliChunk): boolean {
  if (chunk.type === "convoy/child") {
    const parsed = safeJsonParse(chunk.data);
    const method = isRecord(parsed) ? getString(parsed.method) : undefined;
    return method !== undefined && method !== "convoy/child" && isCodexAppServerEphemeralChunk({ type: method, data: "{}" });
  }
  return (
    chunk.type === "convoy/background_tasks" ||
    chunk.type === "item/plan/delta" ||
    chunk.type === "item/agentMessage/delta" ||
    chunk.type === "item/reasoning/textDelta" ||
    chunk.type === "item/reasoning/summaryTextDelta"
  );
}

/**
 * App-server types are slash-separated methods; exec types are dot-separated. The one
 * shared type, `error`, has no slash either way, so it always lands in the exec
 * normalizer — which reads both payload shapes. Hence no `error` case here.
 */
export function isCodexAppServerChunk(chunk: RawCliChunk): boolean {
  return chunk.type.includes("/");
}

function normalizeCommandExecutionItem(
  phase: string,
  item: Record<string, unknown>
): CliNormalizedEvent {
  const toolCallId = getString(item.id);
  if (phase === "item/started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName: "Shell",
      inputJson: JSON.stringify({ command: item.command ?? "" }),
    };
  }

  const exitCode = getNumber(item.exitCode) ?? null;
  const output = getString(item.aggregatedOutput) ?? "";
  if (item.status === "failed" || (exitCode !== null && exitCode !== 0)) {
    const exitText = exitCode !== null ? ` with exit code ${exitCode}` : "";
    return {
      kind: "tool-error",
      toolCallId,
      errorText: `Command failed${exitText}.${output ? `\n${output}` : ""}`,
    };
  }
  if (item.status === "declined") {
    return {
      kind: "tool-error",
      toolCallId,
      errorText: "Command was not approved.",
    };
  }
  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify({ output, exitCode }),
  };
}

function normalizeFileChangeItem(
  phase: string,
  item: Record<string, unknown>
): CliNormalizedEvent {
  const toolCallId = getString(item.id);
  const changes = Array.isArray(item.changes) ? item.changes : [];
  if (phase === "item/started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName: "Apply changes",
      inputJson: JSON.stringify({ changes }),
    };
  }
  if (item.status === "failed") {
    return {
      kind: "tool-error",
      toolCallId,
      errorText: "Codex failed to apply the file changes.",
    };
  }
  if (item.status === "declined") {
    return {
      kind: "tool-error",
      toolCallId,
      errorText: "File changes were not approved.",
    };
  }
  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify({ changes, status: item.status ?? null }),
  };
}

function normalizeMcpToolCallItem(
  phase: string,
  item: Record<string, unknown>
): CliNormalizedEvent {
  const toolCallId = getString(item.id);
  const server = getString(item.server);
  const tool = getString(item.tool);
  const toolName = [server, tool].filter(Boolean).join(".") || "MCP tool";
  if (phase === "item/started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName,
      inputJson: JSON.stringify(item.arguments ?? {}),
    };
  }
  if (item.status === "failed" || item.error) {
    const error = isRecord(item.error) ? getString(item.error.message) : undefined;
    return {
      kind: "tool-error",
      toolCallId,
      errorText: error ?? `MCP tool ${toolName} failed.`,
    };
  }
  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify(item.result ?? item),
  };
}

function normalizeWebSearchItem(
  phase: string,
  item: Record<string, unknown>
): CliNormalizedEvent {
  const toolCallId = getString(item.id);
  if (phase === "item/started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName: "Web search",
      inputJson: JSON.stringify({ action: item.action ?? null }),
    };
  }
  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify(item),
  };
}

function normalizeImageViewItem(
  phase: string,
  item: Record<string, unknown>
): CliNormalizedEvent {
  const toolCallId = getString(item.id);
  const path = getString(item.path);
  const payload = path ? { path } : {};

  if (phase === "item/started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName: "View image",
      inputJson: JSON.stringify(payload),
    };
  }

  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify(payload),
  };
}

function narrativeSource(
  obj: Record<string, unknown>,
  itemId?: string
): CliNarrativeSource | undefined {
  const threadId = getString(obj.threadId) ?? getString(obj.convoyRootThreadId);
  const turnId = getString(obj.turnId);
  const rootThreadId = getString(obj.convoyRootThreadId);
  return threadId || turnId || itemId
    ? {
        threadId,
        turnId,
        itemId,
        ...(rootThreadId
          ? { scope: threadId === rootThreadId ? ("root" as const) : ("child" as const) }
          : {}),
      }
    : undefined;
}

function subagentNotice(
  identity: Record<string, unknown>,
  status: string,
  raw: unknown,
  turnId?: string
): CliNormalizedEvent {
  const threadId = getString(identity.threadId);
  if (
    !threadId ||
    threadId === identity.rootThreadId ||
    identity.agentPath === "/root" ||
    identity.agentPath === "/"
  ) {
    return silentMetadata({ event: "codex-subagent-root-activity", raw });
  }
  const title = getString(identity.agentPath) ?? "Codex subagent";
  return {
    kind: "runtime-notice",
    code: "codex-subagent",
    title,
    message: status,
    detailsJson: JSON.stringify({
      subtype: "codex_subagent",
      payload: {
        task_id: `codex:${threadId}`,
        description: title,
        status,
        turnId,
        ...identity,
        raw,
      },
    }),
  };
}

function normalizeChildEvent(obj: Record<string, unknown>): CliNormalizedEvent {
  const params = isRecord(obj.params) ? obj.params : {};
  const identity = isRecord(obj.source) ? obj.source : {};
  const method = getString(obj.method) ?? "unknown";
  const item = isRecord(params.item) ? params.item : undefined;
  const source: CliNarrativeSource = {
    ...narrativeSource(params, getString(item?.id) ?? getString(params.itemId)),
    threadId: getString(identity.threadId),
    parentThreadId: getString(identity.parentThreadId),
    scope: identity.scope === "child" ? "child" : "unknown",
  };
  if (method === "item/agentMessage/delta" || method.startsWith("item/reasoning/")) {
    return {
      kind: method === "item/agentMessage/delta" ? "text-delta" : "reasoning-delta",
      text: getString(params.delta) ?? "",
      source,
    };
  }
  if (
    method === "item/completed" &&
    (item?.type === "agentMessage" || item?.type === "reasoning")
  ) {
    const event = normalizeItemEvent({ type: method, data: JSON.stringify(params) }, params);
    if (event.kind === "text" || event.kind === "reasoning") return { ...event, source };
  }
  if (identity.scope !== "child") return silentMetadata({ event: method, source });
  const turn = isRecord(params.turn) ? params.turn : undefined;
  if (
    method === "turn/started" ||
    method === "turn/completed" ||
    method === "thread/started" ||
    method === "error"
  ) {
    const status =
      method === "error"
        ? params.willRetry === true
          ? "retrying"
          : "failed"
        : method === "turn/completed"
          ? (getString(turn?.status) ?? "completed")
          : "started";
    return subagentNotice(
      identity,
      status,
      params,
      getString(turn?.id) ?? getString(params.turnId)
    );
  }
  if (item?.type === "subAgentActivity")
    return normalizeItemEvent(
      { type: method, data: JSON.stringify(params) },
      { ...params, convoyRootThreadId: identity.rootThreadId }
    );
  return silentMetadata({ event: method, source });
}

function normalizeItemEvent(
  chunk: RawCliChunk,
  obj: Record<string, unknown>
): CliNormalizedEvent {
  const item = isRecord(obj.item) ? obj.item : null;
  if (!item) {
    return unknownEvent(chunk, "codex-app-server-item-event-without-item");
  }

  const itemType = getString(item.type) ?? "unknown";
  const phase = chunk.type;

  switch (itemType) {
    case "sleep": {
      return {
        kind: "sleep",
        phase: phase === "item/started" ? "started" : "completed",
        itemId: getString(item.id) || undefined,
        sessionId: getString(obj.threadId) || undefined,
        turnId: getString(obj.turnId) || undefined,
        durationMs: getMilliseconds(item.durationMs),
        ...(phase === "item/started"
          ? { startedAt: getMilliseconds(obj.startedAtMs) }
          : { completedAt: getMilliseconds(obj.completedAtMs) }),
      };
    }
    case "agentMessage": {
      if (phase !== "item/completed") {
        return silentMetadata({ event: phase, itemType });
      }
      return { kind: "text", text: getString(item.text) ?? "", source: narrativeSource(obj, getString(item.id)) };
    }
    case "reasoning": {
      if (phase !== "item/completed") {
        return silentMetadata({ event: phase, itemType });
      }
      const content = Array.isArray(item.content) ? item.content : [];
      const summary = Array.isArray(item.summary) ? item.summary : [];
      const text = (content.length > 0 ? content : summary)
        .filter((entry): entry is string => typeof entry === "string")
        .join("\n\n");
      return text.length > 0 || getString(item.id)
        ? { kind: "reasoning", text, source: narrativeSource(obj, getString(item.id)) }
        : silentMetadata({ event: phase, itemType });
    }
    case "subAgentActivity":
      return subagentNotice({ threadId: item.agentThreadId, agentPath: item.agentPath,
        parentThreadId: obj.threadId, rootThreadId: obj.convoyRootThreadId ?? obj.threadId,
      }, getString(item.kind) ?? "updated", item);
    case "collabAgentToolCall": {
      const toolCallId = getString(item.id);
      if (phase === "item/started") return {
        kind: "tool-input", toolFamily: "codex-collaboration", toolCallId, toolName: `Agent ${getString(item.tool) ?? "collaboration"}`, inputJson: JSON.stringify(item),
      };
      if (item.status === "failed" || item.status === "interrupted") return { kind: "tool-error", toolFamily: "codex-collaboration", toolCallId, errorText: JSON.stringify(item) };
      return { kind: "tool-output", toolFamily: "codex-collaboration", toolCallId, outputJson: JSON.stringify(item) };
    }
    case "commandExecution":
      return normalizeCommandExecutionItem(phase, item);
    case "fileChange":
      return normalizeFileChangeItem(phase, item);
    case "mcpToolCall":
      return normalizeMcpToolCallItem(phase, item);
    case "webSearch":
      return normalizeWebSearchItem(phase, item);
    case "imageView":
      return normalizeImageViewItem(phase, item);
    case "userMessage":
      // Codex echoes the prompt back as a thread item; the web already
      // renders the user message envelope.
      return silentMetadata({ event: phase, itemType });
    case "contextCompaction": {
      if (phase === "item/started") {
        return {
          kind: "context-compaction",
          message: "Compacting…",
          inProgress: true,
          detailsJson: chunk.data,
        };
      }
      return {
        kind: "context-compaction",
        message: "Conversation compacted",
        detailsJson: chunk.data,
      };
    }
    case "plan": {
      const itemId = getString(item.id);
      const turnId = getString(obj.turnId);
      const text = getString(item.text);
      return phase === "item/completed" && itemId && turnId && text !== undefined
        ? { kind: "proposed-plan", phase: "completed", itemId, turnId, text }
        : silentMetadata({ event: phase, itemType });
    }
    case "todoList":
      return silentMetadata({ event: phase, itemType, item });
    case "error":
      return {
        kind: "warning",
        code: "codex-item-error",
        message: getString(item.message) ?? "Codex reported an error.",
      };
    default:
      return unknownEvent(chunk, `unrecognized-codex-app-server-item:${itemType}`);
  }
}

function normalizeTokenUsage(obj: Record<string, unknown>): CliNormalizedEvent {
  const tokenUsage = isRecord(obj.tokenUsage) ? obj.tokenUsage : null;
  const last = isRecord(tokenUsage?.last) ? tokenUsage.last : null;
  const usedTokens = getNumber(last?.totalTokens) ?? 0;
  const maxTokens = getNumber(tokenUsage?.modelContextWindow) ?? 0;
  if (usedTokens <= 0 || maxTokens <= 0) {
    return silentMetadata({ event: "thread/tokenUsage/updated", tokenUsage });
  }
  const inputTokens = getNumber(last?.inputTokens);
  const cachedInputTokens = getNumber(last?.cachedInputTokens);
  const outputTokens = getNumber(last?.outputTokens);
  return {
    kind: "context-window",
    usedTokens,
    maxTokens,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

/**
 * `turn/plan/updated` is a full ordered snapshot with explicit step statuses
 * (`pending` | `inProgress` | `completed`) — the richest plan signal Codex
 * emits, and the reason app-server threads can show the active step while
 * exec threads only show completed/total.
 */
function normalizePlanUpdated(obj: Record<string, unknown>): CliNormalizedEvent {
  const plan = Array.isArray(obj.plan) ? obj.plan : [];

  const steps: PlanProgressStep[] = plan.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const text = getString(entry.step)?.trim() ?? "";
    if (text.length === 0) {
      return [];
    }
    return [
      {
        text,
        status:
          entry.status === "completed"
            ? ("completed" as const)
            : entry.status === "inProgress"
              ? ("in-progress" as const)
              : ("pending" as const),
      },
    ];
  });

  // An empty plan is a normal thing to send; stay silent like the exec
  // transport rather than surfacing an "unsupported event" card.
  return planProgressEvent(steps) ?? silentMetadata({ event: "turn/plan/updated", plan });
}

function normalizeDelta(
  chunk: RawCliChunk,
  obj: Record<string, unknown>,
  kind: "text-delta" | "reasoning-delta"
): CliNormalizedEvent {
  const delta = getString(obj.delta);
  if (delta === undefined) {
    return unknownEvent(chunk, "codex-app-server-delta-without-delta");
  }
  return { kind, text: delta, source: narrativeSource(obj, getString(obj.itemId)) };
}

type GoalEvent = Extract<CliNormalizedEvent, { kind: "goal" }>;
type GoalStatus = Exclude<NonNullable<GoalEvent["status"]>, "none">;
const GOAL_STATUSES = new Set<string>(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]);

const GOAL_STATUS_TITLES: Record<GoalStatus, string> = {
  active: "Goal active",
  paused: "Goal paused",
  blocked: "Goal blocked",
  usageLimited: "Goal stopped at a usage limit",
  budgetLimited: "Goal reached its token budget",
  complete: "Goal met",
};

interface CodexGoal {
  objective: string;
  status: GoalStatus;
  tokensUsed?: number;
  tokenBudget?: number;
}

/** Native `ThreadGoal` (codex-cli 0.166.0); null when malformed. */
function readCodexGoal(value: unknown): CodexGoal | null {
  if (!isRecord(value) || typeof value.objective !== "string" || !GOAL_STATUSES.has(String(value.status))) {
    return null;
  }
  const tokensUsed = getNumber(value.tokensUsed);
  const tokenBudget = getNumber(value.tokenBudget);
  return {
    objective: value.objective,
    status: value.status as GoalStatus,
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
  };
}

function compactTokens(value: number): string {
  return value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value);
}

function goalUsage(goal: CodexGoal): string {
  if (goal.tokensUsed === undefined) return "";
  const budget = goal.tokenBudget !== undefined ? ` of ${compactTokens(goal.tokenBudget)}` : "";
  return ` (${compactTokens(goal.tokensUsed)}${budget} tokens)`;
}

function goalEvent(goal: CodexGoal | null, sessionId: string | undefined): GoalEvent {
  return goal
    ? { kind: "goal", source: "report", status: goal.status, objective: goal.objective,
        ...(goal.tokensUsed !== undefined ? { tokensUsed: goal.tokensUsed } : {}),
        ...(goal.tokenBudget !== undefined ? { tokenBudget: goal.tokenBudget } : {}), sessionId }
    : { kind: "goal", source: "cleared", sessionId };
}

function goalEvents(
  goal: CodexGoal | null,
  notice: { code: string; title: string; message: string },
  sessionId: string | undefined
): CliNormalizedEvent {
  const events = [goalEvent(goal, sessionId), { kind: "runtime-notice", ...notice, sessionId }];
  return { kind: "metadata", otherJson: JSON.stringify({ events }) };
}

const NO_GOAL_NOTICE = { code: "goal-status", title: "Goal", message: "No goal set" };

/**
 * The CLI's `convoy/goal/snapshot`: an RPC response, the source of truth, with the
 * command that produced it. Spec: docs/specs/cli-thread-goal.md → Codex.
 */
function normalizeGoalSnapshot(chunk: RawCliChunk, obj: Record<string, unknown>): CliNormalizedEvent {
  const goal = obj.goal === null ? null : readCodexGoal(obj.goal);
  if (obj.goal !== null && !goal) return unknownEvent(chunk, "malformed-codex-goal-snapshot");
  const sessionId = getString(obj.threadId);
  const cleared = getString(obj.clearedObjective);
  // A pre-open or watchdog read: repairs the stored goal silently.
  if (obj.action === "sync") return goalEvent(goal, sessionId);
  if (obj.action === "clear") {
    return goalEvents(null, cleared
      ? { code: "goal-cleared", title: "Goal cleared", message: cleared }
      : NO_GOAL_NOTICE, sessionId);
  }
  if (!goal) return goalEvents(null, NO_GOAL_NOTICE, sessionId);
  const notice =
    obj.action === "set" ? { code: "goal-set", title: "Goal set", message: goal.objective }
    : obj.action === "resume" ? { code: "goal-resumed", title: "Goal resumed", message: goal.objective }
    : obj.action === "pause" ? { code: "goal-paused", title: "Goal paused", message: goal.objective }
    : obj.action === "auto-pause" ? {
        code: "goal-paused",
        title: "Goal paused",
        message: `${goal.objective}. Convoy paused it before reopening the thread. Send /goal resume to continue.`,
      }
    : { code: "goal-status", title: GOAL_STATUS_TITLES[goal.status], message: `${goal.objective}${goalUsage(goal)}` };
  return goalEvents(goal, notice, sessionId);
}

/** Native goal notifications; the CLI forwards only objective or status changes. Root thread only. */
function normalizeGoalNotification(chunk: RawCliChunk, obj: Record<string, unknown>): CliNormalizedEvent {
  const threadId = getString(obj.threadId);
  if (threadId === undefined || threadId !== getString(obj.convoyRootThreadId)) {
    return silentMetadata({ event: chunk.type, threadId });
  }
  if (chunk.type === "thread/goal/cleared") {
    return goalEvents(null, { code: "goal-cleared", title: "Goal cleared", message: "" }, threadId);
  }
  const goal = readCodexGoal(obj.goal);
  if (!goal) return unknownEvent(chunk, "malformed-codex-goal-update");
  const code = goal.status === "complete" ? "goal-met"
    : goal.status === "active" ? "goal-set"
    : goal.status === "paused" ? "goal-paused" : "goal-limited";
  const title = goal.status === "active" ? "Goal set" : GOAL_STATUS_TITLES[goal.status];
  return goalEvents(goal, { code, title, message: `${goal.objective}${goal.status === "active" ? "" : goalUsage(goal)}` }, threadId);
}

export function normalizeCodexAppServerChunk(
  chunk: RawCliChunk
): CliNormalizedEvent {
  const parsed = safeJsonParse(chunk.data);
  const obj = isRecord(parsed) ? parsed : null;
  if (!obj) {
    return unknownEvent(chunk, "unparseable-codex-app-server-chunk");
  }

  switch (chunk.type) {
    case "convoy/background_tasks":
      return { kind: "metadata", backgroundTasks: readBackgroundTasks(obj) };
    case "convoy/child":
      return normalizeChildEvent(obj);
    case "convoy/goal/snapshot":
      return normalizeGoalSnapshot(chunk, obj);
    case "thread/goal/updated":
    case "thread/goal/cleared":
      return normalizeGoalNotification(chunk, obj);
    case "thread/started": {
      const threadId = isRecord(obj.thread) ? getString(obj.thread.id) : undefined;
      return {
        kind: "metadata",
        sessionId: threadId,
        backgroundTasks: { sessionId: threadId, tasks: [], totalCount: 0 },
        otherJson: JSON.stringify({ event: "thread/started", threadId }),
      };
    }
    case "model/rerouted":
      return silentMetadata({ event: "model/rerouted", ...obj });
    case "turn/started":
      return silentMetadata({ event: "turn/started" });
    case "turn/completed": {
      const turn = isRecord(obj.turn) ? obj.turn : null;
      if (turn?.status === "failed") {
        const error = isRecord(turn.error) ? turn.error : null;
        return {
          kind: "runtime-notice",
          code: "codex-turn-failed",
          title: "Codex turn failed",
          message: getString(error?.message) ?? "Codex could not complete the turn.",
          detailsJson: chunk.data,
        };
      }
      return silentMetadata({
        event: "turn/completed",
        status: turn?.status ?? null,
        turnId: getString(turn?.id),
        sessionId: getString(obj.threadId),
      });
    }
    // No `error` case: "error" has no slash, so the dispatcher never routes
    // it here — the exec normalizer's error branch handles both transports
    // (see isCodexAppServerChunk).
    case "turn/plan/updated":
      return normalizePlanUpdated(obj);
    case "thread/tokenUsage/updated":
      return normalizeTokenUsage(obj);
    case "item/plan/delta": {
      const itemId = getString(obj.itemId);
      const turnId = getString(obj.turnId);
      const text = getString(obj.delta);
      return itemId && turnId && text !== undefined
        ? { kind: "proposed-plan", phase: "delta", itemId, turnId, text }
        : silentMetadata({ event: chunk.type });
    }
    case "item/agentMessage/delta":
      return normalizeDelta(chunk, obj, "text-delta");
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
      return normalizeDelta(chunk, obj, "reasoning-delta");
    case "item/started":
    case "item/completed":
      return normalizeItemEvent(chunk, obj);
    default:
      return unknownEvent(chunk, "unrecognized-codex-app-server-event");
  }
}

/** Codex thread id from a stored app-server `thread/started` chunk. */
export function getCodexAppServerThreadId(chunk: RawCliChunk): string | null {
  if (chunk.type !== "thread/started") {
    return null;
  }
  const parsed = safeJsonParse(chunk.data);
  const thread = isRecord(parsed) && isRecord(parsed.thread) ? parsed.thread : null;
  const threadId = getString(thread?.id);
  return threadId && threadId.length > 0 ? threadId : null;
}
