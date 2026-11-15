import type { UIMessage } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import { getNumber, getString } from "@/lib/ai-tools/parse-utils";
import { getFilenameFromPath } from "@/lib/path-display";
import { isRecord } from "@/lib/type-guards";

const FILE_CHANGE_TOOL_NAMES = new Set(["edit", "write", "read"]);

function isFileChangeToolName(value: string): boolean {
  return FILE_CHANGE_TOOL_NAMES.has(value.toLowerCase());
}

export type StructuredPatchHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type FileChangeLineCounts = {
  additions: number;
  deletions: number;
};

export type FileChangeToolPayload = {
  toolName: string;
  toolCallId: string;
  filePath: string;
  state: "input-available" | "output-available" | "output-error";
  /** Edit-specific: unified diff hunks */
  structuredPatch?: StructuredPatchHunk[];
  /** Edit-specific fallback when structured patches are unavailable */
  oldString?: string;
  newString?: string;
  outputText?: string;
  /** Write/Read-specific: file contents */
  content?: string;
  /** Read-specific: partial read metadata */
  startLine?: number;
  totalLines?: number;
  /** Read-specific: input offset/limit */
  offset?: number;
  limit?: number;
  errorText?: string;
};

/**
 * Matches a Read line-number prefix: `   12→` (legacy) or `12\t` (compact).
 * Claude Code emits whichever form the `compact_line_prefix` flag selects, and
 * stored history can hold either, so both must be recognized.
 */
const LINE_NUMBER_PREFIX = /^\s*(\d+)[→\t]/;

/**
 * Strip Read tool line-number prefixes from plain-string output, so numbers come from
 * the viewer's gutter instead of appearing twice.
 *
 * Removed only when the numbered lines form one contiguous, strictly incrementing run —
 * otherwise the digits are the file's own content (e.g. a numeric-first-column TSV).
 * Unnumbered lines around the run are kept; Claude wraps Read output in
 * `<system-reminder>` blocks that aren't part of the file.
 */
function stripLineNumberPrefixes(text: string): string {
  const lines = text.split("\n");
  let previousNumber: number | undefined;
  let runEnded = false;

  for (const line of lines) {
    const match = LINE_NUMBER_PREFIX.exec(line);
    if (!match) {
      // A gap after the run started means the numbering is not one block.
      if (previousNumber !== undefined) runEnded = true;
      continue;
    }
    if (runEnded) return text;

    const lineNumber = Number(match[1]);
    if (previousNumber !== undefined && lineNumber !== previousNumber + 1) {
      return text;
    }
    previousNumber = lineNumber;
  }

  if (previousNumber === undefined) return text;

  return lines
    .map((line) => line.replace(LINE_NUMBER_PREFIX, ""))
    .join("\n");
}

function parseStructuredPatch(raw: unknown): StructuredPatchHunk[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const hunks: StructuredPatchHunk[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const oldStart = typeof item.oldStart === "number" ? item.oldStart : undefined;
    const oldLines = typeof item.oldLines === "number" ? item.oldLines : undefined;
    const newStart = typeof item.newStart === "number" ? item.newStart : undefined;
    const newLines = typeof item.newLines === "number" ? item.newLines : undefined;
    const lines = Array.isArray(item.lines) ? item.lines.filter((l): l is string => typeof l === "string") : undefined;
    if (oldStart === undefined || oldLines === undefined || newStart === undefined || newLines === undefined || !lines) {
      continue;
    }
    hunks.push({ oldStart, oldLines, newStart, newLines, lines });
  }
  return hunks.length > 0 ? hunks : undefined;
}

function extractFilePathFromInput(rawInput: Record<string, unknown>): string | undefined {
  return getString(rawInput, "file_path") ?? getString(rawInput, "filePath") ?? getString(rawInput, "path");
}

function parseEditOutput(
  rawOutput: unknown,
  inputFilePath: string,
  rawInput: Record<string, unknown>
): Omit<FileChangeToolPayload, "toolName" | "toolCallId" | "state"> {
  const result: Omit<FileChangeToolPayload, "toolName" | "toolCallId" | "state"> = { filePath: inputFilePath };

  const oldString =
    getString(rawInput, "old_string") ?? getString(rawInput, "oldString");
  const newString =
    getString(rawInput, "new_string") ?? getString(rawInput, "newString");

  if (oldString !== undefined) result.oldString = oldString;
  if (newString !== undefined) result.newString = newString;

  if (!isRecord(rawOutput)) {
    if (typeof rawOutput === "string") {
      result.outputText = rawOutput;
    }
    return result;
  }

  const outputFilePath = getString(rawOutput, "filePath");
  if (outputFilePath) result.filePath = outputFilePath;

  result.structuredPatch = parseStructuredPatch(rawOutput.structuredPatch);

  const outputOldString = getString(rawOutput, "oldString");
  if (outputOldString !== undefined) result.oldString = outputOldString;

  const outputNewString = getString(rawOutput, "newString");
  if (outputNewString !== undefined) result.newString = outputNewString;

  const outputText = getString(rawOutput, "message");
  if (outputText !== undefined) result.outputText = outputText;

  return result;
}

