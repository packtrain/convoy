import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Options as ClaudeAgentOptions, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { RunnerExecutionError } from "../contracts.js";

const { resolveExecutableMock } = vi.hoisted(() => ({
  resolveExecutableMock: vi.fn(
    async (
      _providerId: string,
      config?: { executablePath?: string }
    ) => ({
      command: config?.executablePath ?? "/mock/claude",
      source: config?.executablePath ? ("configured" as const) : ("path" as const),
    })
  ),
}));

vi.mock("../../sdk/adapters/executable-resolution.js", () => ({
  resolveExecutable: resolveExecutableMock,
}));

import { createClaudeCodeRunner } from "./runner.js";
import { PLAN_MODE_SYSTEM_PROMPT } from "./prompts.js";
import { threadIdentityInstruction } from "../agent-instructions.js";

const IDENTITY_LINE = threadIdentityInstruction("thread_test");

type QueryParams = {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: ClaudeAgentOptions;
};

type FakeQueryBehavior = {
  accountInfo?: () => Promise<unknown>;
  usage?: () => Promise<unknown>;
  launchInMissingDirectory?: boolean;
  spawnRuntime?: boolean;
  messages?: SDKMessage[];
  /** Error thrown by the stream after yielding `messages`. */
  throwAfterMessages?: Error;
  /** Invoked with the stderr callback before streaming begins. */
  emitStderr?: string[];
  /** get_context_usage control response; absent models an unsupported CLI. */
  getContextUsage?: () => Promise<unknown>;
  /** supportedCommands control response; absent models an unsupported CLI. */
  supportedCommands?: () => Promise<unknown>;
  /** Never end the stream after `messages` — models a session gone silent. */
  stallAfterMessages?: boolean;
  /** Messages built from the first prompt frame, streamed after `messages`. */
  messagesForPrompt?: (frame: SDKUserMessage) => SDKMessage[];
};

function makeSdkMessage(value: Record<string, unknown>): SDKMessage {
  return value as unknown as SDKMessage;
}

function createQueryMock(behavior: FakeQueryBehavior = {}) {
  const closeMock = vi.fn();
  const interruptMock = vi.fn().mockResolvedValue(undefined);
  const calls: QueryParams[] = [];
  /** `--settings` file contents and modes, read while the run is live. */
  const settingsFiles: Array<{ path: string; content: string; mode: number }> = [];
  let child: ReturnType<NonNullable<ClaudeAgentOptions["spawnClaudeCodeProcess"]>> | undefined;

  const createQuery = vi.fn((params: QueryParams): Query => {
    calls.push(params);
    const settings = params.options?.extraArgs?.settings;
    if (typeof settings === "string" && existsSync(settings))
      settingsFiles.push({ path: settings, content: readFileSync(settings, "utf8"), mode: statSync(settings).mode & 0o777 });

    async function* stream(): AsyncGenerator<SDKMessage, void> {
      if (behavior.launchInMissingDirectory) {
        const child = params.options?.spawnClaudeCodeProcess?.({
          command: process.execPath, args: [], cwd: "/convoy-missing-cwd-test",
          env: process.env, signal: new AbortController().signal,
        });
        if (child) await new Promise((_, reject) => child.once("error", reject));
        throw new Error("SDK startup failed");
      }
      if (behavior.spawnRuntime) {
        child = params.options?.spawnClaudeCodeProcess?.({
          command: process.execPath, args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"],
          cwd: process.cwd(), env: process.env, signal: new AbortController().signal,
        });
      }
      for (const line of behavior.emitStderr ?? []) {
        params.options?.stderr?.(line);
      }
      for (const message of behavior.messages ?? []) {
        yield message;
      }
      if (behavior.messagesForPrompt && typeof params.prompt !== "string") {
        const first = await params.prompt[Symbol.asyncIterator]().next();
        yield* behavior.messagesForPrompt(first.value as SDKUserMessage);
      }
      if (behavior.throwAfterMessages) {
        throw behavior.throwAfterMessages;
      }
      if (behavior.stallAfterMessages) {
        await new Promise<never>(() => {});
      }
    }

    const generator = stream();
    return Object.assign(generator, {
      close: closeMock,
      interrupt: interruptMock,
      accountInfo: behavior.accountInfo,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: behavior.usage,
      ...(behavior.getContextUsage
        ? { getContextUsage: behavior.getContextUsage }
        : {}),
      ...(behavior.supportedCommands
        ? { supportedCommands: behavior.supportedCommands }
        : {}),
    }) as unknown as Query;
  });

  return { createQuery, closeMock, interruptMock, calls, settingsFiles, child: () => child };
}

async function drain(
  generator: AsyncGenerator<{ type: string; data: string }, { continuationId?: string }, unknown>
): Promise<{
  chunks: Array<{ type: string; data: string }>;
  result?: { continuationId?: string };
}> {
  const chunks: Array<{ type: string; data: string }> = [];
  while (true) {
    const next = await generator.next();
    if (next.done) {
      return { chunks, result: next.value };
    }
    chunks.push(next.value);
  }
}

async function collectAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

const SESSION_MESSAGE = makeSdkMessage({
  type: "system",
  subtype: "init",
  session_id: "session-123",
});

const SUCCESS_RESULT = makeSdkMessage({
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: "session-123",
  result: "done",
});

