import { input } from "@inquirer/prompts";
import chalk from "chalk";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createCliExecutionSdk } from "./sdk/index.js";
import type { ProviderId, RunRequest, TransportMode } from "./sdk/index.js";
import {
  runClaudeAgentSdkPrompt,
  type ClaudeAgentSdkRunResult,
} from "./claude-agent-sdk-runner.js";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

interface ChatOptions {
  agent?: string;
  prompt?: string;
  once?: boolean;
  cwd?: string;
  rawJson?: boolean;
  permissionMode?: string;
  model?: string;
  claudeExecutable?: string;
}

interface RunSubprocessOptions {
  cwd: string;
  sessionId?: string;
  continueSession?: boolean;
  rawJson: boolean;
}

interface ClaudeSdkOptions {
  cwd: string;
  sessionId?: string;
  continueSession?: boolean;
  rawJson: boolean;
  permissionMode?: PermissionMode;
  model?: string;
  claudeExecutable?: string;
}

interface SubprocessAgentConfig {
  providerId: ProviderId;
  transportMode: TransportMode;
  providerOptions?: Record<string, unknown>;
  providerConfig?: RunRequest["providerConfig"];
}

function resolveMockProviderPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, "../src/sdk/mock-provider.mjs"),
    path.resolve(currentDir, "../../src/sdk/mock-provider.mjs"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error("Unable to locate mock provider script");
}

function toSubprocessConfig(
  agent: string,
  options: RunSubprocessOptions
): SubprocessAgentConfig {
  if (agent === "claude-cli-json") {
    if (options.continueSession && !options.sessionId) {
      throw new Error("Cannot resume Claude session without a previous session ID");
    }

    return {
      providerId: "claude",
      transportMode: "json-stream",
      providerOptions: {
        resumeSessionId: options.continueSession ? options.sessionId : undefined,
      },
    };
  }

  if (agent === "codex-cli-json") {
    return {
      providerId: "codex",
      transportMode: "json-stream",
    };
  }

  if (agent === "generic-cli") {
    return {
      providerId: "generic",
      transportMode: "line-text",
    };
  }

  if (agent === "mock-cli-json") {
    return {
      providerId: "generic",
      transportMode: "json-stream",
      providerConfig: {
        executablePath: process.execPath,
      },
      providerOptions: {
        args: [resolveMockProviderPath(), "--mode=json"],
      },
    };
  }

  if (agent === "mock-cli-line") {
    return {
      providerId: "generic",
      transportMode: "line-text",
      providerConfig: {
        executablePath: process.execPath,
      },
      providerOptions: {
        args: [resolveMockProviderPath(), "--mode=line"],
      },
    };
  }

  throw new Error(`Unsupported subprocess agent: ${agent}`);
}

function isClaudeSdkAgent(agent: string): boolean {
  return agent === "claude-agent-sdk";
}

function isPermissionMode(value: string | undefined): value is PermissionMode {
  return (
    value === undefined ||
    value === "default" ||
    value === "acceptEdits" ||
    value === "bypassPermissions" ||
    value === "plan" ||
    value === "dontAsk" ||
    value === "auto"
  );
}

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

function extractSessionIdFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  const direct = stringField(payload, "session_id") ?? stringField(payload, "sessionId");
  if (direct) return direct;

  const nestedMessage = payload.message;
  if (isRecord(nestedMessage)) {
    const nested =
      stringField(nestedMessage, "session_id") ?? stringField(nestedMessage, "sessionId");
    if (nested) return nested;
  }

  const nestedResult = payload.result;
  if (isRecord(nestedResult)) {
    const nested =
      stringField(nestedResult, "session_id") ?? stringField(nestedResult, "sessionId");
    if (nested) return nested;
  }

  return undefined;
}

function extractAssistantText(payload: unknown): string[] {
  if (!isRecord(payload) || payload.type !== "assistant") return [];
  const message = payload.message;
  if (!isRecord(message)) return [];
  const content = message.content;

  if (typeof content === "string" && content.trim()) {
    return [content];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const lines: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      lines.push(block.text);
    }
  }
  return lines;
}

function lineFromPayload(payload: unknown): string | undefined {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }
  if (!isRecord(payload)) {
    return undefined;
  }

  if (payload.kind === "text" && typeof payload.line === "string" && payload.line.trim()) {
    return payload.line;
  }

  return undefined;
}

function renderStdoutPayload(payload: unknown, rawJson: boolean): void {
  if (rawJson) {
    console.log(JSON.stringify(payload));
    return;
  }

  const line = lineFromPayload(payload);
  if (line) {
    console.log(chalk.dim(line));
    return;
  }

  const assistantText = extractAssistantText(payload);
  if (assistantText.length > 0) {
    for (const text of assistantText) {
      console.log(chalk.white(text));
    }
    return;
  }

  if (!isRecord(payload) || payload.type !== "result") {
    return;
  }

  const subtype = stringField(payload, "subtype") ?? "unknown";
  const isError = payload.is_error === true;
  if (!isError && subtype === "success") {
    console.log(chalk.green("\n[Complete]"));
    const resultText =
      typeof payload.result === "string" && payload.result.trim()
        ? payload.result
        : undefined;
    if (resultText) console.log(chalk.white(resultText));
    return;
  }

  console.log(chalk.red(`\n[Result: ${subtype}]`));
  const error =
    typeof payload.error === "string" && payload.error.trim() ? payload.error : undefined;
  if (error) console.log(chalk.red(error));
}

