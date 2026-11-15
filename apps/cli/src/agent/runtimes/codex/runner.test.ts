import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RunnerExecutionError,
  type ContentChunk,
} from "../contracts.js";
import {
  CODEX_EXECUTABLE_ENV,
  buildCodexExecArgs,
  buildCodexSubprocessEnv,
  codexWritableRootsConfigArgs,
  createCodexRunner,
  extractCodexContinuationId,
} from "./runner.js";
import { detectCodex } from "./detect.js";

async function collectChunks(
  gen: AsyncGenerator<ContentChunk, unknown, unknown>
): Promise<{ chunks: ContentChunk[]; result: unknown }> {
  const chunks: ContentChunk[] = [];
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await gen.next();
  }
  return { chunks, result: step.value };
}

describe("buildCodexExecArgs", () => {
  it("uses full access for agent and unset modes", () => {
    for (const cliMode of [undefined, "agent" as const]) {
      expect(buildCodexExecArgs({ cliMode })).toEqual([
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "-",
      ]);
    }
  });

  it("sandboxes every non-agent mode with workspace writes", () => {
    for (const cliMode of ["auto", "default", "plan"] as const) {
      const args = buildCodexExecArgs({ cliMode });
      expect(args).toContain("--sandbox");
      expect(args).toContain("workspace-write");
      expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    }
  });

  it("passes model, effort, and resume before the stdin prompt marker", () => {
    expect(
      buildCodexExecArgs({
        cliMode: "agent",
        runModel: "gpt-5.5",
        runEffort: "xhigh",
        continuationId: "thread-1",
      })
    ).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="xhigh"',
      "resume",
      "thread-1",
      "-",
    ]);
  });

  it("omits the effort override when no run effort is resolved", () => {
    expect(buildCodexExecArgs({ cliMode: "agent" })).not.toContain("-c");
  });

  it("isolation removes the bypass even in agent mode and adds writable roots (OS-1242)", () => {
    for (const cliMode of [undefined, "agent", "auto", "default"] as const) {
      const args = buildCodexExecArgs({
        cliMode,
        sandbox: { writableRoots: ["/repos/a", "/repos/b"] },
      });
      expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(args).toContain("--sandbox");
      expect(args).toContain("workspace-write");
      expect(args).toContain(
        'sandbox_workspace_write.writable_roots=["/repos/a","/repos/b"]'
      );
    }
  });

  // This exact arg set is verified against codex-cli 0.144.4 to block /tmp
  // writes and allow cwd/writable-root writes on macOS. The overrides only
  // work through the legacy `--sandbox` flag path: explicitly selecting a
  // permissions profile (`-P :workspace` / `default_permissions`) makes
  // codex ignore `sandbox_workspace_write.*` entirely.
  it("emits the verified isolated arg set in order", () => {
    const platformArgs = codexWritableRootsConfigArgs({ writableRoots: ["/repos/a"] });
    expect(
      buildCodexExecArgs({ cliMode: "agent", sandbox: { writableRoots: ["/repos/a"] } })
    ).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      ...platformArgs,
      "-",
    ]);
  });
});

describe("codexWritableRootsConfigArgs", () => {
  it("excludes /tmp on macOS (workspace-write allows it by default)", () => {
    expect(codexWritableRootsConfigArgs({ writableRoots: ["/repos/a"] }, "darwin")).toEqual([
      "-c",
      'sandbox_workspace_write.writable_roots=["/repos/a"]',
      "-c",
      "sandbox_workspace_write.exclude_slash_tmp=true",
      "-c",
      'approvals_reviewer="user"',
    ]);
  });

  it("keeps /tmp writable on Linux where it is often the only temp dir", () => {
    expect(codexWritableRootsConfigArgs({ writableRoots: ["/repos/a"] }, "linux")).toEqual([
      "-c",
      'sandbox_workspace_write.writable_roots=["/repos/a"]',
      "-c",
      'approvals_reviewer="user"',
    ]);
  });

  // apply_patch runs in the codex process outside the OS sandbox; an
  // auto_review reviewer in the user's codex config would auto-approve
  // out-of-root patches, so isolation must pin the reviewer to the human.
  it("pins approvals_reviewer to user on every platform", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(codexWritableRootsConfigArgs({ writableRoots: [] }, platform)).toContain(
        'approvals_reviewer="user"'
      );
    }
  });
});

