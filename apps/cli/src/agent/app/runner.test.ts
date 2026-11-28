import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createConvexClientMock,
  createClaudeCodeRunnerMock,
  createFileStreamRunnerMock,
  createMessageHandlerMock,
  getGitRemoteUrlMock,
  toConvexSiteUrlMock,
  detectAvailableClisMock,
  execFileMock,
  subscribeMock,
  closeMock,
  unsubscribeMock,
  mutationMock,
  queryMock,
} = vi.hoisted(() => {
  const runnerAbort = vi.fn();
  const runnerShutdown = vi.fn().mockResolvedValue(undefined);
  // eslint-disable-next-line require-yield
  const runnerExecute = vi.fn(async function* () {
    return {};
  });

  const createClaudeCodeRunner = vi.fn(() => ({
    execute: runnerExecute,
    abort: runnerAbort,
    shutdown: runnerShutdown,
  }));

  const createFileStreamRunner = vi.fn(() => ({
    execute: runnerExecute,
    abort: runnerAbort,
    shutdown: runnerShutdown,
  }));

  const unsubscribe = vi.fn();
  const subscribe = vi.fn(() => unsubscribe);
  const close = vi.fn().mockResolvedValue(undefined);
  const mutation = vi.fn();
  const query = vi.fn();

  const createConvexClient = vi.fn(() => ({
    query,
    mutation,
    subscribe,
    close,
    client: {},
  }));

  return {
    createConvexClientMock: createConvexClient,
    createClaudeCodeRunnerMock: createClaudeCodeRunner,
    createFileStreamRunnerMock: createFileStreamRunner,
    createMessageHandlerMock: vi.fn(() => ({
      enqueueChat: vi.fn(),
      syncPendingChats: vi.fn(),
      isProcessing: vi.fn(() => false),
      shutdown: vi.fn().mockResolvedValue(undefined),
    })),
    detectAvailableClisMock: vi.fn().mockResolvedValue([{ type: "claude-code", version: "2.1.52", provider: "anthropic" }]),
    getGitRemoteUrlMock: vi.fn().mockResolvedValue(null),
    toConvexSiteUrlMock: vi.fn(() => "https://example.convex.site"),
    execFileMock: vi.fn(
      (_command: string, _args: readonly string[], callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
        callback(null, { stdout: "claude 2.1.52\n", stderr: "" });
        return {} as ReturnType<typeof import("child_process").execFile>;
      }
    ),
    subscribeMock: subscribe,
    closeMock: close,
    unsubscribeMock: unsubscribe,
    mutationMock: mutation,
    queryMock: query,
  };
});

vi.mock("../../lib/config/index.js", () => ({
  createConvexClient: createConvexClientMock,
}));

vi.mock("../runtimes/registry.js", () => ({
  detectAvailableClis: detectAvailableClisMock,
  createRunnerForCliType: vi.fn((_cliType: string, options: { streamFile?: string }) =>
    options.streamFile ? createFileStreamRunnerMock() : createClaudeCodeRunnerMock()
  ),
}));

vi.mock("./thread-processor.js", () => ({
  createMessageHandler: createMessageHandlerMock,
}));

vi.mock("../../lib/git/index.js", () => ({
  getGitRemoteUrl: getGitRemoteUrlMock,
}));

vi.mock("./worktree-op-processor.js", () => ({
  createWorktreeOpProcessor: vi.fn(() => ({
    enqueue: vi.fn(),
    scanAndSync: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../lib/url.js", () => ({
  toConvexSiteUrl: toConvexSiteUrlMock,
  resolveConvexSiteUrl: async () => toConvexSiteUrlMock(),
}));

vi.mock("../../lib/connect-events.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/connect-events.js")>()),
  exitAfterFlush: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
}));

import { ConnectDiagnosticError, createAgentRunner, supportsCodexAppServer } from "./runner.js";
import { disableConnectEvents, enableConnectEvents, exitAfterFlush, EXIT_FATAL, EXIT_SESSION_REPLACED } from "../../lib/connect-events.js";
import { getFunctionName } from "convex/server";

function okResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

