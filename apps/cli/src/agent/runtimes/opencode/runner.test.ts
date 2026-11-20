import { describe, it, expect, vi } from "vitest";
import type { OpencodeAuth } from "../../../lib/config/credentials/validators.js";
import {
  RunnerExecutionError,
  type ContentChunk,
  type InteractionBridge,
  type RunnerExecutionOptions,
} from "../contracts.js";
import type {
  OpencodeClientLike,
  OpencodeModelRef,
  OpencodePermissionRule,
} from "./client.js";
import {
  createOpencodeRunner,
  isOpencodeBuiltinCommand,
  parseOpencodeModelRef,
  rulesetForMode,
  segmentJoinedLabels,
  toOpencodeQuestionAnswers,
  withOpencodeBuiltinCommands,
} from "./runner.js";
import { threadIdentityInstruction } from "../agent-instructions.js";

const IDENTITY_LINE = threadIdentityInstruction("thread_test");

type FakeEvent = Record<string, unknown>;

function sessionEvent(type: string, properties: Record<string, unknown>): FakeEvent {
  return { id: "evt", type, properties };
}

function textPart(
  partId: string,
  text: string,
  options?: { end?: boolean; type?: "text" | "reasoning"; sessionID?: string },
): FakeEvent {
  return sessionEvent("message.part.updated", {
    sessionID: options?.sessionID ?? "ses_1",
    part: {
      id: partId,
      sessionID: options?.sessionID ?? "ses_1",
      type: options?.type ?? "text",
      text,
      time: { start: 1, ...(options?.end ? { end: 2 } : {}) },
    },
  });
}

function idleEvent(sessionID = "ses_1"): FakeEvent {
  return sessionEvent("session.status", {
    sessionID,
    status: { type: "idle" },
  });
}

function busyEvent(sessionID = "ses_1"): FakeEvent {
  return sessionEvent("session.status", {
    sessionID,
    status: { type: "busy" },
  });
}

type FakeClientCalls = {
  createSession: Array<{ title: string; permission: OpencodePermissionRule[] }>;
  promptAsync: Array<{
    sessionID: string;
    model?: unknown;
    agent?: string;
    variant?: string;
    text: string;
  }>;
  commandAsync: Array<{
    sessionID: string;
    command: string;
    arguments?: string;
    model?: unknown;
    variant?: string;
  }>;
  listCommands: number;
  compactSession: Array<{ sessionID: string; model: unknown }>;
  getSessionModel: string[];
  getDefaultModel: number;
  abortSession: string[];
  replyPermission: Array<{ requestID: string; reply: string }>;
  replyQuestion: Array<{ requestID: string; answers: string[][] }>;
  rejectQuestion: string[];
};

type FakeClientOptions = {
  /** Resolve command.list with these names; omitted = reject (fail-soft path). */
  commands?: string[];
  commandAsyncError?: Error;
  compactSessionError?: Error;
  /** Session model returned by session.get; null = the session has none. */
  sessionModel?: OpencodeModelRef | null;
  /** Provider default used when neither the run nor the session has a model. */
  defaultModel?: OpencodeModelRef | null;
  /** Effective config's `provider` block for the run directory. */
  providerConfig?: Awaited<ReturnType<OpencodeClientLike["getProviderConfig"]>>;
};