function renderStderrPayload(payload: unknown, rawJson: boolean): void {
  if (rawJson) {
    console.log(JSON.stringify(payload));
    return;
  }

  const line = lineFromPayload(payload);
  if (line) {
    console.log(chalk.red.dim(line));
  }
}

async function runSubprocessAgent(
  agent: string,
  prompt: string,
  options: RunSubprocessOptions
): Promise<{ sessionId?: string }> {
  const config = toSubprocessConfig(agent, options);

  const sdk = createCliExecutionSdk();
  try {
    const run = await sdk.startRun({
      providerId: config.providerId,
      cwd: options.cwd,
      prompt,
      transportMode: config.transportMode,
      providerOptions: config.providerOptions,
      providerConfig: config.providerConfig,
    });

    let sessionId: string | undefined;

    for await (const event of run.events()) {
      if (event.kind === "spawn_error") {
        console.log(chalk.red(`[spawn_error] ${JSON.stringify(event.payload)}`));
        continue;
      }

      if (event.kind === "stdout") {
        const maybeSessionId = extractSessionIdFromPayload(event.payload);
        if (maybeSessionId) {
          sessionId = maybeSessionId;
        }
        renderStdoutPayload(event.payload, options.rawJson);
        continue;
      }

      if (event.kind === "stderr") {
        renderStderrPayload(event.payload, options.rawJson);
      }
    }

    const final = await run.wait();
    if (final.status !== "completed") {
      console.log(
        chalk.red(
          `[${agent}] finished with status=${final.status} exitCode=${String(final.exitCode)}`
        )
      );
    }

    if (agent === "claude-cli-json" && final.status === "completed" && !sessionId) {
      throw new Error(
        "Claude run completed without session_id/sessionId in stream-json output"
      );
    }

    return { sessionId };
  } finally {
    await sdk.shutdown();
  }
}

async function runClaudeSdkAgent(
  prompt: string,
  options: ClaudeSdkOptions
): Promise<ClaudeAgentSdkRunResult> {
  return runClaudeAgentSdkPrompt({
    cwd: options.cwd,
    prompt,
    rawJson: options.rawJson,
    ...(options.continueSession && options.sessionId
      ? { resumeSessionId: options.sessionId }
      : {}),
    ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.claudeExecutable
      ? { pathToClaudeCodeExecutable: options.claudeExecutable }
      : {}),
  });
}

export async function runChat(options: ChatOptions): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const agent = options.agent || "claude-cli-json";
  const rawJson = options.rawJson ?? false;
  const once = options.once ?? false;

  if (!isPermissionMode(options.permissionMode)) {
    throw new Error(`Unsupported Claude permission mode: ${options.permissionMode}`);
  }

  console.log(chalk.bold("\nCLI Agent SDK Playground\n"));
  console.log(chalk.dim(`Agent: ${agent}`));
  console.log(chalk.dim(`Working directory: ${cwd}\n`));

  if (options.prompt) {
    if (isClaudeSdkAgent(agent)) {
      await runClaudeSdkAgent(options.prompt, {
        cwd,
        continueSession: false,
        sessionId: undefined,
        rawJson,
        permissionMode: options.permissionMode,
        model: options.model,
        claudeExecutable: options.claudeExecutable,
      });
      return;
    }

    await runSubprocessAgent(agent, options.prompt, {
      cwd,
      continueSession: false,
      sessionId: undefined,
      rawJson,
    });
    return;
  }

  console.log(chalk.dim('Type your prompt (or "exit" to quit)\n'));

  let isFirstPrompt = true;
  let sessionId: string | undefined;

  if (once) {
    const prompt = await input({ message: chalk.cyan("You:") });
    if (!prompt.trim()) return;

    const res = isClaudeSdkAgent(agent)
      ? await runClaudeSdkAgent(prompt, {
          cwd,
          continueSession: false,
          sessionId: undefined,
          rawJson,
          permissionMode: options.permissionMode,
          model: options.model,
          claudeExecutable: options.claudeExecutable,
        })
      : await runSubprocessAgent(agent, prompt, {
          cwd,
          continueSession: false,
          sessionId: undefined,
          rawJson,
        });
    if (agent === "claude-cli-json" || isClaudeSdkAgent(agent)) {
      sessionId = res.sessionId;
    }
    return;
  }

  while (true) {
    const prompt = await input({ message: chalk.cyan("You:") });

    if (prompt.toLowerCase() === "exit" || prompt.toLowerCase() === "quit") {
      console.log(chalk.dim("\nGoodbye!"));
      break;
    }

    if (!prompt.trim()) continue;

    const res = isClaudeSdkAgent(agent)
      ? await runClaudeSdkAgent(prompt, {
          cwd,
          continueSession: !isFirstPrompt,
          sessionId,
          rawJson,
          permissionMode: options.permissionMode,
          model: options.model,
          claudeExecutable: options.claudeExecutable,
        })
      : await runSubprocessAgent(agent, prompt, {
          cwd,
          continueSession: !isFirstPrompt,
          sessionId,
          rawJson,
        });

    if (agent === "claude-cli-json" || isClaudeSdkAgent(agent)) {
      sessionId = res.sessionId;
    }

    isFirstPrompt = false;
    console.log();
  }
}