describe("agent-runner shutdown lifecycle", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mutationMock.mockResolvedValue("ok");
    queryMock.mockResolvedValue([{ _id: "profile_123" }]);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : typeof input === "object" && input !== null && "url" in input && typeof (input as { url?: unknown }).url === "string"
              ? (input as { url: string }).url
              : "";

      if (url.endsWith("/api/agent/register")) {
        return okResponse({
          sessionId: "session_123",
          profileId: "profile_123",
        });
      }

      if (url.endsWith("/api/agent/disconnect")) {
        return okResponse({});
      }

      throw new Error(`Unexpected fetch url in test: ${url}`);
    });
  });

  it("prints the claude provider slug for anthropic while registering", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
    });

    try {
      const runPromise = runner.run();

      await vi.waitFor(() => {
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[CLIs] claude-code@2.1.52 (provider=claude)"));
      });

      await runner.stop();
      await runPromise;
    } finally {
      logSpy.mockRestore();
    }
  });

  it("gates the codex app-server transport on codex >= 0.142", () => {
    expect(supportsCodexAppServer([{ type: "codex", version: "0.142.3" }])).toBe(true);
    expect(supportsCodexAppServer([{ type: "codex", version: "0.150.0" }])).toBe(true);
    expect(supportsCodexAppServer([{ type: "codex", version: "0.141.9" }])).toBe(false);
    expect(supportsCodexAppServer([{ type: "codex", version: "unknown" }])).toBe(false);
    expect(supportsCodexAppServer([{ type: "claude-code", version: "2.1.52" }])).toBe(false);
  });

  it("downgrades codex steering support when the installed codex is too old", async () => {
    detectAvailableClisMock.mockResolvedValueOnce([
      { type: "codex", version: "0.140.0" },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
      codexAppServer: true,
    });

    try {
      const runPromise = runner.run();

      await vi.waitFor(() => {
        expect(createMessageHandlerMock).toHaveBeenCalled();
      });

      const registerCall = fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith("/api/agent/register")
      );
      const body = JSON.parse(String((registerCall?.[1] as { body: string }).body));
      expect(body.steeringCliTypes).toEqual(["claude-code", "antigravity"]);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("predates the app-server protocol")
      );

      // The runner factory must get the downgraded transport too.
      const handlerCall = createMessageHandlerMock.mock.calls[0] as unknown[] | undefined;
      const runnerFactory = handlerCall?.[0] as ((cliType: string) => unknown) | undefined;
      runnerFactory?.("codex");
      const { createRunnerForCliType } = await import("../runtimes/registry.js");
      expect(createRunnerForCliType).toHaveBeenCalledWith(
        "codex",
        expect.objectContaining({ codexAppServer: false })
      );

      await runner.stop();
      await runPromise;
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps an AWS Codex provider on app-server and hands it to detection and runners (OS-2105)", async () => {
    detectAvailableClisMock.mockResolvedValueOnce([{ type: "codex", version: "0.140.0", provider: "mantle", region: "us-east-1" }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const codexProvider = { provider: "mantle" as const, token: "aws-token", region: "us-east-1" };
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
      codexAppServer: true,
      codexProvider,
    });

    try {
      const runPromise = runner.run();
      await vi.waitFor(() => expect(createMessageHandlerMock).toHaveBeenCalled());
      expect(detectAvailableClisMock).toHaveBeenCalledWith({ codexProvider });
      const registerCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/agent/register"));
      const body = String((registerCall?.[1] as { body: string }).body);
      expect(body).not.toContain("aws-token");
      expect(JSON.parse(body).steeringCliTypes).toEqual(["claude-code", "codex", "antigravity"]);
      const runnerFactory = (createMessageHandlerMock.mock.calls[0] as unknown[])[0] as (cliType: string) => unknown;
      runnerFactory("codex");
      const { createRunnerForCliType } = await import("../runtimes/registry.js");
      expect(createRunnerForCliType).toHaveBeenCalledWith("codex", expect.objectContaining({ codexAppServer: true, codexProvider }));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("codex@0.140.0 (provider=mantle, region=us-east-1)"));
      await runner.stop();
      await runPromise;
    } finally {
      logSpy.mockRestore();
    }
  });

  it("gives the Convex client the Claude and Codex provider tokens to redact", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
      codexAppServer: true,
      claudeProviderToken: "claude-token",
      codexProvider: { provider: "mantle", token: "codex-token", region: "us-east-1" },
    });

    try {
      const runPromise = runner.run();
      await vi.waitFor(() => expect(createMessageHandlerMock).toHaveBeenCalled());
      expect(createConvexClientMock).toHaveBeenCalledWith(expect.objectContaining({ secrets: ["claude-token", "codex-token", undefined, undefined] }));
      await runner.stop();
      await runPromise;
    } finally {
      logSpy.mockRestore();
    }
  });

  it("redacts a managed Claude Code key and detects with it (OS-2108)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const claudeAuth = { mode: "bedrock" as const, secret: "managed-claude", region: "us-west-2" };
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"], claudeAuth,
    });
    try {
      const runPromise = runner.run();
      await vi.waitFor(() => expect(createMessageHandlerMock).toHaveBeenCalled());
      expect(createConvexClientMock).toHaveBeenCalledWith(expect.objectContaining({ secrets: ["managed-claude", undefined, undefined, undefined] }));
      expect(detectAvailableClisMock).toHaveBeenCalledWith(expect.objectContaining({ claudeAuth }));
      await runner.stop();
      await runPromise;
    } finally {
      logSpy.mockRestore();
    }
  });

  it("redacts a managed Cursor key and gives it to the Cursor runner (OS-2017)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cursorAuth = { mode: "managed" as const, secret: "managed-cursor" };
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"], cursorAuth,
    });
    try {
      const runPromise = runner.run();
      await vi.waitFor(() => expect(createMessageHandlerMock).toHaveBeenCalled());
      expect(createConvexClientMock).toHaveBeenCalledWith(expect.objectContaining({ secrets: [undefined, undefined, "managed-cursor", undefined] }));
      const runnerFactory = (createMessageHandlerMock.mock.calls[0] as unknown[])[0] as (cliType: string) => unknown;
      runnerFactory("cursor");
      const { createRunnerForCliType } = await import("../runtimes/registry.js");
      expect(createRunnerForCliType).toHaveBeenCalledWith("cursor", expect.objectContaining({ cursorAuth }));
      await runner.stop();
      await runPromise;
    } finally {
      logSpy.mockRestore();
    }
  });

  it("redacts a managed Gemini key and gives it to detection and the Antigravity runner (OS-2476)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const antigravityAuth = { mode: "managed" as const, secret: "managed-gemini" };
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"], antigravityAuth,
    });
    try {
      const runPromise = runner.run();
      await vi.waitFor(() => expect(createMessageHandlerMock).toHaveBeenCalled());
      expect(createConvexClientMock).toHaveBeenCalledWith(expect.objectContaining({ secrets: [undefined, undefined, undefined, "managed-gemini"] }));
      expect(detectAvailableClisMock).toHaveBeenCalledWith(expect.objectContaining({ antigravityAuth }));
      const runnerFactory = (createMessageHandlerMock.mock.calls[0] as unknown[])[0] as (cliType: string) => unknown;
      runnerFactory("antigravity");
      const { createRunnerForCliType } = await import("../runtimes/registry.js");
      expect(createRunnerForCliType).toHaveBeenCalledWith("antigravity", expect.objectContaining({ antigravityAuth }));
      await runner.stop();
      await runPromise;
    } finally {
      logSpy.mockRestore();
    }
  });

  it("redacts managed OpenCode keys and gives them to detection and the OpenCode runner (OS-2018)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const opencodeAuth = { mode: "managed" as const, keys: { openai: "managed-openai", anthropic: "managed-anthropic", "amazon-bedrock": { secret: "managed-bedrock", region: "us-east-1" } } };
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"], opencodeAuth,
    });
    try {
      const runPromise = runner.run();
      await vi.waitFor(() => expect(createMessageHandlerMock).toHaveBeenCalled());
      expect(createConvexClientMock).toHaveBeenCalledWith(expect.objectContaining({ secrets: [undefined, undefined, undefined, undefined, "managed-openai", "managed-anthropic", "managed-bedrock"] }));
      expect(detectAvailableClisMock).toHaveBeenCalledWith(expect.objectContaining({ opencodeAuth }));
      const runnerFactory = (createMessageHandlerMock.mock.calls[0] as unknown[])[0] as (cliType: string) => unknown;
      runnerFactory("opencode");
      const { createRunnerForCliType } = await import("../runtimes/registry.js");
      expect(createRunnerForCliType).toHaveBeenCalledWith("opencode", expect.objectContaining({ opencodeAuth }));
      await runner.stop();
      await runPromise;
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints the bedrock provider while registering", async () => {
    detectAvailableClisMock.mockResolvedValueOnce([{ type: "claude-code", version: "2.1.52", provider: "bedrock" }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
    });

    try {
      const runPromise = runner.run();

      await vi.waitFor(() => {
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[CLIs] claude-code@2.1.52 (provider=bedrock)"));
      });

      await runner.stop();
      await runPromise;
    } finally {
      logSpy.mockRestore();
    }
  });

  it("calls runner abort+shutdown from stop and keeps stop idempotent", async () => {
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
      maxConcurrentChats: 9,
    });

    const runPromise = runner.run();

    await vi.waitFor(() => {
      expect(createMessageHandlerMock).toHaveBeenCalledTimes(1);
      // pending threads + interaction answers + worktree ops
      expect(subscribeMock).toHaveBeenCalledTimes(3);
    });

    const firstHandlerCall = createMessageHandlerMock.mock.calls[0] as unknown[] | undefined;
    if (!firstHandlerCall) {
      throw new Error("createMessageHandler was not called");
    }
    const runnerFactory = firstHandlerCall[0] as (() => unknown) | undefined;
    const handlerOptions = firstHandlerCall[3];
    expect(typeof runnerFactory).toBe("function");
    runnerFactory?.();
    expect(createClaudeCodeRunnerMock).toHaveBeenCalledTimes(1);
    expect(handlerOptions).toEqual(expect.objectContaining({ maxConcurrentChats: 9 }));

    await runner.stop();
    await runPromise;

    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeMock).toHaveBeenCalledTimes(3);

    await runner.stop();
  });

  it("builds fixture runners lazily in stream mode", async () => {
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
      streamFile: "./fixtures/test.jsonl",
    });

    const runPromise = runner.run();

    await vi.waitFor(() => {
      expect(createMessageHandlerMock).toHaveBeenCalledTimes(1);
    });

    const firstHandlerCall = createMessageHandlerMock.mock.calls[0] as unknown[] | undefined;
    if (!firstHandlerCall) {
      throw new Error("createMessageHandler was not called");
    }
    const runnerFactory = firstHandlerCall[0] as (() => unknown) | undefined;
    expect(typeof runnerFactory).toBe("function");
    runnerFactory?.();
    expect(createFileStreamRunnerMock).toHaveBeenCalledTimes(1);

    await runner.stop();
    await runPromise;
  });

  it("names the detected project runtimes when none starts", async () => {
    vi.stubEnv("CONVOY_PROJECT_IDENTITY", "a".repeat(64)); vi.stubEnv("CONVOY_PROJECT_RUNTIMES", "codex");
    detectAvailableClisMock.mockResolvedValueOnce([]);
    const runner = await createAgentRunner({ convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"] });
    try {
      const failure = await runner.run().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ConnectDiagnosticError);
      expect(failure).toMatchObject({ reason: "runtime-missing", message: expect.stringContaining("Detected for this project: codex. Install Codex, Claude Code, Cursor, Antigravity, OpenCode root-owned") });
    } finally { vi.unstubAllEnvs(); await runner.stop(); }
  });

  it.each([
    ["backend-unreachable", () => { throw new TypeError("fetch failed"); }, /Cannot reach Convoy/],
    ["auth-rejected", () => ({ ok: false, status: 401, json: async () => ({ error: "Invalid or expired API key" }) }) as Response, /rejected this project's API key/],
  ])("reports %s when registration fails", async (reason, respond, message) => {
    fetchMock.mockImplementation(async () => respond());
    const runner = await createAgentRunner({ convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"] });
    try {
      const failure = await runner.run().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ConnectDiagnosticError);
      expect(failure).toMatchObject({ reason, message: expect.stringMatching(message) });
    } finally { await runner.stop(); }
  });

  // OS-2551: the heartbeat is one Convex mutation over the WebSocket client.
  async function runHeartbeat(advanceMs = 30_000, during?: () => Promise<void>) {
    vi.useFakeTimers();
    const events: Array<Record<string, unknown>> = [];
    enableConnectEvents((line) => events.push(JSON.parse(line) as Record<string, unknown>));
    const runner = await createAgentRunner({ convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"] });
    try {
      const runPromise = runner.run();
      await vi.advanceTimersByTimeAsync(advanceMs);
      await during?.();
      const stopPromise = runner.stop();
      await vi.advanceTimersByTimeAsync(2_000);
      await stopPromise; await runPromise;
      return { events, fetched: fetchMock.mock.calls.map(([input]) => String(input)) };
    } finally { disableConnectEvents(); vi.useRealTimers(); }
  }

  it("sends the heartbeat as a Convex mutation, not over HTTP", async () => {
    const { events, fetched } = await runHeartbeat();
    expect(mutationMock.mock.calls.map(([fn, args]) => [getFunctionName(fn), args])).toContainEqual(["cli/sessions:heartbeatByKey", { sessionId: "session_123" }]);
    expect(fetched.filter((url) => url.endsWith("/api/agent/heartbeat"))).toEqual([]);
    expect(events.map((event) => event.status)).toEqual(["online"]);
    expect(exitAfterFlush).not.toHaveBeenCalled();
  });

  // A sleeping laptop misses heartbeats until the sweep deletes its session.
  function expireOnce(registerAgain: () => Response) {
    mutationMock.mockResolvedValueOnce("session_not_found");
    const register = vi.fn<(body: Record<string, unknown>) => Response>()
      .mockReturnValueOnce(okResponse({ sessionId: "session_123", profileId: "profile_123" }))
      .mockImplementation(registerAgain);
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) =>
      String(input).endsWith("/api/agent/register") ? register(JSON.parse(String(init?.body)) as Record<string, unknown>) : okResponse({}));
    return register;
  }

  it("re-registers without force when the sweep expired the session", async () => {
    const register = expireOnce(() => okResponse({ sessionId: "session_456", profileId: "profile_123" }));
    const { events } = await runHeartbeat();
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[1][0]).toMatchObject({ force: false });
    expect(createMessageHandlerMock.mock.calls.map((call: unknown[]) => call[2])).toEqual(["session_123", "session_456"]);
    expect(events).toContainEqual(expect.objectContaining({ status: "online", sessionId: "session_456" }));
    expect(exitAfterFlush).not.toHaveBeenCalled();
  });

  it("exits as replaced when another CLI holds the profile", async () => {
    expireOnce(() => ({ ok: false, status: 409, json: async () => ({ code: "SESSION_CONFLICT", error: "taken" }) }) as Response);
    const { events } = await runHeartbeat();
    expect(events).toContainEqual(expect.objectContaining({ status: "failed", message: "Session was replaced or its profile deleted" }));
    expect(exitAfterFlush).toHaveBeenCalledWith(EXIT_SESSION_REPLACED);
  });

  it("exits as replaced without re-registering when the profile was deleted", async () => {
    const register = expireOnce(() => okResponse({ sessionId: "session_456", profileId: "profile_new" }));
    queryMock.mockResolvedValue([]);
    await runHeartbeat();
    expect(register).toHaveBeenCalledTimes(1);
    expect(exitAfterFlush).toHaveBeenCalledWith(EXIT_SESSION_REPLACED);
  });

  it("keeps the session lost and retries when re-registration cannot reach Convoy", async () => {
    expireOnce(() => { throw new TypeError("fetch failed"); });
    const { events } = await runHeartbeat();
    expect(events).toContainEqual(expect.objectContaining({ status: "retrying" }));
    expect(exitAfterFlush).not.toHaveBeenCalled();
  });

  it("reports a rejected key on heartbeat as auth-rejected", async () => {
    mutationMock.mockResolvedValue("unauthorized");
    const { events } = await runHeartbeat();
    expect(events).toContainEqual(expect.objectContaining({ status: "failed", reason: "auth-rejected" }));
    expect(exitAfterFlush).toHaveBeenCalledWith(EXIT_FATAL);
  });

  it("reports retrying when the heartbeat waits out a WebSocket reconnect", async () => {
    mutationMock.mockReturnValue(new Promise(() => {}));
    const { events } = await runHeartbeat(35_000);
    expect(events).toContainEqual(expect.objectContaining({ status: "retrying" }));
    expect(exitAfterFlush).not.toHaveBeenCalled();
  });

  const heartbeatCalls = () => mutationMock.mock.calls.filter(([fn]) => getFunctionName(fn) === "cli/sessions:heartbeatByKey").length;
  function deferHeartbeat() {
    let settle!: (result: string) => void;
    mutationMock.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    return (result: string) => settle(result);
  }

  it("keeps one heartbeat in flight while the WebSocket is down", async () => {
    mutationMock.mockReturnValue(new Promise(() => {}));
    await runHeartbeat(95_000);
    expect(heartbeatCalls()).toBe(1);
  });

  it("acts on a terminal reply that arrives after the timeout", async () => {
    const settle = deferHeartbeat();
    queryMock.mockResolvedValue([]);
    const { events } = await runHeartbeat(36_000, async () => {
      settle("session_not_found");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(events.map((event) => event.status)).toEqual(["online", "retrying", "failed"]);
    expect(exitAfterFlush).toHaveBeenCalledWith(EXIT_SESSION_REPLACED);
  });

  it("ignores a heartbeat reply that arrives after shutdown", async () => {
    vi.useFakeTimers();
    const settle = deferHeartbeat();
    const runner = await createAgentRunner({ convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"] });
    try {
      const runPromise = runner.run();
      await vi.advanceTimersByTimeAsync(31_000);
      const stopPromise = runner.stop();
      await vi.advanceTimersByTimeAsync(2_000);
      await stopPromise; await runPromise;
      settle("unauthorized");
      await vi.advanceTimersByTimeAsync(0);
      expect(exitAfterFlush).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("retries on a heartbeat status it does not know", async () => {
    mutationMock.mockResolvedValue("rate_limited");
    const { events } = await runHeartbeat();
    expect(events).toContainEqual(expect.objectContaining({ status: "retrying" }));
    expect(exitAfterFlush).not.toHaveBeenCalled();
  });

  it("keeps the session on a thrown heartbeat and names the error", async () => {
    mutationMock.mockRejectedValue(new Error("Could not find public function for 'cli/sessions:heartbeatByKey'"));
    const { events } = await runHeartbeat();
    expect(events).toContainEqual(expect.objectContaining({ status: "retrying", message: expect.stringContaining("Could not find public function") }));
    expect(exitAfterFlush).not.toHaveBeenCalled();
  });

  it("reports registration only after the backend accepts it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = await createAgentRunner({ convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"] });
    try {
      const runPromise = runner.run();
      await vi.waitFor(() => expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Agent registered")));
      await runner.stop(); await runPromise;
    } finally { logSpy.mockRestore(); }
  });

  it("emits an online connect event with the session id after registering", async () => {
    const lines: string[] = [];
    enableConnectEvents((line) => lines.push(line));
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
    });

    try {
      const runPromise = runner.run();

      await vi.waitFor(() => {
        const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(events).toContainEqual(
          expect.objectContaining({ event: "status", status: "online", sessionId: "session_123", versions: { "claude-code": "2.1.52" } })
        );
      });

      await runner.stop();
      await runPromise;
    } finally {
      disableConnectEvents();
    }
  });

  it("waits for message handler shutdown completion before stop resolves", async () => {
    let resolveShutdown!: () => void;
    createMessageHandlerMock.mockReturnValueOnce({
      enqueueChat: vi.fn(),
      syncPendingChats: vi.fn(),
      isProcessing: vi.fn(() => false),
      shutdown: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveShutdown = () => {
              resolve();
            };
          })
      ),
    });
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
    });

    const runPromise = runner.run();

    await vi.waitFor(() => {
      expect(createMessageHandlerMock).toHaveBeenCalledTimes(1);
    });

    const stopPromise = runner.stop();
    let stopResolved = false;
    void stopPromise.then(() => {
      stopResolved = true;
    });

    expect(stopResolved).toBe(false);
    resolveShutdown();

    await stopPromise;
    await runPromise;

    expect(stopResolved).toBe(true);
  });
});
