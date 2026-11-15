import type { DynamicToolUIPart } from "ai";
import { CODEX_AGENT_GROUP_KEY } from "@/lib/cli-stream-ui/types";
import { isForeignNarrativeSource, type CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { expandCliNormalizedEvent } from "@/convex/cli/lib/chunks/normalizedEvents";
import { isRecord } from "@/lib/type-guards";
import type {
  CliUiPart,
  ComposerNotice,
  ComposerMessageState,
  ComposerState,
  EventStoreState,
  NormalizedChunkRow,
  RuntimeNoticePart,
  SleepPart,
  TaskNoticeGroupPart,
  UsageLimitSeverity,
} from "./types";
import {
  createRuntimeNoticePart,
  getTaskNoticeGroupKey,
  getTaskNoticeTaskId,
  isTaskPatchNotice,
  summarizeTaskNoticeGroup,
} from "./runtime-notices";
import {
  formatUsageLimitPercentage,
  formatUsageLimitWindowLabel,
  getUsageLimitSeverity,
} from "./usage-limit";

const USAGE_SEVERITY_RANK: Record<UsageLimitSeverity, number> = {
  none: 0,
  warning: 1,
  critical: 2,
};

type ThreadComposerContext = {
  usageSeverityByWindow: Map<string, UsageLimitSeverity>;
};

const GROUPED_PARENT_TOOL_NAMES = new Set(["Task", "Agent"]);

export function emptyMessageState(): ComposerMessageState {
  return {
    normalizedEvents: [],
    parts: [],
    metadata: {},
    warnings: [],
    toolPartIndexById: new Map(),
    toolTimingsByCallId: new Map(),
    taskNoticeGroupIndexByKey: new Map(),
    taskNoticeGroupIndexByParentToolUseId: new Map(),
    deltaPartIndices: new Set(),
    narrativePartIndexByKey: new Map(),
    completedNarrativeKeys: new Set(),
  };
}

/** First `tool-input` wins — a re-sent input must not restart the span. */
function recordToolStart(
  msg: ComposerMessageState,
  toolCallId: string,
  timestamp: number
): void {
  const existing = msg.toolTimingsByCallId.get(toolCallId);
  if (existing) return;
  msg.toolTimingsByCallId.set(toolCallId, { startedAt: timestamp });
}

/** Last result wins; a result without a recorded start seeds both ends. */
function recordToolEnd(
  msg: ComposerMessageState,
  toolCallId: string,
  timestamp: number
): void {
  const existing = msg.toolTimingsByCallId.get(toolCallId);
  msg.toolTimingsByCallId.set(toolCallId, {
    startedAt: existing?.startedAt ?? timestamp,
    endedAt: timestamp,
  });
}

/** Remove legacy drafts, preserving identified items and rebuilding shifted indices. */
function removeDeltaParts(msg: ComposerMessageState): void {
  if (msg.deltaPartIndices.size === 0) {
    return;
  }

  const identified = new Set(msg.narrativePartIndexByKey.values());
  const removed = [...msg.deltaPartIndices].filter((index) => !identified.has(index));
  removeParts(msg, removed);
}

function removeParts(msg: ComposerMessageState, removed: number[]): void {
  const shiftIndex = (index: number) =>
    index - removed.filter((removedIndex) => removedIndex < index).length;
  msg.parts = msg.parts.filter((_, index) => !removed.includes(index));
  msg.deltaPartIndices = new Set(
    [...msg.deltaPartIndices].filter((index) => !removed.includes(index)).map(shiftIndex)
  );
  msg.narrativePartIndexByKey = new Map(
    [...msg.narrativePartIndexByKey]
      .filter(([, index]) => !removed.includes(index))
      .map(([key, index]) => [key, shiftIndex(index)])
  );
  msg.toolPartIndexById = new Map();
  msg.parts.forEach((part, index) => {
    if (part.type === "dynamic-tool") {
      msg.toolPartIndexById.set(part.toolCallId, index);
    }
  });
  rebuildTaskNoticeGroupIndex(msg);
}

function applyNarrative(
  msg: ComposerMessageState,
  event: Extract<
    CliNormalizedEvent,
    { kind: "text" | "reasoning" | "text-delta" | "reasoning-delta" }
  >
): void {
  const source = event.source;
  const rootThreadId =
    typeof msg.metadata.sessionId === "string" ? msg.metadata.sessionId : undefined;
  if (isForeignNarrativeSource(source, rootThreadId)) return;
  const type = event.kind === "text" || event.kind === "text-delta" ? "text" : "reasoning";
  const delta = event.kind.endsWith("-delta");
  if (source?.itemId) {
    const key = JSON.stringify([
      type,
      source.threadId,
      source.turnId,
      source.itemId,
      source.parentToolUseId,
    ]);
    if (delta && msg.completedNarrativeKeys.has(key)) return;
    const index = msg.narrativePartIndexByKey.get(key);
    if (!delta && event.text.length === 0) {
      if (index !== undefined) removeParts(msg, [index]);
      msg.completedNarrativeKeys.add(key);
      return;
    }
    const previous = index === undefined ? undefined : msg.parts[index];
    const text = delta && previous?.type === type ? previous.text + event.text : event.text;
    const nextIndex = index ?? msg.parts.length;
    msg.parts[nextIndex] = { type, text };
    msg.narrativePartIndexByKey.set(key, nextIndex);
    if (delta) msg.deltaPartIndices.add(nextIndex);
    else {
      msg.deltaPartIndices.delete(nextIndex);
      msg.completedNarrativeKeys.add(key);
    }
    return;
  }
  if (!delta) removeDeltaParts(msg);
  const index = msg.parts.length - 1;
  const previous = msg.parts[index];
  if (
    previous?.type === type &&
    ![...msg.narrativePartIndexByKey.values()].includes(index) &&
    (!delta || msg.deltaPartIndices.has(index))
  ) {
    msg.parts[index] = { type, text: previous.text + event.text };
  } else {
    const addedIndex = msg.parts.push({ type, text: event.text }) - 1;
    if (delta) msg.deltaPartIndices.add(addedIndex);
  }
}

function buildPendingTaskGroupKey(parentToolUseId: string): string {
  return `task-tool::${parentToolUseId}`;
}

function isTaskToolName(toolName: string): boolean {
  return GROUPED_PARENT_TOOL_NAMES.has(toolName);
}

function registerTaskNoticeGroupIndexEntry(
  msg: ComposerMessageState,
  index: number,
  part: TaskNoticeGroupPart
): void {
  msg.taskNoticeGroupIndexByKey.set(part.groupKey, index);
  const parentToolUseId = part.parentToolUseId ?? getTaskToolUseId(part.groupKey);
  if (parentToolUseId) {
    msg.taskNoticeGroupIndexByParentToolUseId.set(parentToolUseId, index);
  }
}

function unregisterTaskNoticeGroupIndexEntry(
  msg: ComposerMessageState,
  index: number,
  part: TaskNoticeGroupPart
): void {
  if (msg.taskNoticeGroupIndexByKey.get(part.groupKey) === index) {
    msg.taskNoticeGroupIndexByKey.delete(part.groupKey);
  }
  const parentToolUseId = part.parentToolUseId ?? getTaskToolUseId(part.groupKey);
  if (
    parentToolUseId &&
    msg.taskNoticeGroupIndexByParentToolUseId.get(parentToolUseId) === index
  ) {
    msg.taskNoticeGroupIndexByParentToolUseId.delete(parentToolUseId);
  }
}

function replaceTaskNoticeGroupAtIndex(
  msg: ComposerMessageState,
  index: number,
  part: TaskNoticeGroupPart
): void {
  const previousPart = msg.parts[index];
  if (previousPart?.type === "task-notice-group") {
    unregisterTaskNoticeGroupIndexEntry(msg, index, previousPart);
  }
  msg.parts[index] = part;
  registerTaskNoticeGroupIndexEntry(msg, index, part);
}

function rebuildTaskNoticeGroupIndex(msg: ComposerMessageState): void {
  msg.taskNoticeGroupIndexByKey = new Map();
  msg.taskNoticeGroupIndexByParentToolUseId = new Map();
  msg.parts.forEach((part, index) => {
    if (part.type === "task-notice-group") {
      registerTaskNoticeGroupIndexEntry(msg, index, part);
    }
  });
}

function ensureTaskNoticeGroup(
  msg: ComposerMessageState,
  parentToolUseId: string,
  groupKey?: string
): { part: TaskNoticeGroupPart; index: number } {
  const existingIndex =
    msg.taskNoticeGroupIndexByParentToolUseId.get(parentToolUseId);
  if (existingIndex !== undefined) {
    const existingPart = msg.parts[existingIndex];
    if (existingPart && existingPart.type === "task-notice-group") {
      const nextGroupKey = groupKey ?? existingPart.groupKey;
      const nextPart =
        existingPart.groupKey === nextGroupKey &&
        existingPart.parentToolUseId === parentToolUseId
          ? existingPart
          : {
              ...existingPart,
              groupKey: nextGroupKey,
              parentToolUseId,
            };
      if (nextPart !== existingPart) {
        replaceTaskNoticeGroupAtIndex(msg, existingIndex, nextPart);
      }
      return { part: nextPart, index: existingIndex };
    }
  }

  const existingToolIndex = msg.toolPartIndexById.get(parentToolUseId);
  const existingToolPart =
    existingToolIndex !== undefined ? msg.parts[existingToolIndex] : undefined;
  if (
    existingToolIndex !== undefined &&
    existingToolPart?.type === "dynamic-tool"
  ) {
    const nextPart: TaskNoticeGroupPart = {
      type: "task-notice-group",
      groupKey: groupKey ?? buildPendingTaskGroupKey(parentToolUseId),
      parentToolUseId,
      notices: [],
      childToolEvents: [],
      childTaskNoticeGroups: [],
      taskTool: existingToolPart,
    };
    msg.toolPartIndexById.delete(parentToolUseId);
    replaceTaskNoticeGroupAtIndex(msg, existingToolIndex, nextPart);
    return { part: nextPart, index: existingToolIndex };
  }

  const nextPart: TaskNoticeGroupPart = {
    type: "task-notice-group",
    groupKey: groupKey ?? buildPendingTaskGroupKey(parentToolUseId),
    parentToolUseId,
    notices: [],
    childToolEvents: [],
    childTaskNoticeGroups: [],
  };
  const nextIndex = msg.parts.push(nextPart) - 1;
  registerTaskNoticeGroupIndexEntry(msg, nextIndex, nextPart);
  return { part: nextPart, index: nextIndex };
}

/**
 * Locate the lifecycle group tracking `taskId`, top-level or nested. Groups per
 * message are few, so this walks the parts instead of maintaining a third index
 * map (which would also have to be cloned and rebuilt on every part removal).
 */
function findTaskNoticeGroupByTaskId(
  msg: ComposerMessageState,
  taskId: string
): { index: number; nestedChildToolUseId?: string } | null {
  for (let index = 0; index < msg.parts.length; index += 1) {
    const part = msg.parts[index];
    if (!part || part.type !== "task-notice-group") {
      continue;
    }

    if (part.taskId === taskId) {
      return { index };
    }

    const nested = (part.childTaskNoticeGroups ?? []).find(
      (group) => group.taskId === taskId
    );
    const nestedToolUseId = nested ? getTaskGroupToolUseId(nested) : undefined;
    if (nested && nestedToolUseId) {
      return { index, nestedChildToolUseId: nestedToolUseId };
    }
  }

  return null;
}

/**
 * Fold a `task_updated` patch into the group already tracking its `task_id`.
 * Returns false when no such group exists — a bare patch has no description or
 * summary of its own, so there is nothing renderable to fall back to.
 */
function mergeTaskPatchNotice(
  msg: ComposerMessageState,
  notice: ComposerNotice,
  taskId: string | null
): boolean {
  if (!taskId) {
    return false;
  }

  const location = findTaskNoticeGroupByTaskId(msg, taskId);
  if (!location) {
    return false;
  }

  if (location.nestedChildToolUseId) {
    upsertNestedChildTaskGroup(
      msg,
      location.index,
      location.nestedChildToolUseId,
      (group) => ({ ...group, notices: [...group.notices, notice] })
    );
    return true;
  }

  const group = msg.parts[location.index];
  if (!group || group.type !== "task-notice-group") {
    return false;
  }

  replaceTaskNoticeGroupAtIndex(msg, location.index, {
    ...group,
    notices: [...group.notices, notice],
  });
  return true;
}

function getTaskNoticeGroupByParentToolUseId(
  msg: ComposerMessageState,
  parentToolUseId: string
): TaskNoticeGroupPart | null {
  const index = msg.taskNoticeGroupIndexByParentToolUseId.get(parentToolUseId);
  const part = index !== undefined ? msg.parts[index] : undefined;
  return part?.type === "task-notice-group" ? part : null;
}

function getTaskGroupToolUseId(part: TaskNoticeGroupPart): string | undefined {
  return part.parentToolUseId ?? getTaskToolUseId(part.groupKey);
}

function getNestedChildTaskGroup(
  parentGroup: TaskNoticeGroupPart,
  childToolUseId: string
): { group: TaskNoticeGroupPart; index: number } | null {
  const childGroups = parentGroup.childTaskNoticeGroups ?? [];
  const index = childGroups.findIndex(
    (group) => getTaskGroupToolUseId(group) === childToolUseId
  );
  if (index === -1) {
    return null;
  }

  const group = childGroups[index];
  return group ? { group, index } : null;
}

function findTopLevelGroupContainingChildTool(
  msg: ComposerMessageState,
  childToolUseId: string
): { group: TaskNoticeGroupPart; index: number } | null {
  for (let index = 0; index < msg.parts.length; index += 1) {
    const part = msg.parts[index];
    if (!part || part.type !== "task-notice-group") {
      continue;
    }

    const hasChildToolEvent = (part.childToolEvents ?? []).some(
      (event) => event.toolCallId === childToolUseId
    );
    const hasNestedChildGroup =
      getNestedChildTaskGroup(part, childToolUseId) !== null;

    if (hasChildToolEvent || hasNestedChildGroup) {
      return { group: part, index };
    }
  }

  return null;
}

function getChildTaskToolFallback(
  parentGroup: TaskNoticeGroupPart,
  childToolUseId: string
): DynamicToolUIPart | null {
  const toolInputEvent = [...(parentGroup.childToolEvents ?? [])]
    .reverse()
    .find(
      (event) => event.kind === "tool-input" && event.toolCallId === childToolUseId
    );

  if (!toolInputEvent || toolInputEvent.kind !== "tool-input") {
    return null;
  }

  return {
    type: "dynamic-tool",
    toolName: toolInputEvent.toolName,
    toolCallId: childToolUseId,
    state: "input-available",
    input: parseToolInputJson(toolInputEvent.inputJson),
  };
}

function upsertNestedChildTaskGroup(
  msg: ComposerMessageState,
  parentGroupIndex: number,
  childToolUseId: string,
  updater: (group: TaskNoticeGroupPart) => TaskNoticeGroupPart,
  groupKey?: string
): void {
  const parentGroup = msg.parts[parentGroupIndex];
  if (!parentGroup || parentGroup.type !== "task-notice-group") {
    return;
  }

  const existingChildGroup = getNestedChildTaskGroup(parentGroup, childToolUseId);
  const fallbackTaskTool =
    existingChildGroup?.group.taskTool ??
    getChildTaskToolFallback(parentGroup, childToolUseId) ??
    undefined;

  const baseChildGroup: TaskNoticeGroupPart =
    existingChildGroup?.group ?? {
      type: "task-notice-group",
      groupKey: groupKey ?? buildPendingTaskGroupKey(childToolUseId),
      parentToolUseId: childToolUseId,
      notices: [],
      childToolEvents: [],
      childTaskNoticeGroups: [],
      ...(fallbackTaskTool ? { taskTool: fallbackTaskTool } : {}),
    };

  const nextChildGroup = updater({
    ...baseChildGroup,
    ...(groupKey ? { groupKey, parentToolUseId: childToolUseId } : {}),
  });

  const existingChildren = parentGroup.childTaskNoticeGroups ?? [];
  const nextChildGroups =
    existingChildGroup === null
      ? [...existingChildren, nextChildGroup]
      : existingChildren.map((group, index) =>
          index === existingChildGroup.index ? nextChildGroup : group
        );

  replaceTaskNoticeGroupAtIndex(msg, parentGroupIndex, {
    ...parentGroup,
    childTaskNoticeGroups: nextChildGroups,
  });
}

function addRuntimeNoticePart(
  msg: ComposerMessageState,
  notice: ComposerNotice,
  debugJson?: string
): void {
  const groupKey = getTaskNoticeGroupKey(notice);
  if (groupKey) {
    const taskId = getTaskNoticeTaskId(notice);

    // A patch merges into the group for its task or is dropped; it must never
    // open a group of its own, and its bare `task_id` key must not be mistaken
    // for the sibling events' `task_id::tool_use_id` key.
    if (isTaskPatchNotice(notice)) {
      mergeTaskPatchNotice(msg, notice, taskId);
      return;
    }

    const parentToolUseId = getTaskToolUseId(groupKey);
    if (!parentToolUseId) {
      const existingIndex = msg.taskNoticeGroupIndexByKey.get(groupKey);
      if (existingIndex !== undefined) {
        const current = msg.parts[existingIndex];
        if (current && current.type === "task-notice-group") {
          replaceTaskNoticeGroupAtIndex(msg, existingIndex, {
            ...current,
            ...(taskId ? { taskId } : {}),
            notices: [...current.notices, notice],
          });
          dedupeNestedUserPromptEchoesForGroup(msg, groupKey);
        }
        return;
      }

      const nextGroup: TaskNoticeGroupPart = {
        type: "task-notice-group",
        groupKey,
        ...(taskId ? { taskId } : {}),
        notices: [notice],
        childToolEvents: [],
      };
      const nextIndex = msg.parts.push(nextGroup) - 1;
      registerTaskNoticeGroupIndexEntry(msg, nextIndex, nextGroup);
      dedupeNestedUserPromptEchoesForGroup(msg, groupKey);
      return;
    }

    const topLevelOwner = findTopLevelGroupContainingChildTool(
      msg,
      parentToolUseId
    );
    if (topLevelOwner) {
      upsertNestedChildTaskGroup(
        msg,
        topLevelOwner.index,
        parentToolUseId,
        (group) => ({
          ...group,
          groupKey,
          parentToolUseId,
          ...(taskId ? { taskId } : {}),
          notices: [...group.notices, notice],
        }),
        groupKey
      );
      return;
    }

    const { part: group, index: groupIndex } = ensureTaskNoticeGroup(
      msg,
      parentToolUseId,
      groupKey
    );
    replaceTaskNoticeGroupAtIndex(msg, groupIndex, {
      ...group,
      groupKey,
      parentToolUseId,
      ...(taskId ? { taskId } : {}),
      notices: [...group.notices, notice],
    });
    dedupeNestedUserPromptEchoesForGroup(msg, groupKey);
    return;
  }

  msg.parts.push(createRuntimeNoticePart(notice, debugJson));
}

function getRuntimeNoticeDebugJson(event: Extract<CliNormalizedEvent, { kind: "runtime-notice" }>): string | undefined {
  return event.detailsJson ? undefined : JSON.stringify(event, null, 2);
}

function getUnknownEventDebugJson(event: Extract<CliNormalizedEvent, { kind: "unknown" }>): string {
  return JSON.stringify(
    {
      rawType: event.rawType,
      reason: event.reason,
      ...(event.rawData !== undefined
        ? { rawData: event.rawData }
        : { rawDataMissing: true }),
    },
    null,
    2
  );
}

type NestedUserTextEcho = {
  parentToolUseId: string;
  text: string;
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

function normalizePromptText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function getTaskToolUseId(groupKey: string): string | undefined {
  const separatorIndex = groupKey.indexOf("::");
  if (separatorIndex === -1) {
    return undefined;
  }

  const toolUseId = groupKey.slice(separatorIndex + 2);
  return toolUseId.length > 0 ? toolUseId : undefined;
}

function parseNestedUserTextEchoFromRawData(
  rawData: string | undefined
): NestedUserTextEcho | null {
  const parsed = tryParseJson(rawData);
  if (!isRecord(parsed) || parsed.type !== "user") {
    return null;
  }

  const parentToolUseId = parsed.parent_tool_use_id;
  if (typeof parentToolUseId !== "string" || parentToolUseId.length === 0) {
    return null;
  }

  const message = isRecord(parsed.message) ? parsed.message : null;
  const content = message?.content;
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }

  const textBlocks = content.map((block) => (isRecord(block) ? block : null));
  if (
    textBlocks.some(
      (block) => block?.type !== "text" || typeof block.text !== "string"
    )
  ) {
    return null;
  }

  const text = textBlocks
    .map((block) => block?.text)
    .filter((value): value is string => typeof value === "string")
    .join("\n\n");

  return text.length > 0 ? { parentToolUseId, text } : null;
}

function parseNestedUserTextEchoFromUnknownEvent(
  event: Extract<CliNormalizedEvent, { kind: "unknown" }>
): NestedUserTextEcho | null {
  if (
    event.rawType !== "user" ||
    event.reason !== "no-recognized-content-blocks"
  ) {
    return null;
  }

  return parseNestedUserTextEchoFromRawData(event.rawData);
}

function parseNestedUserTextEchoFromRuntimeNotice(
  debugJson: string | undefined
): NestedUserTextEcho | null {
  const parsed = tryParseJson(debugJson);
  if (!isRecord(parsed)) {
    return null;
  }

  if (
    parsed.rawType !== "user" ||
    parsed.reason !== "no-recognized-content-blocks"
  ) {
    return null;
  }

  const rawData =
    typeof parsed.rawData === "string" ? parsed.rawData : undefined;
  return parseNestedUserTextEchoFromRawData(rawData);
}

function hasMatchingTaskPromptEcho(
  msg: ComposerMessageState,
  echo: NestedUserTextEcho
): boolean {
  const normalizedEcho = normalizePromptText(echo.text);

  return msg.parts.some((part) => {
    if (part.type !== "task-notice-group") {
      return false;
    }

    const toolUseId = getTaskToolUseId(part.groupKey);
    if (toolUseId !== echo.parentToolUseId) {
      return false;
    }

    const prompt = summarizeTaskNoticeGroup(part).prompt;
    return (
      typeof prompt === "string" &&
      normalizePromptText(prompt) === normalizedEcho
    );
  });
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

function updateTaskToolInGroup(
  msg: ComposerMessageState,
  parentToolUseId: string,
  nextTaskTool: DynamicToolUIPart
): void {
  const { part: group, index: groupIndex } = ensureTaskNoticeGroup(
    msg,
    parentToolUseId
  );
  replaceTaskNoticeGroupAtIndex(msg, groupIndex, {
    ...group,
    parentToolUseId,
    taskTool: nextTaskTool,
  });
  dedupeNestedUserPromptEchoesForGroup(msg, group.groupKey);
}

function appendChildToolEventToGroup(
  msg: ComposerMessageState,
  parentToolUseId: string,
  event: Extract<CliNormalizedEvent, { kind: "tool-input" | "tool-output" | "tool-error" }>
): void {
  const topLevelOwner = findTopLevelGroupContainingChildTool(msg, parentToolUseId);
  if (topLevelOwner) {
    upsertNestedChildTaskGroup(msg, topLevelOwner.index, parentToolUseId, (group) => ({
      ...group,
      childToolEvents: [...(group.childToolEvents ?? []), event],
    }));
    return;
  }

  const { part: group, index: groupIndex } = ensureTaskNoticeGroup(
    msg,
    parentToolUseId
  );
  replaceTaskNoticeGroupAtIndex(msg, groupIndex, {
    ...group,
    parentToolUseId,
    childToolEvents: [...(group.childToolEvents ?? []), event],
  });
}

function dedupeNestedUserPromptEchoesForGroup(
  msg: ComposerMessageState,
  groupKey: string
): void {
  const groupIndex = msg.taskNoticeGroupIndexByKey.get(groupKey);
  const groupPart =
    groupIndex !== undefined ? msg.parts[groupIndex] : undefined;
  if (!groupPart || groupPart.type !== "task-notice-group") {
    return;
  }

  const toolUseId = getTaskToolUseId(groupPart.groupKey);
  const prompt = summarizeTaskNoticeGroup(groupPart).prompt;
  if (!toolUseId || typeof prompt !== "string") {
    return;
  }

  const normalizedPrompt = normalizePromptText(prompt);
  let removed = false;

  msg.parts = msg.parts.filter((part) => {
    if (part.type !== "runtime-notice" || part.code !== "unknown-event") {
      return true;
    }

    const echo = parseNestedUserTextEchoFromRuntimeNotice(part.debugJson);
    if (!echo || echo.parentToolUseId !== toolUseId) {
      return true;
    }

    if (normalizePromptText(echo.text) !== normalizedPrompt) {
      return true;
    }

    removed = true;
    return false;
  });

  if (removed) {
    rebuildTaskNoticeGroupIndex(msg);
  }
}

function buildUsageLimitEscalationMessage(
  event: Extract<CliNormalizedEvent, { kind: "usage-limit" }>,
  severity: UsageLimitSeverity
): string {
  const label = formatUsageLimitWindowLabel(event.window);
  const percentage = formatUsageLimitPercentage(
    typeof event.utilization === "number" ? event.utilization : null
  );

  if (severity === "critical") {
    return event.isUsingOverage
      ? `Over the ${label} — using overage (${percentage} used).`
      : `The ${label} is nearly exhausted — ${percentage} used.`;
  }

  return `Approaching the ${label} — ${percentage} used.`;
}

function groupCodexAgentEvent(
  msg: ComposerMessageState,
  event: CliNormalizedEvent,
  timestamp: number
): boolean {
  if (
    event.kind !== "tool-input" &&
    event.kind !== "tool-output" &&
    event.kind !== "tool-error" &&
    !(event.kind === "runtime-notice" && event.code === "codex-subagent")
  )
    return false;
  if (
    (event.kind === "tool-input" || event.kind === "tool-output" || event.kind === "tool-error") &&
    event.toolFamily !== "codex-collaboration"
  )
    return false;
  const index = msg.parts.findIndex(
    (part) => part.type === "task-notice-group" && part.groupKey === CODEX_AGENT_GROUP_KEY
  );
  const previous = index >= 0 ? msg.parts[index] : undefined;
  const group: TaskNoticeGroupPart =
    previous?.type === "task-notice-group"
      ? previous
      : {
          type: "task-notice-group",
          groupKey: CODEX_AGENT_GROUP_KEY,
          notices: [],
          childTaskNoticeGroups: [],
          childToolEvents: [],
        };
  let next: TaskNoticeGroupPart;
  if (event.kind === "runtime-notice" && event.code === "codex-subagent") {
    const groupKey = getTaskNoticeGroupKey(event);
    if (!groupKey) return false;
    const agents = [...(group.childTaskNoticeGroups ?? [])];
    const agentIndex = agents.findIndex((agent) => agent.groupKey === groupKey);
    const agent: TaskNoticeGroupPart = agents[agentIndex] ?? {
      type: "task-notice-group",
      groupKey,
      notices: [],
      taskId: getTaskNoticeTaskId(event) ?? undefined,
    };
    const updated = { ...agent, notices: [...agent.notices, event] };
    if (agentIndex >= 0) agents[agentIndex] = updated;
    else agents.push(updated);
    next = { ...group, childTaskNoticeGroups: agents };
  } else if (
    event.kind === "tool-input" ||
    event.kind === "tool-output" ||
    event.kind === "tool-error"
  ) {
    if (!event.toolCallId) return false;
    const calls = [...(group.childToolEvents ?? [])];
    const existing = calls.filter((call) => call.toolCallId === event.toolCallId);
    const payload = tryParseJson(
      event.kind === "tool-input"
        ? event.inputJson
        : event.kind === "tool-output"
          ? event.outputJson
          : event.errorText
    );
    if (event.kind === "tool-input") {
      if (existing.some((call) => call.kind !== "tool-input")) return true;
      recordToolStart(msg, event.toolCallId, timestamp);
    } else {
      recordToolEnd(msg, event.toolCallId, timestamp);
      if (!existing.some((call) => call.kind === "tool-input"))
        calls.push({
          kind: "tool-input",
          toolFamily: "codex-collaboration",
          toolCallId: event.toolCallId,
          toolName: `Agent ${isRecord(payload) && typeof payload.tool === "string" ? payload.tool : "collaboration"}`,
          inputJson: JSON.stringify(payload ?? {}),
        });
    }
    const callIndex = calls.findIndex(
      (call) => call.toolCallId === event.toolCallId && call.kind === event.kind
    );
    if (callIndex >= 0) calls[callIndex] = event;
    else calls.push(event);
    next = { ...group, childToolEvents: calls };
  } else return false;
  if (index >= 0) msg.parts[index] = next;
  else msg.parts.push(next);
  return true;
}

function applyEventToMessage(
  msg: ComposerMessageState,
  event: CliNormalizedEvent,
  thread: ThreadComposerContext,
  /**
   * Chunk timestamp used to time tool calls: the agent's emit time when the CLI
   * stamped it, the server's append time otherwise (shared across a batch).
   */
  timestamp: number
): void {
  msg.normalizedEvents.push(event);
  if (groupCodexAgentEvent(msg, event, timestamp)) return;

  switch (event.kind) {
    case "proposed-plan": {
      const index = msg.parts.findIndex((part) => part.type === "proposed-plan" && part.itemId === event.itemId && part.turnId === event.turnId);
      const previous = index >= 0 ? msg.parts[index] : undefined;
      if (previous?.type === "proposed-plan" && previous.state === "completed" && event.phase === "delta") break;
      const part: Extract<CliUiPart, { type: "proposed-plan" }> = {
        type: "proposed-plan", itemId: event.itemId, turnId: event.turnId,
        text: event.phase === "completed" ? event.text : (previous?.type === "proposed-plan" ? previous.text : "") + event.text,
        state: event.phase === "completed" ? "completed" : "streaming",
      };
      if (index >= 0) msg.parts[index] = part;
      else msg.parts.push(part);
      break;
    }
    case "sleep": {
      const index = event.itemId ? msg.parts.findIndex((part) =>
        part.type === "sleep" && part.itemId === event.itemId &&
        part.turnId === event.turnId && part.sessionId === event.sessionId
      ) : -1;
      const previous = index >= 0 ? msg.parts[index] : undefined;
      const existing = previous?.type === "sleep" ? previous : undefined;
      const part: SleepPart = {
        type: "sleep",
        itemId: event.itemId,
        turnId: event.turnId,
        sessionId: event.sessionId,
        state: event.phase === "completed" ? "completed" : existing?.state ?? "sleeping",
        durationMs: existing?.durationMs ?? event.durationMs,
        startedAt: existing?.startedAt ?? event.startedAt,
        completedAt: existing?.completedAt ?? event.completedAt,
      };
      if (index >= 0) msg.parts[index] = part;
      else msg.parts.push(part);
      break;
    }
    case "text":
    case "reasoning":
    case "text-delta":
    case "reasoning-delta":
      applyNarrative(msg, event);
      break;

    case "account-usage": {
      msg.parts.push({ type: "account-usage", usage: event.usage });
      break;
    }

    case "context-window": {
      // Thread-level context-window usage is consumed separately from
      // assistant message part rendering.
      break;
    }

    case "usage-limit": {
      // Usage is state consumed thread-level (footer pill). Inline, only a
      // severity escalation per window surfaces a single muted notice line.
      const severity = getUsageLimitSeverity(event);
      const previous = thread.usageSeverityByWindow.get(event.window) ?? "none";
      thread.usageSeverityByWindow.set(event.window, severity);

      if (USAGE_SEVERITY_RANK[severity] <= USAGE_SEVERITY_RANK[previous]) {
        break;
      }

      addRuntimeNoticePart(msg, {
        code: "usage-limit",
        title: "Usage limit",
        message: buildUsageLimitEscalationMessage(event, severity),
        detailsJson: event.detailsJson,
      });
      break;
    }

    case "tool-progress": {
      // Persisted for a future live tool-progress UI; not rendered yet.
      break;
    }

    case "plan-progress":
    case "plan-step-update": {
      // The plan is thread state, folded into `cliThreads.metadata.plan` at
      // insert time and read by the composer steps chip. It never renders
      // inline: an update per step would bury the stream.
      break;
    }

    case "goal": {
      // Goal state is folded into `cliThreads.metadata.goal` and read by the
      // composer goal button; the transcript shows the paired runtime notices.
      break;
    }

    case "memory-recall": {
      msg.parts.push({
        type: "memory-recall",
        mode: event.mode,
        memories: event.memories,
        detailsJson: event.detailsJson,
      });
      break;
    }

    case "context-compaction": {
      const part: RuntimeNoticePart = {
        type: "runtime-notice",
        code: "context-compaction",
        title: "Context compacted",
        message: event.message,
        detailsJson: event.detailsJson,
        sessionId: event.sessionId,
        ...(event.inProgress ? { pending: true } : {}),
      };

      // One compaction renders one separator: the completed event replaces the
      // pending part in place, and repeated pending events (Claude re-emits
      // `compacting` every 30s as a keepalive, OS-1909) collapse into it.
      // ponytail: matches the latest pending compaction, not item ids —
      // compactions cannot overlap within one message.
      for (let index = msg.parts.length - 1; index >= 0; index -= 1) {
        const existing = msg.parts[index];
        if (
          existing.type === "runtime-notice" &&
          existing.code === "context-compaction" &&
          existing.pending
        ) {
          msg.parts[index] = part;
          return;
        }
      }

      msg.parts.push(part);
      break;
    }

    case "tool-input": {
      // Legacy chunks may lack toolCallId — skip gracefully
      if (!event.toolCallId) break;

      recordToolStart(msg, event.toolCallId, timestamp);

      // A whole-message tool_use block supersedes any streamed deltas for
      // the same in-flight API message.
      removeDeltaParts(msg);

      const input = parseToolInputJson(event.inputJson);

      const part: DynamicToolUIPart = {
        type: "dynamic-tool",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        state: "input-available",
        input,
      };

      if (isTaskToolName(event.toolName)) {
        updateTaskToolInGroup(msg, event.toolCallId, part);
        break;
      }

      if (event.parentToolUseId) {
        appendChildToolEventToGroup(msg, event.parentToolUseId, event);
        break;
      }

      msg.toolPartIndexById.set(event.toolCallId, msg.parts.length);
      msg.parts.push(part);
      break;
    }

    case "tool-output": {
      // Legacy chunks may lack toolCallId — skip gracefully
      if (!event.toolCallId) break;

      recordToolEnd(msg, event.toolCallId, timestamp);

      if (msg.taskNoticeGroupIndexByParentToolUseId.has(event.toolCallId)) {
        const group = getTaskNoticeGroupByParentToolUseId(msg, event.toolCallId);
        const input = group?.taskTool?.input ?? {};
        const nextTaskTool: DynamicToolUIPart = {
          type: "dynamic-tool",
          toolName: group?.taskTool?.toolName ?? "Task",
          toolCallId: event.toolCallId,
          state: "output-available",
          input,
          output: parseToolOutputJson(event.outputJson),
        };
        updateTaskToolInGroup(msg, event.toolCallId, nextTaskTool);
        break;
      }

      const topLevelOwner = findTopLevelGroupContainingChildTool(
        msg,
        event.toolCallId
      );
      const nestedChildGroup = topLevelOwner
        ? getNestedChildTaskGroup(topLevelOwner.group, event.toolCallId)
        : null;
      if (topLevelOwner && nestedChildGroup) {
        const fallbackTaskTool =
          nestedChildGroup.group.taskTool ??
          getChildTaskToolFallback(topLevelOwner.group, event.toolCallId);
        upsertNestedChildTaskGroup(
          msg,
          topLevelOwner.index,
          event.toolCallId,
          (group) => ({
            ...group,
            taskTool: {
              type: "dynamic-tool",
              toolName: fallbackTaskTool?.toolName ?? "Task",
              toolCallId: event.toolCallId!,
              state: "output-available",
              input: fallbackTaskTool?.input ?? group.taskTool?.input ?? {},
              output: parseToolOutputJson(event.outputJson),
            },
          })
        );
        break;
      }

      if (event.parentToolUseId) {
        appendChildToolEventToGroup(msg, event.parentToolUseId, event);
        break;
      }

      const idx = msg.toolPartIndexById.get(event.toolCallId);
      if (idx !== undefined) {
        msg.parts[idx] = {
          ...(msg.parts[idx] as DynamicToolUIPart),
          state: "output-available",
          output: parseToolOutputJson(event.outputJson),
        } as DynamicToolUIPart;
      } else {
        msg.warnings.push(
          `tool-output for unknown toolCallId: ${event.toolCallId}`
        );
      }
      break;
    }

    case "tool-error": {
      // Legacy chunks may lack toolCallId — skip gracefully
      if (!event.toolCallId) break;

      recordToolEnd(msg, event.toolCallId, timestamp);

      if (msg.taskNoticeGroupIndexByParentToolUseId.has(event.toolCallId)) {
        const group = getTaskNoticeGroupByParentToolUseId(msg, event.toolCallId);
        const input = group?.taskTool?.input ?? {};
        const nextTaskTool: DynamicToolUIPart = {
          type: "dynamic-tool",
          toolName: group?.taskTool?.toolName ?? "Task",
          toolCallId: event.toolCallId,
          state: "output-error",
          input,
          errorText: event.errorText,
        };
        updateTaskToolInGroup(msg, event.toolCallId, nextTaskTool);
        break;
      }

      const topLevelOwner = findTopLevelGroupContainingChildTool(
        msg,
        event.toolCallId
      );
      const nestedChildGroup = topLevelOwner
        ? getNestedChildTaskGroup(topLevelOwner.group, event.toolCallId)
        : null;
      if (topLevelOwner && nestedChildGroup) {
        const fallbackTaskTool =
          nestedChildGroup.group.taskTool ??
          getChildTaskToolFallback(topLevelOwner.group, event.toolCallId);
        upsertNestedChildTaskGroup(
          msg,
          topLevelOwner.index,
          event.toolCallId,
          (group) => ({
            ...group,
            taskTool: {
              type: "dynamic-tool",
              toolName: fallbackTaskTool?.toolName ?? "Task",
              toolCallId: event.toolCallId!,
              state: "output-error",
              input: fallbackTaskTool?.input ?? group.taskTool?.input ?? {},
              errorText: event.errorText,
            },
          })
        );
        break;
      }

      if (event.parentToolUseId) {
        appendChildToolEventToGroup(msg, event.parentToolUseId, event);
        break;
      }

      const idx = msg.toolPartIndexById.get(event.toolCallId);
      if (idx !== undefined) {
        msg.parts[idx] = {
          ...(msg.parts[idx] as DynamicToolUIPart),
          state: "output-error",
          errorText: event.errorText,
        } as DynamicToolUIPart;
      } else {
        msg.warnings.push(
          `tool-error for unknown toolCallId: ${event.toolCallId}`
        );
      }
      break;
    }

    case "metadata": {
      if (event.sessionId) {
        msg.metadata.sessionId = event.sessionId;
      }
      if (event.otherJson) {
        try {
          const parsed = JSON.parse(event.otherJson) as Record<
            string,
            unknown
          >;
          Object.assign(msg.metadata, parsed);
          if (parsed.event === "turn/completed" && parsed.status === "interrupted") {
            msg.parts = msg.parts.map((part) =>
              part.type === "sleep" && part.state === "sleeping" &&
              part.turnId === parsed.turnId && part.sessionId === parsed.sessionId
                ? { ...part, state: "interrupted" } : part
            );
          }
        } catch {
          // ignore malformed otherJson
        }
      }
      break;
    }

    case "runtime-notice": {
      addRuntimeNoticePart(
        msg,
        {
          code: event.code,
          title: event.title,
          message: event.message,
          detailsJson: event.detailsJson,
          sessionId: event.sessionId,
        },
        getRuntimeNoticeDebugJson(event)
      );
      break;
    }

    case "warning": {
      msg.warnings.push(`${event.code}: ${event.message}`);
      addRuntimeNoticePart(msg, {
        code: event.code,
        title: "Warning",
        message: event.message,
      }, JSON.stringify(event, null, 2));
      break;
    }

    case "unknown": {
      const nestedUserTextEcho = parseNestedUserTextEchoFromUnknownEvent(event);
      if (
        nestedUserTextEcho &&
        hasMatchingTaskPromptEcho(msg, nestedUserTextEcho)
      ) {
        break;
      }

      msg.warnings.push(`unknown event: ${event.reason} (${event.rawType})`);
      addRuntimeNoticePart(
        msg,
        {
          code: "unknown-event",
          title: "Unsupported CLI event",
          message: `Received ${event.reason} (${event.rawType}).`,
        },
        getUnknownEventDebugJson(event)
      );
      break;
    }
  }
}

/** Apply a batch of rows to an existing composer state. */
export function applyRowsToComposer(
  composer: ComposerState,
  rows: NormalizedChunkRow[]
): ComposerState {
  // Shallow-clone so callers can compare identity for change detection.
  const messages = new Map(composer.messages);
  const thread: ThreadComposerContext = {
    usageSeverityByWindow: new Map(composer.usageSeverityByWindow ?? []),
  };

  // Track which messages have been cloned this batch to avoid double-cloning.
  const cloned = new Set<string>();

  for (const row of rows) {
    const events = expandCliNormalizedEvent(row.event);
    if (events.length === 0) continue;

    let msg = messages.get(row.messageId);
    if (!msg) {
      msg = emptyMessageState();
      messages.set(row.messageId, msg);
      cloned.add(row.messageId);
    } else if (!cloned.has(row.messageId)) {
      // Clone existing state so downstream identity checks (React.memo,
      // useMemo deps) detect the change. (Issue 3: immutability.)
      msg = {
        normalizedEvents: [...msg.normalizedEvents],
        parts: [...msg.parts],
        metadata: { ...msg.metadata },
        warnings: [...msg.warnings],
        toolPartIndexById: new Map(msg.toolPartIndexById),
        toolTimingsByCallId: new Map(msg.toolTimingsByCallId),
        taskNoticeGroupIndexByKey: new Map(msg.taskNoticeGroupIndexByKey),
        taskNoticeGroupIndexByParentToolUseId: new Map(
          msg.taskNoticeGroupIndexByParentToolUseId
        ),
        deltaPartIndices: new Set(msg.deltaPartIndices),
        narrativePartIndexByKey: new Map(msg.narrativePartIndexByKey),
        completedNarrativeKeys: new Set(msg.completedNarrativeKeys),
      };
      messages.set(row.messageId, msg);
      cloned.add(row.messageId);
    }

    for (const event of events) {
      applyEventToMessage(msg, event, thread, row.timestamp);
    }
  }

  return { messages, usageSeverityByWindow: thread.usageSeverityByWindow };
}

/** Build a full composer state from a complete event store snapshot. */
export function initComposerFromStore(store: EventStoreState): ComposerState {
  return applyRowsToComposer({ messages: new Map() }, store.rows);
}

/** A top-level group keyed on a tool call this message has not loaded (OS-2285). */
function isUnanchoredTaskGroup(part: CliUiPart): boolean {
  return (
    part.type === "task-notice-group" &&
    part.groupKey !== CODEX_AGENT_GROUP_KEY &&
    part.taskTool === undefined &&
    getTaskGroupToolUseId(part) !== undefined
  );
}

/**
 * Hide unanchored task groups in a message whose head is not loaded yet; they
 * nest once older chunks load. Spec: docs/specs/cli-thread-message-pagination.md.
 */
export function hideUnanchoredTaskGroups(
  messages: ComposerState["messages"],
  messageId: string | null
): ComposerState["messages"] {
  const msg = messageId ? messages.get(messageId) : undefined;
  if (!messageId || !msg?.parts.some(isUnanchoredTaskGroup)) return messages;
  const next = new Map(messages);
  next.set(messageId, { ...msg, parts: msg.parts.filter((part) => !isUnanchoredTaskGroup(part)) });
  return next;
}