function createFakeClient(events: FakeEvent[], options?: FakeClientOptions): {
  client: OpencodeClientLike;
  calls: FakeClientCalls;
  pushEvent: (event: FakeEvent) => void;
  endStream: () => void;
} {
  const calls: FakeClientCalls = {
    createSession: [],
    promptAsync: [],
    commandAsync: [],
    listCommands: 0,
    compactSession: [],
    getSessionModel: [],
    getDefaultModel: 0,
    abortSession: [],
    replyPermission: [],
    replyQuestion: [],
    rejectQuestion: [],
  };

  const queue: FakeEvent[] = [...events];
  let ended = false;
  let wake: (() => void) | null = null;
  let abortSignal: AbortSignal | null = null;

  async function* stream(): AsyncGenerator<unknown> {
    while (true) {
      if (abortSignal?.aborted) {
        throw new Error("stream aborted");
      }
      const next = queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (ended) {
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        abortSignal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  }

  const client: OpencodeClientLike = {
    async createSession(input) {
      calls.createSession.push(input);
      return { id: "ses_1" };
    },
    async promptAsync(input) {
      calls.promptAsync.push(input);
    },
    async commandAsync(input) {
      calls.commandAsync.push(input);
      if (options?.commandAsyncError) {
        throw options.commandAsyncError;
      }
    },
    async listCommands() {
      calls.listCommands += 1;
      if (options?.commands === undefined) {
        throw new Error("command.list unavailable");
      }
      return options.commands;
    },
    async compactSession(input) {
      calls.compactSession.push(input);
      if (options?.compactSessionError) {
        throw options.compactSessionError;
      }
    },
    async getSessionModel(sessionID) {
      calls.getSessionModel.push(sessionID);
      return options?.sessionModel ?? null;
    },
    async getDefaultModel() {
      calls.getDefaultModel += 1;
      return options?.defaultModel ?? null;
    },
    async abortSession(sessionID) {
      calls.abortSession.push(sessionID);
    },
    async subscribeEvents(signal) {
      abortSignal = signal;
      return stream();
    },
    async replyPermission(requestID, reply) {
      calls.replyPermission.push({ requestID, reply });
    },
    async replyQuestion(requestID, answers) {
      calls.replyQuestion.push({ requestID, answers });
    },
    async rejectQuestion(requestID) {
      calls.rejectQuestion.push(requestID);
    },
    async listProviders() {
      return { all: [], connected: [], defaults: {} };
    },
    async getProviderConfig() {
      return options?.providerConfig ?? {};
    },
  };

  return {
    client,
    calls,
    pushEvent(event) {
      queue.push(event);
      wake?.();
      wake = null;
    },
    endStream() {
      ended = true;
      wake?.();
      wake = null;
    },
  };
}

function createRunnerWithFakeClient(
  events: FakeEvent[],
  options?: { partialStreaming?: boolean } & FakeClientOptions,
) {
  const fake = createFakeClient(events, options);
  const runner = createOpencodeRunner(
    { partialStreaming: options?.partialStreaming ?? false },
    {
      getServer: async () => ({ url: "http://127.0.0.1:1", password: "pw" }),
      connect: () => fake.client,
    },
  );
  return { runner, ...fake };
}

async function collectChunks(
  gen: AsyncGenerator<ContentChunk, unknown, unknown>,
): Promise<{ chunks: ContentChunk[]; result: unknown }> {
  const chunks: ContentChunk[] = [];
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await gen.next();
  }
  return { chunks, result: step.value };
}

const baseOptions: RunnerExecutionOptions = { threadId: "thread_test", cliType: "opencode" };

/**
 * Chunk types with the synthetic command-inventory chunk dropped: every run
 * emits it (OS-1614), so it is noise for tests about streamed turn content.
 */
function streamedChunkTypes(chunks: ContentChunk[]): string[] {
  return chunks
    .map((chunk) => chunk.type)
    .filter((type) => type !== "convoy.commands");
}

describe("managed OpenCode keys (OS-2018)", () => {
  const managed: OpencodeAuth = { mode: "managed", keys: { openai: "sk-openai-sentinel" } };
  type Overrides = { model?: string; serverError?: Error; providerConfig?: FakeClientOptions["providerConfig"]; continuationId?: string };
  const run = async (opencodeAuth: OpencodeAuth, overrides?: Overrides) => {
    const fake = createFakeClient([busyEvent(), idleEvent()], { providerConfig: overrides?.providerConfig });
    const getServer = vi.fn(async (auth?: OpencodeAuth) => {
      if (overrides?.serverError) throw overrides.serverError;
      return { url: "http://127.0.0.1:1", password: `pw-${auth?.mode}` };
    });
    const connect = vi.fn((_args: { baseUrl: string; directory: string; password: string }) => fake.client);
    const runner = createOpencodeRunner({ opencodeAuth }, { getServer, connect });
    const result = collectChunks(runner.execute("/tmp/wd", "hello", { ...baseOptions, continuationId: overrides?.continuationId, resolvedCliModel: overrides?.model }));
    return { result, getServer, connect, calls: fake.calls };
  };

  it("starts the server with the project's keys and connects with its password", async () => {
    const { result, getServer, connect } = await run(managed, { model: "openai/gpt-5.5" });
    await result;
    expect(getServer).toHaveBeenCalledWith(managed);
    expect(connect).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:1", directory: "/tmp/wd", password: "pw-managed" });
  });

  it("fails every run of a disabled project before starting a server", async () => {
    const { result, getServer } = await run({ mode: "disabled" });
    await expect(result).rejects.toThrow("OpenCode is disabled for this project. Assign a key or explicitly restore native login.");
    expect(getServer).not.toHaveBeenCalled();
  });

  it("refuses a model whose provider has no usable key", async () => {
    const { result, getServer } = await run(managed, { model: "anthropic/claude-sonnet-5" });
    await expect(result).rejects.toThrow("No usable anthropic key in this project. Check convoy keys status.");
    expect(getServer).not.toHaveBeenCalled();
  });

  // The start refuses an untested binary; the run must keep its session (OS-2018 #2).
  it("fails the run with the server's refusal and keeps the session", async () => {
    const { result } = await run(managed, { serverError: new Error("OpenCode 1.14.19 is not tested with managed keys."), continuationId: "ses_prev" });
    await expect(result).rejects.toMatchObject({ message: "OpenCode 1.14.19 is not tested with managed keys.", continuationId: "ses_prev" });
  });

  // Request headers outrank the inline apiKey, so they could bill another account (OS-2018 #1).
  it.each([
    ["provider", { openai: { options: { headers: { Authorization: "Bearer other" } } } }],
    ["model", { openai: { models: { "gpt-4o": { headers: { "OpenAI-Organization": "org-other" } } } } }],
  ])("refuses %s headers on an assigned provider before prompting", async (_level, providerConfig) => {
    const { result, calls } = await run(managed, { providerConfig });
    await expect(result).rejects.toThrow("OpenCode config sets headers for openai, which override Convoy's key. Remove them, or unassign the key and restore native login.");
    expect(calls.promptAsync).toHaveLength(0);
  });

  it("refuses headers on an assigned Bedrock slot (OS-2205)", async () => {
    const bedrock = { mode: "managed" as const, keys: { "amazon-bedrock": { secret: "token", region: "us-east-1" } } };
    const { result, calls } = await run(bedrock, {
      model: "amazon-bedrock/anthropic.claude-haiku-5-5",
      providerConfig: { "amazon-bedrock": { models: { "anthropic.claude-haiku-5-5": { headers: { Authorization: "Bearer other" } } } } },
    });
    await expect(result).rejects.toThrow("OpenCode config sets headers for amazon-bedrock");
    expect(calls.promptAsync).toHaveLength(0);
  });

  it("allows headers on providers Convoy does not manage", async () => {
    const { result, calls } = await run(managed, { providerConfig: { anthropic: { options: { headers: { "x-api-key": "other" } } } } });
    await result;
    expect(calls.promptAsync).toHaveLength(1);
  });
});

describe("rulesetForMode", () => {
  it("allows everything for agent and unset modes", () => {
    for (const mode of [undefined, "agent" as const]) {
      expect(rulesetForMode(mode)).toEqual([
        { permission: "*", pattern: "*", action: "allow" },
      ]);
    }
  });

  it("asks for every sensitive permission in non-agent modes", () => {
    for (const mode of ["default", "auto", "plan"] as const) {
      const ruleset = rulesetForMode(mode);
      expect(ruleset).toContainEqual({
        permission: "*",
        pattern: "*",
        action: "ask",
      });
      expect(ruleset).toContainEqual({
        permission: "bash",
        pattern: "*",
        action: "ask",
      });
      expect(ruleset).toContainEqual({
        permission: "question",
        pattern: "*",
        action: "allow",
      });
    }
  });
});

describe("opencode built-in commands", () => {
  it("recognizes only the commands executed outside command.list", () => {
    expect(isOpencodeBuiltinCommand("compact")).toBe(true);
    expect(isOpencodeBuiltinCommand("init")).toBe(false);
  });

  it("appends built-ins to the template inventory without duplicating", () => {
    expect(withOpencodeBuiltinCommands(["init"])).toEqual(["init", "compact"]);
    expect(withOpencodeBuiltinCommands(["compact"])).toEqual(["compact"]);
    expect(withOpencodeBuiltinCommands([])).toEqual(["compact"]);
  });
});

describe("parseOpencodeModelRef", () => {
  it("splits provider/model slugs on the first slash", () => {
    expect(parseOpencodeModelRef("anthropic/claude-sonnet-5")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-5",
    });
    expect(parseOpencodeModelRef("openrouter/meta/llama-3")).toEqual({
      providerID: "openrouter",
      modelID: "meta/llama-3",
    });
  });

  it("rejects values that are not provider/model slugs", () => {
    expect(parseOpencodeModelRef(undefined)).toBeUndefined();
    expect(parseOpencodeModelRef("opus")).toBeUndefined();
    expect(parseOpencodeModelRef("/model")).toBeUndefined();
    expect(parseOpencodeModelRef("provider/")).toBeUndefined();
  });
});

