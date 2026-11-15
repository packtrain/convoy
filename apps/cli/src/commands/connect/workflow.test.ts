import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({ confirm: vi.fn().mockRejectedValue(new Error("stdin is closed")) }));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start() {
      return this;
    },
    succeed: vi.fn(),
    fail: vi.fn(),
  })),
}));

const { createAgentRunnerMock, offerUpdateMock } = vi.hoisted(() => ({
  createAgentRunnerMock: vi.fn(),
  offerUpdateMock: vi.fn(),
}));

vi.mock("../update/prompts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../update/prompts.js")>()),
  offerUpdate: offerUpdateMock,
}));

vi.mock("../../agent/app/runner.js", () => ({
  createAgentRunner: createAgentRunnerMock,
  ConnectDiagnosticError: class ConnectDiagnosticError extends Error {
    constructor(message: string, public readonly reason?: string) { super(message); }
  },
  SessionConflictError: class SessionConflictError extends Error {
    public readonly activeSessionCount: number;

    constructor(message: string, activeSessionCount: number) {
      super(message);
      this.activeSessionCount = activeSessionCount;
    }
  },
}));

import { connectCommand } from "./command.js";
import {
  connectUsingProfile,
  DEFAULT_CONNECT_CONCURRENCY,
  logConnectConfigSummary,
  parseConnectConcurrencyOption,
  resolveCodexAppServer,
  resolveConnectConcurrency,
  resolveIsolated,
  resolvePartialStreaming,
  runConnect,
} from "./workflow.js";
import { MAX_MAX_CONCURRENT_CHATS } from "../../agent/app/runtime-config.js";

