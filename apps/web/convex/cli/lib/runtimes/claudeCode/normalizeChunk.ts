import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { toCliAccountUsage } from "@/convex/lib/contracts/validators";
import { formatDurationMs } from "@/lib/format-duration-ms";
import { isRecord } from "@/lib/type-guards";
import { readBackgroundTasks } from "../shared/parsing";
import type { RawCliChunk } from "../contracts";
import {
  planProgressEvent,
  planStepUpdateEvent,
  type PlanProgressStep,
} from "../shared/planProgress";

function safeJsonParse(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/**
 * `task_updated` is a diff of the SDK's task registry, not a conversation event:
 * `{ task_id, patch }` with only the changed fields, no `tool_use_id` and no
 * description. The client folds it into that task's group by `task_id` and drops it
 * when no group exists.
 */
function claudeTaskPatch(obj: Record<string, unknown>): Record<string, unknown> | null {
  return getRecord(obj.patch);
}

/**
 * A `task_updated` patch worth keeping past ephemeral cleanup. `patch.error` is
 * the only place a failed task's error text ever appears (`task_notification`
 * carries `status`/`summary`, never `error`), and `is_backgrounded` is only
 * observable here; every other patch field is superseded by the terminal
 * `task_notification`.
 */
function isDurableClaudeTaskPatch(patch: Record<string, unknown> | null): boolean {
  if (!patch) {
    return false;
  }

  return typeof patch.error === "string" || typeof patch.is_backgrounded === "boolean";
}

/**
 * Ambient/housekeeping task lifecycle events. The SDK documents
 * `skip_transcript` as "Consumers should hide this from the inline transcript;
 * it may still appear in a tasks panel", so these normalize to silent metadata
 * instead of a grouped card.
 */
function isSkippedClaudeTaskTranscript(obj: Record<string, unknown>): boolean {
  return obj.skip_transcript === true;
}

/**
 * Priority floor for a `notification` to render inline. The SDK ranks
 * notifications `low | medium | high | immediate` and mirrors the interactive
 * REPL's auto-dismissing queue — but a thread transcript has no auto-dismiss,
 * so anything below the floor would be permanent history. `high` is the floor:
 * these are the ones that ask the user to act.
 */
const RENDERED_NOTIFICATION_PRIORITIES = new Set(["high", "immediate"]);

/**
 * `memory_recall` → provider-neutral `memory-recall`. The SDK's `mode` names
 * the retrieval strategy (`select` picks whole files, `synthesize` authors one
 * paragraph); the normalized names describe what the payload *is*, since that
 * is what the renderer branches on.
 */
type ClaudeRecalledMemory = Extract<
  CliNormalizedEvent,
  { kind: "memory-recall" }
>["memories"][number];

function normalizeClaudeMemoryRecall(
  obj: Record<string, unknown>,
  sessionId: string | undefined,
): CliNormalizedEvent {
  const memories = (Array.isArray(obj.memories) ? obj.memories : []).flatMap(
    (entry): ClaudeRecalledMemory[] => {
      const record = getRecord(entry);
      if (!record) {
        return [];
      }

      const content =
        typeof record.content === "string" && record.content.trim().length > 0
          ? record.content
          : undefined;
      // A synthesis path is the sentinel `<synthesis:DIR>`, not a real file:
      // dropping it keeps the renderer from offering a path that opens nothing.
      const rawPath = typeof record.path === "string" ? record.path.trim() : "";
      const path =
        rawPath.length > 0 && !rawPath.startsWith("<synthesis:")
          ? rawPath
          : undefined;
      const scope =
        record.scope === "personal" || record.scope === "team"
          ? record.scope
          : undefined;

      if (!path && !content) {
        return [];
      }

      return [
        {
          ...(path ? { path } : {}),
          ...(scope ? { scope } : {}),
          ...(content ? { content } : {}),
        },
      ];
    },
  );

  // Nothing recalled is nothing to say — the supervisor ran and matched
  // nothing, which is not a transcript event.
  if (memories.length === 0) {
    return {
      kind: "metadata",
      sessionId,
      otherJson: JSON.stringify({ subtype: "memory_recall", payload: obj }),
    };
  }

  return {
    kind: "memory-recall",
    mode: obj.mode === "synthesize" ? "synthesis" : "files",
    memories,
    sessionId,
    detailsJson: JSON.stringify({ subtype: "memory_recall", payload: obj }),
  };
}

function normalizeClaudeSystemNotice(
  obj: Record<string, unknown>,
): CliNormalizedEvent {
  const sessionId =
    typeof obj.session_id === "string" ? obj.session_id : undefined;
  const subtype =
    typeof obj.subtype === "string" ? obj.subtype : "unknown-system-event";

  if (subtype === "background_tasks_changed") {
    return {
      kind: "metadata",
      sessionId,
      backgroundTasks: readBackgroundTasks(obj),
      otherJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (
    (subtype === "task_started" ||
      subtype === "task_progress" ||
      subtype === "task_notification") &&
    isSkippedClaudeTaskTranscript(obj)
  ) {
    return {
      kind: "metadata",
      sessionId,
      otherJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (subtype === "task_updated") {
    const patch = claudeTaskPatch(obj);
    const taskId = typeof obj.task_id === "string" ? obj.task_id : undefined;
    const status = typeof patch?.status === "string" ? patch.status : undefined;

    return {
      kind: "runtime-notice",
      code: "claude-task-updated",
      title: "Task updated",
      message: status
        ? `Task ${taskId ?? "(unknown)"} is now ${status}.`
        : `Task ${taskId ?? "(unknown)"} changed.`,
      sessionId,
      detailsJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (subtype === "api_retry") {
    const attempt = getNumber(obj.attempt);
    const maxRetries = getNumber(obj.max_retries);
    const retryDelayMs = getNumber(obj.retry_delay_ms);
    const delayText = formatDurationMs(retryDelayMs);

    const parts = [
      attempt !== undefined && maxRetries !== undefined
        ? `Attempt ${attempt} of ${maxRetries}.`
        : "Retrying Claude API request.",
      delayText ? `Retrying in ${delayText}.` : null,
    ].filter((part): part is string => part !== null);

    return {
      kind: "runtime-notice",
      code: "claude-api-retry",
      title: "Claude API retry",
      message: parts.join(" "),
      sessionId,
      detailsJson: JSON.stringify({
        subtype,
        attempt,
        maxRetries,
        retryDelayMs,
        errorStatus: obj.error_status ?? null,
        error: obj.error ?? null,
      }),
    };
  }

  // Most status heartbeats are moment-in-time state with no history value: silent
  // telemetry. The compaction pair is the exception — `status: "compacting"` is the only
  // signal a compaction is running, so it renders as pending until the paired
  // `compact_boundary` replaces it (OS-1593).
  if (subtype === "status") {
    const silent: CliNormalizedEvent = {
      kind: "metadata",
      sessionId,
      otherJson: JSON.stringify({ subtype, payload: obj }),
    };

    if (obj.status === "compacting") {
      return {
        kind: "context-compaction",
        message: "Compacting…",
        inProgress: true,
        sessionId,
        detailsJson: JSON.stringify({ subtype, payload: obj }),
      };
    }

    // A cleared status carries the compaction outcome. Success is already
    // reported by `compact_boundary` (with trigger and token counts), so only
    // a failure needs to resolve the pending part — otherwise the shimmer
    // would hang for a compaction that never produced a boundary.
    if (obj.compact_result !== "failed") {
      return silent;
    }

    const compactError =
      typeof obj.compact_error === "string" && obj.compact_error.trim().length > 0
        ? obj.compact_error.trim()
        : undefined;

    return {
      kind: "context-compaction",
      message: compactError
        ? `Compaction failed: ${/[.!?]$/.test(compactError) ? compactError : `${compactError}.`}`
        : "Compaction failed.",
      sessionId,
      detailsJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (subtype === "compact_boundary") {
    const compactMetadata = getRecord(obj.compact_metadata);
    const trigger =
      typeof compactMetadata?.trigger === "string"
        ? compactMetadata.trigger
        : undefined;
    const preTokens = getNumber(compactMetadata?.pre_tokens);

    const message = [
      trigger === "auto"
        ? "Context compacted automatically"
        : trigger === "manual"
          ? "Context compacted manually"
          : "Context compacted",
      preTokens !== undefined && preTokens > 0
        ? ` (was ~${preTokens.toLocaleString("en-US")} tokens)`
        : "",
      ".",
    ].join("");

    return {
      kind: "context-compaction",
      message,
      sessionId,
      detailsJson: JSON.stringify({
        subtype,
        payload: obj,
      }),
    };
  }

  // Pure telemetry — `metadata` events are never rendered.
  // `commands_changed` feeds the slash-command inventory pipeline, not the thread.
  // `background_tasks_changed` and `session_state_changed` are *level* signals: the whole
  // set/state re-emitted on every change, with no outcome, so neither belongs in a
  // transcript (OS-1399, OS-1598). The thread header already derives session state
  // authoritatively from message status and the `result` chunk.
  // `elicitation_complete` carries only ids — no outcome, value or error — so a card
  // could only restate them; the paired *request* is where user-facing UI belongs.
  if (
    subtype === "thinking_tokens" ||
    subtype === "hook_started" ||
    subtype === "hook_progress" ||
    subtype === "commands_changed" ||
    subtype === "session_state_changed" ||
    subtype === "elicitation_complete"
  ) {
    return {
      kind: "metadata",
      sessionId,
      otherJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (subtype === "memory_recall") {
    return normalizeClaudeMemoryRecall(obj, sessionId);
  }

  // A model-authored per-turn summary — the richest status signal the SDK has, but the
  // SDK's own reader intercepts it before yielding, so it cannot reach a chunk row through
  // `query()` today. Silent rather than a content-free card; real UI is OS-1610, gated on
  // reachability.
  if (subtype === "post_turn_summary") {
    return {
      kind: "metadata",
      sessionId,
      otherJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  // The SDK's guidance for `local_command_output` is "Displayed as assistant-style text in
  // the transcript": it is the direct answer to a slash command the user typed, so it is
  // conversation content. `text` needs no new kind or renderer, and avoids a collapsed card
  // hiding the very output that was asked for.
  if (subtype === "local_command_output") {
    const content = typeof obj.content === "string" ? obj.content : "";
    if (content.trim().length === 0) {
      return {
        kind: "metadata",
        sessionId,
        otherJson: JSON.stringify({ subtype, payload: obj }),
      };
    }

    return { kind: "text", text: content };
  }

  // Same rule as `hook_response`: only the failure is worth a card. `started`/`installed`/
  // `completed` are housekeeping superseded by the terminal event, while `failed` is the
  // only record that a configured plugin is not loaded — and it carries error text. Since
  // the clean path renders nothing, N failures produce N notices, not one changing row.
  if (subtype === "plugin_install") {
    if (obj.status !== "failed") {
      return {
        kind: "metadata",
        sessionId,
        otherJson: JSON.stringify({ subtype, payload: obj }),
      };
    }

    const name = typeof obj.name === "string" ? obj.name : "A plugin";
    const error =
      typeof obj.error === "string" && obj.error.trim().length > 0
        ? obj.error.trim()
        : undefined;

    return {
      kind: "runtime-notice",
      code: "claude-plugin-install-failed",
      title: "Plugin install failed",
      message: error ? `${name}: ${error}` : `${name} did not install.`,
      sessionId,
      detailsJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  // The only unmapped subtype whose payload is already a finished human-readable sentence.
  // Gated on priority: the SDK mirrors the REPL's auto-dismissing queue (hence
  // `timeout_ms`), and a transcript cannot auto-dismiss, so low/medium would become
  // permanent history.
  if (subtype === "notification") {
    const text =
      typeof obj.text === "string" && obj.text.trim().length > 0
        ? obj.text.trim()
        : undefined;
    const priority = typeof obj.priority === "string" ? obj.priority : undefined;

    if (!text || !priority || !RENDERED_NOTIFICATION_PRIORITIES.has(priority)) {
      return {
        kind: "metadata",
        sessionId,
        otherJson: JSON.stringify({ subtype, payload: obj }),
      };
    }

    return {
      kind: "runtime-notice",
      code: "claude-notification",
      title: "Claude notification",
      message: text,
      sessionId,
      detailsJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (subtype === "hook_response") {
    const exitCode = getNumber(obj.exit_code);
    const outcome = typeof obj.outcome === "string" ? obj.outcome : undefined;
    const hookFailed =
      (outcome !== undefined && outcome !== "success") ||
      (exitCode !== undefined && exitCode !== 0) ||
      obj.decision === "block";

    // Successful hooks stay silent: SessionStart hooks always stream in SDK
    // mode, so rendering them would spam every new session.
    if (!hookFailed) {
      return {
        kind: "metadata",
        sessionId,
        otherJson: JSON.stringify({ subtype, payload: obj }),
      };
    }

    const hookName =
      typeof obj.hook_name === "string" ? obj.hook_name : "unknown hook";
    return {
      kind: "runtime-notice",
      code: "claude-hook-failed",
      title: "Hook failed",
      message: `Hook ${hookName} did not complete successfully${
        exitCode !== undefined ? ` (exit code ${exitCode})` : ""
      }.`,
      sessionId,
      detailsJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (subtype === "permission_denied") {
    const toolName =
      typeof obj.tool_name === "string"
        ? obj.tool_name
        : typeof obj.toolName === "string"
          ? obj.toolName
          : "a tool";
    return {
      kind: "runtime-notice",
      code: "claude-permission-denied",
      title: "Tool blocked",
      message: `Claude was not permitted to run ${toolName}.`,
      sessionId,
      detailsJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (subtype === "files_persisted") {
    const persistedCount = Array.isArray(obj.files)
      ? obj.files.length
      : undefined;
    const failedCount = Array.isArray(obj.failed) ? obj.failed.length : 0;
    return {
      kind: "runtime-notice",
      code: "claude-files-persisted",
      title: "Files persisted",
      message: [
        persistedCount !== undefined
          ? `Persisted ${persistedCount} file${persistedCount === 1 ? "" : "s"}`
          : "Persisted files",
        failedCount > 0 ? `; ${failedCount} failed` : "",
        ".",
      ].join(""),
      sessionId,
      detailsJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  // Repo-state signal (commit created, branch switched). The CLI consumes it
  // to refresh the thread's branch/PR snapshot (OS-1386); the badge is the
  // render, so the thread stays silent.
  if (subtype === "vcs_state_changed") {
    return {
      kind: "metadata",
      sessionId,
      otherJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (subtype === "code_change_published") {
    const repo = typeof obj.repo === "string" ? obj.repo : undefined;
    const identifier =
      typeof obj.identifier === "string" ? obj.identifier : undefined;
    const url = typeof obj.url === "string" ? obj.url : undefined;
    const ref =
      repo && identifier ? `${repo}#${identifier}` : (url ?? "a code change");
    return {
      kind: "runtime-notice",
      code: "claude-code-change-published",
      title: "Code change published",
      message: `Published ${ref}.`,
      sessionId,
      detailsJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  if (subtype === "mirror_error") {
    return {
      kind: "runtime-notice",
      code: "claude-mirror-error",
      title: "Workspace sync error",
      message:
        typeof obj.error === "string"
          ? obj.error
          : "Claude reported a workspace mirror error.",
      sessionId,
      detailsJson: JSON.stringify({ subtype, payload: obj }),
    };
  }

  return {
    kind: "runtime-notice",
    code: `claude-system-${subtype}`,
    title: "Claude runtime notice",
    message: `Claude reported ${subtype}.`,
    sessionId,
    detailsJson: JSON.stringify({
      subtype,
      payload: obj,
    }),
  };
}

/**
 * Synthetic chunk emitted by the Convoy Claude runner after each completed
 * turn, sourced from the Agent SDK `get_context_usage` control request. This
 * is the sole source for the context-window meter — Claude `result.usage` is
 * cumulative API usage for the whole run, not the current context size.
 */
function normalizeClaudeContextUsageChunk(
  obj: Record<string, unknown>,
): CliNormalizedEvent {
  const usedTokens = getNumber(obj.usedTokens);
  const maxTokens = getNumber(obj.maxTokens);
  if (
    usedTokens === undefined ||
    usedTokens <= 0 ||
    maxTokens === undefined ||
    maxTokens <= 0
  ) {
    return {
      kind: "metadata",
      otherJson: JSON.stringify({ contextUsage: obj }),
    };
  }

  return { kind: "context-window", usedTokens, maxTokens };
}

/**
 * Prompt size of the API call that produced a top-level `assistant` message,
 * the same number Claude Code's status line shows (OS-1900). No max here; the
 * client carries the last known max forward. Subagents have their own context.
 */
function claudeLiveContextWindowEvent(
  message: Record<string, unknown> | undefined,
): CliNormalizedEvent | null {
  const usage = getRecord(message?.usage);
  if (!usage) {
    return null;
  }
  const usedTokens =
    (getNumber(usage.input_tokens) ?? 0) +
    (getNumber(usage.cache_creation_input_tokens) ?? 0) +
    (getNumber(usage.cache_read_input_tokens) ?? 0);

  return usedTokens > 0 ? { kind: "context-window", usedTokens } : null;
}

/**
 * Claude keeps its checklist two ways and both must work: `TodoWrite` resends the
 * whole list (snapshot), while `TaskCreate`/`TaskUpdate`/`TaskList` report one task
 * at a time. `TaskCreate` is the awkward one — its input has no id, so the plan step
 * is emitted from the result rather than the call.
 */
const CLAUDE_TASK_TOOLS = ["TaskCreate", "TaskUpdate", "TaskList"];

function claudePlanStatus(value: unknown): PlanProgressStep["status"] | undefined {
  if (value === "completed") {
    return "completed";
  }
  if (value === "in_progress") {
    return "in-progress";
  }
  if (value === "pending") {
    return "pending";
  }
  return undefined;
}

/**
 * `TodoWrite` input → provider-neutral plan snapshot. Claude's `TodoWrite`
 * is a tool call, but its payload is thread state rather than conversation:
 * it replaces the previous list every time. Returns `null` for anything that
 * is not a usable snapshot so the caller keeps the plain tool-call event.
 */
function claudeTodoPlanEvent(
  block: Record<string, unknown>,
): CliNormalizedEvent | null {
  if (block.name !== "TodoWrite") {
    return null;
  }

  const input = getRecord(block.input);
  const todos = Array.isArray(input?.todos) ? input.todos : [];

  const steps: PlanProgressStep[] = todos.flatMap((todo) => {
    const record = getRecord(todo);
    const text = typeof record?.content === "string" ? record.content.trim() : "";
    if (text.length === 0) {
      return [];
    }
    return [{ text, status: claudePlanStatus(record?.status) ?? "pending" }];
  });

  return planProgressEvent(steps);
}

/**
 * Task-tool call → plan edit. `TaskUpdate` carries the id and the new status
 * in its input, so it maps directly. `TaskCreate` and `TaskList` have nothing
 * usable at call time (no id yet / no tasks yet) and are silenced here — the
 * plan arrives with their result — so the raw JSON tool card stays out of the
 * transcript either way.
 */
function claudeTaskToolEvent(
  block: Record<string, unknown>,
): CliNormalizedEvent | null {
  if (typeof block.name !== "string" || !CLAUDE_TASK_TOOLS.includes(block.name)) {
    return null;
  }

  const input = getRecord(block.input);
  const taskId = typeof input?.taskId === "string" ? input.taskId.trim() : "";
  const subject = typeof input?.subject === "string" ? input.subject.trim() : undefined;

  if (block.name === "TaskUpdate" && taskId.length > 0) {
    const update = planStepUpdateEvent([
      {
        id: taskId,
        ...(subject ? { text: subject } : {}),
        ...(claudePlanStatus(input?.status) ? { status: claudePlanStatus(input?.status) } : {}),
      },
    ]);
    if (update) {
      return update;
    }
  }

  // No `otherJson`: the composer merges metadata payloads into the message's
  // metadata bag, and a marker key there would be noise.
  return { kind: "metadata" };
}

/**
 * Task-tool result → plan edit, per result block. `TaskList` returns a snapshot;
 * `TaskCreate` returns the created task, the first place its id appears.
 *
 * `toolUseResult` is passed only for a single result block: it is one top-level
 * field, so batched parallel results give no way to say which block owns it. Batched
 * `TaskCreate`s therefore go through the per-block result text.
 */
function claudeTaskResultBlockEvent(
  block: Record<string, unknown>,
  toolUseResult: Record<string, unknown> | null,
): CliNormalizedEvent | null {
  if (block.type !== "tool_result") {
    return null;
  }

  if (Array.isArray(toolUseResult?.tasks)) {
    const steps: PlanProgressStep[] = toolUseResult.tasks.flatMap((entry) => {
      const task = getRecord(entry);
      const text = typeof task?.subject === "string" ? task.subject.trim() : "";
      const id = typeof task?.id === "string" ? task.id : undefined;
      if (text.length === 0) {
        return [];
      }
      return [{ ...(id ? { id } : {}), text, status: claudePlanStatus(task?.status) ?? "pending" }];
    });
    const snapshot = planProgressEvent(steps);
    if (snapshot) {
      return snapshot;
    }
  }

  const created = getRecord(toolUseResult?.task);
  const createdId = typeof created?.id === "string" ? created.id.trim() : "";
  const createdSubject =
    typeof created?.subject === "string" ? created.subject.trim() : undefined;
  if (createdId.length > 0 && createdSubject) {
    return planStepUpdateEvent([
      {
        id: createdId,
        text: createdSubject,
        status: claudePlanStatus(created?.status) ?? "pending",
      },
    ]);
  }

  if (typeof block.content !== "string") {
    return null;
  }
  const match = /^Task #(\S+) created successfully: (.+)$/.exec(block.content.trim());
  if (!match) {
    return null;
  }
  return planStepUpdateEvent([{ id: match[1], text: match[2].trim(), status: "pending" }]);
}

function normalizeAssistantBlock(
  block: Record<string, unknown>,
  parentToolUseId?: string,
): CliNormalizedEvent | null {
  if (block.type === "thinking" && typeof block.thinking === "string") {
    return { kind: "reasoning", text: block.thinking, ...(parentToolUseId ? { source: { parentToolUseId, scope: "child" as const } } : {}) };
  }

  if (block.type === "text" && typeof block.text === "string") {
    return { kind: "text", text: block.text, ...(parentToolUseId ? { source: { parentToolUseId, scope: "child" as const } } : {}) };
  }

  if (
    block.type === "tool_use" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
  ) {
    // Subagent checklists stay plain tool calls: the thread-level steps pill
    // tracks the main agent's plan, not each subagent's private checklist.
    if (!parentToolUseId) {
      const planEvent = claudeTodoPlanEvent(block) ?? claudeTaskToolEvent(block);
      if (planEvent) {
        return planEvent;
      }
    }

    return {
      kind: "tool-input",
      toolCallId: block.id,
      toolName: block.name,
      inputJson: JSON.stringify(block.input ?? {}),
      ...(parentToolUseId ? { parentToolUseId } : {}),
    };
  }

  return null;
}

function normalizeToolResultBlock(
  block: Record<string, unknown>,
  parentToolUseId?: string,
): CliNormalizedEvent | null {
  if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") {
    return null;
  }

  const contentStr =
    typeof block.content === "string"
      ? block.content
      : JSON.stringify(block.content ?? "");

  if (block.is_error === true) {
    return {
      kind: "tool-error",
      toolCallId: block.tool_use_id,
      errorText: contentStr,
      ...(parentToolUseId ? { parentToolUseId } : {}),
    };
  }

  return {
    kind: "tool-output",
    toolCallId: block.tool_use_id,
    outputJson: contentStr,
    ...(parentToolUseId ? { parentToolUseId } : {}),
  };
}

function singleOrBundled(
  events: Array<CliNormalizedEvent>,
): CliNormalizedEvent {
  if (events.length === 1) {
    return events[0];
  }

  return {
    kind: "metadata",
    otherJson: JSON.stringify({ events }),
  };
}

type GoalEvent = Extract<CliNormalizedEvent, { kind: "goal" }>;

/** Claude's `/goal` replies (2.1.318 wording). Spec: docs/specs/cli-thread-goal.md. */
function parseClaudeGoalReply(text: string): Omit<GoalEvent, "kind" | "sessionId"> | null {
  const set = /^Goal set: ([\s\S]+)$/.exec(text);
  if (set) return { source: "set", objective: set[1] };
  const active = /^Goal active: ([\s\S]+?) \((?:not yet evaluated|(\d+) turns?)\)(?:\nLast check: ([\s\S]*))?$/.exec(text);
  if (active) {
    return {
      source: "report",
      status: "active",
      objective: active[1],
      iterations: active[2] ? Number(active[2]) : 0,
      ...(active[3] ? { lastReason: active[3] } : {}),
    };
  }
  const cleared = /^Goal cleared: ([\s\S]+)$/.exec(text);
  if (cleared) return { source: "cleared", objective: cleared[1] };
  if (/^No goal set\b/.test(text)) return { source: "report", status: "none" };
  return null;
}

/** A recognized `/goal` reply renders as a goal notice rather than text, which would run into the next paragraph. */
function claudeGoalReplyEvents(text: string, sessionId: string | undefined): CliNormalizedEvent[] | null {
  const goal = parseClaudeGoalReply(text);
  if (!goal) return null;
  const checks = goal.iterations ? `${goal.iterations} ${goal.iterations === 1 ? "check" : "checks"}` : "not checked yet";
  const notice =
    goal.source === "set" ? { code: "goal-set", title: "Goal set", message: goal.objective ?? "" }
    : goal.source === "cleared" ? { code: "goal-cleared", title: "Goal cleared", message: goal.objective ?? "" }
    : goal.status === "active" ? {
        code: "goal-status",
        title: "Goal active",
        message: `${goal.objective} (${checks})${goal.lastReason ? `. Last check: ${goal.lastReason}` : ""}`,
      }
    : { code: "goal-status", title: "Goal", message: "No goal set" };
  return [{ kind: "goal", ...goal, sessionId }, { kind: "runtime-notice", ...notice, sessionId }];
}

const STOP_HOOK_FEEDBACK_PREFIX = "Stop hook feedback:\n";

/** A goal's Stop hook prefixes its reason with `[objective]: `; any other Stop hook is the user's own. */
function claudeStopHookFeedbackEvents(text: string, sessionId: string | undefined): CliNormalizedEvent[] | null {
  if (!text.startsWith(STOP_HOOK_FEEDBACK_PREFIX)) return null;
  const feedback = text.slice(STOP_HOOK_FEEDBACK_PREFIX.length).trim();
  const goal = /^\[([\s\S]+?)\]: ([\s\S]*)$/.exec(feedback);
  if (!goal) {
    return [{ kind: "runtime-notice", code: "stop-hook-feedback", title: "Stop hook feedback", message: feedback, sessionId }];
  }
  return [
    { kind: "goal", source: "check", objective: goal[1], lastReason: goal[2], sessionId },
    { kind: "runtime-notice", code: "goal-check", title: "Goal not met yet", message: goal[2], sessionId },
  ];
}

/** Result semantics match the CLI/web counterpart; see cli-sdk-integration.md. */
function claudeResultOutcome(record: Record<string, unknown>): {
  status: "completed" | "failed" | "interrupted";
  errorText?: string;
} {
  const reason = record.terminal_reason;
  const errors = Array.isArray(record.errors)
    ? record.errors.filter((value): value is string => typeof value === "string")
    : [];
  if (reason === "aborted_tools" || reason === "aborted_streaming" || errors.some(
    (error) => error.includes("[ede_diagnostic]") && error.includes("stop_reason=tool_use")
  )) return { status: "interrupted" };
  const terminalErrors: Record<string, string> = {
    blocking_limit: "Claude stopped: a usage limit blocked the request.",
    rapid_refill_breaker: "Claude stopped: the context refilled too quickly after compaction.",
    prompt_too_long: "Claude stopped: the prompt exceeds the model's context window.",
    image_error: "Claude stopped: an image could not be processed.",
    model_error: "Claude stopped: the model returned an error.",
    api_error: "Claude gave up after repeated API errors.",
    malformed_tool_use_exhausted: "Claude gave up after repeated malformed tool calls.",
    budget_exhausted: "Claude stopped: the turn's token budget was exhausted.",
    structured_output_retry_exhausted: "Claude could not produce the requested structured output.",
    tool_deferred_unavailable: "Claude could not resume a deferred tool call: the tool is no longer available.",
    turn_setup_failed: "Claude could not start the turn.",
  };
  const structuredError = record.api_error_status === 529
    ? "Claude API is overloaded (529). Try again shortly."
    : typeof reason === "string" && Object.hasOwn(terminalErrors, reason) ? terminalErrors[reason] : undefined;
  const failed = !!structuredError || record.is_error === true ||
    (typeof record.subtype === "string" && record.subtype !== "success");
  const resultText = typeof record.result === "string" && record.result.trim() ? record.result : undefined;
  return {
    status: failed ? "failed" : "completed",
    errorText: structuredError ?? (errors.length ? errors.join("; ") : resultText),
  };
}

function normalizeClaudeResultError(
  obj: Record<string, unknown>,
  sessionId: string | undefined,
): CliNormalizedEvent | null {
  const subtype = typeof obj.subtype === "string" ? obj.subtype : undefined;
  const outcome = claudeResultOutcome(obj);
  if (outcome.status !== "failed") return null;
  const message = outcome.errorText ?? `Claude run ended with ${subtype ?? "an error"}.`;

  return {
    kind: "runtime-notice",
    code: "claude-result-error",
    title: "Run error",
    message,
    sessionId,
    detailsJson: JSON.stringify({
      resultSubtype: subtype,
      isError: obj.is_error ?? null,
      errors: obj.errors ?? [],
      terminalReason: obj.terminal_reason ?? null,
      apiErrorStatus: obj.api_error_status ?? null,
      result: obj.result ?? null,
    }),
  };
}

/** Maps Claude `rateLimitType` values to short user-facing window labels. */
function toUsageLimitWindow(rateLimitType: string | undefined): string {
  if (rateLimitType === "five_hour") {
    return "5h";
  }
  if (rateLimitType === "seven_day" || rateLimitType === "weekly") {
    return "weekly";
  }
  return rateLimitType ?? "unknown";
}

function normalizeClaudeRateLimitEvent(
  obj: Record<string, unknown>,
): CliNormalizedEvent {
  const info = getRecord(obj.rate_limit_info);
  const sessionId =
    typeof obj.session_id === "string" ? obj.session_id : undefined;

  if (!info) {
    return {
      kind: "metadata",
      sessionId,
      otherJson: JSON.stringify({ rateLimitInfo: obj }),
    };
  }

  // Usage is account state, not a conversation event: normalize every status
  // (including "allowed") to a usage-limit snapshot. The thread footer pill
  // consumes the latest snapshot per window; nothing renders inline except
  // the composer's severity-escalation one-liner.
  const status = typeof info.status === "string" ? info.status : undefined;
  const rateLimitType =
    typeof info.rateLimitType === "string" ? info.rateLimitType : undefined;
  const utilization = getNumber(info.utilization);
  const resetsAt = getNumber(info.resetsAt);

  return {
    kind: "usage-limit",
    window: toUsageLimitWindow(rateLimitType),
    ...(utilization !== undefined ? { utilization } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
    ...(info.isUsingOverage === true ? { isUsingOverage: true } : {}),
    ...(status ? { status } : {}),
    detailsJson: JSON.stringify({ rateLimitInfo: info }),
  };
}

function normalizeClaudeToolProgress(
  obj: Record<string, unknown>,
  parentToolUseId: string | undefined,
): CliNormalizedEvent {
  const toolCallId =
    typeof obj.tool_use_id === "string"
      ? obj.tool_use_id
      : typeof obj.toolUseId === "string"
        ? obj.toolUseId
        : undefined;

  if (!toolCallId) {
    return {
      kind: "metadata",
      otherJson: JSON.stringify({ toolProgress: obj }),
    };
  }

  const toolName =
    typeof obj.tool_name === "string"
      ? obj.tool_name
      : typeof obj.toolName === "string"
        ? obj.toolName
        : undefined;
  const elapsedSeconds =
    getNumber(obj.elapsed_time_seconds) ??
    getNumber(obj.elapsedSeconds) ??
    getNumber(obj.elapsed_seconds);

  return {
    kind: "tool-progress",
    toolCallId,
    ...(toolName ? { toolName } : {}),
    ...(elapsedSeconds !== undefined ? { elapsedSeconds } : {}),
    ...(parentToolUseId ? { parentToolUseId } : {}),
  };
}

/** System subtypes that are pure live telemetry with no value in history. */
const EPHEMERAL_SYSTEM_SUBTYPES = new Set([
  "thinking_tokens",
  "hook_started",
  "hook_progress",
  "status",
  // Large full-catalog dump; the inventory is persisted as a runtime fact
  // before ephemeral cleanup, so the row has no historical value.
  "commands_changed",
  // Silent repo-state signal; consumed live by the CLI's VCS snapshot
  // refresh, worthless in history.
  "vcs_state_changed",
  // Live snapshot of running background tasks; only the latest one is ever
  // meaningful and it resets per CLI process (OS-1399).
  "background_tasks_changed",
  // Registry diff superseded by the terminal `task_notification`. Patches that
  // carry the only copy of a signal (`error`, `is_backgrounded`) are exempted
  // below (OS-1597).
  "task_updated",
  // Level signal (the whole state re-emitted per transition), already derived
  // from message status and the `result` chunk (OS-1598).
  "session_state_changed",
  // Session-start housekeeping superseded by the terminal `completed`. A
  // `failed` install renders inline and is exempted below (OS-1598).
  "plugin_install",
  // Transient by construction — the SDK ships an auto-dismiss `timeout_ms`.
  // Notices above the render threshold are exempted below (OS-1598).
  "notification",
  // Two bare identifiers with no outcome; nothing to render or keep (OS-1598).
  "elicitation_complete",
]);

/**
 * Split an oversized coalesced `stream_event` text/thinking delta back into
 * smaller deltas that each fit the chunk-row storage budget — the inverse of
 * the CLI-side coalescing that produced it. Returns null for any chunk shape
 * that carries no splittable text payload; callers fall back to the shared
 * scrub, then truncation.
 */
export function splitOversizedClaudeCodeChunk(
  chunk: RawCliChunk,
  maxDataChars: number,
): RawCliChunk[] | null {
  if (chunk.type !== "stream_event") {
    return null;
  }

  const message = getRecord(safeJsonParse(chunk.data));
  const event = getRecord(message?.event);
  if (!message || !event || event.type !== "content_block_delta") {
    return null;
  }

  const delta = getRecord(event.delta);
  const textField =
    delta?.type === "thinking_delta"
      ? "thinking"
      : delta?.type === "text_delta"
        ? "text"
        : null;
  if (!delta || !textField) {
    return null;
  }

  const text = delta[textField];
  if (typeof text !== "string") {
    return null;
  }

  // JSON escaping expands a char to at most 6 chars (\uXXXX), so a piece of
  // budget/6 raw chars always serializes under the budget past the wrapper.
  const wrapperChars = chunk.data.length - (JSON.stringify(text).length - 2);
  const pieceChars = Math.floor((maxDataChars - wrapperChars) / 6);
  if (pieceChars < 1) {
    return null;
  }

  const pieces: string[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + pieceChars, text.length);
    // Never split a surrogate pair: a lone surrogate is not valid Unicode.
    const lastCode = text.charCodeAt(end - 1);
    if (end < text.length && lastCode >= 0xd800 && lastCode <= 0xdbff) {
      end += 1;
    }
    pieces.push(text.slice(start, end));
    start = end;
  }

  return pieces.map((piece) => ({
    type: chunk.type,
    data: JSON.stringify({
      ...message,
      event: { ...event, delta: { ...delta, [textField]: piece } },
    }),
  }));
}

/**
 * Partial-streaming chunks are redundant once the whole assistant message
 * arrives, and pure-telemetry system chunks (thinking-token counters, hook
 * heartbeats, status pings) only matter while streaming; both are marked
 * ephemeral so completion can delete their rows. Keeping them would let a
 * single short run flood the historical chunk window with silent rows.
 */
export function isClaudeCodeEphemeralChunk(chunk: RawCliChunk): boolean {
  if (chunk.type === "stream_event") {
    return true;
  }

  if (chunk.type !== "system") {
    return false;
  }

  const obj = getRecord(safeJsonParse(chunk.data));
  if (typeof obj?.subtype !== "string") {
    return false;
  }

  // A `status` row reporting a failed compaction is the only record of that
  // failure — it renders inline and must outlive ephemeral cleanup. Live
  // status heartbeats (including `compacting`, superseded by the boundary
  // notice) stay ephemeral (OS-1593).
  if (obj.subtype === "status" && obj.compact_result === "failed") {
    return false;
  }

  // A `task_updated` patch carrying `error` or `is_backgrounded` is the only
  // record of that signal, so it must outlive ephemeral cleanup (OS-1597).
  if (obj.subtype === "task_updated" && isDurableClaudeTaskPatch(claudeTaskPatch(obj))) {
    return false;
  }

  // A failed plugin install is the only record that a configured plugin is not
  // loaded, and it renders inline — so unlike the rest of the install bracket
  // it must outlive ephemeral cleanup (OS-1598).
  if (obj.subtype === "plugin_install" && obj.status === "failed") {
    return false;
  }

  // Likewise for a notification loud enough to render: keeping it ephemeral
  // would delete the row under a card that is still on screen (OS-1598).
  if (
    obj.subtype === "notification" &&
    typeof obj.priority === "string" &&
    RENDERED_NOTIFICATION_PRIORITIES.has(obj.priority)
  ) {
    return false;
  }

  return EPHEMERAL_SYSTEM_SUBTYPES.has(obj.subtype);
}

function normalizeClaudeStreamEvent(
  obj: Record<string, unknown>,
  parentToolUseId: string | undefined,
): CliNormalizedEvent {
  const silentMetadata = (): CliNormalizedEvent => ({
    kind: "metadata",
    sessionId:
      typeof obj.session_id === "string" ? obj.session_id : undefined,
    otherJson: JSON.stringify({ streamEvent: obj.event ?? null }),
  });

  const event = getRecord(obj.event);
  if (!event) {
    return silentMetadata();
  }

  const source = parentToolUseId ? { parentToolUseId, scope: "child" as const } : undefined;

  if (event.type === "content_block_delta") {
    const delta = getRecord(event.delta);
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return { kind: "text-delta", text: delta.text, ...(source ? { source } : {}) };
    }
    if (
      delta?.type === "thinking_delta" &&
      typeof delta.thinking === "string"
    ) {
      return { kind: "reasoning-delta", text: delta.thinking, ...(source ? { source } : {}) };
    }
    // input_json_delta / signature_delta have no incremental rendering value.
    return silentMetadata();
  }

  // The CLI drops empty redacted-thinking deltas, so the block start is the live "Reasoning" marker.
  if (event.type === "content_block_start" && getRecord(event.content_block)?.type === "thinking") {
    return { kind: "reasoning-delta", text: "", ...(source ? { source } : {}) };
  }

  // message_start/stop, content_block_start/stop, message_delta (usage kept
  // in otherJson; the live meter reads the `assistant` message's usage).
  return silentMetadata();
}

export function normalizeClaudeCodeChunk(
  chunk: RawCliChunk,
): CliNormalizedEvent {
  const parsed = safeJsonParse(chunk.data);
  if (parsed === null) {
    return {
      kind: "unknown",
      reason: "json-parse-error",
      rawType: chunk.type,
      rawData: chunk.data,
    };
  }

  const obj = parsed as Record<string, unknown>;
  if (chunk.type === "convoy.account_usage") {
    const usage = toCliAccountUsage(parsed);
    return usage?.provider === "claude-code"
      ? { kind: "account-usage", usage }
      : { kind: "unknown", reason: "Invalid Claude account usage", rawType: chunk.type, rawData: chunk.data };
  }
  const parentToolUseId =
    typeof obj.parent_tool_use_id === "string"
      ? obj.parent_tool_use_id
      : undefined;

  if (chunk.type === "assistant") {
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) {
      return {
        kind: "unknown",
        reason: "no-content-array",
        rawType: chunk.type,
        rawData: chunk.data,
      };
    }

    const events = content
      .map((block) =>
        normalizeAssistantBlock(
          block as Record<string, unknown>,
          parentToolUseId
        )
      )
      .filter((event): event is CliNormalizedEvent => event !== null);

    if (events.length === 0) {
      return {
        kind: "unknown",
        reason: "no-recognized-content-blocks",
        rawType: chunk.type,
        rawData: chunk.data,
      };
    }

    const contextWindow = parentToolUseId ? null : claudeLiveContextWindowEvent(message);
    const goalEvents = !parentToolUseId && getRecord(obj.local_command_run)?.command === "goal" &&
      events.length === 1 && events[0].kind === "text"
      ? claudeGoalReplyEvents(events[0].text, typeof obj.session_id === "string" ? obj.session_id : undefined)
      : null;
    return singleOrBundled([...(goalEvents ?? events), ...(contextWindow ? [contextWindow] : [])]);
  }

  if (chunk.type === "user") {
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    // String-content user messages are SDK bookkeeping, not conversation
    // input: compaction continuation summaries and replayed local-command
    // output (e.g. "<local-command-stdout>Compacted</local-command-stdout>"
    // after /compact). Keep them silent instead of an "unsupported event" box.
    if (typeof content === "string") {
      return {
        kind: "metadata",
        sessionId:
          typeof obj.session_id === "string" ? obj.session_id : undefined,
        otherJson: JSON.stringify({ userStringContent: content }),
      };
    }
    if (!Array.isArray(content)) {
      return {
        kind: "unknown",
        reason: "no-content-array",
        rawType: chunk.type,
        rawData: chunk.data,
      };
    }

    // `tool_use_result` is a single top-level field, so it can only be
    // attributed when the message carries exactly one result block.
    const soleToolUseResult =
      content.filter((block) => getRecord(block)?.type === "tool_result").length === 1
        ? getRecord(obj.tool_use_result)
        : null;

    const events = content
      .map((block) => {
        const record = block as Record<string, unknown>;
        // A task-tool result carries plan state, and its paired call was
        // silenced, so the plan event replaces that block's tool output.
        // Sibling blocks still normalize normally. Subagent results stay out
        // of the thread plan.
        if (!parentToolUseId) {
          const taskEvent = claudeTaskResultBlockEvent(record, soleToolUseResult);
          if (taskEvent) {
            return taskEvent;
          }
        }
        return normalizeToolResultBlock(record, parentToolUseId);
      })
      .filter((event): event is CliNormalizedEvent => event !== null);

    if (events.length === 0) {
      // Top-level text-only user messages are SDK bookkeeping like the string-content case
      // above — e.g. the synthetic "[Request interrupted by user for tool use]" a graceful
      // interrupt injects (OS-1463). Silent metadata, not an "unsupported event" box. Nested
      // ones (parent_tool_use_id set) must stay unknown: they are Task subagent prompt echoes
      // the composer dedupes from the raw event. Nested `isSynthetic` ones (e.g. the
      // "[Image: original …]" note after a subagent reads an image) are bookkeeping too.
      if (
        (!parentToolUseId || obj.isSynthetic === true) &&
        content.length > 0 &&
        content.every((block) => getRecord(block)?.type === "text")
      ) {
        const textBlocks = content
          .map((block) => getRecord(block))
          .filter((record): record is Record<string, unknown> => record !== null)
          .map((record) => (typeof record.text === "string" ? record.text : ""));
        const sessionId = typeof obj.session_id === "string" ? obj.session_id : undefined;
        const stopHookEvents = textBlocks.length === 1 ? claudeStopHookFeedbackEvents(textBlocks[0], sessionId) : null;
        if (stopHookEvents) {
          return singleOrBundled(stopHookEvents);
        }
        return {
          kind: "metadata",
          sessionId,
          otherJson: JSON.stringify({ userTextContent: textBlocks }),
        };
      }

      return {
        kind: "unknown",
        reason: "no-recognized-content-blocks",
        rawType: chunk.type,
        rawData: chunk.data,
      };
    }

    return singleOrBundled(events);
  }

  if (chunk.type === "result") {
    const sessionId =
      typeof obj.session_id === "string" ? obj.session_id : undefined;
    const metadataEvent: CliNormalizedEvent = {
      kind: "metadata",
      sessionId,
      otherJson: JSON.stringify({
        resultSubtype: obj.subtype,
        terminalReason: obj.terminal_reason,
        apiErrorStatus: obj.api_error_status,
        ...(obj.terminal_reason !== undefined || obj.api_error_status !== undefined
          ? { resultOutcome: claudeResultOutcome(obj).status } : {}),
        totalCostUsd: obj.total_cost_usd,
        durationMs: obj.duration_ms,
        usage: obj.usage,
        modelUsage: obj.modelUsage,
      }),
    };
    const errorNoticeEvent = normalizeClaudeResultError(obj, sessionId);

    // The goal's Stop hook blocks a normal stop until it is met (OS-2276).
    const runCompleted = obj.terminal_reason === "completed" && claudeResultOutcome(obj).status === "completed";
    const events: CliNormalizedEvent[] = [
      metadataEvent,
      ...(errorNoticeEvent ? [errorNoticeEvent] : []),
      ...(runCompleted ? [{ kind: "goal" as const, source: "run-completed" as const, sessionId }] : []),
    ];

    return singleOrBundled(events);
  }

  if (chunk.type === "convoy.context_usage") {
    return normalizeClaudeContextUsageChunk(obj);
  }

  // Convoy-authored, not a Claude event: the runner stopped holding the turn open for
  // background agents that never reported back (OS-1661).
  if (chunk.type === "convoy.background_wait_timeout") {
    const taskCount = getNumber(obj.taskCount) ?? 0;
    const waitedMs = getNumber(obj.waitedMs);
    const waitedMinutes = waitedMs !== undefined ? Math.round(waitedMs / 60_000) : undefined;
    const shell = obj.taskKind === "shell";
    const noun = shell ? "background shell job" : "background agent";
    const agentText = `${taskCount} ${noun}${taskCount === 1 ? "" : "s"}`;

    return {
      kind: "runtime-notice",
      code: "convoy-background-wait-timeout",
      title: shell ? "Background shell jobs stopped" : "Background agents stopped",
      message: `Stopped waiting${waitedMinutes ? ` after ${waitedMinutes} minutes` : ""} with ${agentText} still running. They were ended with this turn and did not report back.`,
      detailsJson: JSON.stringify({ payload: obj }),
    };
  }

  if (chunk.type === "stream_event") {
    return normalizeClaudeStreamEvent(obj, parentToolUseId);
  }

  if (chunk.type === "rate_limit_event") {
    return normalizeClaudeRateLimitEvent(obj);
  }

  if (chunk.type === "tool_progress") {
    return normalizeClaudeToolProgress(obj, parentToolUseId);
  }

  if (chunk.type === "tool_use_summary") {
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    if (!summary) {
      return {
        kind: "metadata",
        otherJson: JSON.stringify({ toolUseSummary: obj }),
      };
    }

    return {
      kind: "runtime-notice",
      code: "claude-tool-summary",
      title: "Tool summary",
      message: summary,
      sessionId:
        typeof obj.session_id === "string" ? obj.session_id : undefined,
      detailsJson: JSON.stringify({ payload: obj }),
    };
  }

  if (chunk.type === "auth_status") {
    const error = typeof obj.error === "string" && obj.error.trim() ? obj.error : undefined;
    if (!error && obj.isAuthenticating !== true) {
      return {
        kind: "metadata",
        otherJson: JSON.stringify({ authStatus: obj }),
      };
    }

    // The SDK types output as string[]; tolerate a plain string as well.
    const outputLines = (Array.isArray(obj.output) ? obj.output : [obj.output])
      .filter(
        (line): line is string =>
          typeof line === "string" && line.trim().length > 0,
      );

    return {
      kind: "runtime-notice",
      code: error ? "claude-auth-error" : "claude-auth-status",
      title: error ? "Claude authentication failed" : "Claude authentication",
      message: error
        ? [...new Set([error, ...outputLines])].join("\n")
        : outputLines.length > 0
          ? outputLines.join("\n")
          : "Claude is waiting for authentication.",
      detailsJson: JSON.stringify({ payload: obj }),
    };
  }

  // Predicted next user prompt. Its top-level type is `prompt_suggestion`, not `system`, so
  // it never reaches the subtype switch and used to land on the "Unsupported CLI event"
  // card. A composer affordance, not transcript content — last turn's guess as permanent
  // history is wrong — so it stays silent, with the suggestion kept in metadata for OS-1609.
  if (chunk.type === "prompt_suggestion") {
    return {
      kind: "metadata",
      sessionId:
        typeof obj.session_id === "string" ? obj.session_id : undefined,
      otherJson: JSON.stringify({
        promptSuggestion:
          typeof obj.suggestion === "string" ? obj.suggestion : null,
      }),
    };
  }

  // Queued-prompt state (queued/started/cancelled): SDK queue bookkeeping, nothing renders.
  if (chunk.type === "command_lifecycle") {
    return {
      kind: "metadata",
      sessionId:
        typeof obj.session_id === "string" ? obj.session_id : undefined,
    };
  }

  // The runner's slash-command inventory: discovery only, nothing renders
  // (OS-1806, docs/specs/cli-runtime-commands.md).
  if (chunk.type === "convoy.commands") {
    return {
      kind: "metadata",
      otherJson: JSON.stringify({ event: "convoy.commands" }),
    };
  }

  if (chunk.type === "system") {
    const subtype = typeof obj.subtype === "string" ? obj.subtype : undefined;
    if (subtype && subtype !== "init") {
      return normalizeClaudeSystemNotice(obj);
    }

    const systemInit: Record<string, unknown> = {};
    if (obj.model !== undefined) systemInit.model = obj.model;
    if (obj.claude_code_version !== undefined)
      systemInit.claudeCodeVersion = obj.claude_code_version;
    if (obj.permissionMode !== undefined)
      systemInit.permissionMode = obj.permissionMode;
    if (obj.tools !== undefined) systemInit.tools = obj.tools;
    if (obj.slash_commands !== undefined)
      systemInit.slashCommands = obj.slash_commands;
    if (obj.agents !== undefined) systemInit.agents = obj.agents;
    if (obj.plugins !== undefined) systemInit.plugins = obj.plugins;

    return {
      kind: "metadata",
      sessionId:
        typeof obj.session_id === "string" ? obj.session_id : undefined,
      otherJson:
        Object.keys(systemInit).length > 0
          ? JSON.stringify({ systemInit })
          : undefined,
      ...(subtype === "init" && !parentToolUseId
        ? { backgroundTasks: {
            ...(typeof obj.session_id === "string" ? { sessionId: obj.session_id } : {}),
            tasks: [], totalCount: 0,
          } }
        : {}),
    };
  }

  return {
    kind: "unknown",
    reason: "unsupported-type",
    rawType: chunk.type,
    rawData: chunk.data,
  };
}
