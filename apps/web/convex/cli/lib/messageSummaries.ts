import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { agentTextChunkScan, composeAgentMessageTexts } from "./messages/agentText";
import { toMessageSummary, type CliMessageSummary } from "./validators";

/**
 * Loading for the **summary** tier of messages (OS-1627): the shape and its
 * projection live in `validators.ts`; this owns how the text is composed.
 *
 * Sibling of `threadSummaries.ts`. The tier's rules live in
 * `docs/specs/mcp-server.md` under "The summary tier".
 */

/**
 * Summaries for a page of messages, each text composed from one bounded chunk scan.
 *
 * Sized by the messages *found*, not the `limit` asked for: same budget either way,
 * but the request would penalize short threads. `messages` is returned in the order
 * given; nothing here sorts.
 */
export async function enrichMessageSummaries(ctx: QueryCtx, messages: Doc<"cliMessages">[]): Promise<CliMessageSummary[]> {
  const texts = await composeAgentMessageTexts(ctx, messages, agentTextChunkScan(Math.max(1, messages.length)));
  return messages.map((message) => toMessageSummary(message, texts.get(message._id) ?? { text: "", truncated: false }));
}
