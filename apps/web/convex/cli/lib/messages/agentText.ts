/** Plain text for external readers, using normalized source labels and bounded scans. */

import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { expandCliNormalizedEvent } from "../chunks/normalizedEvents";
import { isForeignNarrativeSource } from "../../../lib/contracts/validators";
import { clampChars } from "../../../lib/shared/strings";
import { listLatestStoredChunksByMessage } from "../cliMessageChunksRepo";

type Ctx = QueryCtx | MutationCtx;

/** Chars emitted per message before `truncated` is set. */
export const AGENT_TEXT_CHARS = 4000;

/** Stored (non-ephemeral) chunk rows scanned per message, before the derivation below. */
export const AGENT_TEXT_CHUNK_SCAN = 40;

/**
 * Chunk rows one request may scan across all its messages. Mirrors
 * `WINDOW_CHUNK_BUDGET` in `cli/messageChunks.ts`: a page size must not multiply
 * the per-item cap past Convex's per-query scan limit.
 */
export const AGENT_TEXT_CHUNK_BUDGET = 400;

/**
 * Chunks to scan per message for a page of `messageLimit` messages. Derived
 * rather than flat: 20 messages × a flat 40 would double the budget. At 10 the
 * two agree, so this only tightens larger pages.
 */
export function agentTextChunkScan(messageLimit: number): number {
  return Math.max(1, Math.min(AGENT_TEXT_CHUNK_SCAN, Math.floor(AGENT_TEXT_CHUNK_BUDGET / messageLimit)));
}

export type AgentMessageText = {
  text: string;
  /** Text was dropped — by the chunk scan, the char cap, or both. */
  truncated: boolean;
};

/**
 * The agent-visible text of one chunk row, or null when it carries none: a
 * non-blank text, completed proposal or goal notice, excluding ephemeral rows.
 */
export function chunkAgentText(
  chunk: Pick<Doc<"cliMessageChunks">, "ephemeral" | "normalizedEvent">
): string | null {
  if (chunk.ephemeral === true) return null;
  const text = expandCliNormalizedEvent(chunk.normalizedEvent)
    .flatMap((entry) => {
      // Goal notices stand in for Claude's `/goal` reply text (OS-2276).
      if (entry.kind === "runtime-notice" && entry.code.startsWith("goal-")) return [`${entry.title}: ${entry.message}`];
      if (entry.kind !== "text" && !(entry.kind === "proposed-plan" && entry.phase === "completed"))
        return [];
      if (entry.kind === "text" && isForeignNarrativeSource(entry.source)) return [];
      return entry.text.trim() ? [entry.text.trim()] : [];
    })
    .join("\n\n");
  return text || null;
}

/**
 * Compose one message's text from at most `chunkScan` of its stored chunk rows.
 *
 * Scans the message's **tail** — an overflowing run's conclusion matters more
 * than its opening, as the notification preview also assumes — then restores
 * conversation order, so the char cap cuts the end.
 */
export async function composeAgentMessageText(
  ctx: Ctx,
  message: Pick<Doc<"cliMessages">, "_id" | "threadId">,
  chunkScan: number
): Promise<AgentMessageText> {
  // One over the cap: never emitted, it only proves older rows exist.
  const rows = await listLatestStoredChunksByMessage(
    ctx,
    message.threadId,
    message._id,
    chunkScan + 1
  );
  const scanned = rows.slice(0, chunkScan);
  const scanTruncated = rows.length > chunkScan;

  const parts: string[] = [];
  for (const chunk of scanned.reverse()) {
    const text = chunkAgentText(chunk);
    if (text !== null) {
      parts.push(text);
    }
  }

  const composed = parts.join("\n\n");
  const charsTruncated = composed.length > AGENT_TEXT_CHARS;

  return {
    // `clampChars`, not `slice`: an emoji or other astral character sitting on the
    // cap would otherwise be cut in half and ship a lone surrogate.
    text: clampChars(composed, AGENT_TEXT_CHARS),
    // Means "rows went unread", not "prose was dropped" — so it fires often on
    // tool-heavy runs. Narrowing it to "the overflow row held text" would be
    // wrong: that row says nothing about the rows behind it.
    truncated: charsTruncated || scanTruncated,
  };
}

/** Compose text for a page of messages, one bounded scan each. */
export async function composeAgentMessageTexts(
  ctx: Ctx,
  messages: Doc<"cliMessages">[],
  chunkScan: number
): Promise<Map<Id<"cliMessages">, AgentMessageText>> {
  const entries = await Promise.all(
    messages.map(
      async (message) =>
        [
          message._id,
          await composeAgentMessageText(ctx, message, chunkScan),
        ] as const
    )
  );
  return new Map(entries);
}