describe("toOpencodeQuestionAnswers", () => {
  const questions = [
    {
      question: "Which db?",
      header: "DB",
      options: [
        { label: "Postgres", description: "" },
        { label: "SQLite", description: "" },
      ],
      multiSelect: true,
    },
  ];

  it("maps joined labels back to per-question arrays", () => {
    expect(
      toOpencodeQuestionAnswers(questions, { "Which db?": "Postgres, SQLite" }),
    ).toEqual([["Postgres", "SQLite"]]);
  });

  it("passes unmatched values through whole (custom answers)", () => {
    expect(
      toOpencodeQuestionAnswers(questions, { "Which db?": "use whatever" }),
    ).toEqual([["use whatever"]]);
  });

  it("answers missing questions with an empty selection", () => {
    expect(toOpencodeQuestionAnswers(questions, {})).toEqual([[]]);
  });

  it("segments labels that themselves contain the join delimiter", () => {
    const withCommaLabels = [
      {
        question: "Proceed?",
        header: "Go",
        options: [
          { label: "Yes, always", description: "" },
          { label: "No", description: "" },
        ],
        multiSelect: true,
      },
    ];
    expect(
      toOpencodeQuestionAnswers(withCommaLabels, {
        "Proceed?": "Yes, always, No",
      }),
    ).toEqual([["Yes, always", "No"]]);
  });

  it("passes mixed label + custom values through whole instead of dropping labels", () => {
    // "Postgres" is a known label but the remainder is not — dropping it
    // silently would send a wrong answer, so the whole value passes through.
    expect(
      toOpencodeQuestionAnswers(questions, {
        "Which db?": "Postgres, something custom",
      }),
    ).toEqual([["Postgres, something custom"]]);
  });
});

describe("segmentJoinedLabels", () => {
  it("prefers longer labels over ambiguous splits", () => {
    expect(segmentJoinedLabels("a, b, c", ["a, b", "c", "a"])).toEqual([
      "a, b",
      "c",
    ]);
  });

  it("backtracks when the greedy choice dead-ends", () => {
    expect(segmentJoinedLabels("a, b", ["a, b", "a", "b"])).toEqual(["a, b"]);
    expect(segmentJoinedLabels("a, b, x", ["a, b", "a", "b"])).toBeNull();
  });

  it("returns null for empty or unmatched values", () => {
    expect(segmentJoinedLabels("", ["a"])).toBeNull();
    expect(segmentJoinedLabels("nope", ["a"])).toBeNull();
  });
});

