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

  const createConvexClient = vi.fn(() => ({
    query: vi.fn(),
    mutation: vi.fn(),
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
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
}));

import { ConnectDiagnosticError, createAgentRunner, supportsCodexAppServer } from "./runner.js";
import { disableConnectEvents, enableConnectEvents } from "../../lib/connect-events.js";

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

      if (url.endsWith("/api/agent/heartbeat")) {
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
      expect(createConvexClientMock).toHaveBeenCalledWith(expect.objectContaining({ secrets: ["claude-token", "codex-token", undefined] }));
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
      expect(createConvexClientMock).toHaveBeenCalledWith(expect.objectContaining({ secrets: ["managed-claude", undefined, undefined] }));
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
      expect(createConvexClientMock).toHaveBeenCalledWith(expect.objectContaining({ secrets: [undefined, undefined, "managed-cursor"] }));
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

  it("redacts managed OpenCode keys and gives them to detection and the OpenCode runner (OS-2018)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const opencodeAuth = { mode: "managed" as const, keys: { openai: "managed-openai", anthropic: "managed-anthropic", "amazon-bedrock": { secret: "managed-bedrock", region: "us-east-1" } } };
    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"], opencodeAuth,
    });
    try {
      const runPromise = runner.run();
      await vi.waitFor(() => expect(createMessageHandlerMock).toHaveBeenCalled());
      expect(createConvexClientMock).toHaveBeenCalledWith(expect.objectContaining({ secrets: [undefined, undefined, undefined, "managed-openai", "managed-anthropic", "managed-bedrock"] }));
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
      expect(failure).toMatchObject({ reason: "runtime-missing", message: expect.stringContaining("Detected for this project: codex. Install Codex, Claude Code, Cursor, OpenCode, Antigravity root-owned") });
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

  it("reports a rejected key on heartbeat as auth-rejected", async () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const events: string[] = [];
    enableConnectEvents((line) => events.push(line));
    fetchMock.mockImplementation(async (input: unknown) => String(input).endsWith("/api/agent/register")
      ? okResponse({ sessionId: "session_123", profileId: "profile_123" })
      : String(input).endsWith("/api/agent/heartbeat") ? { ok: false, status: 403 } as Response : okResponse({}));
    const runner = await createAgentRunner({ convexUrl: "https://example.convex.cloud", apiKey: "api_test_123", projectId: "project_123", paths: ["/tmp/repo"] });
    try {
      const runPromise = runner.run();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(events.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual(expect.objectContaining({ status: "failed", reason: "auth-rejected" }));
      const stopPromise = runner.stop();
      await vi.advanceTimersByTimeAsync(2_000);
      await stopPromise; await runPromise;
    } finally { disableConnectEvents(); exitSpy.mockRestore(); vi.useRealTimers(); }
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
          expect.objectContaining({ event: "status", status: "online", sessionId: "session_123" })
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

  it("keeps the session on transient heartbeat errors instead of exiting", async () => {
    vi.useFakeTimers();
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const events: string[] = [];
    enableConnectEvents((line) => events.push(line));
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.endsWith("/api/agent/register")) {
        return okResponse({ sessionId: "session_123", profileId: "profile_123" });
      }
      if (url.endsWith("/api/agent/heartbeat")) {
        return { ok: false, status: 500 } as Response;
      }
      return okResponse({});
    });

    const runner = await createAgentRunner({
      convexUrl: "https://example.convex.cloud",
      apiKey: "api_test_123",
      projectId: "project_123",
      paths: ["/tmp/repo"],
    });

    try {
      const runPromise = runner.run();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(exitSpy).not.toHaveBeenCalled();
      const statuses = events.map(
        (line) => (JSON.parse(line) as { status?: string }).status
      );
      expect(statuses).toContain("retrying");

      const stopPromise = runner.stop();
      await vi.advanceTimersByTimeAsync(2_000);
      await stopPromise;
      await runPromise;
    } finally {
      disableConnectEvents();
      exitSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
