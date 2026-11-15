import type { UIMessage } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import {
  getNumber,
  getString,
  getToolOutputText,
} from "@/lib/ai-tools/parse-utils";
import { isRecord } from "@/lib/type-guards";

export type GrepOutputMode = "content" | "files_with_matches" | "count";

export type GrepToolPayload = {
  toolName: "Grep";
  toolCallId: string;
  state: "input-available" | "output-available" | "output-error";
  pattern: string;
  path?: string;
  glob?: string;
  outputMode?: GrepOutputMode;
  contextLines?: number;
  headLimit?: number;
  offset?: number;
  resultText?: string;
  resultCount?: number;
  resultLabel?: "lines" | "files" | "matches";
  errorText?: string;
};

const VALID_OUTPUT_MODES = new Set<string>([
  "content",
  "files_with_matches",
  "count",
]);

function isGrepOutputMode(value: unknown): value is GrepOutputMode {
  return typeof value === "string" && VALID_OUTPUT_MODES.has(value);
}

function countNonEmptyLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

function extractFoundCount(text: string): number | undefined {
  const match = text.match(/^Found\s+(\d+)\s+/m);
  if (!match) return undefined;
  const count = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(count) ? count : undefined;
}

function extractResultCount(
  outputMode: GrepOutputMode | undefined,
  rawOutput: unknown,
  resultText: string | undefined
): Pick<GrepToolPayload, "resultCount" | "resultLabel"> {
  if (isRecord(rawOutput)) {
    const numLines = getNumber(rawOutput, "numLines");
    if (numLines !== undefined) {
      return { resultCount: numLines, resultLabel: "lines" };
    }

    const numMatches = getNumber(rawOutput, "numMatches");
    if (numMatches !== undefined) {
      return { resultCount: numMatches, resultLabel: "matches" };
    }

    const numFiles = getNumber(rawOutput, "numFiles");
    if (numFiles !== undefined) {
      return { resultCount: numFiles, resultLabel: "files" };
    }
  }

  if (!resultText || resultText.trim().length === 0) {
    return {};
  }

  const foundCount = extractFoundCount(resultText);
  if (foundCount !== undefined) {
    return {
      resultCount: foundCount,
      resultLabel: outputMode === "count" ? "matches" : "files",
    };
  }

  if (outputMode === "content") {
    return { resultCount: countNonEmptyLines(resultText), resultLabel: "lines" };
  }

  return {};
}

export function parseGrepToolPart(
  part: UIMessage["parts"][number]
): GrepToolPayload | null {
  if (!isDynamicToolUIPart(part)) {
    return null;
  }

  if (part.toolName !== "Grep") {
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

  const outputModeCandidate = rawInput.output_mode;
  const outputMode = isGrepOutputMode(outputModeCandidate)
    ? outputModeCandidate
    : undefined;
  const contextLines =
    getNumber(rawInput, "context") ?? getNumber(rawInput, "-C");
  const path = getString(rawInput, "path");
  const glob = getString(rawInput, "glob");
  const headLimit = getNumber(rawInput, "head_limit");
  const offset = getNumber(rawInput, "offset");

  if (part.state === "output-error") {
    const errorText =
      "errorText" in part && typeof part.errorText === "string"
        ? part.errorText
        : undefined;

    return {
      toolName: "Grep",
      toolCallId: part.toolCallId,
      state: "output-error",
      pattern,
      ...(path ? { path } : {}),
      ...(glob ? { glob } : {}),
      ...(outputMode ? { outputMode } : {}),
      ...(contextLines !== undefined ? { contextLines } : {}),
      ...(headLimit !== undefined ? { headLimit } : {}),
      ...(offset !== undefined ? { offset } : {}),
      ...(errorText ? { errorText } : {}),
    };
  }

  if (part.state === "output-available") {
    const rawOutput = "output" in part ? part.output : undefined;
    const resultText = getToolOutputText(rawOutput, "content");
    const resultCount = extractResultCount(outputMode, rawOutput, resultText);

    return {
      toolName: "Grep",
      toolCallId: part.toolCallId,
      state: "output-available",
      pattern,
      ...(path ? { path } : {}),
      ...(glob ? { glob } : {}),
      ...(outputMode ? { outputMode } : {}),
      ...(contextLines !== undefined ? { contextLines } : {}),
      ...(headLimit !== undefined ? { headLimit } : {}),
      ...(offset !== undefined ? { offset } : {}),
      ...(resultText !== undefined ? { resultText } : {}),
      ...resultCount,
    };
  }

  return {
    toolName: "Grep",
    toolCallId: part.toolCallId,
    state: "input-available",
    pattern,
    ...(path ? { path } : {}),
    ...(glob ? { glob } : {}),
    ...(outputMode ? { outputMode } : {}),
    ...(contextLines !== undefined ? { contextLines } : {}),
    ...(headLimit !== undefined ? { headLimit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
}
