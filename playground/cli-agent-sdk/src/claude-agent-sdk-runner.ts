import { input } from "@inquirer/prompts";
import {
  query,
  type CanUseTool,
  type Options as ClaudeQueryOptions,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import chalk from "chalk";

export interface ClaudeAgentSdkRunOptions {
  cwd: string;
  prompt: string;
  rawJson: boolean;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  model?: string;
  pathToClaudeCodeExecutable?: string;
  createQuery?: CreateClaudeQuery;
  promptForInput?: (message: string) => Promise<string>;
  renderMessage?: (message: SDKMessage, rawJson: boolean) => void;
}

export interface ClaudeAgentSdkRunResult {
  sessionId?: string;
}

export type CreateClaudeQuery = (input: {
  prompt: string;
  options: ClaudeQueryOptions;
}) => Query;

const DEFAULT_SETTING_SOURCES: NonNullable<ClaudeQueryOptions["settingSources"]> = [
  "user",
  "project",
  "local",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

function sessionIdFromMessage(message: SDKMessage): string | undefined {
  if ("session_id" in message && typeof message.session_id === "string") {
    return message.session_id;
  }
  return undefined;
}

function extractAssistantText(message: SDKMessage): string[] {
  if (message.type !== "assistant") return [];

  const content: unknown = message.message.content;
  if (typeof content === "string" && content.trim()) {
    return [content];
  }

  if (!Array.isArray(content)) return [];

  const lines: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      lines.push(block.text);
    }
  }
  return lines;
}

function streamDeltaText(message: SDKMessage): string | undefined {
  if (message.type !== "stream_event") return undefined;

  const event = message.event;
  if (event.type !== "content_block_delta") return undefined;

  if (event.delta.type === "text_delta") {
    return event.delta.text;
  }

  if (
    event.delta.type === "thinking_delta" &&
    typeof event.delta.thinking === "string"
  ) {
    return event.delta.thinking;
  }

  return undefined;
}

function formatOptionList(options: Array<{ label: string; description?: string }>): string {
  if (options.length === 0) return "";

  return options
    .map((option, index) => {
      const description = option.description ? ` - ${option.description}` : "";
      return `${index + 1}. ${option.label}${description}`;
    })
    .join("\n");
}

function parseQuestionOptions(
  rawOptions: unknown
): Array<{ label: string; description?: string }> {
  if (!Array.isArray(rawOptions)) return [];

  const options: Array<{ label: string; description?: string }> = [];
  for (const rawOption of rawOptions) {
    if (!isRecord(rawOption)) continue;

    const label = stringField(rawOption, "label");
    if (!label) continue;

    const description = stringField(rawOption, "description");
    options.push({
      label,
      ...(description ? { description } : {}),
    });
  }
  return options;
}

function parseAskUserQuestions(
  toolInput: Record<string, unknown>
): Array<{
  key: string;
  prompt: string;
  options: Array<{ label: string; description?: string }>;
}> {
  const rawQuestions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
  const questions: Array<{
    key: string;
    prompt: string;
    options: Array<{ label: string; description?: string }>;
  }> = [];

  for (const [index, rawQuestion] of rawQuestions.entries()) {
    if (!isRecord(rawQuestion)) continue;

    const question =
      stringField(rawQuestion, "question") ??
      stringField(rawQuestion, "header") ??
      `Question ${index + 1}`;
    questions.push({
      key: question,
      prompt: question,
      options: parseQuestionOptions(rawQuestion.options),
    });
  }

  return questions;
}

async function resolveAskUserQuestion(
  toolInput: Record<string, unknown>,
  promptForInput: (message: string) => Promise<string>
): Promise<PermissionResult> {
  const questions = parseAskUserQuestions(toolInput);
  const answers: Record<string, string> = {};

  for (const question of questions) {
    const optionList = formatOptionList(question.options);
    const message = optionList
      ? `${question.prompt}\n${optionList}\nAnswer`
      : question.prompt;
    const answer = (await promptForInput(message)).trim();
    answers[question.key] = answer || question.options[0]?.label || "";
  }

  return {
    behavior: "allow",
    updatedInput: {
      questions: toolInput.questions,
      answers,
    },
  };
}

