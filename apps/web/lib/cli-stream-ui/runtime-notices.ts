import type { DynamicToolUIPart } from "ai";
import type {
  CliUiPart,
  ComposerNotice,
  RuntimeNoticePart,
  TaskNoticeGroupPart,
  TaskNoticeGroupToolEvent,
} from "./types";
import { isRecord } from "@/lib/type-guards";

const TASK_LIFECYCLE_SUBTYPES = new Set([
  "codex_subagent",
  "task_started",
  "task_progress",
  "task_notification",
  "task_updated",
]);

type NoticePayload = {
  subtype?: string;
  payload: Record<string, unknown> | null;
};

function tryParseJson(value: string | undefined): unknown | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function formatJsonString(value: string): string {
  const parsed = tryParseJson(value);
  if (parsed === undefined) {
    return value;
  }

  return JSON.stringify(parsed, null, 2);
}

export function parseNoticePayload(notice: ComposerNotice): NoticePayload {
  const parsed = tryParseJson(notice.detailsJson);
  if (!isRecord(parsed)) {
    return { payload: null };
  }

  return {
    subtype: typeof parsed.subtype === "string" ? parsed.subtype : undefined,
    payload: isRecord(parsed.payload) ? parsed.payload : null,
  };
}

export function getTaskNoticeGroupKey(notice: ComposerNotice): string | null {
  const { subtype, payload } = parseNoticePayload(notice);
  if (!subtype || !TASK_LIFECYCLE_SUBTYPES.has(subtype) || !payload) {
    return null;
  }

  const taskId = getTaskNoticeTaskId(notice);
  if (!taskId) {
    return null;
  }

  const toolUseId =
    typeof payload.tool_use_id === "string" ? payload.tool_use_id : null;
  return toolUseId ? `${taskId}::${toolUseId}` : taskId;
}

/**
 * The `task_id` a lifecycle notice belongs to, independent of the group key
 * shape. `task_updated` never carries `tool_use_id`, so its key would be a bare
 * `task_id` while its siblings key on `task_id::tool_use_id` — correlation has
 * to happen on the task id alone or the patch lands in a second, sibling group.
 */
export function getTaskNoticeTaskId(notice: ComposerNotice): string | null {
  const { subtype, payload } = parseNoticePayload(notice);
  if (!subtype || !TASK_LIFECYCLE_SUBTYPES.has(subtype) || !payload) {
    return null;
  }

  return typeof payload.task_id === "string" && payload.task_id.length > 0
    ? payload.task_id
    : null;
}

/**
 * A `task_updated` patch is unrenderable on its own (no description, no
 * summary), so the composer drops it when no group for its `task_id` exists.
 */
export function isTaskPatchNotice(notice: ComposerNotice): boolean {
  return parseNoticePayload(notice).subtype === "task_updated";
}

export function createRuntimeNoticePart(
  notice: ComposerNotice,
  debugJson?: string
): RuntimeNoticePart {
  return {
    type: "runtime-notice",
    ...notice,
    ...(debugJson ? { debugJson } : {}),
  };
}

function parseToolInputJson(inputJson: string): unknown {
  try {
    return JSON.parse(inputJson);
  } catch {
    return {};
  }
}

function parseToolOutputJson(outputJson: string): unknown {
  try {
    return JSON.parse(outputJson);
  } catch {
    return outputJson;
  }
}

export function buildTaskNoticeGroupChildToolParts(
  events: TaskNoticeGroupToolEvent[] | undefined
): DynamicToolUIPart[] {
  if (!events || events.length === 0) {
    return [];
  }

  const parts: DynamicToolUIPart[] = [];
  const partIndexByToolCallId = new Map<string, number>();

  for (const event of events) {
    if (!event.toolCallId) {
      continue;
    }

    if (event.kind === "tool-input") {
      const nextPart: DynamicToolUIPart = {
        type: "dynamic-tool",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        state: "input-available",
        input: parseToolInputJson(event.inputJson),
      };
      const existingIndex = partIndexByToolCallId.get(event.toolCallId);
      if (existingIndex === undefined) {
        partIndexByToolCallId.set(event.toolCallId, parts.length);
        parts.push(nextPart);
      } else {
        parts[existingIndex] = nextPart;
      }
      continue;
    }

    const existingIndex = partIndexByToolCallId.get(event.toolCallId);
    if (existingIndex === undefined) {
      continue;
    }

    const currentPart = parts[existingIndex];
    if (!currentPart) {
      continue;
    }

    if (event.kind === "tool-output") {
      parts[existingIndex] = {
        ...currentPart,
        state: "output-available",
        output: parseToolOutputJson(event.outputJson),
      } as DynamicToolUIPart;
      continue;
    }

    parts[existingIndex] = {
      ...currentPart,
      state: "output-error",
      errorText: event.errorText,
    } as DynamicToolUIPart;
  }

  return parts;
}

