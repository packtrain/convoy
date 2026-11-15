import type { UIMessage } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import { getBoolean, getString } from "@/lib/ai-tools/parse-utils";
import { isRecord } from "@/lib/type-guards";

/**
 * Set of tool names that should be rendered as terminal output.
 * Extensible for future CLI types (e.g. Codex shell commands).
 */
const TERMINAL_TOOL_NAMES = new Set([
  "bash",
  "shell",
  "terminal",
]);

function isTerminalToolName(value: string): boolean {
  return TERMINAL_TOOL_NAMES.has(value.toLowerCase());
}

export type TerminalToolPayload = {
  toolName: string;
  toolCallId: string;
  command: string;
  description?: string;
  state: "input-available" | "output-available" | "output-error";
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  errorText?: string;
};

export function parseTerminalToolPart(
  part: UIMessage["parts"][number]
): TerminalToolPayload | null {
  if (!isDynamicToolUIPart(part)) {
    return null;
  }

  if (!isTerminalToolName(part.toolName)) {
    return null;
  }

  const rawInput = "input" in part ? part.input : undefined;
  if (!isRecord(rawInput)) {
    return null;
  }

  const command = getString(rawInput, "command");
  if (typeof command !== "string" || command.trim().length === 0) {
    return null;
  }

  const description = getString(rawInput, "description");

  if (part.state === "output-error") {
    const errorText =
      "errorText" in part && typeof part.errorText === "string"
        ? part.errorText
        : undefined;

    return {
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      command,
      ...(description ? { description } : {}),
      state: "output-error",
      ...(errorText ? { errorText } : {}),
    };
  }

  if (part.state === "output-available") {
    const rawOutput = "output" in part ? part.output : undefined;
    let stdout: string | undefined;
    let stderr: string | undefined;
    let interrupted: boolean | undefined;

    if (isRecord(rawOutput)) {
      stdout = getString(rawOutput, "stdout");
      stderr = getString(rawOutput, "stderr");
      interrupted = getBoolean(rawOutput, "interrupted");
    } else if (typeof rawOutput === "string") {
      stdout = rawOutput;
    }

    return {
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      command,
      ...(description ? { description } : {}),
      state: "output-available",
      ...(stdout ? { stdout } : {}),
      ...(stderr ? { stderr } : {}),
      ...(interrupted !== undefined ? { interrupted } : {}),
    };
  }

  // input-available (pending/streaming)
  return {
    toolName: part.toolName,
    toolCallId: part.toolCallId,
    command,
    ...(description ? { description } : {}),
    state: "input-available",
  };
}

/**
 * Build the full terminal text for copy/download.
 */
export function buildTerminalText(payload: TerminalToolPayload): string {
  const lines: string[] = [`$ ${payload.command}`];

  if (payload.stdout) {
    lines.push(payload.stdout);
  }

  if (payload.stderr) {
    lines.push(payload.stderr);
  }

  if (payload.errorText) {
    lines.push(payload.errorText);
  }

  if (payload.interrupted) {
    lines.push("[Interrupted]");
  }

  return lines.join("\n");
}
