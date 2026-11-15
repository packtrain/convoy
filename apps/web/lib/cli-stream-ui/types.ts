import type { DynamicToolUIPart, UIMessage } from "ai";
import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import type { Id } from "@/convex/_generated/dataModel";

/** A single row as returned by the cli/messageChunks list queries. */
export type NormalizedChunkRow = {
  messageId: Id<"cliMessages">;
  threadId: Id<"cliThreads">;
  createdAt: number;
  chunkOrder: number;
  timestamp: number;
  event: CliNormalizedEvent | undefined;
};

/** Re-derive the part union from the ai package's UIMessage type. */
export type UIMessagePart = UIMessage["parts"][number];

export type ComposerNotice = {
  code: string;
  title: string;
  message: string;
  detailsJson?: string;
  sessionId?: string;
};

export type RuntimeNoticePart = ComposerNotice & {
  type: "runtime-notice";
  debugJson?: string;
  /** Still running (e.g. codex compaction between item/started and item/completed). */
  pending?: boolean;
};

/**
 * Memories the agent recalled into the turn. Carries the list rather than a
 * pre-rendered sentence because the renderer decides what to show per entry
 * (inline body when the provider shipped one, otherwise the file path).
 */
export type MemoryRecallPart = {
  type: "memory-recall";
  mode: "files" | "synthesis";
  memories: Array<{
    path?: string;
    scope?: "personal" | "team";
    content?: string;
  }>;
  detailsJson?: string;
};

export type SleepPart = Omit<Extract<CliNormalizedEvent, { kind: "sleep" }>, "kind" | "phase"> & {
  type: "sleep";
  state: "sleeping" | "completed" | "interrupted" | "ended";
};

export type TaskNoticeGroupToolEvent = Extract<
  CliNormalizedEvent,
  { kind: "tool-input" | "tool-output" | "tool-error" }
>;

export const CODEX_AGENT_GROUP_KEY = "codex-agents";

export type TaskNoticeGroupPart = {
  type: "task-notice-group";
  groupKey: string;
  parentToolUseId?: string;
  /**
   * Claude `task_id` this group tracks. `task_updated` patches carry no
   * `tool_use_id`, so they can only be correlated on this.
   */
  taskId?: string;
  notices: ComposerNotice[];
  taskTool?: DynamicToolUIPart;
  childToolEvents?: TaskNoticeGroupToolEvent[];
  childTaskNoticeGroups?: TaskNoticeGroupPart[];
  runStatus?: "completed" | "failed";
};

export type ProposedPlanPart = Omit<Extract<CliNormalizedEvent, { kind: "proposed-plan" }>, "kind" | "phase"> & {
  type: "proposed-plan";
  state: "streaming" | "completed";
};

export type CliUiPart =
  | { type: "account-usage"; usage: Extract<CliNormalizedEvent, { kind: "account-usage" }>["usage"] }
  | ProposedPlanPart
  | UIMessagePart
  | RuntimeNoticePart
  | TaskNoticeGroupPart
  | MemoryRecallPart
  | SleepPart;

/**
 * Span of a single tool call, taken from the chunk timestamps of its
 * `tool-input` / `tool-output` / `tool-error` events — agent emit time when the
 * CLI stamped the chunk, server append time otherwise. `endedAt` stays
 * undefined while the call is in flight (or when it never produced a result).
 */
export type ToolCallTiming = {
  startedAt: number;
  endedAt?: number;
};

export type CliRenderMessage = Omit<UIMessage, "parts"> & {
  parts: CliUiPart[];
};

/** Renderable state for a single assistant message, built from normalized events. */
export type ComposerMessageState = {
  normalizedEvents: CliNormalizedEvent[];
  parts: CliUiPart[];
  metadata: Record<string, unknown>;
  warnings: string[];
  toolPartIndexById: Map<string, number>;
  /** Per-tool-call wall-clock spans, keyed by `toolCallId` (index-independent). */
  toolTimingsByCallId: Map<string, ToolCallTiming>;
  taskNoticeGroupIndexByKey: Map<string, number>;
  taskNoticeGroupIndexByParentToolUseId: Map<string, number>;
  /**
   * Indices of parts built from text-delta/reasoning-delta events; removed
   * when the final whole message content arrives and supersedes them.
   */
  deltaPartIndices: Set<number>;
  narrativePartIndexByKey: Map<string, number>;
  completedNarrativeKeys: Set<string>;
};

export type UsageLimitSeverity = "none" | "warning" | "critical";

/** Top-level composer state keyed by messageId. */
export type ComposerState = {
  messages: Map<string, ComposerMessageState>;
  /**
   * Last seen usage-limit severity per rate-limit window. Used to emit an
   * inline notice only when a thread escalates into a worse severity tier.
   */
  usageSeverityByWindow?: Map<string, UsageLimitSeverity>;
};

/** Ordered event store holding all received chunk rows. */
export type EventStoreState = {
  rows: NormalizedChunkRow[];
  dedupKeys: Set<string>;
  cursor: {
    createdAt: number;
    messageId: Id<"cliMessages">;
    chunkOrder: number;
  } | null;
};

/** Shape of the delta page returned by the server query. */
export type DeltaPage = {
  page: NormalizedChunkRow[];
  nextCursor: {
    createdAt: number;
    messageId: Id<"cliMessages">;
    chunkOrder: number;
  } | null;
  resetRequired: boolean;
};
