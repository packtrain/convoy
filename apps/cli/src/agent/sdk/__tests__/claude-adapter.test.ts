import { describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../adapters/claude/claude-adapter.js";

describe("claude adapter", () => {
  it("buildSpawnSpec uses print mode + stream-json defaults", async () => {
    const adapter = new ClaudeAdapter();
    const spec = await adapter.buildSpawnSpec({
      runId: "run_1",
      cwd: process.cwd(),
      prompt: "hello",
      transportMode: "json-stream",
      resolvedExecutable: { command: "/bin/claude", source: "path" },
      version: { raw: "2.1.0", normalized: "2.1.0" },
      capabilities: {
        supportsJsonStream: true,
        supportsResume: true,
        supportsInterrupt: true,
        supportsPty: false,
      },
      providerOptions: {
        permissionMode: "bypassPermissions",
      },
      env: {},
    });

    expect(spec.transportMode).toBe("json-stream");
    expect(spec.bootstrapInput).toBeUndefined();
    expect(spec.closeStdinAfterSpawn).toBe(true);
    expect(spec.args).toEqual([
      "-p",
      "hello",
      "--dangerously-skip-permissions",
      "--verbose",
      "--output-format",
      "stream-json",
    ]);
  });

  it("adds resume + fork-session for follow-up runs", async () => {
    const adapter = new ClaudeAdapter();
    const spec = await adapter.buildSpawnSpec({
      runId: "run_2",
      cwd: process.cwd(),
      prompt: "next",
      transportMode: "json-stream",
      resolvedExecutable: { command: "/bin/claude", source: "path" },
      version: { raw: "2.1.0", normalized: "2.1.0" },
      capabilities: {
        supportsJsonStream: true,
        supportsResume: true,
        supportsInterrupt: true,
        supportsPty: false,
      },
      providerOptions: {
        resumeSessionId: "session-123",
      },
      env: {},
    });

    expect(spec.args).toContain("--resume");
    expect(spec.args).toContain("session-123");
    expect(spec.args).toContain("--fork-session");
  });

  it("uses --permission-mode plan when plan permission mode is requested", async () => {
    const adapter = new ClaudeAdapter();
    const spec = await adapter.buildSpawnSpec({
      runId: "run_3",
      cwd: process.cwd(),
      prompt: "plan",
      transportMode: "json-stream",
      resolvedExecutable: { command: "/bin/claude", source: "path" },
      version: { raw: "2.1.0", normalized: "2.1.0" },
      capabilities: {
        supportsJsonStream: true,
        supportsResume: true,
        supportsInterrupt: true,
        supportsPty: false,
      },
      providerOptions: {
        permissionMode: "plan",
      },
      env: {},
    });

    expect(spec.args).toContain("--permission-mode");
    expect(spec.args).toContain("plan");
    expect(spec.args).not.toContain("--dangerously-skip-permissions");
  });

  it("buildSpawnSpec supports stream-json input with bootstrap frames", async () => {
    const adapter = new ClaudeAdapter();
    const spec = await adapter.buildSpawnSpec({
      runId: "run_4",
      cwd: process.cwd(),
      prompt: "unused",
      transportMode: "json-stream",
      resolvedExecutable: { command: "/bin/claude", source: "path" },
      version: { raw: "2.1.0", normalized: "2.1.0" },
      capabilities: {
        supportsJsonStream: true,
        supportsResume: true,
        supportsInterrupt: true,
        supportsPty: false,
      },
      providerOptions: {
        inputFormat: "stream-json",
        bootstrapInput: [{ type: "user", message: { role: "user", content: [] } }],
      },
      env: {},
    });

    expect(spec.args).toEqual([
      "--input-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "--verbose",
      "--output-format",
      "stream-json",
    ]);
    expect(spec.bootstrapInput).toEqual([
      { type: "user", message: { role: "user", content: [] } },
    ]);
    expect(spec.closeStdinAfterSpawn).toBe(true);
  });
});
