import type { Id } from "@/convex/_generated/dataModel";
import { canForkReply } from "@/convex/cli/lib/runtimes/registry";
import type { CliType } from "@/convex/lib/contracts/validators";
import {
  parseAskUserQuestionResponse,
  type AskUserQuestionResponsePayload,
} from "@/lib/ai-tools/ask-user-question";

interface ThreadRowMessage {
  _id: Id<"cliMessages">;
  role: "user" | "assistant";
  steeredAt?: number;
}

/**
 * A steered user message is drawn inside the assistant stream at its injection
 * point (the `steered-message` part), never as a row of its own. See
 * `docs/specs/cli-steering.md`.
 */
export function isInlineSteeredMessage(
  message: Pick<ThreadRowMessage, "role" | "steeredAt">
): boolean {
  return message.role === "user" && message.steeredAt !== undefined;
}

function findLatestRow<T extends ThreadRowMessage>(
  messages: T[],
  matches: (message: T) => boolean
): T | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && !isInlineSteeredMessage(message) && matches(message)) {
      return message;
    }
  }
  return undefined;
}

/**
 * The newest message that renders as its own row — the last turn the user
 * actually sees. Anything keyed to "the latest message" must use this rather
 * than the raw envelope tail: a steer is stored after the run it steers into,
 * so an invisible message would otherwise take the latest slot and silently
 * suppress the failure state of the assistant turn below it (OS-1463).
 */
export function findLatestRowMessage<T extends ThreadRowMessage>(messages: T[]): T | undefined {
  return findLatestRow(messages, () => true);
}

/**
 * The newest *user* message that renders as its own row — the one the inline
 * Edit action belongs to. Same rule, same reason: after a steered run the
 * newest user message is the steer, which has no bubble to hang Edit on, so
 * the action would render nowhere.
 */
export function findLatestRowUserMessage<T extends ThreadRowMessage>(
  messages: T[]
): T | undefined {
  return findLatestRow(messages, (message) => message.role === "user");
}

/**
 * Whether a run can be branched at its reply (OS-1397): the assistant menu and
 * the user-row icon share this gate with the fork mutation, so neither offers
 * a fork the server rejects. Spec: docs/specs/cli-thread-fork.md → Runtime gating.
 */
export function canBranchFromReply(reply: {
  cliType: CliType;
  status?: "pending" | "claimed" | "streaming" | "completed" | "failed";
  cliContext?: { continuationId?: string; turnId?: string };
}): boolean {
  return (
    canForkReply(reply.cliType, reply.cliContext) &&
    reply.status !== undefined &&
    reply.status !== "streaming" &&
    reply.cliContext?.continuationId !== undefined
  );
}

/**
 * Where a fork's "Forked from" divider sits (OS-1397): below the copied run's
 * last row. Once that run is rewritten (edit-last, retry) nothing carries its
 * id and the divider is gone. Spec: cli-thread-fork.md.
 */
export function forkDividerAnchor<T extends { _id: Id<"cliMessages">; runId?: string }>(
  messages: readonly T[],
  runId: string | undefined
): Id<"cliMessages"> | null {
  if (runId === undefined) return null;
  return messages.findLast((message) => message.runId === runId)?._id ?? null;
}

/** The parsed AskUserQuestion response per user message, for the bubble swap in the list. */
export function deriveUserMessageResponseMap<T extends ThreadRowMessage>(
  messages: T[],
  userTextById: Map<string, string>
): Map<string, AskUserQuestionResponsePayload> {
  const map = new Map<string, AskUserQuestionResponsePayload>();
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const parsed = parseAskUserQuestionResponse(userTextById.get(message._id) ?? "");
    if (parsed) {
      map.set(message._id, parsed);
    }
  }
  return map;
}

/** A chunkless message that still renders from its envelope: a task-launch prompt or an attachment-only reply (OS-2091). */
export function rendersFromEnvelope(envelope: { role: string; chunkCount: number; attachments: readonly unknown[] }): boolean {
  return envelope.chunkCount === 0 && (envelope.role === "user" || envelope.attachments.length > 0);
}