function getStringField(
  payload: Record<string, unknown> | null,
  field: string
): string | undefined {
  const value = payload?.[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getUsage(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  return isRecord(payload?.usage) ? payload.usage : null;
}

function getTaskToolInputValue(
  part: TaskNoticeGroupPart,
  field: string
): string | undefined {
  const input = part.taskTool?.input;
  if (!isRecord(input)) {
    return undefined;
  }

  const value = input[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * `task_updated` reports status inside `patch` rather than at the top level,
 * and adds a value the edge events never emit (`killed`).
 */
function getTaskPatch(
  payload: Record<string, unknown> | null
): Record<string, unknown> | null {
  return isRecord(payload?.patch) ? payload.patch : null;
}

function formatTaskStatus(subtype: string | undefined, payload: Record<string, unknown> | null): string {
  if (subtype === "task_updated") {
    return getStringField(getTaskPatch(payload), "status") ?? "notice";
  }

  const explicitStatus = getStringField(payload, "status");
  if (explicitStatus) {
    return explicitStatus;
  }

  switch (subtype) {
    case "task_started":
      return "started";
    case "task_progress":
      return "in progress";
    case "task_notification":
      return "updated";
    default:
      return "notice";
  }
}

export type TaskNoticeGroupSummary = {
  title: string;
  status: string;
  prompt?: string;
  outputFile?: string;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
  /** Only ever reported by a `task_updated` patch. */
  error?: string;
  /** Only observable through a `task_updated` patch. */
  isBackgrounded?: boolean;
  debugJson: string;
};

export function summarizeTaskNoticeGroup(
  part: TaskNoticeGroupPart
): TaskNoticeGroupSummary {
  let title = "Claude task";
  let prompt: string | undefined;
  let outputFile: string | undefined;
  let totalTokens: number | undefined;
  let toolUses: number | undefined;
  let durationMs: number | undefined;
  let error: string | undefined;
  let isBackgrounded: boolean | undefined;

  // Codex explicit outcomes outrank activity summaries; Claude patches use the latest status.
  let status = "notice";
  let codexTurnId: string | undefined;
  let codexStatusHasTurn = false;
  const previousCodexTurns = new Set<string>();

  for (const notice of part.notices) {
    const { subtype, payload } = parseNoticePayload(notice);
    const patch = getTaskPatch(payload);

    const noticeStatus = formatTaskStatus(subtype, payload);
    let acceptStatus = true;
    if (subtype === "codex_subagent") {
      const turnId = getStringField(payload, "turnId");
      if (turnId && previousCodexTurns.has(turnId)) {
        acceptStatus = false;
      } else if (turnId && turnId !== codexTurnId) {
        if (codexTurnId) previousCodexTurns.add(codexTurnId);
        codexTurnId = turnId;
      } else if (["completed", "failed", "interrupted", "closed"].includes(status)) {
        acceptStatus =
          !!turnId &&
          !codexStatusHasTurn &&
          ["completed", "failed", "interrupted", "closed"].includes(noticeStatus);
      }
      if (acceptStatus && noticeStatus !== "notice") codexStatusHasTurn = !!turnId;
    }
    if (noticeStatus !== "notice" && acceptStatus) status = noticeStatus;

    title =
      getStringField(payload, "summary") ??
      getStringField(payload, "description") ??
      getStringField(patch, "description") ??
      title;
    prompt = getStringField(payload, "prompt") ?? prompt;
    outputFile = getStringField(payload, "output_file") ?? outputFile;
    error = getStringField(patch, "error") ?? error;
    if (typeof patch?.is_backgrounded === "boolean") {
      isBackgrounded = patch.is_backgrounded;
    }
    const usage = getUsage(payload);
    totalTokens =
      typeof usage?.total_tokens === "number" ? usage.total_tokens : totalTokens;
    toolUses =
      typeof usage?.tool_uses === "number" ? usage.tool_uses : toolUses;
    durationMs =
      typeof usage?.duration_ms === "number" ? usage.duration_ms : durationMs;
  }

  title =
    title === "Claude task"
      ? getTaskToolInputValue(part, "description") ?? title
      : title;
  prompt = prompt ?? getTaskToolInputValue(part, "prompt");

  if (status === "notice" || status === "started") {
    const taskToolState = part.taskTool?.state;
    if (taskToolState === "output-available") {
      status = "completed";
    } else if (taskToolState === "output-error") {
      status = "failed";
    } else if (taskToolState === "input-available" && status === "notice") {
      status = "started";
    }
  }

  return {
    title,
    status,
    ...(prompt ? { prompt } : {}),
    ...(outputFile ? { outputFile } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(error ? { error } : {}),
    ...(isBackgrounded !== undefined ? { isBackgrounded } : {}),
    debugJson: JSON.stringify(
      {
        taskTool: part.taskTool ?? null,
        notices: part.notices.map((notice) => {
          const { subtype, payload } = parseNoticePayload(notice);
          return {
            code: notice.code,
            title: notice.title,
            message: notice.message,
            sessionId: notice.sessionId,
            subtype,
            payload,
          };
        }),
        childToolEvents: part.childToolEvents,
        childTaskNoticeGroups: part.childTaskNoticeGroups ?? [],
      },
      null,
      2
    ),
  };
}

/** The repo key of the CLI's `worktree-setup-unapproved` notice, backticked in its message (docs/specs/cli-worktrees.md#approval). */
export function unapprovedWorktreeSetupRepoKey(part: CliUiPart): string | null {
  if (part.type !== "runtime-notice" || part.code !== "worktree-setup-unapproved") return null;
  return /`([^`]+)`/.exec(part.message)?.[1] ?? null;
}