function parseWriteOutput(rawOutput: unknown, inputFilePath: string, rawInput: Record<string, unknown>): Omit<FileChangeToolPayload, "toolName" | "toolCallId" | "state"> {
  const result: Omit<FileChangeToolPayload, "toolName" | "toolCallId" | "state"> = { filePath: inputFilePath };

  // Content comes from input for Write
  const content = getString(rawInput, "content");
  if (content) result.content = content;

  if (isRecord(rawOutput)) {
    const outputFilePath = getString(rawOutput, "filePath");
    if (outputFilePath) result.filePath = outputFilePath;
  }

  return result;
}

function parseReadOutput(rawOutput: unknown, inputFilePath: string): Omit<FileChangeToolPayload, "toolName" | "toolCallId" | "state"> {
  const result: Omit<FileChangeToolPayload, "toolName" | "toolCallId" | "state"> = { filePath: inputFilePath };

  // Structured format: output.file.content
  if (isRecord(rawOutput)) {
    const file = rawOutput.file;
    if (isRecord(file)) {
      const filePath = getString(file, "filePath");
      if (filePath) result.filePath = filePath;
      const content = getString(file, "content");
      if (content) result.content = content;
      result.startLine = getNumber(file, "startLine");
      result.totalLines = getNumber(file, "totalLines");
      return result;
    }
  }

  // Plain string format with line-number prefixes
  if (typeof rawOutput === "string") {
    result.content = stripLineNumberPrefixes(rawOutput);
  }

  return result;
}

export function parseFileChangeToolPart(
  part: UIMessage["parts"][number]
): FileChangeToolPayload | null {
  if (!isDynamicToolUIPart(part)) return null;
  if (!isFileChangeToolName(part.toolName)) return null;

  const rawInput = "input" in part ? part.input : undefined;
  if (!isRecord(rawInput)) return null;

  const inputFilePath = extractFilePathFromInput(rawInput);
  if (!inputFilePath) return null;

  const lowerToolName = part.toolName.toLowerCase();

  if (part.state === "output-error") {
    const errorText =
      "errorText" in part && typeof part.errorText === "string"
        ? part.errorText
        : undefined;
    return {
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      filePath: inputFilePath,
      state: "output-error",
      ...(errorText ? { errorText } : {}),
    };
  }

  if (part.state === "output-available") {
    const rawOutput = "output" in part ? part.output : undefined;

    let parsed: Omit<FileChangeToolPayload, "toolName" | "toolCallId" | "state">;
    if (lowerToolName === "edit") {
      parsed = parseEditOutput(rawOutput, inputFilePath, rawInput);
    } else if (lowerToolName === "write") {
      parsed = parseWriteOutput(rawOutput, inputFilePath, rawInput);
    } else {
      parsed = parseReadOutput(rawOutput, inputFilePath);
      // Capture offset/limit from input for line number display
      const offset = getNumber(rawInput, "offset");
      const limit = getNumber(rawInput, "limit");
      if (offset !== undefined) parsed.offset = offset;
      if (limit !== undefined) parsed.limit = limit;
    }

    return {
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      state: "output-available",
      ...parsed,
    };
  }

  // input-available (pending/streaming)
  return {
    toolName: part.toolName,
    toolCallId: part.toolCallId,
    filePath: inputFilePath,
    state: "input-available",
  };
}

/**
 * Build a fake unified diff for a Read result so PatchDiff renders correct line numbers.
 * All lines are context lines (space-prefixed), so no red/green coloring.
 */
export function buildReadPatch(filePath: string, content: string, offset: number): string {
  const lines = content.split("\n");
  const lineCount = lines.length;
  const contextLines = lines.map((line) => ` ${line}`).join("\n");
  return `--- a/${filePath}\n+++ b/${filePath}\n@@ -${offset},${lineCount} +${offset},${lineCount} @@\n${contextLines}\n`;
}

/**
 * Build a unified diff string from structured patch hunks.
 */