describe("createClaudeCodeRunner (agent SDK)", () => {
  it("reads account usage without submitting a prompt or changing continuation", async () => {
    const usage = vi.fn().mockResolvedValue({
      rate_limits_available: true,
      rate_limits: { five_hour: { utilization: 25, resets_at: "2026-10-09T12:00:00Z" } },
    });
    const mock = createQueryMock({
      accountInfo: async () => ({ email: "user@example.com", subscriptionType: "max" }),
      usage,
    });
    const runner = createClaudeCodeRunner({ createQuery: mock.createQuery });
    const { chunks, result } = await drain(runner.execute("/repo", "", {
      cliType: "claude-code", threadId: "thread_test", continuationId: "previous",
      requireContinuation: true, runtimeCommand: { command: "usage" },
    }));
    expect(usage).toHaveBeenCalledWith({ skipBehaviors: true });
    expect(chunks.map(chunk => chunk.type)).toEqual(["convoy.account_usage"]);
    expect(JSON.parse(chunks[0].data)).toMatchObject({
      provider: "claude-code", source: "reported", account: "user@example.com",
      buckets: [{ id: "five_hour", windows: [{ usedPercent: 25 }] }],
    });
    expect(result).toEqual({ continuationId: "previous" });
    expect(mock.calls[0].options?.resume).toBeUndefined();
    expect(mock.calls[0].options?.forkSession).toBeUndefined();
    expect(await collectAsyncIterable(mock.calls[0].prompt as AsyncIterable<SDKUserMessage>)).toEqual([]);
    expect(mock.closeMock).toHaveBeenCalled();
  });

  it("returns an unavailable report for an older CLI instead of generating a reply", async () => {
    const mock = createQueryMock();
    const runner = createClaudeCodeRunner({ createQuery: mock.createQuery });
    const { chunks } = await drain(runner.execute("/repo", "", {
      cliType: "claude-code", threadId: "thread_test", runtimeCommand: { command: "usage" },
    }));
    expect(chunks).toHaveLength(1);
    expect(JSON.parse(chunks[0].data)).toMatchObject({ source: "unavailable", buckets: [] });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONVOY_CLAUDE_EXECUTABLE;
  });

  it("shutdown waits for the SDK runtime process to exit", async () => {
    const mock = createQueryMock({ spawnRuntime: true, messages: [SESSION_MESSAGE] });
    const runner = createClaudeCodeRunner({ createQuery: mock.createQuery });
    const execution = runner.execute(process.cwd(), "hello", { cliType: "claude-code", threadId: "thread_test" });
    try {
      await execution.next();
      let stopped = false;
      const shutdown = runner.shutdown().then(() => { stopped = true; });
      await Promise.resolve();
      expect(stopped).toBe(false);
      mock.child()!.stdin.end();
      await shutdown;
      expect(stopped).toBe(true);
    } finally {
      mock.child()?.kill("SIGKILL");
      await execution.return({});
    }
  });

  it("preserves a structured launch failure from the SDK process", async () => {
    const { createQuery } = createQueryMock({ launchInMissingDirectory: true });
    const runner = createClaudeCodeRunner({ createQuery });
    await expect(runner.execute("/convoy-missing-cwd-test", "hello", {
      cliType: "claude-code", threadId: "thread_test",
    }).next()).rejects.toMatchObject({ launchFailed: true });
    await runner.shutdown();
  });

  it("streams SDK messages as chunks and returns the continuation id", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [
        SESSION_MESSAGE,
        makeSdkMessage({ type: "assistant", message: { role: "assistant", content: [] } }),
        SUCCESS_RESULT,
      ],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    const { chunks, result } = await drain(
      runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        continuationId: "session-prev",
      })
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.type).toBe("system");
    expect(chunks[0]?.data).toContain('"session_id":"session-123"');
    expect(chunks[1]?.type).toBe("assistant");
    expect(result?.continuationId).toBe("session-123");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe("prompt");
    expect(calls[0]?.options).toMatchObject({
      cwd: "/repo",
      pathToClaudeCodeExecutable: "/mock/claude",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      resume: "session-prev",
      forkSession: true,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      tools: { type: "preset", preset: "claude_code" },
    });
  });

  it("drops thinking_tokens frames and empty thinking deltas", async () => {
    const thinkingDelta = (thinking: string) =>
      makeSdkMessage({
        type: "stream_event",
        session_id: "session-123",
        parent_tool_use_id: null,
        event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking, estimated_tokens: 50 } },
      });
    const { createQuery } = createQueryMock({
      messages: [
        SESSION_MESSAGE,
        makeSdkMessage({ type: "system", subtype: "thinking_tokens", estimated_tokens: 50, estimated_tokens_delta: 50, session_id: "session-123" }),
        thinkingDelta(""),
        thinkingDelta("real thought"),
        SUCCESS_RESULT,
      ],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    const { chunks } = await drain(
      runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" })
    );

    const data = chunks.map((chunk) => chunk.data).join("\n");
    expect(data).not.toContain("thinking_tokens");
    expect(chunks.filter((chunk) => chunk.type === "stream_event")).toHaveLength(1);
    expect(data).toContain("real thought");
  });

  it("re-sends the profile provider env via a private --settings file, never argv", async () => {
    const providerEnv = {
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_MANTLE: "0",
      AWS_BEARER_TOKEN_BEDROCK: "tok-secret",
    };
    process.env.CONVOY_CLAUDE_PROVIDER_ENV = JSON.stringify(providerEnv);
    try {
      const { createQuery, calls, settingsFiles } = createQueryMock({
        messages: [SESSION_MESSAGE, SUCCESS_RESULT],
      });

      const runner = createClaudeCodeRunner({ createQuery });
      await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

      const settings = calls[0]?.options?.extraArgs?.settings;
      expect(settings).not.toContain("tok-secret");
      expect(settingsFiles).toEqual([{ path: settings, content: JSON.stringify({ env: providerEnv }), mode: 0o600 }]);
      expect(existsSync(settings!)).toBe(false);
    } finally {
      delete process.env.CONVOY_CLAUDE_PROVIDER_ENV;
    }
  });

  it("names the settings folder after its process and sweeps folders a dead CLI left behind (OS-2016)", async () => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    const dead = join(tmpdir(), `convoy-claude-settings-${deadPid}-test`);
    const live = join(tmpdir(), `convoy-claude-settings-${process.pid}-test`);
    mkdirSync(dead, { recursive: true });
    mkdirSync(live, { recursive: true });
    try {
      process.env.CONVOY_CLAUDE_PROVIDER_ENV = JSON.stringify({ CLAUDE_CODE_USE_BEDROCK: "1" });
      const { createQuery, calls } = createQueryMock({ messages: [SESSION_MESSAGE, SUCCESS_RESULT] });
      const runner = createClaudeCodeRunner({ createQuery });
      expect(existsSync(dead)).toBe(false);
      expect(existsSync(live)).toBe(true);
      await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));
      expect(basename(join(calls[0]!.options!.extraArgs!.settings!, ".."))).toMatch(new RegExp(`^convoy-claude-settings-${process.pid}-`));
    } finally {
      delete process.env.CONVOY_CLAUDE_PROVIDER_ENV;
      rmSync(dead, { recursive: true, force: true });
      rmSync(live, { recursive: true, force: true });
    }
  });

  it("runs ultracode as xhigh effort plus the ultracode setting, merged with the provider env", async () => {
    const providerEnv = { CLAUDE_CODE_USE_BEDROCK: "1" };
    process.env.CONVOY_CLAUDE_PROVIDER_ENV = JSON.stringify(providerEnv);
    try {
      const { createQuery, calls, settingsFiles } = createQueryMock({ messages: [SESSION_MESSAGE, SUCCESS_RESULT] });
      const runner = createClaudeCodeRunner({ createQuery });
      await drain(runner.execute("/repo", "prompt", {
        threadId: "thread_test", cliType: "claude-code", resolvedCliEffort: "ultracode",
      }));

      expect(calls[0]?.options).toMatchObject({ effort: "xhigh" });
      expect(settingsFiles[0]?.content).toBe(JSON.stringify({ env: providerEnv, ultracode: true }));
    } finally {
      delete process.env.CONVOY_CLAUDE_PROVIDER_ENV;
    }
  });

  it("gives a managed AWS credential to the Claude child only, and refuses a disabled one (OS-2108)", async () => {
    const { createQuery, calls, settingsFiles } = createQueryMock({ messages: [SESSION_MESSAGE, SUCCESS_RESULT] });
    const runner = createClaudeCodeRunner({ createQuery, claudeAuth: { mode: "mantle", secret: "aws-token", region: "us-east-1" } });
    await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));
    const env = {
      CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_MANTLE: "1", CLAUDE_CODE_USE_VERTEX: "0", CLAUDE_CODE_USE_FOUNDRY: "0",
      AWS_BEARER_TOKEN_BEDROCK: "aws-token", AWS_REGION: "us-east-1",
    };
    expect(calls[0]?.options).toMatchObject({ env });
    expect(settingsFiles[0]?.content).toBe(JSON.stringify({ env }));
    expect(calls[0]?.options?.extraArgs?.settings).not.toContain("aws-token");
    expect(JSON.stringify(process.env)).not.toContain("aws-token");
    const disabled = createClaudeCodeRunner({ createQuery, claudeAuth: { mode: "disabled" } });
    await expect(drain(disabled.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }))).rejects.toThrow(
      "Claude Code is disabled for this project"
    );
    expect(calls).toHaveLength(1);
  });

  const MANAGED_ANTHROPIC_ACCOUNT = { apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" };

  it("selects a managed Anthropic API key over every other credential source (OS-2016)", async () => {
    const { createQuery, calls, settingsFiles } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT], accountInfo: async () => MANAGED_ANTHROPIC_ACCOUNT,
    });
    const runner = createClaudeCodeRunner({ createQuery, claudeAuth: { mode: "anthropic", secret: "sk-ant-managed" } });
    await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));
    const env = {
      CLAUDE_CODE_USE_BEDROCK: "0", CLAUDE_CODE_USE_MANTLE: "0", CLAUDE_CODE_USE_VERTEX: "0", CLAUDE_CODE_USE_FOUNDRY: "0",
      ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_CUSTOM_HEADERS: "", ANTHROPIC_API_KEY: "sk-ant-managed", ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    };
    expect(calls[0]?.options).toMatchObject({ env });
    expect(settingsFiles[0]?.content).toBe(JSON.stringify({ env }));
    expect(JSON.stringify(calls[0]?.options?.extraArgs)).not.toContain("sk-ant-managed");
    expect(JSON.stringify(process.env)).not.toContain("sk-ant-managed");
  });

  it("sends the prompt only after Claude Code confirms it will use the managed Anthropic key (OS-2016)", async () => {
    const firstFrame = async (prompt: QueryParams["prompt"] | undefined) => {
      if (!prompt || typeof prompt === "string") return prompt;
      return Promise.race([prompt[Symbol.asyncIterator]().next().then(() => "sent"), new Promise((r) => setTimeout(() => r("held"), 50))]);
    };
    const gateway = createQueryMock({ messages: [SESSION_MESSAGE, SUCCESS_RESULT], accountInfo: async () => ({ apiProvider: "gateway" }) });
    const blocked = createClaudeCodeRunner({ createQuery: gateway.createQuery, claudeAuth: { mode: "anthropic", secret: "sk-ant-managed" } });
    await expect(drain(blocked.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }))).rejects.toThrow(
      "would not use the assigned Anthropic key"
    );
    expect(await firstFrame(gateway.calls[0]?.prompt)).toBe("held");

    const direct = createQueryMock({ messages: [SESSION_MESSAGE, SUCCESS_RESULT], accountInfo: async () => MANAGED_ANTHROPIC_ACCOUNT });
    const allowed = createClaudeCodeRunner({ createQuery: direct.createQuery, claudeAuth: { mode: "anthropic", secret: "sk-ant-managed" } });
    await drain(allowed.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));
    expect(await firstFrame(direct.calls[0]?.prompt)).toBe("sent");
  });

  it("passes no extraArgs without a provider env marker", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

    expect(calls[0]?.options?.extraArgs).toBeUndefined();
  });

  it("omits includePartialMessages by default", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

    expect(calls[0]?.options?.includePartialMessages).toBeUndefined();
  });

  it("passes includePartialMessages when partial streaming is enabled", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({
      createQuery,
      includePartialMessages: true,
    });
    await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

    expect(calls[0]?.options?.includePartialMessages).toBe(true);
  });

  it("omits sandbox options by default", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

    expect(calls[0]?.options?.sandbox).toBeUndefined();
    expect(calls[0]?.options?.additionalDirectories).toBeUndefined();
  });

  it("enables the OS sandbox with the profile paths when isolated (OS-1242)", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({
      createQuery,
      sandbox: { writableRoots: ["/repos/a", "/repos/b"] },
    });
    await drain(runner.execute("/repos/a", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

    expect(calls[0]?.options?.sandbox).toEqual({
      enabled: true,
      allowUnsandboxedCommands: false,
      filesystem: { allowWrite: ["/repos/a", "/repos/b"] },
    });
    expect(calls[0]?.options?.additionalDirectories).toEqual(["/repos/a", "/repos/b"]);
  });

  it("omits the file-tool guard hook when not isolated", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

    expect(calls[0]?.options?.hooks).toBeUndefined();
  });

  it("blocks file tools outside the sandbox roots via a PreToolUse hook (OS-1242)", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({
      createQuery,
      sandbox: { writableRoots: ["/repos/a"] },
    });
    await drain(runner.execute("/worktrees/w1", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

    const matchers = calls[0]?.options?.hooks?.PreToolUse;
    expect(matchers).toHaveLength(1);
    const hook = matchers?.[0]?.hooks[0];
    if (!hook) throw new Error("guard hook missing");

    const invoke = (toolName: string, toolInput: Record<string, unknown>) =>
      hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: toolName,
          tool_input: toolInput,
          tool_use_id: "tu-1",
          session_id: "session-123",
          transcript_path: "/x",
          cwd: "/worktrees/w1",
        } as Parameters<typeof hook>[0],
        "tu-1",
        { signal: new AbortController().signal }
      );

    // Outside every root → blocked.
    await expect(invoke("Write", { file_path: "/tmp/evil.txt" })).resolves.toMatchObject({
      decision: "block",
    });
    // Traversal escape resolved before checking → blocked.
    await expect(
      invoke("Edit", { file_path: "/repos/a/../../etc/hosts" })
    ).resolves.toMatchObject({ decision: "block" });
    await expect(
      invoke("NotebookEdit", { notebook_path: "/home/user/nb.ipynb" })
    ).resolves.toMatchObject({ decision: "block" });

    // Inside a writable root or the cwd (worktrees) → allowed.
    await expect(invoke("Write", { file_path: "/repos/a/src/x.ts" })).resolves.toEqual({});
    await expect(invoke("Edit", { file_path: "relative/inside-cwd.ts" })).resolves.toEqual({});

    // Non-file tools pass through untouched.
    await expect(invoke("Bash", { command: "ls" })).resolves.toEqual({});
  });

  it("passes the resolved Claude model through the model option", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(
      runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliModel: "opus",
        resolvedCliModel: "claude-opus-4-6",
      })
    );

    expect(calls[0]?.options?.model).toBe("claude-opus-4-6");
  });

  it.each([undefined, "previous-session"])("forwards Opus 5.5 for continuation %s", async (continuationId) => {
    const { createQuery, calls } = createQueryMock({ messages: [SESSION_MESSAGE, SUCCESS_RESULT] });
    const runner = createClaudeCodeRunner({ createQuery });
    await drain(runner.execute("/repo", "prompt", {
      threadId: "thread_test", cliType: "claude-code", cliModel: "opus-5-5",
      resolvedCliModel: "claude-opus-5-5", resolvedCliEffort: "high", continuationId,
    }));
    expect(calls[0]?.options).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
    expect(calls[0]?.options?.resume).toBe(continuationId);
    expect(calls[0]?.options?.thinking).toBeUndefined();
    if (continuationId) expect(calls[0]?.options?.forkSession).toBe(true);
  });

  it("omits the model option when the default Claude model is selected", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(
      runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliModel: "default",
      })
    );

    expect(calls[0]?.options?.model).toBeUndefined();
  });

  it("uses permissionMode=plan with the appended plan system prompt for plan runs", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(
      runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "plan",
      })
    );

    expect(calls[0]?.options).toMatchObject({
      permissionMode: "plan",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: `${PLAN_MODE_SYSTEM_PROMPT}\n\n${IDENTITY_LINE}`,
      },
    });
    expect(calls[0]?.options?.allowDangerouslySkipPermissions).toBe(true);
  });

  it("does not append the plan system prompt for agent runs", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(
      runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "agent",
      })
    );

    expect(calls[0]?.options?.permissionMode).toBe("bypassPermissions");
    expect(calls[0]?.options?.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      // The thread-identity line (OS-1223) rides the append on every run.
      append: IDENTITY_LINE,
    });
  });

  it("installs canUseTool in bypass/agent mode so AskUserQuestion still waits", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(
      runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "agent",
        interactionBridge: {
          request: async () => JSON.stringify({ answers: {} }),
          cancel: () => {},
        },
      })
    );

    expect(calls[0]?.options?.permissionMode).toBe("bypassPermissions");
    // Without it, tools flagged requiresUserInteraction resolve unanswered.
    expect(calls[0]?.options?.canUseTool).toBeTypeOf("function");
    // The control channel needs streaming input held open for the run.
    expect(typeof calls[0]?.prompt).not.toBe("string");
  });

  it.each(["agent", "plan", "default"] as const)("bridges MCP forms in %s mode with schema and server identity", async (cliMode) => {
    const { createQuery, calls } = createQueryMock({ messages: [SESSION_MESSAGE, SUCCESS_RESULT] });
    const request = vi.fn().mockResolvedValue(JSON.stringify({ action: "accept", content: { count: 2 } }));
    const runner = createClaudeCodeRunner({ createQuery });
    await drain(runner.execute("/repo", "prompt", {
      threadId: "thread_test", cliType: "claude-code", cliMode,
      interactionBridge: { request, cancel: vi.fn() },
    }));
    const callback = calls[0]?.options?.onElicitation;
    expect(callback).toBeTypeOf("function");
    const input = { serverName: "survey", message: "How many?", requestedSchema: {
      type: "object", properties: { count: { type: "integer", minimum: 1 } }, required: ["count"],
    } };
    expect(await callback?.(input, { signal: new AbortController().signal, requestId: "request-1" })).toEqual({ action: "accept", content: { count: 2 } });
    expect(JSON.parse(request.mock.calls[0][0].payloadJson)).toMatchObject({
      ...input, mode: "form", elicitation: true, isBlocking: true,
    });
  });

  it.each([
    [{ api_error_status: 529 }, "overloaded (529)"],
    [{ terminal_reason: "prompt_too_long" }, "context window"],
    [{ terminal_reason: "api_error" }, "API errors"],
  ])("fails success-tagged structured errors %j", async (fields, message) => {
    const { createQuery } = createQueryMock({ messages: [SESSION_MESSAGE, makeSdkMessage({ ...SUCCESS_RESULT, result: "", ...fields })] });
    const runner = createClaudeCodeRunner({ createQuery });
    await expect(drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }))).rejects.toThrow(message);
  });

  it.each(["aborted_tools", "aborted_streaming"])("does not fail explicit provider interruption %s", async (terminal_reason) => {
    const { createQuery } = createQueryMock({ messages: [SESSION_MESSAGE, makeSdkMessage({
      type: "result", subtype: "error_during_execution", is_error: true, terminal_reason, errors: [],
    })] });
    const runner = createClaudeCodeRunner({ createQuery });
    await expect(drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }))).resolves.toMatchObject({ result: { continuationId: "session-123" } });
  });

  it("appends the agent prompt to the system prompt preset on every run", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(
      runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "agent",
        agentPrompt: "You are a meticulous reviewer.",
        agentName: "Reviewer",
        workspaceNotice: "Working directory recovered to /workspace.",
        // Resumed run: appends do not survive resume, so it must re-appear.
        continuationId: "session-prev",
      })
    );

    expect(calls[0]?.options?.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: `You are a meticulous reviewer.\n\n${IDENTITY_LINE}\n\nWorking directory recovered to /workspace.`,
    });
  });

  it("composes agent prompt first, then plan instructions, for plan runs", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(
      runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "plan",
        agentPrompt: "You are a meticulous reviewer.",
      })
    );

    expect(calls[0]?.options?.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: `You are a meticulous reviewer.\n\n${PLAN_MODE_SYSTEM_PROMPT}\n\n${IDENTITY_LINE}`,
    });
  });

  it("strips the Convoy API key from the subprocess environment", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

    const env = calls[0]?.options?.env;
    expect(env).toBeDefined();
    expect(env).toHaveProperty("CONVOY_API_KEY", undefined);
    expect(env?.CONVOY_THREAD_ID).toBe("thread_test");
    expect(typeof env?.HOME).toBe("string");
  });

  it("honors the CONVOY_CLAUDE_EXECUTABLE override", async () => {
    process.env.CONVOY_CLAUDE_EXECUTABLE = "/custom/claude";
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));

    expect(resolveExecutableMock).toHaveBeenCalledWith("claude", {
      executablePath: "/custom/claude",
    });
    expect(calls[0]?.options?.pathToClaudeCodeExecutable).toBe("/custom/claude");
  });

  it("converts stream-json bootstrap frames into SDK user messages", async () => {
    const { createQuery, calls } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const content = [
      { type: "text", text: "hello" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "aaaa" },
      },
    ];

    const runner = createClaudeCodeRunner({ createQuery });
    await drain(
      runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        inputFormat: "stream-json",
        bootstrapInput: [{ type: "user", message: { role: "user", content } }],
      })
    );

    const promptInput = calls[0]?.prompt;
    expect(typeof promptInput).not.toBe("string");
    const messages = await collectAsyncIterable(
      promptInput as AsyncIterable<SDKUserMessage>
    );
    expect(messages).toEqual([
      {
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
        uuid: expect.any(String),
      },
    ]);
  });

  it("fails stream-json runs without valid bootstrap frames", async () => {
    const { createQuery } = createQueryMock();

    const runner = createClaudeCodeRunner({ createQuery });
    const generator = runner.execute("/repo", "prompt", {
      threadId: "thread_test",
      cliType: "claude-code",
      inputFormat: "stream-json",
      bootstrapInput: [],
    });

    await expect(generator.next()).rejects.toThrow(
      "Claude stream-json input requires bootstrapInput frames"
    );
    expect(createQuery).not.toHaveBeenCalled();
  });

  it("fails when a completed run does not emit a continuation id", async () => {
    const { createQuery } = createQueryMock({
      messages: [
        makeSdkMessage({ type: "assistant", message: { role: "assistant", content: [] } }),
      ],
    });

    const runner = createClaudeCodeRunner({ createQuery });

    await expect(
      drain(
        runner.execute("/repo", "prompt", {
          threadId: "thread_test",
          cliType: "claude-code",
          requireContinuation: true,
        })
      )
    ).rejects.toThrow(
      "Claude run completed without session_id/sessionId in stream-json output"
    );
  });

  it("allows completed runs without continuation when continuation is not required", async () => {
    const { createQuery } = createQueryMock({
      messages: [
        makeSdkMessage({ type: "assistant", message: { role: "assistant", content: [] } }),
      ],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    await expect(
      drain(
        runner.execute("/repo", "prompt", {
          threadId: "thread_test",
          cliType: "claude-code",
          requireContinuation: false,
        })
      )
    ).resolves.toMatchObject({ result: {} });
  });

  it("fails runs whose result message reports an error subtype", async () => {
    const { createQuery } = createQueryMock({
      messages: [
        SESSION_MESSAGE,
        makeSdkMessage({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          session_id: "session-123",
          errors: ["boom"],
        }),
      ],
    });

    const runner = createClaudeCodeRunner({ createQuery });

    let thrown: unknown;
    try {
      await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RunnerExecutionError);
    if (!(thrown instanceof RunnerExecutionError)) return;
    expect(thrown.message).toMatch(/reason=result_error_during_execution/);
    expect(thrown.message).toMatch(/detail=boom/);
    expect(thrown.continuationId).toBe("session-123");
  });

  // OS-1807: an API error reaches the SDK as a synthetic assistant message and a
  // `success` result with `is_error`, carrying no `errors[]` — so the failure read
  // "reason=result_success" with nothing to act on.
  it("reports the synthetic assistant text for an errored success result", async () => {
    const { createQuery } = createQueryMock({
      messages: [
        SESSION_MESSAGE,
        makeSdkMessage({
          type: "assistant",
          session_id: "session-123",
          message: {
            model: "<synthetic>",
            role: "assistant",
            stop_reason: "stop_sequence",
            content: [{ type: "text", text: "API Error: 429 rate limit exceeded" }],
          },
        }),
        makeSdkMessage({
          type: "result",
          subtype: "success",
          is_error: true,
          session_id: "session-123",
        }),
      ],
    });

    const runner = createClaudeCodeRunner({ createQuery });

    let thrown: unknown;
    try {
      await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RunnerExecutionError);
    if (!(thrown instanceof RunnerExecutionError)) return;
    expect(thrown.message).toMatch(/reason=result_success/);
    expect(thrown.message).toMatch(/detail=API Error: 429 rate limit exceeded/);
  });

  it("wraps SDK stream errors with the stderr tail and observed continuation", async () => {
    const { createQuery } = createQueryMock({
      messages: [SESSION_MESSAGE],
      emitStderr: ["Claude auth missing"],
      throwAfterMessages: new Error("Claude Code process exited with code 1"),
    });

    const runner = createClaudeCodeRunner({ createQuery });

    let thrown: unknown;
    try {
      await drain(runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RunnerExecutionError);
    if (!(thrown instanceof RunnerExecutionError)) return;
    expect(thrown.message).toMatch(/reason=sdk_error/);
    expect(thrown.message).toMatch(/Claude Code process exited with code 1/);
    expect(thrown.message).toMatch(/stderrTail=Claude auth missing/);
    expect(thrown.continuationId).toBe("session-123");
  });

  it("rejects unsupported cli types", async () => {
    const { createQuery } = createQueryMock();
    const runner = createClaudeCodeRunner({ createQuery });
    const generator = runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "codex" });

    await expect(generator.next()).rejects.toThrow(
      'Unsupported cliType "codex" for SDK runner. Only "claude-code" is supported.'
    );
    expect(createQuery).not.toHaveBeenCalled();
  });

  it("closes the active query when aborted", async () => {
    const { createQuery, closeMock } = createQueryMock({
      messages: [SESSION_MESSAGE, SUCCESS_RESULT],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    const generator = runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" });

    // Start the run so the query is active.
    await generator.next();
    runner.abort();
    expect(closeMock).toHaveBeenCalled();

    // Drain remaining output; the mocked stream ends normally.
    await drain(generator);
  });

  it("refuses new executions after shutdown", async () => {
    const { createQuery } = createQueryMock();
    const runner = createClaudeCodeRunner({ createQuery });

    await runner.shutdown();
    await runner.shutdown();

    const generator = runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" });
    await expect(generator.next()).rejects.toThrow("Claude runner is shut down");
    expect(createQuery).not.toHaveBeenCalled();
  });

  it.each(["plan", "elicitation"])("does not idle-time-out while %s waits on the user", async (kind) => {
    vi.useFakeTimers();
    try {
      let answerRequest: ((responseJson: string) => void) | undefined;
      const createQuery = vi.fn((params: QueryParams): Query => {
        async function* stream(): AsyncGenerator<SDKMessage, void> {
          yield SESSION_MESSAGE;
          if (kind === "elicitation") {
            await params.options?.onElicitation?.({ serverName: "survey", message: "Answer", mode: "form", requestedSchema: { type: "object", properties: {} } }, { signal: new AbortController().signal, requestId: "request-1" });
          } else await params.options?.canUseTool?.(
            "ExitPlanMode",
            { plan: "# Plan" },
            { signal: new AbortController().signal } as Parameters<
              NonNullable<ClaudeAgentOptions["canUseTool"]>
            >[2]
          );
          yield SUCCESS_RESULT;
        }

        return Object.assign(stream(), {
          close: vi.fn(),
          interrupt: vi.fn().mockResolvedValue(undefined),
        }) as unknown as Query;
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const drainPromise = drain(
        runner.execute("/repo", "prompt", {
          threadId: "thread_test",
          cliType: "claude-code",
          cliMode: "plan",
          interactionBridge: {
            request: () =>
              new Promise<string>((resolve) => {
                answerRequest = resolve;
              }),
            cancel: () => {},
          },
        })
      );

      // Well past IDLE_TIMEOUT_MS (10 min) — the user is still deciding.
      await vi.advanceTimersByTimeAsync(25 * 60_000);
      expect(answerRequest).toBeTypeOf("function");

      answerRequest?.(JSON.stringify({ decision: "deny" }));
      await vi.advanceTimersByTimeAsync(0);

      const { chunks } = await drainPromise;
      expect(chunks.map((chunk) => chunk.type)).toEqual(["system", "result"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["plan", "elicitation"])("does not fail a %s wait interrupted by the user", async (kind) => {
    // Gracefully stopping a run parked on a plan approval interrupts a turn
    // with an unresolved tool_use; the CLI then ends the turn with an
    // error_during_execution result ("[ede_diagnostic] … stop_reason=tool_use").
    // Self-inflicted: the run must wind down cleanly, not read as failed.
    let interrupted = false;
    // interrupt() aborts the parked canUseTool's signal, like the real SDK.
    const toolAbort = new AbortController();
    const createQuery = vi.fn((params: QueryParams): Query => {
      async function* stream(): AsyncGenerator<SDKMessage, void> {
        yield SESSION_MESSAGE;
        if (kind === "elicitation") {
          await params.options?.onElicitation?.({ serverName: "survey", message: "Answer", requestedSchema: { type: "object", properties: {} } }, { signal: toolAbort.signal, requestId: "request-1" });
        } else await params.options?.canUseTool?.(
          "ExitPlanMode",
          { plan: "# Plan" },
          { signal: toolAbort.signal } as Parameters<
            NonNullable<ClaudeAgentOptions["canUseTool"]>
          >[2]
        );
        yield makeSdkMessage({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          session_id: "session-123",
          errors: [
            "[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use",
          ],
          result: null,
        });
      }

      return Object.assign(stream(), {
        close: vi.fn(),
        interrupt: vi.fn().mockImplementation(async () => {
          interrupted = true;
          toolAbort.abort();
        }),
      }) as unknown as Query;
    });

    const runner = createClaudeCodeRunner({ createQuery });
    const generator = runner.execute("/repo", "prompt", {
      threadId: "thread_test",
      cliType: "claude-code",
      cliMode: "plan",
      interactionBridge: {
        request: (_input, signal) =>
          new Promise<string>((_resolve, reject) => {
            // Mirror the real bridge: an already-aborted signal rejects
            // immediately (abort() can land before the request is created).
            if (signal.aborted) {
              reject(new Error("Approval request aborted"));
              return;
            }
            signal.addEventListener("abort", () => {
              reject(new Error("Approval request aborted"));
            });
          }),
        cancel: () => {},
      },
    });

    // Start the run and let it park on the plan gate.
    const first = await generator.next();
    expect(first.done).toBe(false);

    // Graceful stop while parked (the canUseTool deny unblocks the stream,
    // which then emits the self-inflicted error result).
    runner.abort();

    const { chunks, result } = await drain(generator);
    expect(interrupted).toBe(true);
    expect(chunks.some((chunk) => chunk.type === "result")).toBe(true);
    expect(result?.continuationId).toBe("session-123");
  });

  it("still fails on an error result the run produced on its own", async () => {
    const { createQuery } = createQueryMock({
      messages: [
        SESSION_MESSAGE,
        makeSdkMessage({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          session_id: "session-123",
          errors: ["genuine failure"],
          result: null,
        }),
      ],
    });

    const runner = createClaudeCodeRunner({ createQuery });
    let thrown: unknown;
    try {
      await drain(
        runner.execute("/repo", "prompt", {
          threadId: "thread_test",
          cliType: "claude-code",
        })
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RunnerExecutionError);
    expect((thrown as RunnerExecutionError).message).toMatch(
      /result_error_during_execution/
    );
  });

  describe("context usage snapshot", () => {
    /** Cumulative run usage far above the actual live context size. */
    const AGGREGATE_RESULT = makeSdkMessage({
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "session-123",
      result: "done",
      total_cost_usd: 1.25,
      usage: {
        input_tokens: 4_870,
        cache_creation_input_tokens: 44_000,
        cache_read_input_tokens: 780_000,
        output_tokens: 20_000,
        total_tokens: 848_870,
      },
      modelUsage: {
        "claude-opus-4-6": { contextWindow: 1_000_000 },
      },
    });

    it("emits a snapshot chunk from the SDK control response, not result usage", async () => {
      const { createQuery } = createQueryMock({
        messages: [SESSION_MESSAGE, AGGREGATE_RESULT],
        getContextUsage: () =>
          Promise.resolve({
            totalTokens: 33_729,
            maxTokens: 1_000_000,
            rawMaxTokens: 1_100_000,
            percentage: 3.4,
          }),
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const { chunks } = await drain(
        runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" })
      );

      expect(chunks.map((chunk) => chunk.type)).toEqual([
        "system",
        "result",
        "convoy.context_usage",
      ]);
      // The result chunk stays byte-equivalent to the SDK message.
      expect(chunks[1]?.data).toBe(JSON.stringify(AGGREGATE_RESULT));
      expect(JSON.parse(chunks[2]?.data ?? "{}")).toEqual({
        type: "convoy.context_usage",
        usedTokens: 33_729,
        maxTokens: 1_000_000,
      });
    });

    it("completes without a snapshot when the control request rejects", async () => {
      const { createQuery } = createQueryMock({
        messages: [SESSION_MESSAGE, SUCCESS_RESULT],
        getContextUsage: () =>
          Promise.reject(new Error("control request not supported")),
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const { chunks, result } = await drain(
        runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" })
      );

      expect(chunks.map((chunk) => chunk.type)).toEqual(["system", "result"]);
      expect(result?.continuationId).toBe("session-123");
    });

    it("completes without a snapshot when the query lacks getContextUsage", async () => {
      const { createQuery } = createQueryMock({
        messages: [SESSION_MESSAGE, SUCCESS_RESULT],
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const { chunks, result } = await drain(
        runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" })
      );

      expect(chunks.map((chunk) => chunk.type)).toEqual(["system", "result"]);
      expect(result?.continuationId).toBe("session-123");
    });

    it("waits for a slow context usage control response", async () => {
      vi.useFakeTimers();
      try {
        const { createQuery } = createQueryMock({
          messages: [SESSION_MESSAGE, SUCCESS_RESULT],
          getContextUsage: () =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve({ totalTokens: 34_784, maxTokens: 1_000_000 }),
                7_500
              );
            }),
        });

        const runner = createClaudeCodeRunner({ createQuery });
        const drainPromise = drain(
          runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" })
        );
        await vi.advanceTimersByTimeAsync(7_500);
        const { chunks, result } = await drainPromise;

        expect(chunks.map((chunk) => chunk.type)).toEqual([
          "system",
          "result",
          "convoy.context_usage",
        ]);
        expect(JSON.parse(chunks[2]?.data ?? "{}")).toEqual({
          type: "convoy.context_usage",
          usedTokens: 34_784,
          maxTokens: 1_000_000,
        });
        expect(result?.continuationId).toBe("session-123");
      } finally {
        vi.useRealTimers();
      }
    });

    it("skips snapshots with non-positive token values", async () => {
      const { createQuery } = createQueryMock({
        messages: [SESSION_MESSAGE, SUCCESS_RESULT],
        getContextUsage: () =>
          Promise.resolve({ totalTokens: 0, maxTokens: -1 }),
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const { chunks } = await drain(
        runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" })
      );

      expect(chunks.map((chunk) => chunk.type)).toEqual(["system", "result"]);
    });
  });

  // OS-1806: the init event advertises names only, so the descriptions and
  // argument hints the composer menu shows come from a control request.
  describe("slash command inventory", () => {
    it("reports the inventory as a convoy.commands chunk", async () => {
      const { createQuery } = createQueryMock({
        messages: [SESSION_MESSAGE, SUCCESS_RESULT],
        supportedCommands: () =>
          Promise.resolve([
            { name: "compact", description: "Compact the conversation", argumentHint: "" },
            { name: "review", description: "Review a PR", argumentHint: "[pr-number]" },
          ]),
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const { chunks } = await drain(
        runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" })
      );

      const inventory = chunks.find((chunk) => chunk.type === "convoy.commands");
      expect(JSON.parse(inventory?.data ?? "{}")).toEqual({
        commands: [
          // An empty hint is dropped rather than rendered as an empty label.
          { name: "compact", description: "Compact the conversation" },
          { name: "review", description: "Review a PR", argumentHint: "[pr-number]" },
        ],
      });
    });

    it("completes without an inventory when the control request rejects", async () => {
      const { createQuery } = createQueryMock({
        messages: [SESSION_MESSAGE, SUCCESS_RESULT],
        supportedCommands: () => Promise.reject(new Error("not supported")),
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const { chunks, result } = await drain(
        runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" })
      );

      expect(chunks.map((chunk) => chunk.type)).toEqual(["system", "result"]);
      expect(result?.continuationId).toBe("session-123");
    });
  });

  describe("steering", () => {
    /**
     * A fake SDK query that consumes the streaming input and emits one
     * assistant + result pair per user message — the shape of a steer that
     * lands after the turn finalized (queued turn, drained after input EOF).
     * Mid-turn absorption is modeled separately below.
     */
    function createSteeringQueryMock(behavior: {
      getContextUsage?: () => Promise<unknown>;
    } = {}) {
      const closeMock = vi.fn();
      const interruptMock = vi.fn().mockResolvedValue(undefined);
      const calls: QueryParams[] = [];
      const receivedUserMessages: SDKUserMessage[] = [];
      const setPermissionModeMock = vi.fn().mockResolvedValue(undefined);

      const createQuery = vi.fn((params: QueryParams): Query => {
        calls.push(params);

        async function* stream(): AsyncGenerator<SDKMessage, void> {
          yield SESSION_MESSAGE;
          const input = params.prompt;
          if (typeof input === "string") {
            throw new Error("steering mock requires streaming input");
          }
          for await (const userMessage of input) {
            receivedUserMessages.push(userMessage);
            yield makeSdkMessage({
              type: "assistant",
              message: { role: "assistant", content: [] },
            });
            yield makeSdkMessage({
              type: "result",
              subtype: "success",
              is_error: false,
              session_id: "session-123",
            });
          }
        }

        const generator = stream();
        return Object.assign(generator, {
          close: closeMock,
          interrupt: interruptMock,
          setPermissionMode: setPermissionModeMock,
          ...(behavior.getContextUsage
            ? { getContextUsage: behavior.getContextUsage }
            : {}),
        }) as unknown as Query;
      });

      return { createQuery, closeMock, interruptMock, calls, receivedUserMessages, setPermissionModeMock };
    }

    it("opens streaming input for steer-enabled bypass runs and ends after the first result", async () => {
      const { createQuery, calls } = createSteeringQueryMock();

      const runner = createClaudeCodeRunner({ createQuery });
      const { chunks, result } = await drain(
        runner.execute("/repo", "prompt", {
          threadId: "thread_test",
          cliType: "claude-code",
          cliMode: "agent",
          steerEnabled: true,
        })
      );

      expect(typeof calls[0]?.prompt).not.toBe("string");
      expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(1);
      expect(result?.continuationId).toBe("session-123");
    });

    it("drains a queued steered turn after ending the input", async () => {
      const { createQuery, receivedUserMessages } = createSteeringQueryMock();

      const runner = createClaudeCodeRunner({ createQuery });
      const generator = runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "agent",
        steerEnabled: true,
      });

      // Pull the first chunk so the run is active, then steer.
      const first = await generator.next();
      expect(first.done).toBe(false);
      expect(runner.steer?.({ prompt: "steer prompt", inputFormat: "prompt" })).toBe(true);

      const { chunks } = await drain(generator);
      expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(2);
      expect(receivedUserMessages).toHaveLength(2);
      expect(receivedUserMessages[1]?.message.content).toBe("steer prompt");
    });

    it("completes when a mid-turn steer is absorbed without an extra result", async () => {
      // Claude Code injects mid-turn pushes into the running turn: the frame
      // is consumed from the input but produces no additional result.
      const receivedUserMessages: SDKUserMessage[] = [];
      const createQuery = vi.fn((params: QueryParams): Query => {
        async function* stream(): AsyncGenerator<SDKMessage, void> {
          yield SESSION_MESSAGE;
          const input = params.prompt as AsyncIterable<SDKUserMessage>;
          let turnEmitted = false;
          for await (const userMessage of input) {
            receivedUserMessages.push(userMessage);
            if (!turnEmitted) {
              turnEmitted = true;
              yield makeSdkMessage({
                type: "assistant",
                message: { role: "assistant", content: [] },
              });
              yield SUCCESS_RESULT;
            }
            // Later frames are absorbed silently; the stream only ends once
            // the runner closes the input.
          }
        }
        const generator = stream();
        return Object.assign(generator, {
          close: vi.fn(),
          interrupt: vi.fn().mockResolvedValue(undefined),
        }) as unknown as Query;
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const generator = runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "agent",
        steerEnabled: true,
      });

      const first = await generator.next();
      expect(first.done).toBe(false);
      expect(runner.steer?.({ prompt: "absorbed steer", inputFormat: "prompt" })).toBe(true);

      const { chunks, result } = await drain(generator);
      expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(1);
      expect(receivedUserMessages).toHaveLength(2);
      expect(result?.continuationId).toBe("session-123");
    });

    it("emits one context usage snapshot after each completed turn", async () => {
      let snapshotCalls = 0;
      const { createQuery } = createSteeringQueryMock({
        getContextUsage: () => {
          snapshotCalls += 1;
          return Promise.resolve({
            totalTokens: 30_000 + snapshotCalls,
            maxTokens: 1_000_000,
          });
        },
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const generator = runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "agent",
        steerEnabled: true,
      });

      const first = await generator.next();
      expect(first.done).toBe(false);
      expect(runner.steer?.({ prompt: "steer prompt", inputFormat: "prompt" })).toBe(true);

      const { chunks } = await drain(generator);
      const types = chunks.map((chunk) => chunk.type);
      expect(types.filter((type) => type === "result")).toHaveLength(2);
      expect(types.filter((type) => type === "convoy.context_usage")).toHaveLength(2);
      // Each snapshot directly follows its result.
      for (const [index, type] of types.entries()) {
        if (type === "convoy.context_usage") {
          expect(types[index - 1]).toBe("result");
        }
      }
    });

    it("switches the session to the steered message's mode before injecting it", async () => {
      const { createQuery, calls, receivedUserMessages, setPermissionModeMock } = createSteeringQueryMock();

      const runner = createClaudeCodeRunner({ createQuery });
      const generator = runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "default",
        steerEnabled: true,
      });

      const first = await generator.next();
      expect(first.done).toBe(false);
      expect(await runner.steer?.({ prompt: "now act", inputFormat: "prompt" }, "agent")).toBe(true);

      await drain(generator);
      // Bypass is only reachable mid-run when the session opted into it at start.
      expect(calls[0]?.options?.allowDangerouslySkipPermissions).toBe(true);
      expect(setPermissionModeMock).toHaveBeenCalledWith("bypassPermissions");
      expect(receivedUserMessages[1]?.message.content).toBe("now act");
    });

    it("injects stream-json steer frames with their content blocks", async () => {
      const { createQuery, receivedUserMessages } = createSteeringQueryMock();
      const content = [
        { type: "text", text: "look at this" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "bbbb" },
        },
      ];

      const runner = createClaudeCodeRunner({ createQuery });
      const generator = runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "agent",
        steerEnabled: true,
      });

      await generator.next();
      expect(
        runner.steer?.({
          prompt: "unused",
          inputFormat: "stream-json",
          bootstrapInput: [{ type: "user", message: { role: "user", content } }],
        })
      ).toBe(true);

      await drain(generator);
      expect(receivedUserMessages[1]).toEqual({
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
        uuid: expect.any(String),
      });
    });

    it("returns false from steer once the run has ended", async () => {
      const { createQuery } = createSteeringQueryMock();

      const runner = createClaudeCodeRunner({ createQuery });
      await drain(
        runner.execute("/repo", "prompt", {
          threadId: "thread_test",
          cliType: "claude-code",
          cliMode: "agent",
          steerEnabled: true,
        })
      );

      expect(runner.steer?.({ prompt: "too late", inputFormat: "prompt" })).toBe(false);
    });

    it("returns false from steer for runs without steering enabled", async () => {
      const { createQuery } = createQueryMock({
        messages: [SESSION_MESSAGE, SUCCESS_RESULT],
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const generator = runner.execute("/repo", "prompt", { threadId: "thread_test", cliType: "claude-code" });
      await generator.next();

      expect(runner.steer?.({ prompt: "nope", inputFormat: "prompt" })).toBe(false);

      await drain(generator);
    });
  });

  /**
   * Background agents run in-process, so ending the turn at the first result killed
   * them — losing their output, and making the next resume synthesize a "was running
   * when the previous process exited" failure (OS-1661).
   */
  describe("live background agents", () => {
    const TIMEOUT_CHUNK_TYPE = "convoy.background_wait_timeout";

    const backgroundTasksChanged = (
      tasks: Array<{ task_id: string; task_type?: string }>
    ): SDKMessage =>
      makeSdkMessage({
        type: "system",
        subtype: "background_tasks_changed",
        session_id: "session-123",
        tasks,
      });

    /** The edge event that marks a task as spawned by *this* turn's tool call. */
    const taskStarted = (taskId: string, taskType = "local_agent"): SDKMessage =>
      makeSdkMessage({
        type: "system",
        subtype: "task_started",
        session_id: "session-123",
        task_id: taskId,
        tool_use_id: `toolu_${taskId}`,
        task_type: taskType,
      });

    const AGENT_DONE = makeSdkMessage({
      type: "system",
      subtype: "task_notification",
      session_id: "session-123",
      task_id: "agent-1",
      status: "completed",
      summary: "agent finished",
    });

    const spawnAgentMessages = [
      SESSION_MESSAGE,
      taskStarted("agent-1"),
      backgroundTasksChanged([{ task_id: "agent-1", task_type: "local_agent" }]),
    ];

    const runToCompletion = (createQuery: ReturnType<typeof createQueryMock>["createQuery"]) =>
      drain(
        createClaudeCodeRunner({ createQuery }).execute("/repo", "prompt", {
          threadId: "thread_test",
          cliType: "claude-code",
          cliMode: "agent",
          steerEnabled: true,
        })
      );

    it("holds the spawning turn open so the agent's own result lands after it", async () => {
      const { createQuery } = createQueryMock({
        messages: [
          ...spawnAgentMessages,
          // The turn that spawned the agent finishes here; the old code stopped reading.
          SUCCESS_RESULT,
          AGENT_DONE,
          backgroundTasksChanged([]),
          SUCCESS_RESULT,
        ],
      });

      const { chunks } = await runToCompletion(createQuery);

      // Ordering is the guarantee: the agent's completion has to fall *between* the two
      // results. A count alone passes for any code that merely reads past the first one.
      const types = chunks.map((chunk) => chunk.type);
      const resultIndexes = types.flatMap((type, index) => (type === "result" ? [index] : []));
      const noticeIndex = chunks.findIndex((chunk) => chunk.data.includes("agent finished"));
      expect(resultIndexes).toHaveLength(2);
      expect(noticeIndex).toBeGreaterThan(resultIndexes[0] as number);
      expect(noticeIndex).toBeLessThan(resultIndexes[1] as number);
    });

    it("keeps spawned background shell jobs alive after the foreground answer", async () => {
      const { createQuery } = createQueryMock({
        messages: [
          SESSION_MESSAGE,
          taskStarted("bash-1", "local_bash"),
          backgroundTasksChanged([{ task_id: "bash-1", task_type: "local_bash" }]),
          SUCCESS_RESULT,
          makeSdkMessage({
            type: "system",
            subtype: "task_notification",
            task_id: "bash-1",
            status: "completed",
            summary: "Background shell finished",
          }),
          backgroundTasksChanged([]),
          SUCCESS_RESULT,
        ],
      });

      const { chunks } = await runToCompletion(createQuery);

      expect(chunks.map((chunk) => chunk.data).join("\n")).toContain("Background shell finished");
      expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(2);
    });

    it("does not hold for remote jobs or shell jobs this turn did not spawn", async () => {
      const { createQuery } = createQueryMock({
        messages: [
          SESSION_MESSAGE,
          taskStarted("remote-1", "remote_agent"),
          backgroundTasksChanged([
            { task_id: "remote-1", task_type: "remote_agent" },
            { task_id: "unowned-shell", task_type: "local_bash" },
          ]),
          SUCCESS_RESULT,
          makeSdkMessage({ type: "assistant", message: { role: "assistant", content: [] } }),
        ],
      });
      const { chunks } = await runToCompletion(createQuery);
      expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(1);
      expect(chunks.some((chunk) => chunk.type === "assistant")).toBe(false);
    });

    /**
     * The registry also holds entries this turn never spawned — the CLI registers its own
     * backgrounded main session as a `local_agent`. Holding for those could never clear.
     */
    it("ignores live entries the turn never spawned via a tool call", async () => {
      const { createQuery } = createQueryMock({
        messages: [
          SESSION_MESSAGE,
          backgroundTasksChanged([{ task_id: "main-session", task_type: "local_agent" }]),
          SUCCESS_RESULT,
          makeSdkMessage({ type: "assistant", message: { role: "assistant", content: [] } }),
        ],
      });

      const { chunks } = await runToCompletion(createQuery);

      expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(1);
      expect(chunks.some((chunk) => chunk.type === "assistant")).toBe(false);
    });

    /**
     * A resume after a killed background job replays its orphan `task_notification` as its
     * own no-model turn ahead of the prompt. Ending at that `result` dropped the prompt.
     */
    describe("orphan notification turn on resume", () => {
      const ORPHAN_NOTICE = makeSdkMessage({
        type: "system",
        subtype: "task_notification",
        session_id: "session-123",
        task_id: "previous-shell",
        status: "stopped",
        summary: "Background shell command didn't finish before the previous session ended",
      });
      const ORPHAN_RESULT = makeSdkMessage({ ...SUCCESS_RESULT, num_turns: 0, result: "" });
      const REPLY = makeSdkMessage({
        type: "assistant",
        session_id: "session-123",
        message: { role: "assistant", content: [{ type: "text", text: "the answer" }] },
      });
      const LATE = makeSdkMessage({ type: "assistant", message: { role: "assistant", content: [] } });

      it("keeps reading past the orphan's result to answer the prompt", async () => {
        const { createQuery } = createQueryMock({
          messages: [ORPHAN_NOTICE, SESSION_MESSAGE, ORPHAN_RESULT, SESSION_MESSAGE, REPLY, SUCCESS_RESULT, LATE],
        });

        const { chunks } = await runToCompletion(createQuery);

        expect(chunks.map((chunk) => chunk.data).join("\n")).toContain("the answer");
        expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(2);
        expect(chunks.filter((chunk) => chunk.type === "assistant")).toHaveLength(1);
      });

      it("ends at a result stamped with the prompt's uuid even after an orphan notice", async () => {
        const { createQuery } = createQueryMock({
          messages: [ORPHAN_NOTICE, SESSION_MESSAGE, REPLY],
          messagesForPrompt: (frame) => [
            makeSdkMessage({ ...SUCCESS_RESULT, user_message_uuids: [frame.uuid] }),
            LATE,
          ],
        });

        const { chunks } = await runToCompletion(createQuery);

        expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(1);
        expect(chunks.filter((chunk) => chunk.type === "assistant")).toHaveLength(1);
      });
    });

    it("keeps holding when a snapshot arrives malformed rather than clearing the gate", async () => {
      const { createQuery } = createQueryMock({
        messages: [
          ...spawnAgentMessages,
          // `tasks` keyed by id instead of an array: unusable, so prior state must stand.
          makeSdkMessage({
            type: "system",
            subtype: "background_tasks_changed",
            session_id: "session-123",
            tasks: { "agent-1": { task_type: "local_agent" } },
          }),
          SUCCESS_RESULT,
          AGENT_DONE,
          backgroundTasksChanged([]),
          SUCCESS_RESULT,
        ],
      });

      const { chunks } = await runToCompletion(createQuery);

      expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(2);
      expect(chunks.map((chunk) => chunk.data).join("\n")).toContain("agent finished");
    });

    /**
     * The normal shape: a running agent emits `task_progress`, which keeps the loop busy —
     * so a deadline consulted only at a `result` never fires and the ceiling does not exist.
     */
    it("ends the turn at the ceiling while an agent keeps emitting progress", async () => {
      const progress = Array.from({ length: 8 }, () =>
        makeSdkMessage({
          type: "system",
          subtype: "task_progress",
          session_id: "session-123",
          task_id: "agent-1",
        })
      );
      const { createQuery } = createQueryMock({
        messages: [...spawnAgentMessages, SUCCESS_RESULT, ...progress],
      });

      // The clock advances 10 simulated minutes per progress message, so the 1-hour
      // ceiling passes mid-stream rather than after a fixed number of next() calls.
      let now = 1_000_000;
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
      try {
        const runner = createClaudeCodeRunner({ createQuery });
        const generator = runner.execute("/repo", "prompt", {
          threadId: "thread_test",
          cliType: "claude-code",
          cliMode: "agent",
          steerEnabled: true,
        });

        const chunks: Array<{ type: string; data: string }> = [];
        while (true) {
          const next = await generator.next();
          if (next.done) break;
          chunks.push(next.value);
          if (next.value.data.includes("task_progress")) {
            now += 600_000;
          }
        }

        // The ceiling fires mid-progress instead of draining all 8.
        const notices = chunks.filter((chunk) => chunk.type === TIMEOUT_CHUNK_TYPE);
        expect(notices).toHaveLength(1);
        expect(JSON.parse(notices[0]!.data)).toMatchObject({ waitedMs: 3_600_000 });
        expect(chunks.filter((chunk) => chunk.data.includes("task_progress")).length).toBeLessThan(
          progress.length
        );
        // The notice is the last thing the turn emits.
        expect(chunks[chunks.length - 1]?.type).toBe(TIMEOUT_CHUNK_TYPE);
      } finally {
        nowSpy.mockRestore();
      }
    });

    /** A silent hold must end with the notice, not a generic `timeout_idle` failure. */
    it.each([false, true])("limits shell-only holds to thirty minutes, silent=%s", async (silent) => {
      const progress = Array.from({ length: 8 }, () => makeSdkMessage({ type: "system", subtype: "task_progress", task_id: "shell" }));
      const { createQuery } = createQueryMock({
        messages: [SESSION_MESSAGE, taskStarted("shell", "local_bash"),
          backgroundTasksChanged([{ task_id: "shell", task_type: "local_bash" }]), SUCCESS_RESULT,
          ...(silent ? [] : progress)],
        stallAfterMessages: silent,
      });
      let now = 1_000_000;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
      const timer = silent ? vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
        now += ms ?? 0; queueMicrotask(fn); return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout) : undefined;
      try {
        const chunks = [];
        let holdStart = now;
        for await (const chunk of createClaudeCodeRunner({ createQuery }).execute("/repo", "prompt", {
          threadId: "thread_test", cliType: "claude-code", cliMode: "agent", steerEnabled: true,
        })) {
          chunks.push(chunk);
          if (chunk.type === "result") holdStart = now;
          if (chunk.data.includes("task_progress")) now += 600_000;
        }
        const notice = chunks.find(c => c.type === TIMEOUT_CHUNK_TYPE);
        expect(notice).toBeDefined();
        expect(JSON.parse(notice!.data)).toMatchObject({ waitedMs: 1_800_000, taskKind: "shell", taskCount: 1 });
        expect(now - holdStart).toBeGreaterThanOrEqual(1_800_000);
        expect(now - holdStart).toBeLessThanOrEqual(2_400_000);
      } finally { timer?.mockRestore(); clock.mockRestore(); }
    });

    it("reports the ceiling instead of an idle timeout when the agent goes silent", async () => {
      const { createQuery } = createQueryMock({
        messages: [...spawnAgentMessages, SUCCESS_RESULT],
        // Nothing ever arrives after the result: the hold is silent.
        stallAfterMessages: true,
      });

      let now = 1_000_000;
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
      const timeoutSpy = vi
        .spyOn(globalThis, "setTimeout")
        .mockImplementation(((fn: () => void, ms?: number) => {
          // Fire the idle race immediately, advancing the clock by what it waited.
          now += ms ?? 0;
          queueMicrotask(fn);
          return 0 as unknown as NodeJS.Timeout;
        }) as unknown as typeof setTimeout);

      try {
        const { chunks } = await drain(
          createClaudeCodeRunner({ createQuery }).execute("/repo", "prompt", {
            threadId: "thread_test",
            cliType: "claude-code",
            cliMode: "agent",
            steerEnabled: true,
          })
        );

        expect(chunks.filter((chunk) => chunk.type === TIMEOUT_CHUNK_TYPE)).toHaveLength(1);
      } finally {
        timeoutSpy.mockRestore();
        nowSpy.mockRestore();
      }
    });

    /**
     * Abort must not be held hostage by a running agent: waiting past the graceful
     * interrupt's result strands it and loses the continuation id (OS-1463).
     */
    it("ends at the next result once abort is requested, without waiting for the agent", async () => {
      const { createQuery } = createQueryMock({
        messages: [
          ...spawnAgentMessages,
          SUCCESS_RESULT,
          makeSdkMessage({ type: "assistant", message: { role: "assistant", content: [] } }),
        ],
      });

      const runner = createClaudeCodeRunner({ createQuery });
      const generator = runner.execute("/repo", "prompt", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "agent",
        steerEnabled: true,
      });

      // Drain up to and including the snapshot, then cancel mid-hold.
      await generator.next();
      await generator.next();
      await generator.next();
      runner.abort();

      const { chunks, result } = await drain(generator);

      expect(chunks.filter((chunk) => chunk.type === "result")).toHaveLength(1);
      expect(chunks.some((chunk) => chunk.type === "assistant")).toBe(false);
      // The graceful path still preserved the continuation id.
      expect(result?.continuationId).toBe("session-123");
    });
  });

  it("logs a query_started debug line when CONVOY_CLI_DEBUG is enabled", async () => {
    const previousDebug = process.env.CONVOY_CLI_DEBUG;
    process.env.CONVOY_CLI_DEBUG = "1";
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const { createQuery } = createQueryMock({
        messages: [SESSION_MESSAGE, SUCCESS_RESULT],
      });

      const runner = createClaudeCodeRunner({ createQuery });
      await drain(
        runner.execute("/repo", "prompt", {
          threadId: "thread_test",
          cliType: "claude-code",
          continuationId: "session-prev",
        })
      );

      const queryStartedLine = consoleLogSpy.mock.calls
        .map((call) => call[0])
        .find(
          (line): line is string =>
            typeof line === "string" && line.startsWith("[SDK:query_started]")
        );
      expect(queryStartedLine).toBeDefined();
      expect(queryStartedLine).toContain('"executable":"/mock/claude"');
      expect(queryStartedLine).toContain('"permissionMode":"bypassPermissions"');
      expect(queryStartedLine).toContain('"resumeSessionId":"session-prev"');
    } finally {
      consoleLogSpy.mockRestore();
      if (previousDebug === undefined) {
        delete process.env.CONVOY_CLI_DEBUG;
      } else {
        process.env.CONVOY_CLI_DEBUG = previousDebug;
      }
    }
  });
});
