import type { CliUiPart } from "@/lib/cli-stream-ui";
import { formatFileSize } from "@/lib/tasks/files";

/**
 * The envelope fields the export reads. Structural on purpose: the builder is
 * pure and its tests should not have to shape a whole message envelope.
 */
export interface ThreadExportEnvelope {
  _id: string;
  role: "user" | "assistant";
  createdAt: number;
  status?: string;
  errorMessage?: string;
  /** Another thread's agent posted this message (OS-1631). */
  sentBy?: { kind: "thread"; threadId: string };
  attachments?: Array<{ fileName: string; fileSize: number }>;
}

export interface ThreadMarkdownInput {
  title: string;
  taskRef?: string;
  /** CLI runtime label, e.g. "Claude Code" — also the assistant's author name. */
  cliLabel?: string;
  exportedAt: number;
  /** `hasOlderEnvelopes`: history no amount of pagination can reach (OS-1600). */
  hasUnreachableHistory: boolean;
  /** Oldest-first. */
  envelopes: ThreadExportEnvelope[];
  partsByMessageId: Map<string, { parts: CliUiPart[] }>;
  userTextById: Map<string, string>;
}

const AGENT_FALLBACK_LABEL = "Agent";

/** UTC, so the document doesn't depend on the exporting machine's zone. */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function authorLabel(
  envelope: ThreadExportEnvelope,
  cliLabel: string | undefined
): string {
  if (envelope.role === "assistant") {
    return cliLabel ?? AGENT_FALLBACK_LABEL;
  }

  return envelope.sentBy ? "Another agent" : "You";
}

function messageText(
  envelope: ThreadExportEnvelope,
  input: ThreadMarkdownInput
): string {
  if (envelope.role === "user") {
    return (input.userTextById.get(envelope._id) ?? "").trim();
  }

  // Text parts only: tool calls, reasoning and cards are the trace, not the
  // conversation (docs/specs/cli-thread-markdown-export.md).
  return (input.partsByMessageId.get(envelope._id)?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
}

function authorLine(
  envelope: ThreadExportEnvelope,
  input: ThreadMarkdownInput,
  withMessageId: boolean
): string {
  const line = `**${authorLabel(envelope, input.cliLabel)}** · ${formatTimestamp(envelope.createdAt)}`;
  return withMessageId ? `${line} · message ${envelope._id}` : line;
}

/** One turn's block, or null when the message contributes nothing readable. */
function renderTurn(
  envelope: ThreadExportEnvelope,
  input: ThreadMarkdownInput,
  withMessageId = false
): string | null {
  const body: string[] = [];
  const text = messageText(envelope, input);
  if (text.length > 0) {
    body.push(text);
  }

  if (envelope.status === "failed" && envelope.errorMessage) {
    body.push(`_Run failed: ${envelope.errorMessage}_`);
  }

  const attachments = envelope.attachments ?? [];
  if (attachments.length > 0) {
    body.push(
      `Attachments: ${attachments
        .map(
          (attachment) =>
            `\`${attachment.fileName}\` (${formatFileSize(attachment.fileSize)})`
        )
        .join(", ")}`
    );
  }

  if (body.length === 0) {
    return null;
  }

  return [authorLine(envelope, input, withMessageId), ...body].join("\n\n");
}

/**
 * The exported conversation. Turns are `---` + a bold author line rather than
 * headings: message bodies carry their own `#` headings and would outrank a
 * turn header. Spec: docs/specs/cli-thread-markdown-export.md
 */
export function buildThreadMarkdown(input: ThreadMarkdownInput): string {
  const turns = input.envelopes.flatMap((envelope) => {
    const turn = renderTurn(envelope, input);
    return turn ? [turn] : [];
  });

  return assembleDocument(input, turns);
}

function assembleDocument(input: ThreadMarkdownInput, turns: string[]): string {
  const meta = [
    input.taskRef ? `\`${input.taskRef}\`` : null,
    input.cliLabel ?? null,
    `${turns.length} message${turns.length === 1 ? "" : "s"}`,
    `exported ${formatTimestamp(input.exportedAt)} UTC`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  const blocks = [`# ${input.title}`, meta];
  if (input.hasUnreachableHistory) {
    blocks.push(
      "> Earlier messages are outside the loaded window and were not exported."
    );
  }
  turns.forEach((turn) => {
    blocks.push("---", turn);
  });

  return `${blocks.join("\n\n")}\n`;
}

export function threadMarkdownFileName(
  title: string,
  exportedAt: number,
  prefix = "thread"
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const date = new Date(exportedAt).toISOString().slice(0, 10);

  return `${prefix}-${slug ? `${slug}-` : ""}${date}.md`;
}

/** About 16k tokens. Spec: docs/specs/cli-thread-handoff.md → Size cap. */
export const HANDOFF_BYTE_CAP = 64_000;

const utf8 = new TextEncoder();
const byteLength = (text: string) => utf8.encode(text).length;

/**
 * The handoff transcript: every turn tagged `message <id>`. Over the cap,
 * middle assistant replies become stubs pointing into `full`, oldest first;
 * `full` is null when nothing was omitted.
 */
export function buildHandoffMarkdown(
  input: ThreadMarkdownInput & { fullFileName: string; byteCap?: number }
): { capped: string; full: string | null } {
  const rendered = input.envelopes.flatMap((envelope) => {
    const turn = renderTurn(envelope, input, true);
    return turn ? [{ envelope, turn }] : [];
  });
  const turns = rendered.map(({ turn }) => turn);
  const full = assembleDocument(input, turns);
  let bytes = byteLength(full);
  const cap = input.byteCap ?? HANDOFF_BYTE_CAP;
  if (bytes <= cap) {
    return { capped: full, full: null };
  }

  // First and last replies stay, like every user message.
  const replies = rendered.flatMap((entry, index) =>
    entry.envelope.role === "assistant" ? [{ ...entry, index }] : []
  );
  let omitted = 0;
  for (const { envelope, turn, index } of replies.slice(1, -1)) {
    if (bytes <= cap) break;
    const stub = [
      authorLine(envelope, input, true),
      `_Reply omitted (${formatFileSize(byteLength(turn))}). Search ${input.fullFileName} for "message ${envelope._id}"._`,
    ].join("\n\n");
    const saved = byteLength(turn) - byteLength(stub);
    // A reply shorter than its stub stays: stubbing it would grow the file.
    if (saved <= 0) continue;
    bytes -= saved;
    turns[index] = stub;
    omitted += 1;
  }

  return omitted > 0
    ? { capped: assembleDocument(input, turns), full }
    : { capped: full, full: null };
}

/** The editable message a handoff seeds above its files. */
export function buildHandoffDraftText({
  title,
  threadUrl,
  cliLabel,
  replyAt,
  fullFileName,
}: {
  title: string;
  threadUrl: string;
  cliLabel: string;
  replyAt: number;
  /** Set when replies were omitted and the full transcript is attached too. */
  fullFileName?: string;
}): string {
  const text =
    `Continue the work from the attached handoff. It holds the conversation from the thread "${title}" (${threadUrl}), ` +
    `run by ${cliLabel}, through ${formatTimestamp(replyAt)} UTC. Tool calls, tool output and reasoning are left out. ` +
    "Read the files you need from the working directory.";
  return fullFileName
    ? `${text} Some replies are shortened to a stub; look them up in ${fullFileName}.`
    : text;
}