describe("connect command concurrency", () => {
  let tmpDirs: string[] = [];

  // Each runConnect installs its own signal handlers; a real process only ever
  // calls it once, so the default cap of 10 is a test-only artifact.
  process.setMaxListeners(50);

  beforeEach(() => {
    tmpDirs = [];
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Keep the update check off the network: an old version means no notice.
    stubNpmLatest("0.0.1");
    createAgentRunnerMock.mockResolvedValue({
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const tmpDir of tmpDirs) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function stubNpmLatest(version: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ version }) }))
    );
  }

  function loggedLines(): string {
    return vi.mocked(console.log).mock.calls.flat().join("\n");
  }

  function makeTmpDir(): string {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname, ".tmp-connect-"));
    tmpDirs.push(tmpDir);
    return tmpDir;
  }

  it("parses undefined as default concurrency", () => {
    expect(parseConnectConcurrencyOption(undefined)).toBe(
      DEFAULT_CONNECT_CONCURRENCY
    );
  });

  it("reports a noninteractive session conflict with explicit force recovery", async () => {
    const { SessionConflictError } = await import("../../agent/app/runner.js");
    createAgentRunnerMock.mockRejectedValue(new SessionConflictError("conflict", 1));
    await expect(runConnect({ convexUrl: "https://example.com", apiKey: "secret", projectId: "a", nonInteractive: true })).rejects.toThrow(/--force/);
  });
  it("shows an intentional isolated diagnostic without its credentials", async () => {
    const { ConnectDiagnosticError } = await import("../../agent/app/runner.js");
    createAgentRunnerMock.mockResolvedValue({ run: vi.fn().mockRejectedValue(new ConnectDiagnosticError("No runtime for key secret-key.", "runtime-missing")), stop: vi.fn() });
    const failure = await runConnect({ convexUrl: "https://example.com", apiKey: "secret-key", projectId: "a", nonInteractive: true }).then(() => new Error("resolved"), (error: Error) => error);
    expect(failure.message).toContain("No runtime for key [redacted].");
  });
  it("keeps unexpected isolated errors generic", async () => {
    createAgentRunnerMock.mockResolvedValue({ run: vi.fn().mockRejectedValue(new Error("raw backend detail")), stop: vi.fn() });
    const failure = await runConnect({ convexUrl: "https://example.com", apiKey: "secret", projectId: "a", nonInteractive: true }).then(() => new Error("resolved"), (error: Error) => error);
    expect(failure.message).toMatch(/^Isolated connection failed\./); expect(failure.message).not.toContain("raw backend detail");
  });
  it("sends the diagnostic reason to a JSON supervisor", async () => {
    const { ConnectDiagnosticError } = await import("../../agent/app/runner.js");
    const { disableConnectEvents } = await import("../../lib/connect-events.js");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    createAgentRunnerMock.mockResolvedValue({ run: vi.fn().mockRejectedValue(new ConnectDiagnosticError("No runtime.", "runtime-missing")), stop: vi.fn() });
    vi.stubEnv("CONVOY_PROJECT_RUNTIMES", "codex,claude-code");
    try {
      await runConnect({ convexUrl: "https://example.com", apiKey: "secret", projectId: "a", nonInteractive: true, jsonEvents: true }).catch(() => {});
      const events = write.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(events).toContainEqual(expect.objectContaining({ event: "status", status: "failed", reason: "runtime-missing", runtimes: ["codex", "claude-code"] }));
      // Reported at start too, so a paused project still knows which logins exist.
      expect(events).toContainEqual(expect.objectContaining({ event: "status", status: "connecting", runtimes: ["codex", "claude-code"] }));
    } finally { write.mockRestore(); disableConnectEvents(); vi.unstubAllEnvs(); }
  });
  it("reports skipped and logged-out runtimes at start, minus managed ones", async () => {
    const { disableConnectEvents } = await import("../../lib/connect-events.js");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    createAgentRunnerMock.mockResolvedValue({ run: vi.fn().mockRejectedValue(new Error("stop")), stop: vi.fn() });
    vi.stubEnv("CONVOY_PROJECT_RUNTIMES", "codex,claude-code");
    vi.stubEnv("CONVOY_PROJECT_UNTRUSTED", "");
    vi.stubEnv("CONVOY_PROJECT_LOGGED_OUT", "codex,claude-code");
    try {
      await runConnect({ convexUrl: "https://example.com", apiKey: "secret", projectId: "a", nonInteractive: true, jsonEvents: true,
        claudeAuth: { mode: "bedrock", secret: "s", region: "us-east-1" } }).catch(() => {});
      const events = write.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(events).toContainEqual(expect.objectContaining({ status: "connecting", untrusted: [], loggedOut: ["codex"] }));
    } finally { write.mockRestore(); disableConnectEvents(); vi.unstubAllEnvs(); }
  });
  it("does not claim registration before the runner registers", async () => {
    createAgentRunnerMock.mockResolvedValue({ run: vi.fn().mockRejectedValue(new Error("failed")), stop: vi.fn() });
    await runConnect({ convexUrl: "https://example.com", apiKey: "secret", projectId: "a", nonInteractive: true }).catch(() => {});
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).not.toContain("Agent registered");
  });
  it("stops the runner gracefully on the isolated control signal", async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const run = vi.fn(() => pending);
    const stop = vi.fn(async () => { finish(); });
    createAgentRunnerMock.mockResolvedValue({ run, stop });
    const running = runConnect({ convexUrl: "https://example.com", apiKey: "secret", projectId: "a", shutdownSignal: controller.signal });
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    controller.abort();
    try { await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce()); }
    finally { finish(); await running; }
  });
  it("parses positive integer concurrency", () => {
    expect(parseConnectConcurrencyOption("7")).toBe(7);
  });

  it("resolves concurrency from flag, profile, then default", () => {
    expect(resolveConnectConcurrency(9, 7)).toBe(9);
    expect(resolveConnectConcurrency(undefined, 7)).toBe(7);
    expect(resolveConnectConcurrency(undefined, undefined)).toBe(
      DEFAULT_CONNECT_CONCURRENCY
    );
  });

  it("rejects invalid concurrency values", () => {
    expect(() => parseConnectConcurrencyOption("0")).toThrow(
      /Invalid concurrency/
    );
    expect(() => parseConnectConcurrencyOption("-1")).toThrow(
      /Invalid concurrency/
    );
    expect(() => parseConnectConcurrencyOption("1.5")).toThrow(
      /Invalid concurrency/
    );
    expect(() => parseConnectConcurrencyOption("abc")).toThrow(
      /Invalid concurrency/
    );
    expect(() =>
      parseConnectConcurrencyOption(String(MAX_MAX_CONCURRENT_CHATS + 1))
    ).toThrow(/Maximum supported value/);
  });

  it("exposes an explicit force option", () => {
    expect(connectCommand.options.find((option) => option.long === "--force")).toBeDefined();
  });

  it("registers short and long concurrency flags in connect command", () => {
    const option = connectCommand.options.find(
      (candidate) => candidate.long === "--concurrency"
    );

    expect(option).toBeDefined();
    expect(option?.short).toBe("-c");
    expect(option?.attributeName()).toBe("concurrency");
  });

  it("passes explicit concurrency to agent runner", async () => {
    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: ["/tmp/repo"],
      concurrency: 8,
    });

    expect(createAgentRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrentChats: 8 })
    );
  });

  it("exports the bridge's profile to agent subprocesses over a stale CONVOY_PROFILE", async () => {
    const before = process.env.CONVOY_PROFILE;
    process.env.CONVOY_PROFILE = "stale-host-profile";
    let profileAtRunnerStart: string | undefined;
    createAgentRunnerMock.mockImplementationOnce(async () => {
      profileAtRunnerStart = process.env.CONVOY_PROFILE;
      return { run: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    });
    try {
      await runConnect({
        convexUrl: "https://example.convex.cloud",
        apiKey: "sk_test",
        projectId: "proj_test",
        paths: ["/tmp/repo"],
        profileKey: "bridge-profile",
      });
    } finally {
      if (before === undefined) delete process.env.CONVOY_PROFILE;
      else process.env.CONVOY_PROFILE = before;
    }

    expect(profileAtRunnerStart).toBe("bridge-profile");
  });

  it("uses default concurrency when omitted", async () => {
    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: ["/tmp/repo"],
    });

    expect(createAgentRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxConcurrentChats: DEFAULT_CONNECT_CONCURRENCY,
      })
    );
  });

  it("prints the update notice when npm has a newer version", async () => {
    stubNpmLatest("999.0.0");

    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: ["/tmp/repo"],
    });

    expect(loggedLines()).toMatch(/Update available: .+ → 999\.0\.0/);
    expect(loggedLines()).toContain("convoy update");
  });

  it("prints no update notice when npm has nothing newer", async () => {
    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: ["/tmp/repo"],
    });

    expect(loggedLines()).not.toContain("Update available");
  });

  it("skips the update check in stream-replay mode", async () => {
    stubNpmLatest("999.0.0");

    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: ["/tmp/repo"],
      streamFile: "/tmp/does-not-exist.jsonl",
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(loggedLines()).not.toContain("Update available");
  });

  describe("session conflict with nobody to answer", () => {
    const stdinTty = process.stdin.isTTY;
    const setStdinTty = (value: boolean) => Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
    const config = { convexUrl: "https://example.convex.cloud", apiKey: "sk_test", projectId: "proj_test", paths: ["/tmp/repo"] };

    beforeEach(async () => {
      const { SessionConflictError } = await import("../../agent/app/runner.js");
      createAgentRunnerMock.mockRejectedValue(new SessionConflictError("conflict", 1));
      offerUpdateMock.mockResolvedValue(false);
    });
    afterEach(() => { setStdinTty(stdinTty); vi.unstubAllEnvs(); });

    it("fails with the --force hint instead of prompting when stdin is not a TTY", async () => {
      const { confirm } = await import("@inquirer/prompts");
      setStdinTty(false); vi.stubEnv("CONVOY_THREAD_ID", "");

      await expect(runConnect(config)).rejects.toThrow(/--force/);

      expect(confirm).not.toHaveBeenCalled();
      expect(createAgentRunnerMock).toHaveBeenCalledOnce();
    });

    it("fails with the --force hint instead of prompting inside an agent thread", async () => {
      const { confirm } = await import("@inquirer/prompts");
      setStdinTty(true); vi.stubEnv("CONVOY_THREAD_ID", "thread-a");

      await expect(runConnect(config)).rejects.toThrow(/--force/);

      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe("in a terminal", () => {
    const stdinTty = process.stdin.isTTY;
    const stdoutTty = process.stdout.isTTY;
    const setTty = (stdin: boolean, stdout: boolean) => {
      Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
    };
    const config = { convexUrl: "https://example.convex.cloud", apiKey: "sk_test", projectId: "proj_test", paths: ["/tmp/repo"] };

    beforeEach(() => { setTty(true, true); vi.stubEnv("CI", ""); vi.stubEnv("CONVOY_THREAD_ID", ""); stubNpmLatest("999.0.0"); });
    afterEach(() => { setTty(stdinTty, stdoutTty); vi.unstubAllEnvs(); });

    it("offers the update before connecting and exits once it installs", async () => {
      offerUpdateMock.mockResolvedValue(true);

      await runConnect(config);

      expect(offerUpdateMock).toHaveBeenCalledWith("999.0.0");
      expect(createAgentRunnerMock).not.toHaveBeenCalled();
      expect(loggedLines()).toContain("Updated. Run convoy connect again.");
    });

    it("connects without the notice line after a skip", async () => {
      offerUpdateMock.mockResolvedValue(false);

      await runConnect(config);

      expect(createAgentRunnerMock).toHaveBeenCalledOnce();
      expect(loggedLines()).not.toContain("Update available");
    });

    it("keeps the notice and never prompts for a supervised run", async () => {
      const { disableConnectEvents } = await import("../../lib/connect-events.js");
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const errors = vi.mocked(console.error);
      try {
        await runConnect({ ...config, jsonEvents: true });
      } finally { write.mockRestore(); disableConnectEvents(); }

      expect(offerUpdateMock).not.toHaveBeenCalled();
      expect([...vi.mocked(console.log).mock.calls, ...errors.mock.calls].flat().join("\n")).toContain("Update available");
    });

    it("does not prompt again on a session-conflict retry", async () => {
      const { SessionConflictError } = await import("../../agent/app/runner.js");
      const { confirm } = await import("@inquirer/prompts");
      vi.mocked(confirm).mockResolvedValueOnce(true);
      createAgentRunnerMock.mockRejectedValueOnce(new SessionConflictError("conflict", 1));
      offerUpdateMock.mockResolvedValue(false);

      await runConnect(config);

      expect(createAgentRunnerMock).toHaveBeenCalledTimes(2);
      expect(offerUpdateMock).toHaveBeenCalledOnce();
    });
  });

  it("registers the --buffered flag on the connect command", () => {
    const option = connectCommand.options.find(
      (candidate) => candidate.long === "--buffered"
    );

    expect(option).toBeDefined();
    expect(option?.attributeName()).toBe("buffered");
  });

  it("registers the --json flag on the connect command", () => {
    const option = connectCommand.options.find(
      (candidate) => candidate.long === "--json"
    );

    expect(option).toBeDefined();
    expect(option?.attributeName()).toBe("json");
  });

  it("registers the --codex-exec flag on the connect command", () => {
    const option = connectCommand.options.find(
      (candidate) => candidate.long === "--codex-exec"
    );

    expect(option).toBeDefined();
    expect(option?.attributeName()).toBe("codexExec");
  });

  it("registers no negated flags on the connect command", () => {
    const negated = connectCommand.options
      .map((candidate) => candidate.long)
      .filter((long) => long?.startsWith("--no-"));

    expect(negated).toEqual([]);
  });

  it("resolves partial streaming from --buffered, then profile config, else unset", () => {
    // --buffered always wins: it is the explicit off switch.
    expect(resolvePartialStreaming(true, undefined)).toBe(false);
    expect(resolvePartialStreaming(true, true)).toBe(false);
    // Unset falls through to the profile, then to runConnect's default.
    expect(resolvePartialStreaming(undefined, true)).toBe(true);
    expect(resolvePartialStreaming(undefined, false)).toBe(false);
    expect(resolvePartialStreaming(undefined, undefined)).toBeUndefined();
  });

  it("resolves the codex transport from --codex-exec, else unset", () => {
    expect(resolveCodexAppServer(true)).toBe(false);
    expect(resolveCodexAppServer(undefined)).toBeUndefined();
  });

  it("passes partial streaming to the agent runner", async () => {
    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: ["/tmp/repo"],
      partialStreaming: true,
    });

    expect(createAgentRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({ partialStreaming: true })
    );
  });

  it("defaults streaming and the codex app-server transport on (OS-1659)", async () => {
    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: ["/tmp/repo"],
    });

    expect(createAgentRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({ partialStreaming: true, codexAppServer: true })
    );
  });

  it("honors explicit opt-out of streaming and the app-server transport", async () => {
    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: ["/tmp/repo"],
      partialStreaming: false,
      codexAppServer: false,
    });

    expect(createAgentRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({ partialStreaming: false, codexAppServer: false })
    );
  });

  it("registers the --isolated flag on the connect command", () => {
    const option = connectCommand.options.find(
      (candidate) => candidate.long === "--isolated"
    );

    expect(option).toBeDefined();
    expect(option?.attributeName()).toBe("isolated");
  });

  it("resolves isolation from flag, profile config, then off", () => {
    expect(resolveIsolated(true, undefined)).toBe(true);
    expect(resolveIsolated(true, false)).toBe(true);
    expect(resolveIsolated(undefined, true)).toBe(true);
    expect(resolveIsolated(undefined, false)).toBe(false);
    expect(resolveIsolated(undefined, undefined)).toBe(false);
  });

  it("passes isolation to the agent runner", async () => {
    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: ["/tmp/repo"],
      isolated: true,
    });

    expect(createAgentRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({ isolated: true })
    );
  });

  it("prints a skills.sh hint when connecting without a project skill", async () => {
    const repoPath = makeTmpDir();

    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: [repoPath],
    });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Convoy task skill was not found")
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("convoy init skill --scope project")
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("npx skills add https://github.com/packtrain/convoy/tree/main/plugins/convoy/skills --skill convoy")
    );
  });

  it("does not print the skills.sh hint when a project skill exists", async () => {
    const repoPath = makeTmpDir();
    const skillDir = path.join(repoPath, ".agents", "skills", "convoy");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# skill", "utf-8");

    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: [repoPath],
    });

    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining("Convoy task skill was not found")
    );
  });

  it("does not print the skills.sh hint in stream fixture mode", async () => {
    const repoPath = makeTmpDir();

    await runConnect({
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test",
      projectId: "proj_test",
      paths: [repoPath],
      streamFile: path.join(repoPath, "fixture.jsonl"),
    });

    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining("Convoy task skill was not found")
    );
  });

  it("prints a masked connect config summary", () => {
    logConnectConfigSummary({
      profileKey: "os-local",
      profileName: "Local Profile",
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test_abcdefghijklmnopqrstuvwxyz",
      projectId: "proj_123",
      paths: ["/tmp/repo", "/tmp/other"],
      resolutionSource: "path-match",
    });

    expect(console.log).toHaveBeenCalledWith("Resolved config:");
    expect(console.log).toHaveBeenCalledWith("  Profile key: os-local");
    expect(console.log).toHaveBeenCalledWith("  Profile name: Local Profile");
    expect(console.log).toHaveBeenCalledWith("  Source:      path-match");
    expect(console.log).toHaveBeenCalledWith(
      "  URL:         https://example.convex.cloud"
    );
    expect(console.log).toHaveBeenCalledWith("  Project ID:  proj_123");
    expect(console.log).toHaveBeenCalledWith(
      "  API Key:     sk_test_ab...wxyz"
    );
    expect(console.log).toHaveBeenCalledWith("  Paths:");
    expect(console.log).toHaveBeenCalledWith("    - /tmp/repo");
    expect(console.log).toHaveBeenCalledWith("    - /tmp/other");
  });

  it("connects using the resolved profile key", async () => {
    await connectUsingProfile({
      profileKey: "os-local",
      profileName: "Local Profile",
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test_abcdefghijklmnopqrstuvwxyz",
      projectId: "proj_123",
      paths: ["/tmp/repo"],
      resolutionSource: "path-match",
    });

    expect(createAgentRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profileKey: "os-local",
        paths: ["/tmp/repo"],
      })
    );
    expect(console.log).toHaveBeenCalledWith(
      'Using profile "os-local" (matched by path-match)'
    );
  });

  describe("Codex provider key (OS-2105)", () => {
    const base = {
      profileKey: "os-local",
      profileName: "Local Profile",
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_test_abcdefghijklmnopqrstuvwxyz",
      projectId: "proj_123",
      paths: ["/tmp/repo"],
      codexProviderKey: { name: "codex-mantle", key: { provider: "mantle" as const, token: "aws-token", region: "us-east-1" } },
    };

    it("hands the Codex key to the runner, never to the process env", async () => {
      const before = process.env.AWS_BEARER_TOKEN_BEDROCK;
      await connectUsingProfile(base);
      expect(createAgentRunnerMock).toHaveBeenCalledWith(expect.objectContaining({
        codexProvider: { provider: "mantle", token: "aws-token", region: "us-east-1" },
      }));
      expect(process.env.AWS_BEARER_TOKEN_BEDROCK).toBe(before);
      expect(loggedLines()).toContain('Codex provider: AWS Bedrock (Mantle) ("codex-mantle", us-east-1)');
      expect(loggedLines()).not.toContain("aws-token");
    });

    it("hands the Claude key token to the runner for redaction", async () => {
      const env = { ...process.env };
      try {
        await connectUsingProfile({ ...base, providerKey: { name: "claude-mantle", key: { provider: "mantle", token: "claude-token" } } });
      } finally {
        process.env = env;
      }
      expect(createAgentRunnerMock).toHaveBeenCalledWith(expect.objectContaining({ claudeProviderToken: "claude-token" }));
    });

    it("refuses the exec transport instead of downgrading", async () => {
      await expect(connectUsingProfile({ ...base, codexAppServer: false })).rejects.toThrow(/app-server/);
      expect(createAgentRunnerMock).not.toHaveBeenCalled();
    });
  });
});
