import type { UIMessage } from "ai";
import type { CliUiPart } from "@/lib/cli-stream-ui";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import { getBoolean, getString } from "@/lib/ai-tools/parse-utils";
import { isRecord } from "@/lib/type-guards";

export type AskUserQuestionOption = {
  label: string;
  description?: string;
};

export type AskUserQuestionQuestion = {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: AskUserQuestionOption[];
};

export type AskUserQuestionToolPayload = {
  toolName: "AskUserQuestion";
  toolCallId: string;
  questions: AskUserQuestionQuestion[];
};

export type AskUserQuestionAnswer = {
  questionIndex: number;
  header?: string;
  question: string;
  multiSelect: boolean;
  selectedOptionLabels: string[];
  customAnswer?: string;
};

export type AskUserQuestionResponsePayload = {
  toolName: "AskUserQuestion";
  toolCallId: string;
  submittedAt: number;
  answers: AskUserQuestionAnswer[];
};

export type AskUserQuestionResponseMap = Record<
  string,
  AskUserQuestionResponsePayload
>;

export type AskUserQuestionResponseSourceMessage = {
  role: "user" | "assistant";
  createdAt?: number;
  content?: Array<{ data: string }>;
  textContent?: string;
};

const RESPONSE_BLOCK_START = "<convoy:ask-user-question-response>";
const RESPONSE_BLOCK_END = "</convoy:ask-user-question-response>";

function normalizeToolName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isAskUserQuestionToolName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    normalizeToolName(value) === normalizeToolName("AskUserQuestion")
  );
}


function toQuestionOption(value: unknown): AskUserQuestionOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = getString(value, "label");
  if (!label) {
    return null;
  }

  const description = getString(value, "description");
  return description ? { label, description } : { label };
}

function toQuestion(value: unknown): AskUserQuestionQuestion | null {
  if (!isRecord(value)) {
    return null;
  }

  const question = getString(value, "question");
  if (!question) {
    return null;
  }

  const header = getString(value, "header");
  const multiSelect = getBoolean(value, "multiSelect", false);

  const rawOptions = value.options;
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return null;
  }

  const options = rawOptions
    .map(toQuestionOption)
    .filter((option): option is AskUserQuestionOption => option !== null);
  if (options.length === 0) {
    return null;
  }

  return {
    question,
    header,
    multiSelect,
    options,
  };
}

function toQuestionArray(value: unknown): AskUserQuestionQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const questions = value
    .map(toQuestion)
    .filter((question): question is AskUserQuestionQuestion => question !== null);
  if (questions.length === 0) {
    return null;
  }

  return questions;
}

/** Asked and never answered: the live card owns it until its run dies (OS-1463). */
export function isParkedAskUserQuestion(
  part: CliUiPart
): part is Extract<CliUiPart, { type: "dynamic-tool"; state: "input-available" }> {
  return (
    part.type === "dynamic-tool" &&
    isAskUserQuestionToolName(part.toolName) &&
    part.state === "input-available"
  );
}

export function parseAskUserQuestionToolPart(
  part: UIMessage["parts"][number]
): AskUserQuestionToolPayload | null {
  if (!isDynamicToolUIPart(part)) {
    return null;
  }

  if (!isAskUserQuestionToolName(part.toolName)) {
    return null;
  }

  if (part.state !== "output-error") {
    return null;
  }

  const rawInput = "input" in part ? part.input : undefined;
  if (!isRecord(rawInput)) {
    return null;
  }

  const questions = toQuestionArray(rawInput.questions);
  if (!questions) {
    return null;
  }

  return {
    toolName: "AskUserQuestion",
    toolCallId: part.toolCallId,
    questions,
  };
}

function isAskUserQuestionAnswer(value: unknown): value is AskUserQuestionAnswer {
  if (!isRecord(value)) {
    return false;
  }

  const selectedOptionLabels = value.selectedOptionLabels;
  if (!Array.isArray(selectedOptionLabels)) {
    return false;
  }

  if (!selectedOptionLabels.every((label) => typeof label === "string")) {
    return false;
  }

  if (typeof value.questionIndex !== "number") {
    return false;
  }

  if (typeof value.question !== "string") {
    return false;
  }

  if (typeof value.multiSelect !== "boolean") {
    return false;
  }

  if (value.header !== undefined && typeof value.header !== "string") {
    return false;
  }

  if (value.customAnswer !== undefined && typeof value.customAnswer !== "string") {
    return false;
  }

  return true;
}

function isAskUserQuestionResponsePayload(
  value: unknown
): value is AskUserQuestionResponsePayload {
  if (!isRecord(value)) {
    return false;
  }

  if (value.toolName !== "AskUserQuestion") {
    return false;
  }

  if (typeof value.toolCallId !== "string") {
    return false;
  }

  if (typeof value.submittedAt !== "number") {
    return false;
  }

  if (!Array.isArray(value.answers)) {
    return false;
  }

  return value.answers.every((answer) => isAskUserQuestionAnswer(answer));
}

function extractResponseJsonBlock(content: string): string | null {
  const start = content.indexOf(RESPONSE_BLOCK_START);
  if (start < 0) {
    return null;
  }

  const jsonStart = start + RESPONSE_BLOCK_START.length;
  const end = content.indexOf(RESPONSE_BLOCK_END, jsonStart);
  if (end < 0) {
    return null;
  }

  return content.slice(jsonStart, end).trim();
}

export function parseAskUserQuestionResponse(
  content: string
): AskUserQuestionResponsePayload | null {
  const jsonBlock = extractResponseJsonBlock(content);
  if (!jsonBlock) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(jsonBlock);
    return isAskUserQuestionResponsePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function summarizeAnswer(answer: AskUserQuestionAnswer): string {
  const selected = answer.selectedOptionLabels.join(", ");
  const custom = answer.customAnswer?.trim();

  if (selected && custom) {
    return `${selected}; custom: ${custom}`;
  }

  if (selected) {
    return selected;
  }

  if (custom) {
    return `custom: ${custom}`;
  }

  return "(no answer)";
}

export function buildAskUserQuestionResponseSummaryLines(
  payload: AskUserQuestionResponsePayload
): string[] {
  return payload.answers.map((answer) => {
    const prefix =
      answer.header?.trim() ||
      answer.question ||
      `Question ${answer.questionIndex + 1}`;
    return `${prefix}: ${summarizeAnswer(answer)}`;
  });
}

export function formatAskUserQuestionResponse(
  payload: AskUserQuestionResponsePayload
): string {
  const summaryLines = buildAskUserQuestionResponseSummaryLines(payload);
  const summary = summaryLines.map((line) => `- ${line}`).join("\n");

  return [
    RESPONSE_BLOCK_START,
    JSON.stringify(payload, null, 2),
    RESPONSE_BLOCK_END,
    "",
    "Submitted answers:",
    summary,
  ].join("\n");
}

export function extractLatestAskUserQuestionResponses(
  messages: AskUserQuestionResponseSourceMessage[]
): AskUserQuestionResponseMap {
  const responses: AskUserQuestionResponseMap = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const mergedContent =
      message.textContent ??
      message.content?.map((chunk) => chunk.data).join("\n") ??
      "";
    const parsed = parseAskUserQuestionResponse(mergedContent);
    if (!parsed) {
      continue;
    }

    responses[parsed.toolCallId] = parsed;
  }

  return responses;
}