describe("extractCodexContinuationId", () => {
  it("reads thread_id from thread.started", () => {
    expect(
      extractCodexContinuationId({ type: "thread.started", thread_id: "t-1" })
    ).toBe("t-1");
  });

  it("ignores other events and malformed payloads", () => {
    expect(extractCodexContinuationId({ type: "turn.started" })).toBeNull();
    expect(
      extractCodexContinuationId({ type: "thread.started", thread_id: "" })
    ).toBeNull();
    expect(extractCodexContinuationId("nope")).toBeNull();
  });
});

describe("createCodexRunner (fake codex executable)", () => {
  let tmpDir: string;
  let previousExecutable: string | undefined;

  function writeFakeCodex(script: string): string {
    const file = join(tmpDir, "codex");
    writeFileSync(file, `#!/usr/bin/env node\n${script}`);
    chmodSync(file, 0o755);
    process.env[CODEX_EXECUTABLE_ENV] = file;
    return file;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "codex-runner-test-"));
    previousExecutable = process.env[CODEX_EXECUTABLE_ENV];
  });

  afterEach(() => {
    if (previousExecutable === undefined) {
      delete process.env[CODEX_EXECUTABLE_ENV];
    } else {
      process.env[CODEX_EXECUTABLE_ENV] = previousExecutable;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies missing-cwd startup failures without emitting output", async () => {
    writeFakeCodex("process.exit(0);");
    const runner = createCodexRunner();
    await expect(runner.execute(join(tmpDir, "missing"), "hello", {
      cliType: "codex", threadId: "thread_test",
    }).next()).rejects.toMatchObject({ launchFailed: true });
    await runner.shutdown();
  });

  it("streams JSONL chunks and returns the continuation id", async () => {
    writeFakeCodex(`
const lines = [
  JSON.stringify({ type: "thread.started", thread_id: "thread-42" }),
  JSON.stringify({ type: "turn.started" }),
  "not-json noise",
  JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "hello" } }),
  JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } }),
];
for (const line of lines) console.log(line);
`);

    const runner = createCodexRunner();
    const { chunks, result } = await collectChunks(
      runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex" })
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "thread.started",
      "turn.started",
      "item.completed",
      "turn.completed",
    ]);
    expect(result).toEqual({ continuationId: "thread-42" });
  });

  it("delivers the prompt over stdin", async () => {
    writeFakeCodex(`
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "thread.started", thread_id: "t" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: input } }));
});
`);

    const runner = createCodexRunner();
    const { chunks } = await collectChunks(
      runner.execute(tmpDir, "the prompt body", { threadId: "thread_test", cliType: "codex" })
    );

    const message = chunks.find((chunk) => chunk.type === "item.completed");
    expect(message?.data).toContain("the prompt body");
  });

  it("prepends agent instructions to the first message of a fresh session", async () => {
    writeFakeCodex(`
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "thread.started", thread_id: "t" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: input } }));
});
`);

    const runner = createCodexRunner();
    const { chunks } = await collectChunks(
      runner.execute(tmpDir, "the prompt body", {
        threadId: "thread_test",
        cliType: "codex",
        agentPrompt: "You are the Reviewer persona.",
        agentName: "Reviewer",
      })
    );

    const message = chunks.find((chunk) => chunk.type === "item.completed");
    expect(message?.data).toContain('<agent-instructions agent=\\"Reviewer\\">');
    expect(message?.data).toContain("You are the Reviewer persona.");
    expect(message?.data).toContain("the prompt body");
  });

  it("does not inject agent instructions on resumed sessions", async () => {
    writeFakeCodex(`
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "thread.started", thread_id: "t" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: input } }));
});
`);

    const runner = createCodexRunner();
    const { chunks } = await collectChunks(
      runner.execute(tmpDir, "the prompt body", {
        threadId: "thread_test",
        cliType: "codex",
        agentPrompt: "You are the Reviewer persona.",
        agentName: "Reviewer",
        continuationId: "t-1",
      })
    );

    const message = chunks.find((chunk) => chunk.type === "item.completed");
    expect(message?.data).not.toContain("agent-instructions");
    expect(message?.data).toContain("the prompt body");
  });

  it("fails with stderr tail and continuation id on non-zero exit", async () => {
    writeFakeCodex(`
console.log(JSON.stringify({ type: "thread.started", thread_id: "t-9" }));
console.error("stream error: quota exceeded");
process.exit(3);
`);

    const runner = createCodexRunner();
    const gen = runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex" });

    let error: unknown;
    try {
      await collectChunks(gen);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    const runnerError = error as RunnerExecutionError;
    expect(runnerError.message).toContain("exit code 3");
    expect(runnerError.message).toContain("quota exceeded");
    expect(runnerError.continuationId).toBe("t-9");
  });

  it("fails when requireContinuation is set and no thread.started arrived", async () => {
    writeFakeCodex(`
console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
`);

    const runner = createCodexRunner();
    const gen = runner.execute(tmpDir, "hi", {
      threadId: "thread_test",
      cliType: "codex",
      requireContinuation: true,
    });

    await expect(collectChunks(gen)).rejects.toThrow(
      /without thread.started/
    );
  });

  it("aborting kills the subprocess and fails the run", async () => {
    writeFakeCodex(`
console.log(JSON.stringify({ type: "thread.started", thread_id: "t-abort" }));
setInterval(() => {}, 1000); // keep the process alive
`);

    const runner = createCodexRunner();
    const gen = runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex" });

    const first = await gen.next();
    expect(first.done).toBe(false);
    runner.abort();

    let error: unknown;
    try {
      await collectChunks(gen);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("aborted");
    expect((error as RunnerExecutionError).continuationId).toBe("t-abort");
  });

  it("fails a runtime command instead of sending it as prose (OS-1582)", async () => {
    // The exec transport has no per-thread RPC channel; delivering
    // "/compact" as prose made the model reply "Context compacted." while
    // nothing was compacted, so it must fail visibly instead.
    writeFakeCodex(`console.log(JSON.stringify({ type: "turn.completed" }));`);

    const runner = createCodexRunner();
    const gen = runner.execute(tmpDir, "/compact", {
      threadId: "thread_test",
      cliType: "codex",
      continuationId: "t-exec",
      runtimeCommand: { command: "compact" },
    });

    let error: unknown;
    try {
      await collectChunks(gen);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("app-server");
    expect((error as RunnerExecutionError).continuationId).toBe("t-exec");
  });

  it.each([
    ["an ordinary prompt", {}],
    ["a runtime command", { runtimeCommand: { command: "compact" } }],
  ])("refuses to branch over the exec transport without claiming the parent's session: %s", async (_label, extra) => {
    writeFakeCodex(`console.log(JSON.stringify({ type: "turn.completed" }));`);

    const runner = createCodexRunner();
    const gen = runner.execute(tmpDir, "hi", {
      threadId: "thread_test",
      cliType: "codex",
      continuationId: "t-parent",
      forkTurnId: "turn-7",
      ...extra,
    });

    let error: unknown;
    try {
      await collectChunks(gen);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("app-server");
    expect((error as RunnerExecutionError).continuationId).toBeUndefined();
  });

  it("detectCodex reports the parsed version", async () => {
    writeFakeCodex(`
if (process.argv.includes("--version")) {
  console.log("codex-cli 9.9.9");
}
`);

    await expect(detectCodex()).resolves.toEqual({
      type: "codex",
      version: "9.9.9",
    });
  });
});

describe("buildCodexSubprocessEnv", () => {
  it("sets the thread id and strips the Convoy API key", () => {
    process.env.CONVOY_API_KEY = "sk_user_secret";
    try {
      const env = buildCodexSubprocessEnv("thread_test");
      expect(env.CONVOY_THREAD_ID).toBe("thread_test");
      expect(env.CONVOY_API_KEY).toBeUndefined();
    } finally {
      delete process.env.CONVOY_API_KEY;
    }
  });

  it("does not inherit the Claude provider key injected by connect (OS-2105)", async () => {
    vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", undefined);
    vi.stubEnv("AWS_REGION", "eu-west-1");
    vi.stubEnv("CONVOY_CLAUDE_PROVIDER_ENV", undefined);
    const { applyProviderKeyEnv, buildProviderKeyEnv } = await import("../../../lib/config/provider-keys.js");
    try {
      applyProviderKeyEnv(buildProviderKeyEnv({ provider: "mantle", token: "claude-token", region: "us-east-1" }));
      const env = buildCodexSubprocessEnv("thread_test");
      expect(env.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined();
      expect(env.AWS_REGION).toBe("eu-west-1");
      expect(env.CONVOY_CLAUDE_PROVIDER_ENV).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      for (const name of ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_MANTLE", "CONVOY_CLAUDE_PROVIDER_ENV"]) delete process.env[name];
    }
  });
});