function createPermissionHandler(options: {
  permissionMode: PermissionMode;
  promptForInput: (message: string) => Promise<string>;
}): CanUseTool {
  return async (toolName, toolInput, callbackOptions) => {
    if (toolName === "AskUserQuestion") {
      return resolveAskUserQuestion(toolInput, options.promptForInput);
    }

    if (toolName === "ExitPlanMode") {
      return {
        behavior: "deny",
        message:
          "Plan captured by the host. Stop here and wait for follow-up instructions.",
        toolUseID: callbackOptions.toolUseID,
      };
    }

    if (options.permissionMode === "bypassPermissions") {
      return {
        behavior: "allow",
        updatedInput: toolInput,
        toolUseID: callbackOptions.toolUseID,
      };
    }

    const title = callbackOptions.title ?? `${toolName} permission request`;
    const description = callbackOptions.description
      ? `\n${callbackOptions.description}`
      : "";
    const answer = await options.promptForInput(
      `${title}${description}\nAllow this tool call? [y/N]`
    );

    if (answer.trim().toLowerCase().startsWith("y")) {
      return {
        behavior: "allow",
        updatedInput: toolInput,
        toolUseID: callbackOptions.toolUseID,
        ...(callbackOptions.suggestions
          ? { updatedPermissions: callbackOptions.suggestions }
          : {}),
      };
    }

    return {
      behavior: "deny",
      message: "User declined tool execution.",
      toolUseID: callbackOptions.toolUseID,
    };
  };
}

export function buildClaudeAgentQueryOptions(
  options: Omit<ClaudeAgentSdkRunOptions, "prompt" | "rawJson" | "renderMessage">
): ClaudeQueryOptions {
  const permissionMode = options.permissionMode ?? "bypassPermissions";

  return {
    cwd: options.cwd,
    ...(options.model ? { model: options.model } : {}),
    ...(options.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }
      : {}),
    settingSources: [...DEFAULT_SETTING_SOURCES],
    systemPrompt: { type: "preset", preset: "claude_code" },
    tools: { type: "preset", preset: "claude_code" },
    permissionMode,
    ...(permissionMode === "bypassPermissions"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    ...(options.resumeSessionId
      ? { resume: options.resumeSessionId, forkSession: true }
      : {}),
    includePartialMessages: true,
    canUseTool: createPermissionHandler({
      permissionMode,
      promptForInput:
        options.promptForInput ??
        ((message) =>
          input({
            message: chalk.cyan(message),
          })),
    }),
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: "convoy-cli-agent-sdk-playground",
    },
  };
}

export function renderClaudeAgentSdkMessage(message: SDKMessage, rawJson: boolean): void {
  if (rawJson) {
    console.log(JSON.stringify(message));
    return;
  }

  const delta = streamDeltaText(message);
  if (delta) {
    process.stdout.write(chalk.white(delta));
    return;
  }

  const assistantText = extractAssistantText(message);
  if (assistantText.length > 0) {
    for (const text of assistantText) {
      console.log(chalk.white(text));
    }
    return;
  }

  if (message.type === "system" && message.subtype === "init") {
    console.log(
      chalk.dim(
        `[Claude SDK] version=${message.claude_code_version} cwd=${message.cwd}`
      )
    );
    return;
  }

  if (message.type === "system" && message.subtype === "status") {
    const mode = message.permissionMode ? ` permissionMode=${message.permissionMode}` : "";
    console.log(chalk.dim(`[Claude SDK status] ${message.status}${mode}`));
    return;
  }

  if (message.type !== "result") return;

  if (message.subtype === "success") {
    console.log(chalk.green("\n[Complete]"));
    if (message.result.trim()) {
      console.log(chalk.white(message.result));
    }
    return;
  }

  console.log(chalk.red(`\n[Result: ${message.subtype}]`));
  if (message.errors.length > 0) {
    console.log(chalk.red(message.errors.join("\n")));
  }
}

export async function runClaudeAgentSdkPrompt(
  options: ClaudeAgentSdkRunOptions
): Promise<ClaudeAgentSdkRunResult> {
  const createQuery = options.createQuery ?? ((input) => query(input));
  const renderMessage = options.renderMessage ?? renderClaudeAgentSdkMessage;
  const queryOptions = buildClaudeAgentQueryOptions(options);
  const runtime = createQuery({
    prompt: options.prompt,
    options: queryOptions,
  });

  let sessionId: string | undefined;
  try {
    for await (const message of runtime) {
      const maybeSessionId = sessionIdFromMessage(message);
      if (maybeSessionId) {
        sessionId = maybeSessionId;
      }
      renderMessage(message, options.rawJson);
    }
  } finally {
    runtime.close();
  }

  return { sessionId };
}