export function buildUnifiedDiff(filePath: string, hunks: StructuredPatchHunk[]): string {
  const header = `--- a/${filePath}\n+++ b/${filePath}`;
  const body = hunks
    .map((hunk) => {
      const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
      return [hunkHeader, ...hunk.lines].join("\n");
    })
    .join("\n");
  return `${header}\n${body}\n`;
}

function splitDiffLines(value: string): string[] {
  return value.split("\n");
}

function countEditableLines(value: string): number {
  return value.length === 0 ? 0 : splitDiffLines(value).length;
}

function getCommonPrefixLength(oldLines: string[], newLines: string[]): number {
  const max = Math.min(oldLines.length, newLines.length);
  for (let index = 0; index < max; index += 1) {
    if (oldLines[index] !== newLines[index]) return index;
  }
  return max;
}

function getCommonSuffixLength(
  oldLines: string[],
  newLines: string[],
  prefixLength: number
): number {
  const max = Math.min(oldLines.length, newLines.length) - prefixLength;
  for (let offset = 0; offset < max; offset += 1) {
    const oldLine = oldLines[oldLines.length - 1 - offset];
    const newLine = newLines[newLines.length - 1 - offset];
    if (oldLine !== newLine) return offset;
  }
  return max;
}

function buildReplacementHunkLines(oldString: string, newString: string): string[] {
  const oldLines = oldString.length === 0 ? [] : splitDiffLines(oldString);
  const newLines = newString.length === 0 ? [] : splitDiffLines(newString);
  const prefixLength = getCommonPrefixLength(oldLines, newLines);
  const suffixLength = getCommonSuffixLength(oldLines, newLines, prefixLength);
  const oldChangeEnd =
    suffixLength > 0 ? oldLines.length - suffixLength : oldLines.length;
  const newChangeEnd =
    suffixLength > 0 ? newLines.length - suffixLength : newLines.length;

  return [
    ...oldLines.slice(0, prefixLength).map((line) => ` ${line}`),
    ...oldLines.slice(prefixLength, oldChangeEnd).map((line) => `-${line}`),
    ...newLines.slice(prefixLength, newChangeEnd).map((line) => `+${line}`),
    ...oldLines.slice(oldChangeEnd).map((line) => ` ${line}`),
  ];
}

export function buildReplacementPatch(
  filePath: string,
  oldString: string,
  newString: string
): string {
  const hunkLines = buildReplacementHunkLines(oldString, newString);
  const oldLineCount = countEditableLines(oldString);
  const newLineCount = countEditableLines(newString);

  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${oldLineCount} +1,${newLineCount} @@`,
    ...hunkLines,
    "",
  ].join("\n");
}

export function countStructuredPatchLines(
  hunks: StructuredPatchHunk[] | undefined
): FileChangeLineCounts | null {
  if (!hunks || hunks.length === 0) return null;

  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions += 1;
      if (line.startsWith("-")) deletions += 1;
    }
  }

  return { additions, deletions };
}

export function countReplacementLines(
  oldString: string | undefined,
  newString: string | undefined
): FileChangeLineCounts | null {
  if (oldString === undefined && newString === undefined) return null;
  const hunkLines = buildReplacementHunkLines(oldString ?? "", newString ?? "");

  return {
    additions: hunkLines.filter((line) => line.startsWith("+")).length,
    deletions: hunkLines.filter((line) => line.startsWith("-")).length,
  };
}

export function getFileChangeLineCounts(
  payload: FileChangeToolPayload
): FileChangeLineCounts | null {
  if (payload.toolName.toLowerCase() !== "edit") return null;

  return (
    countStructuredPatchLines(payload.structuredPatch) ??
    countReplacementLines(payload.oldString, payload.newString)
  );
}

/**
 * Get a display title for the file change tool part.
 */
export function getFileChangeTitle(payload: FileChangeToolPayload): string {
  const filename = getFilenameFromPath(payload.filePath);
  const lowerToolName = payload.toolName.toLowerCase();

  if (lowerToolName === "read") {
    // Prefer startLine/totalLines from structured output, fall back to offset/limit from input
    const start = payload.startLine ?? payload.offset;
    const total = payload.totalLines;
    if (start !== undefined && payload.content !== undefined) {
      const lineCount = payload.content.split("\n").length;
      const endLine = start + lineCount - 1;
      const ofTotal = total !== undefined ? ` of ${total}` : "";
      return `Read ${filename} (lines ${start}–${endLine}${ofTotal})`;
    }
  }

  return `${payload.toolName} ${filename}`;
}
