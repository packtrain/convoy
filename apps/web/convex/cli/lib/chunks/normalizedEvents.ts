import { normalizeCliChunk } from "@/convex/cli/lib/runtimes/registry";
import type { Doc } from "../../../_generated/dataModel";
import type { CliNormalizedEvent, CliType } from "../../../lib/contracts/validators";

type RawChunk = { type: string; data: string };

type StoredChunkForRead = Pick<Doc<"cliMessageChunks">, "type" | "data" | "normalizedEvent">;

function safeJsonParse(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Chunks injected by the Convoy CLI bridge itself (not by the agent
 * runtime), e.g. worktree-creation progress. Runtime-agnostic by design so
 * new runtimes get them for free.
 */
const BRIDGE_NOTICE_CHUNK_TYPE = "convoy_notice";

/** A Workflow Bash step's stdout/stderr (OS-1886): plain text, whatever runtime the thread runs. */
export const SCRIPT_OUTPUT_CHUNK_TYPE = "convoy_script_output";

function normalizeBridgeChunk(chunk: RawChunk): CliNormalizedEvent | null {
  if (chunk.type === SCRIPT_OUTPUT_CHUNK_TYPE) {
    return { kind: "text", text: chunk.data };
  }
  if (chunk.type !== BRIDGE_NOTICE_CHUNK_TYPE) {
    return null;
  }

  const parsed = safeJsonParse(chunk.data);
  const obj = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  // Any other fields are the notice's structured payload, e.g. a steered
  // marker's `messageId` or a worktree change's paths (cli-worktrees.md).
  const { code, title, message, ...details } = obj;

  return {
    kind: "runtime-notice",
    code: typeof code === "string" ? code : "convoy-notice",
    title: typeof title === "string" ? title : "Convoy",
    message: typeof message === "string" ? message : chunk.data,
    ...(Object.keys(details).length > 0 ? { detailsJson: JSON.stringify(details) } : {}),
  };
}

export function normalizeCliChunkToEvent(chunk: RawChunk, cliType: CliType = "claude-code"): CliNormalizedEvent {
  const bridgeEvent = normalizeBridgeChunk(chunk);
  if (bridgeEvent) {
    return bridgeEvent;
  }

  return normalizeCliChunk({
    cliType,
    chunk,
  });
}

/**
 * The event to display for a stored chunk. Trusts the stored `normalizedEvent`,
 * except for `result`/`system`/`rate_limit_event`/`auth_status` and `unknown` chunks, whose
 * normalization may have gained a proper mapping since the row was written.
 * Backfills `rawData` when re-normalization is still unknown.
 */
export function resolveChunkReadEvent(chunk: StoredChunkForRead, cliType: CliType | undefined): CliNormalizedEvent | undefined {
  const shouldRenormalize =
    chunk.type === "result" || chunk.type === "system" || chunk.type === "rate_limit_event" || chunk.type === "auth_status" || chunk.normalizedEvent?.kind === "unknown";

  if (!shouldRenormalize) {
    return chunk.normalizedEvent;
  }

  const event = normalizeCliChunkToEvent({ type: chunk.type, data: chunk.data }, cliType ?? "claude-code");

  if (event.kind === "unknown" && event.rawData === undefined) {
    return { ...event, rawData: chunk.data };
  }

  return event;
}

export function normalizeUserChunkToEvent(chunk: RawChunk): CliNormalizedEvent {
  return {
    kind: "text",
    text: chunk.data,
  };
}

export function expandCliNormalizedEvent(event: CliNormalizedEvent | undefined): CliNormalizedEvent[] {
  if (!event) {
    return [];
  }

  if (event.kind !== "metadata" || !event.otherJson) {
    return [event];
  }

  const parsed = safeJsonParse(event.otherJson);
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as Record<string, unknown>).events)
  ) {
    const nested = (parsed as Record<string, unknown>).events as unknown[];
    const valid = nested.filter(
      (value): value is CliNormalizedEvent =>
        typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).kind === "string"
    );
    if (valid.length > 0) {
      return valid;
    }
  }

  return [event];
}