describe("createOpencodeRunner", () => {
  it("reuses context limits across runner teardown and scopes and expires the cache", async () => {
    const firstServer = { url: "http://127.0.0.1:1", password: "pw" };
    const inventory = vi.fn().mockImplementation(async () => ({
      all: ["anthropic", "other"].map((id) => ({ id, name: id, models: {
        actual: { id: "actual", name: "Actual", limit: { context: 200_000 } },
        second: { id: "second", name: "Second", limit: { context: 100_000 } },
      } })), connected: [], defaults: {},
    }));
    const run = async (server = firstServer, directory = "/tmp/wd", providerID = "anthropic", modelID = "actual") => {
      const fake = createFakeClient([
        busyEvent(), sessionEvent("message.updated", { sessionID: "ses_1", info: {
          role: "assistant", providerID, modelID,
          tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 300, write: 40 } },
        } }), idleEvent(),
      ]);
      fake.client.listProviders = inventory;
      const runner = createOpencodeRunner(undefined, { getServer: async () => server, connect: () => fake.client });
      const { chunks } = await collectChunks(runner.execute(directory, "hello", baseOptions));
      await runner.shutdown?.();
      return chunks.filter((chunk) => chunk.type === "convoy.context_usage").map((chunk) => JSON.parse(chunk.data));
    };
    expect(await run()).toEqual([{ usedTokens: 460, maxTokens: 200_000 }]);
    expect(await run()).toEqual([{ usedTokens: 460, maxTokens: 200_000 }]);
    expect(inventory).toHaveBeenCalledTimes(1);
    await run(firstServer, "/tmp/other");
    await run(firstServer, "/tmp/wd", "other");
    expect(await run(firstServer, "/tmp/wd", "anthropic", "second"))
      .toEqual([{ usedTokens: 460, maxTokens: 100_000 }]);
    await run({ url: firstServer.url, password: "pw" });
    expect(inventory).toHaveBeenCalledTimes(5);

    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_001);
    try {
      await run();
      expect(inventory).toHaveBeenCalledTimes(6);
    } finally {
      now.mockRestore();
    }

    for (let i = 0; i < 257; i++) await run(firstServer, `/tmp/project-${i}`);
    const callsBeforeEviction = inventory.mock.calls.length;
    await run(firstServer, "/tmp/project-0");
    expect(inventory).toHaveBeenCalledTimes(callsBeforeEviction + 1);
  });

  it.each(["failure", "missing", "invalid"])("retries a %s context-limit lookup", async (scenario) => {
    const server = { url: "http://127.0.0.1:1", password: "pw" };
    const inventory = vi.fn()
      .mockResolvedValueOnce({ all: [{ id: "anthropic", models: scenario === "missing" ? {} : {
        actual: { limit: { context: 0 } },
      } }], connected: [], defaults: {} })
      .mockResolvedValue({ all: [{ id: "anthropic", models: {
        actual: { limit: { context: 200_000 } },
      } }], connected: [], defaults: {} });
    if (scenario === "failure") inventory.mockReset().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ all: [{ id: "anthropic", models: {
        actual: { limit: { context: 200_000 } },
      } }], connected: [], defaults: {} });
    for (let turn = 0; turn < 2; turn++) {
      const fake = createFakeClient([
        busyEvent(), sessionEvent("message.updated", { sessionID: "ses_1", info: {
          role: "assistant", providerID: "anthropic", modelID: "actual",
          tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 300, write: 40 } },
        } }), idleEvent(),
      ]);
      fake.client.listProviders = inventory;
      const runner = createOpencodeRunner(undefined, { getServer: async () => server, connect: () => fake.client });
      const { chunks } = await collectChunks(runner.execute("/tmp/wd", "hello", baseOptions));
      expect(chunks.filter((chunk) => chunk.type === "convoy.context_usage")).toHaveLength(turn);
      await runner.shutdown?.();
    }
    expect(inventory).toHaveBeenCalledTimes(2);
  });

  it("emits the latest context snapshot on both fresh and resumed turns", async () => {
    const fake = createRunnerWithFakeClient([]);
    fake.client.listProviders = vi.fn().mockResolvedValue({
      all: [{ id: "anthropic", name: "Anthropic", models: {
        actual: { id: "actual", name: "Actual model", limit: { context: 200_000 } },
      } }], connected: ["anthropic"], defaults: {},
    });
    for (const [turn, input] of [[0, 100], [1, 200]]) {
      fake.pushEvent(busyEvent());
      for (const tokens of [
        { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        { input, output: 20, reasoning: 5, cache: { read: 300, write: 40 } },
      ]) {
        fake.pushEvent(sessionEvent("message.updated", { sessionID: "ses_1", info: {
          role: "assistant", id: `msg_${turn}`, sessionID: "ses_1",
          providerID: "anthropic", modelID: "actual", tokens,
        } }));
      }
      fake.pushEvent(idleEvent());
      const { chunks } = await collectChunks(fake.runner.execute("/tmp/wd", "hello", {
        ...baseOptions, ...(turn ? { continuationId: "ses_1" } : {}),
      }));
      expect(chunks.filter((chunk) => chunk.type === "convoy.context_usage").map((chunk) => JSON.parse(chunk.data)))
        .toEqual([{ usedTokens: input + 365, maxTokens: 200_000 }]);
    }
    expect(fake.calls.createSession).toHaveLength(1);
  });

  it.each(["missing model", "invalid limit", "inventory failure", "incomplete usage", "zero output", "other session"])(
    "completes without inventing a context snapshot: %s", async (scenario) => {
      const fake = createRunnerWithFakeClient([
        busyEvent(),
        sessionEvent("message.updated", { sessionID: scenario === "other session" ? "ses_other" : "ses_1", info: {
          role: "assistant", providerID: "anthropic", modelID: "actual",
          tokens: { input: 100, output: scenario === "zero output" ? 0 : 20, reasoning: 0,
            cache: scenario === "incomplete usage" ? {} : { read: 300, write: 40 } },
        } }),
        idleEvent(),
      ]);
      fake.client.listProviders = scenario === "inventory failure"
        ? vi.fn().mockRejectedValue(new Error("offline"))
        : vi.fn().mockResolvedValue({ all: [{ id: "anthropic", models: scenario === "missing model" ? {} : {
            actual: { limit: { context: scenario === "invalid limit" ? 0 : 200_000 } },
          } }], connected: [], defaults: {} });
      const { chunks, result } = await collectChunks(fake.runner.execute("/tmp/wd", "hello", baseOptions));
      expect(chunks.some((chunk) => chunk.type === "convoy.context_usage")).toBe(false);
      expect(result).toEqual({ continuationId: "ses_1" });
    },
  );

  it("creates a session with the mode ruleset, prompts, and completes on idle", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent(),
      textPart("prt_1", "hello world", { end: true }),
      idleEvent(),
    ]);

    const { chunks, result } = await collectChunks(
      runner.execute("/tmp/wd", "the prompt", { ...baseOptions, cliMode: "agent" }),
    );

    expect(calls.createSession).toHaveLength(1);
    expect(calls.createSession[0].permission).toEqual([
      { permission: "*", pattern: "*", action: "allow" },
    ]);
    expect(calls.promptAsync).toEqual([
      {
        sessionID: "ses_1",
        model: undefined,
        // Fresh session: the thread-identity line (OS-1223) is prepended.
        text: [IDENTITY_LINE, "", "the prompt"].join("\n"),
      },
    ]);
    expect(streamedChunkTypes(chunks)).toEqual(["message.part.updated"]);
    expect(result).toEqual({ continuationId: "ses_1" });
  });

  it("reuses the continuation session without creating a new one", async () => {
    const fake = createFakeClient([
      busyEvent("ses_resume"),
      textPart("prt_1", "hi", { end: true, sessionID: "ses_resume" }),
      idleEvent("ses_resume"),
    ]);
    const runner = createOpencodeRunner(
      {},
      {
        getServer: async () => ({ url: "http://127.0.0.1:1", password: "pw" }),
        connect: () => fake.client,
      },
    );

    const { result } = await collectChunks(
      runner.execute("/tmp/wd", "again", {
        ...baseOptions,
        continuationId: "ses_resume",
      }),
    );

    expect(fake.calls.createSession).toHaveLength(0);
    expect(fake.calls.promptAsync[0].sessionID).toBe("ses_resume");
    expect(result).toEqual({ continuationId: "ses_resume" });
  });

  it("injects agent instructions into the first prompt of a fresh session", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent(),
      idleEvent(),
    ]);

    await collectChunks(
      runner.execute("/tmp/wd", "the prompt", {
        ...baseOptions,
        agentPrompt: "You are a meticulous reviewer.",
        agentName: "Reviewer",
      }),
    );

    expect(calls.promptAsync[0].text).toBe(
      [
        '<agent-instructions agent="Reviewer">',
        "You are a meticulous reviewer.",
        "</agent-instructions>",
        "",
        IDENTITY_LINE,
        "",
        "the prompt",
      ].join("\n"),
    );
  });

  it("does not inject agent instructions on resumed sessions", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent("ses_resume"),
      idleEvent("ses_resume"),
    ]);

    await collectChunks(
      runner.execute("/tmp/wd", "the prompt", {
        ...baseOptions,
        continuationId: "ses_resume",
        agentPrompt: "You are a meticulous reviewer.",
        agentName: "Reviewer",
      }),
    );

    expect(calls.promptAsync[0].text).toBe("the prompt");
  });

  it("injects only the thread identity without an agent prompt (OS-1223)", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent(),
      idleEvent(),
    ]);

    await collectChunks(
      runner.execute("/tmp/wd", "the prompt", {
        ...baseOptions,
        agentName: "Reviewer",
      }),
    );

    expect(calls.promptAsync[0].text).toBe(
      [IDENTITY_LINE, "", "the prompt"].join("\n"),
    );
  });

  it("passes the resolved run model as a provider/model reference", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent(),
      idleEvent(),
    ]);

    await collectChunks(
      runner.execute("/tmp/wd", "hi", {
        ...baseOptions,
        resolvedCliModel: "anthropic/claude-sonnet-5",
      }),
    );

    expect(calls.promptAsync[0].model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-5",
    });
  });

  it("plan mode prompts OpenCode's plan agent with the ask ruleset", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent(),
      idleEvent(),
    ]);

    await collectChunks(
      runner.execute("/tmp/wd", "hi", { ...baseOptions, cliMode: "plan" }),
    );

    expect(calls.promptAsync[0].agent).toBe("plan");
    expect(calls.createSession[0].permission).toContainEqual({
      permission: "*",
      pattern: "*",
      action: "ask",
    });
  });

  it("non-plan modes prompt the default agent", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent(),
      idleEvent(),
    ]);

    await collectChunks(
      runner.execute("/tmp/wd", "hi", { ...baseOptions, cliMode: "agent" }),
    );

    expect(calls.promptAsync[0].agent).toBeUndefined();
  });

  it("passes the resolved effort as the prompt variant", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent(),
      idleEvent(),
    ]);

    await collectChunks(
      runner.execute("/tmp/wd", "hi", {
        ...baseOptions,
        resolvedCliModel: "anthropic/claude-sonnet-5",
        resolvedCliEffort: "high",
      }),
    );

    expect(calls.promptAsync[0].variant).toBe("high");
  });

  it("ignores events for other sessions", async () => {
    const { runner } = createRunnerWithFakeClient([
      busyEvent(),
      textPart("prt_x", "other session text", {
        end: true,
        sessionID: "ses_other",
      }),
      idleEvent(),
    ]);

    const { chunks } = await collectChunks(
      runner.execute("/tmp/wd", "hi", baseOptions),
    );
    expect(streamedChunkTypes(chunks)).toEqual([]);
  });

  it("synthesizes deduplicated streaming deltas from snapshots and deltas", async () => {
    const { runner } = createRunnerWithFakeClient(
      [
        busyEvent(),
        // Snapshot establishes the part and emits the first suffix.
        textPart("prt_1", "hel"),
        // Incremental delta extends it.
        sessionEvent("message.part.delta", {
          sessionID: "ses_1",
          messageID: "msg_1",
          partID: "prt_1",
          field: "text",
          delta: "lo wo",
        }),
        // Overlapping snapshot must NOT re-emit already-streamed text.
        textPart("prt_1", "hello world"),
        textPart("prt_1", "hello world", { end: true }),
        idleEvent(),
      ],
      { partialStreaming: true },
    );

    const { chunks } = await collectChunks(
      runner.execute("/tmp/wd", "hi", baseOptions),
    );

    const deltas = chunks
      .filter((chunk) => chunk.type === "text.delta")
      .map((chunk) => (JSON.parse(chunk.data) as { text: string }).text);
    expect(deltas.join("")).toBe("hello world");
    expect(chunks.at(-1)?.type).toBe("message.part.updated");
  });

  it("does not synthesize delta chunks when partial streaming is off", async () => {
    const { runner } = createRunnerWithFakeClient([
      busyEvent(),
      textPart("prt_1", "hel"),
      textPart("prt_1", "hello", { end: true }),
      idleEvent(),
    ]);

    const { chunks } = await collectChunks(
      runner.execute("/tmp/wd", "hi", baseOptions),
    );
    expect(streamedChunkTypes(chunks)).toEqual(["message.part.updated"]);
  });

  it("yields tool chunks once per running part and again on completion", async () => {
    const runningTool = (title: string) =>
      sessionEvent("message.part.updated", {
        sessionID: "ses_1",
        part: {
          id: "prt_t",
          sessionID: "ses_1",
          type: "tool",
          tool: "bash",
          callID: "call_1",
          state: { status: "running", input: { command: "ls" }, title },
        },
      });

    const { runner } = createRunnerWithFakeClient([
      busyEvent(),
      runningTool("ls"),
      runningTool("ls (updated)"),
      sessionEvent("message.part.updated", {
        sessionID: "ses_1",
        part: {
          id: "prt_t",
          sessionID: "ses_1",
          type: "tool",
          tool: "bash",
          callID: "call_1",
          state: { status: "completed", output: "files", time: { start: 1, end: 2 } },
        },
      }),
      idleEvent(),
    ]);

    const { chunks } = await collectChunks(
      runner.execute("/tmp/wd", "hi", baseOptions),
    );
    expect(streamedChunkTypes(chunks)).toEqual([
      "message.part.updated",
      "message.part.updated",
    ]);
  });

  it("routes permission.asked through the bridge and replies with the mapped decision", async () => {
    const bridgeRequests: Array<{ requestId: string; kind: string; payloadJson: string }> = [];
    const bridge: InteractionBridge = {
      async request(input) {
        bridgeRequests.push(input);
        return JSON.stringify({ decision: "allow-always" });
      },
      cancel() {},
    };

    const { runner, calls, pushEvent } = createRunnerWithFakeClient([
      busyEvent(),
      sessionEvent("permission.asked", {
        sessionID: "ses_1",
        id: "per_1",
        permission: "bash",
        patterns: ["ls *"],
        metadata: { command: "ls" },
        always: [],
      }),
    ]);

    const gen = runner.execute("/tmp/wd", "hi", {
      ...baseOptions,
      cliMode: "default",
      interactionBridge: bridge,
    });

    const collecting = collectChunks(gen);
    // The reply lands asynchronously; wait for it, then finish the run.
    await vi.waitFor(() => expect(calls.replyPermission.length).toBeGreaterThan(0));
    pushEvent(idleEvent());

    await collecting;

    expect(bridgeRequests).toHaveLength(1);
    expect(bridgeRequests[0].kind).toBe("tool-approval");
    const payload = JSON.parse(bridgeRequests[0].payloadJson) as Record<string, unknown>;
    expect(payload.toolName).toBe("bash");
    expect(payload.hasSuggestions).toBe(true);
    expect(calls.replyPermission).toEqual([{ requestID: "per_1", reply: "always" }]);
  });

  it("survives the idle timeout while parked on a bridge request, then still idles out on true silence (OS-1463)", async () => {
    vi.useFakeTimers();
    try {
      let answerRequest: ((responseJson: string) => void) | null = null;
      // Read through a function: TS cannot see the closure assignment above
      // and narrows the direct read to `never` at the call site.
      const getAnswerRequest = () => answerRequest;
      const bridge: InteractionBridge = {
        request: () =>
          new Promise<string>((resolve) => {
            answerRequest = resolve;
          }),
        cancel() {},
      };

      const { runner, calls, pushEvent } = createRunnerWithFakeClient([
        busyEvent(),
        sessionEvent("permission.asked", {
          sessionID: "ses_1",
          id: "per_parked",
          permission: "bash",
          patterns: [],
          metadata: {},
          always: [],
        }),
      ]);

      const collecting = collectChunks(
        runner.execute("/tmp/wd", "hi", {
          ...baseOptions,
          cliMode: "default",
          interactionBridge: bridge,
        }),
      );
      // The rejection lands during the fake-timer advance, before the final
      // await attaches handlers — pre-attach one so it never reads unhandled.
      collecting.catch(() => {});

      // Well past IDLE_TIMEOUT_MS (10 min) — the user is still deciding.
      await vi.advanceTimersByTimeAsync(25 * 60_000);
      expect(getAnswerRequest()).toBeTypeOf("function");
      expect(calls.abortSession).toHaveLength(0);

      getAnswerRequest()?.(JSON.stringify({ decision: "allow" }));
      await vi.waitFor(() => expect(calls.replyPermission.length).toBeGreaterThan(0));

      // With nothing parked anymore, true silence must still idle out.
      await vi.advanceTimersByTimeAsync(11 * 60_000);
      pushEvent(idleEvent());

      let error: unknown;
      try {
        await collecting;
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(RunnerExecutionError);
      expect((error as RunnerExecutionError).message).toContain("no events");
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-rejects permissions when no bridge is available", async () => {
    const { runner, calls, pushEvent } = createRunnerWithFakeClient([
      busyEvent(),
      sessionEvent("permission.asked", {
        sessionID: "ses_1",
        id: "per_2",
        permission: "edit",
        patterns: [],
        metadata: {},
        always: [],
      }),
    ]);

    const gen = runner.execute("/tmp/wd", "hi", baseOptions);
    const collecting = collectChunks(gen);
    await vi.waitFor(() => expect(calls.replyPermission.length).toBeGreaterThan(0));
    pushEvent(idleEvent());
    await collecting;

    expect(calls.replyPermission).toEqual([{ requestID: "per_2", reply: "reject" }]);
  });

  it("routes question.asked through the bridge and replies with ordered answers", async () => {
    const bridge: InteractionBridge = {
      async request(input) {
        const payload = JSON.parse(input.payloadJson) as {
          questions: Array<{ question: string }>;
        };
        return JSON.stringify({
          answers: { [payload.questions[0].question]: "Postgres" },
        });
      },
      cancel() {},
    };

    const { runner, calls, pushEvent } = createRunnerWithFakeClient([
      busyEvent(),
      sessionEvent("question.asked", {
        sessionID: "ses_1",
        id: "que_1",
        questions: [
          {
            question: "Which db?",
            header: "DB",
            options: [{ label: "Postgres", description: "pg" }],
            multiple: false,
          },
        ],
      }),
    ]);

    const gen = runner.execute("/tmp/wd", "hi", {
      ...baseOptions,
      interactionBridge: bridge,
    });
    const collecting = collectChunks(gen);
    await vi.waitFor(() => expect(calls.replyQuestion.length).toBeGreaterThan(0));
    pushEvent(idleEvent());
    await collecting;

    expect(calls.replyQuestion).toEqual([
      { requestID: "que_1", answers: [["Postgres"]] },
    ]);
  });

  it("fails with the provider message on session.error", async () => {
    const { runner } = createRunnerWithFakeClient([
      busyEvent(),
      sessionEvent("session.error", {
        sessionID: "ses_1",
        error: { name: "ApiError", data: { message: "quota exceeded" } },
      }),
    ]);

    let error: unknown;
    try {
      await collectChunks(runner.execute("/tmp/wd", "hi", baseOptions));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("quota exceeded");
    expect((error as RunnerExecutionError).continuationId).toBe("ses_1");
  });

  it("ignores a stale idle before any activity", async () => {
    const { runner, pushEvent } = createRunnerWithFakeClient([
      // Idle arrives immediately after prompting — must not complete the run.
      idleEvent(),
    ]);

    const gen = runner.execute("/tmp/wd", "hi", baseOptions);
    const collecting = collectChunks(gen);
    // Real activity follows; then a real idle completes.
    pushEvent(busyEvent());
    pushEvent(textPart("prt_1", "done", { end: true }));
    pushEvent(idleEvent());

    const { chunks, result } = await collecting;
    expect(streamedChunkTypes(chunks)).toHaveLength(1);
    expect(result).toEqual({ continuationId: "ses_1" });
  });

  it("aborting aborts the session and fails the run with the continuation id", async () => {
    const { runner, calls } = createRunnerWithFakeClient([busyEvent()]);

    const gen = runner.execute("/tmp/wd", "hi", baseOptions);
    const collecting = collectChunks(gen);
    // Abort only after the session is active so abortSession is observable.
    await vi.waitFor(() => expect(calls.promptAsync.length).toBeGreaterThan(0));
    runner.abort();

    let error: unknown;
    try {
      await collecting;
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("aborted");
    expect((error as RunnerExecutionError).continuationId).toBe("ses_1");
    expect(calls.abortSession).toEqual(["ses_1"]);
  });

  it("fails when the event stream ends before the session goes idle", async () => {
    const { runner, endStream, pushEvent } = createRunnerWithFakeClient([]);

    const gen = runner.execute("/tmp/wd", "hi", baseOptions);
    const collecting = collectChunks(gen);
    pushEvent(busyEvent());
    endStream();

    await expect(collecting).rejects.toThrow(/ended before the session went idle/);
  });

  it("advertises the command.list inventory as an convoy.commands chunk", async () => {
    const { runner, calls } = createRunnerWithFakeClient(
      [busyEvent(), textPart("prt_1", "hi", { end: true }), idleEvent()],
      { commands: ["init", "commit"] },
    );

    const { chunks } = await collectChunks(
      runner.execute("/tmp/wd", "hi", baseOptions),
    );

    expect(calls.listCommands).toBe(1);
    expect(chunks[0].type).toBe("convoy.commands");
    // `compact` is executable through the summarize endpoint, so it joins the
    // template commands in the advertised inventory (OS-1614).
    expect(JSON.parse(chunks[0].data)).toEqual({
      commands: ["init", "commit", "compact"],
    });
    // Discovery is inventory-only; the prompt still goes out normally.
    expect(calls.promptAsync).toHaveLength(1);
  });

  // command.list() failing must not cost the user /compact: executing it does
  // not depend on that call.
  it("still advertises compact when command.list fails", async () => {
    const { runner } = createRunnerWithFakeClient([
      busyEvent(),
      textPart("prt_1", "hi", { end: true }),
      idleEvent(),
    ]);

    const { chunks } = await collectChunks(
      runner.execute("/tmp/wd", "hi", baseOptions),
    );

    expect(JSON.parse(chunks[0].data)).toEqual({ commands: ["compact"] });
  });

  it("executes /compact via the summarize endpoint with the run's model", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent(),
      { type: "session.compacted", properties: { sessionID: "ses_1" } },
      idleEvent(),
    ]);

    const { chunks, result } = await collectChunks(
      runner.execute("/tmp/wd", "/compact", {
        ...baseOptions,
        resolvedCliModel: "anthropic/claude-sonnet-5",
        runtimeCommand: { command: "compact" },
      }),
    );

    expect(calls.commandAsync).toHaveLength(0);
    expect(calls.promptAsync).toHaveLength(0);
    expect(calls.compactSession).toEqual([
      {
        sessionID: "ses_1",
        model: { providerID: "anthropic", modelID: "claude-sonnet-5" },
      },
    ]);
    // The confirmation event reaches the backend so the row can render.
    expect(chunks.some((chunk) => chunk.type === "session.compacted")).toBe(true);
    expect(result).toEqual({ continuationId: "ses_1" });
  });

  // summarize requires an explicit model, so a thread on the default model
  // falls back to the session's model, then the provider default.
  it("falls back to the session model when the run has no model", async () => {
    const { runner, calls } = createRunnerWithFakeClient(
      [busyEvent(), idleEvent()],
      { sessionModel: { providerID: "openai", modelID: "gpt-5.6" } },
    );

    await collectChunks(
      runner.execute("/tmp/wd", "/compact", {
        ...baseOptions,
        runtimeCommand: { command: "compact" },
      }),
    );

    expect(calls.getSessionModel).toEqual(["ses_1"]);
    expect(calls.getDefaultModel).toBe(0);
    expect(calls.compactSession).toEqual([
      { sessionID: "ses_1", model: { providerID: "openai", modelID: "gpt-5.6" } },
    ]);
  });

  it("falls back to the provider default when the session has no model", async () => {
    const { runner, calls } = createRunnerWithFakeClient(
      [busyEvent(), idleEvent()],
      { sessionModel: null, defaultModel: { providerID: "openai", modelID: "gpt-5.6" } },
    );

    await collectChunks(
      runner.execute("/tmp/wd", "/compact", {
        ...baseOptions,
        runtimeCommand: { command: "compact" },
      }),
    );

    expect(calls.getDefaultModel).toBe(1);
    expect(calls.compactSession).toEqual([
      { sessionID: "ses_1", model: { providerID: "openai", modelID: "gpt-5.6" } },
    ]);
  });

  it("fails the run with an actionable error when no model can be resolved", async () => {
    const { runner, calls } = createRunnerWithFakeClient([busyEvent()], {
      sessionModel: null,
      defaultModel: null,
    });

    await expect(
      collectChunks(
        runner.execute("/tmp/wd", "/compact", {
          ...baseOptions,
          runtimeCommand: { command: "compact" },
        }),
      ),
    ).rejects.toThrow(/could not resolve a model to compact/);
    expect(calls.compactSession).toHaveLength(0);
  });

  it("fails the run when the summarize endpoint rejects", async () => {
    const { runner } = createRunnerWithFakeClient([busyEvent()], {
      sessionModel: { providerID: "openai", modelID: "gpt-5.6" },
      compactSessionError: new Error("compaction unavailable"),
    });

    await expect(
      collectChunks(
        runner.execute("/tmp/wd", "/compact", {
          ...baseOptions,
          runtimeCommand: { command: "compact" },
        }),
      ),
    ).rejects.toThrow(/compaction unavailable/);
  });

  it("executes runtime commands via session.command instead of prompting", async () => {
    const { runner, calls } = createRunnerWithFakeClient([
      busyEvent(),
      textPart("prt_1", "committed", { end: true }),
      idleEvent(),
    ]);

    const { result } = await collectChunks(
      runner.execute("/tmp/wd", "/commit -m fix", {
        ...baseOptions,
        resolvedCliModel: "anthropic/claude-sonnet-5",
        resolvedCliEffort: "high",
        runtimeCommand: { command: "commit", arguments: "-m fix" },
      }),
    );

    expect(calls.promptAsync).toHaveLength(0);
    expect(calls.commandAsync).toEqual([
      {
        sessionID: "ses_1",
        command: "commit",
        arguments: "-m fix",
        model: { providerID: "anthropic", modelID: "claude-sonnet-5" },
        variant: "high",
      },
    ]);
    expect(result).toEqual({ continuationId: "ses_1" });
  });

  it("fails the run when session.command rejects", async () => {
    const { runner } = createRunnerWithFakeClient([busyEvent()], {
      commandAsyncError: new Error("unknown command"),
    });

    let error: unknown;
    try {
      await collectChunks(
        runner.execute("/tmp/wd", "/nope", {
          ...baseOptions,
          runtimeCommand: { command: "nope" },
        }),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("unknown command");
    expect((error as RunnerExecutionError).continuationId).toBe("ses_1");
  });
});
