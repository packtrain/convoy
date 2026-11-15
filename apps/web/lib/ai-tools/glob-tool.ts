import type { UIMessage } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import {
  getBoolean,
  getNumber,
  getString,
  getToolOutputText,
} from "@/lib/ai-tools/parse-utils";
import { isRecord } from "@/lib/type-guards";

const NO_FILES_FOUND_TEXT = "No files found";
const TRUNCATED_RESULTS_TEXT =
  "(Results are truncated. Consider using a more specific path or pattern.)";
const TRUNCATED_RESULTS_MARKER = "Results are truncated";

export type GlobToolPayload = {
  toolName: "Glob";
  toolCallId: string;
  state: "input-available" | "output-available" | "output-error";
  pattern: string;
  path?: string;
  resultText?: string;
  resultCount?: number;
  truncated?: boolean;
  durationMs?: number;
  errorText?: string;
};

function countFileLines(text: string): number | undefined {
  if (text.trim() === NO_FILES_FOUND_TEXT) {
    return 0;
  }

  const lines = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length > 0 &&
      trimmed !== TRUNCATED_RESULTS_TEXT
    );
  });

  return lines.length;
}

export function parseGlobToolPart(
  part: UIMessage["parts"][number]
): GlobToolPayload | null {
  if (!isDynamicToolUIPart(part)) {
    return null;
  }

  if (part.toolName !== "Glob") {
    return null;
  }

  const rawInput = "input" in part ? part.input : undefined;
  if (!isRecord(rawInput)) {
    return null;
  }

  const pattern = getString(rawInput, "pattern");
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    return null;
  }

  const path = getString(rawInput, "path");

  if (part.state === "output-error") {
    const errorText =
      "errorText" in part && typeof part.errorText === "string"
        ? part.errorText
        : undefined;

    return {
      toolName: "Glob",
      toolCallId: part.toolCallId,
      state: "output-error",
      pattern,
      ...(path ? { path } : {}),
      ...(errorText ? { errorText } : {}),
    };
  }

  if (part.state === "output-available") {
    const rawOutput = "output" in part ? part.output : undefined;
    const resultText = getToolOutputText(rawOutput, "filenames");
    const structuredCount = isRecord(rawOutput)
      ? getNumber(rawOutput, "numFiles")
      : undefined;
    const resultCount =
      structuredCount ?? (resultText ? countFileLines(resultText) : undefined);
    const truncated = isRecord(rawOutput)
      ? getBoolean(rawOutput, "truncated")
      : resultText?.includes(TRUNCATED_RESULTS_MARKER) || undefined;
    const durationMs = isRecord(rawOutput)
      ? getNumber(rawOutput, "durationMs")
      : undefined;

    return {
      toolName: "Glob",
      toolCallId: part.toolCallId,
      state: "output-available",
      pattern,
      ...(path ? { path } : {}),
      ...(resultText !== undefined ? { resultText } : {}),
      ...(resultCount !== undefined ? { resultCount } : {}),
      ...(truncated !== undefined ? { truncated } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }

  return {
    toolName: "Glob",
    toolCallId: part.toolCallId,
    state: "input-available",
    pattern,
    ...(path ? { path } : {}),
  };
}
