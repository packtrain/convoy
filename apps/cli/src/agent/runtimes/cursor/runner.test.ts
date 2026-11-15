import * as cursorCommands from "./commands.js";
import { cursorRuntime } from "./runtime.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RunnerExecutionError,
  type ContentChunk,
} from "../contracts.js";
import {
  CURSOR_EXECUTABLE_ENV,
  buildCursorAgentArgs,
  buildCursorSubprocessEnv,
  createCursorRunner,
  extractCursorSessionId,
} from "./runner.js";
import { resetTrustFlagProbeForTests } from "./detect.js";
import { threadIdentityInstruction } from "../agent-instructions.js";

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

/** JSONL stream chunks only (the synthetic commands chunk depends on ~/.cursor). */
function streamChunks(chunks: ContentChunk[]): ContentChunk[] {
  return chunks.filter((chunk) => chunk.type !== "convoy.commands");
}

describe("buildCursorAgentArgs", () => {
  it("force-allows commands for agent and unset modes", () => {
    for (const cliMode of [undefined, "agent" as const]) {
      expect(buildCursorAgentArgs({ cliMode, trustFlagSupported: true })).toEqual([
        "-p",
        "--output-format=stream-json",
        "--force",
      ]);
    }
  });

  it("guarded modes trust the directory only when the flag is supported", () => {
    expect(
      buildCursorAgentArgs({ cliMode: "default", trustFlagSupported: true })
    ).toEqual(["-p", "--output-format=stream-json", "--trust"]);
    expect(
      buildCursorAgentArgs({ cliMode: "default", trustFlagSupported: false })
    ).toEqual(["-p", "--output-format=stream-json"]);
    // Legacy/unknown modes degrade to the guarded behavior, never --force.
    expect(
      buildCursorAgentArgs({ cliMode: "plan", trustFlagSupported: true })
    ).not.toContain("--force");
  });

  it("combines model and effort into the suffixed --model value", () => {
    expect(
      buildCursorAgentArgs({
        cliMode: "agent",
        runModel: "claude-sonnet-5",
        runEffort: "thinking",
        continuationId: "chat-1",
        trustFlagSupported: false,
      })
    ).toEqual([
      "-p",
      "--output-format=stream-json",
      "--force",
      "--model",
      "claude-sonnet-5-thinking-high",
      "--resume",
      "chat-1",
    ]);
  });

  it("omits --model when no run model is resolved", () => {
    expect(
      buildCursorAgentArgs({ cliMode: "agent", trustFlagSupported: false })
    ).not.toContain("--model");
  });
});

describe("extractCursorSessionId", () => {
  it("reads session_id from non-system events", () => {
    expect(
      extractCursorSessionId({ type: "assistant", session_id: "sess-1" })
    ).toBe("sess-1");
    expect(
      extractCursorSessionId({ type: "result", session_id: "sess-2" })
    ).toBe("sess-2");
  });

  it("skips system events and malformed payloads", () => {
    expect(
      extractCursorSessionId({ type: "system", session_id: "sess-1" })
    ).toBeNull();
    expect(extractCursorSessionId({ type: "assistant" })).toBeNull();
    expect(extractCursorSessionId("nope")).toBeNull();
  });
});

describe("createCursorRunner (fake cursor-agent executable)", () => {
  let tmpDir: string;
  let previousExecutable: string | undefined;

  function writeFakeCursorAgent(script: string): string {
    const file = join(tmpDir, "cursor-agent");
    writeFileSync(file, `#!/usr/bin/env node\n${script}`);
    chmodSync(file, 0o755);
    process.env[CURSOR_EXECUTABLE_ENV] = file;
    return file;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cursor-runner-test-"));
    previousExecutable = process.env[CURSOR_EXECUTABLE_ENV];
    resetTrustFlagProbeForTests();
  });

  afterEach(() => {
    if (previousExecutable === undefined) {
      delete process.env[CURSOR_EXECUTABLE_ENV];
    } else {
      process.env[CURSOR_EXECUTABLE_ENV] = previousExecutable;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    resetTrustFlagProbeForTests();
  });

  it("classifies missing-cwd startup failures without emitting output", async () => {
    writeFakeCursorAgent("process.exit(0);");
    const runner = createCursorRunner();
    await expect(runner.execute(join(tmpDir, "missing"), "hello", {
      cliType: "cursor", threadId: "thread_test",
    }).next()).rejects.toMatchObject({ launchFailed: true });
    await runner.shutdown();
  });

  it("does not publish command metadata before a failed spawn", async () => {
    writeFakeCursorAgent("process.exit(0);");
    const discovery = vi.spyOn(cursorCommands, "discoverCursorCommands").mockResolvedValueOnce(["review"]);
    const runner = createCursorRunner();
    try {
      await expect(runner.execute(join(tmpDir, "missing"), "hello", {
        cliType: "cursor", threadId: "thread_test",
      }).next()).rejects.toMatchObject({ launchFailed: true });
    } finally {
      discovery.mockRestore();
      await runner.shutdown();
    }
  });

  it("streams JSONL chunks and returns the session id as continuation", async () => {
    writeFakeCursorAgent(`
const lines = [
  JSON.stringify({ type: "system", subtype: "init", session_id: "ignored", model: "auto" }),
  JSON.stringify({ type: "assistant", session_id: "sess-42", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
  "not-json noise",
  JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "sess-42" }),
];
for (const line of lines) console.log(line);
`);

    const runner = createCursorRunner();
    const { chunks, result } = await collectChunks(
      runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" })
    );

    expect(streamChunks(chunks).map((chunk) => chunk.type)).toEqual([
      "system",
      "assistant",
      "result",
    ]);
    expect(result).toEqual({ continuationId: "sess-42" });
  });

  it("delivers the prompt over stdin", async () => {
    writeFakeCursorAgent(`
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "assistant", session_id: "s", message: { role: "assistant", content: [{ type: "text", text: input }] } }));
});
`);

    const runner = createCursorRunner();
    const { chunks } = await collectChunks(
      runner.execute(tmpDir, "the prompt body", { threadId: "thread_test", cliType: "cursor" })
    );

    const message = streamChunks(chunks).find(
      (chunk) => chunk.type === "assistant"
    );
    expect(message?.data).toContain("the prompt body");
  });

  it("prepends agent instructions to the stdin prompt on fresh sessions only", async () => {
    const echoStdinScript = `
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "assistant", session_id: "s", message: { role: "assistant", content: [{ type: "text", text: input }] } }));
});
`;
    writeFakeCursorAgent(echoStdinScript);

    const runner = createCursorRunner();
    const { chunks } = await collectChunks(
      runner.execute(tmpDir, "the prompt body", {
        threadId: "thread_test",
        cliType: "cursor",
        agentPrompt: "You are a meticulous reviewer.",
        agentName: "Reviewer",
      })
    );

    const message = streamChunks(chunks).find(
      (chunk) => chunk.type === "assistant"
    );
    const echoed = (
      JSON.parse(message!.data) as {
        message: { content: Array<{ text: string }> };
      }
    ).message.content[0].text;
    expect(echoed).toBe(
      [
        '<agent-instructions agent="Reviewer">',
        "You are a meticulous reviewer.",
        "</agent-instructions>",
        "",
        threadIdentityInstruction("thread_test"),
        "",
        "the prompt body",
      ].join("\n")
    );

    // Resumed session: the runtime transcript already carries the block.
    writeFakeCursorAgent(echoStdinScript);
    const resumedRunner = createCursorRunner();
    const resumed = await collectChunks(
      resumedRunner.execute(tmpDir, "follow-up", {
        threadId: "thread_test",
        cliType: "cursor",
        continuationId: "sess-42",
        agentPrompt: "You are a meticulous reviewer.",
        agentName: "Reviewer",
      })
    );
    const resumedMessage = streamChunks(resumed.chunks).find(
      (chunk) => chunk.type === "assistant"
    );
    expect(resumedMessage?.data).toContain("follow-up");
    expect(resumedMessage?.data).not.toContain("agent-instructions");
  });

  it("delivers a resumed raw command unchanged after workspace recovery", async () => {
    writeFakeCursorAgent(`
let input = "";
process.stdin.on("data", d => input += d);
process.stdin.on("end", () => console.log(JSON.stringify({ type: "assistant", session_id: "s", text: input })));
`);
    const prepared = await cursorRuntime.prepareRunExecution({ messages: [{
      id: "m", createdAt: 0, contentText: "/review changes", runtimeCommand: true, attachments: [],
    }] });
    const runner = createCursorRunner();
    const result = await collectChunks(runner.execute(tmpDir, prepared.prompt, {
      ...prepared, cliType: "cursor", threadId: "thread_test", continuationId: "session",
      workspaceNotice: "The working directory is now /repo.",
    }));
    const output = streamChunks(result.chunks).find(chunk => chunk.type === "assistant");
    expect(JSON.parse(output!.data).text).toBe("/review changes");
    await runner.shutdown();
  });

  it("surfaces the login hint when cursor reports missing authentication", async () => {
    writeFakeCursorAgent(`
console.error("Authentication required. Please run 'cursor-agent login' first, or set CURSOR_API_KEY environment variable.");
process.exit(1);
`);

    const runner = createCursorRunner();
    const gen = runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" });

    await expect(collectChunks(gen)).rejects.toThrow(
      /cursor-agent login/
    );
  });

  /** Fake that answers `--version` and otherwise reports the auth env it got. */
  const ENV_REPORTER = (version: string) => `
if (process.argv.includes("--version")) { console.log("${version}"); process.exit(0); }
const auth = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(CURSOR_|AGENT_CLI_)/.test(k)));
console.log(JSON.stringify({ type: "assistant", session_id: "s", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify({ auth, argv: process.argv.slice(2) }) }] } }));
`;

  it("gives a managed key to the Cursor child only, in memory, without inherited overrides (OS-2017)", async () => {
    writeFakeCursorAgent(ENV_REPORTER("2026.10.22-27dcf5f"));
    const inherited = { CURSOR_AUTH_TOKEN: "native-token", CURSOR_API_BASE_URL: "https://evil.example", AGENT_CLI_AUTHLESS_MODE: "1" };
    Object.assign(process.env, inherited);
    try {
      const runner = createCursorRunner({ cursorAuth: { mode: "managed", secret: "key_managed_sentinel" } });
      const { chunks } = await collectChunks(runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" }));
      const text = JSON.parse(JSON.parse(streamChunks(chunks)[0]!.data).message.content[0].text);
      expect(text.auth).toEqual({ CURSOR_API_KEY: "key_managed_sentinel", AGENT_CLI_CREDENTIAL_STORE: "memory" });
      expect(JSON.stringify(text.argv)).not.toContain("key_managed_sentinel");
      expect(JSON.stringify(process.env)).not.toContain("key_managed_sentinel");
    } finally {
      for (const key of Object.keys(inherited)) delete process.env[key];
    }
  });

  it("refuses a disabled binding and an untested Cursor version before spawning (OS-2017)", async () => {
    writeFakeCursorAgent(ENV_REPORTER("2025.09.18-7ae6800"));
    const disabled = createCursorRunner({ cursorAuth: { mode: "disabled" } });
    await expect(collectChunks(disabled.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" }))).rejects.toThrow(
      "Cursor is disabled for this project"
    );
    const old = createCursorRunner({ cursorAuth: { mode: "managed", secret: "key_managed_sentinel" } });
    await expect(collectChunks(old.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" }))).rejects.toThrow(
      "Cursor Agent 2025.09.18-7ae6800 is not tested with managed keys"
    );
  });

  it("names a rejected managed key instead of the login hint (OS-2017)", async () => {
    writeFakeCursorAgent(`
if (process.argv.includes("--version")) { console.log("2026.10.22-27dcf5f"); process.exit(0); }
console.log("⚠ Warning: The provided API key is invalid.");
console.log("The API key was loaded from the CURSOR_API_KEY environment variable.");
process.exit(1);
`);
    const runner = createCursorRunner({ cursorAuth: { mode: "managed", secret: "key_managed_sentinel" } });
    await expect(collectChunks(runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" }))).rejects.toThrow(
      "Cursor rejected the assigned account key"
    );
  });

  it("surfaces plain-text stdout errors on non-zero exit", async () => {
    writeFakeCursorAgent(`
console.log("ActionRequiredError: Named models unavailable Free plans can only use Auto.");
process.exit(1);
`);

    const runner = createCursorRunner();
    const gen = runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" });

    await expect(collectChunks(gen)).rejects.toThrow(
      /Named models unavailable/
    );
  });

  it("fails with stderr tail and continuation id on non-zero exit", async () => {
    writeFakeCursorAgent(`
console.log(JSON.stringify({ type: "assistant", session_id: "sess-9", message: { role: "assistant", content: [] } }));
console.error("stream error: quota exceeded");
process.exit(3);
`);

    const runner = createCursorRunner();
    const gen = runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" });

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
    expect(runnerError.continuationId).toBe("sess-9");
  });

  it("fails when requireContinuation is set and no session id arrived", async () => {
    writeFakeCursorAgent(`
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "only-system" }));
`);

    const runner = createCursorRunner();
    const gen = runner.execute(tmpDir, "hi", {
      threadId: "thread_test",
      cliType: "cursor",
      requireContinuation: true,
    });

    await expect(collectChunks(gen)).rejects.toThrow(/without a session_id/);
  });

  it("advertises project slash commands as a synthetic chunk", async () => {
    const commandsDir = join(tmpDir, ".cursor", "commands");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "plan.md"), "# plan");

    writeFakeCursorAgent(`
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "s" }));
`);

    const runner = createCursorRunner();
    const { chunks } = await collectChunks(
      runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" })
    );

    const inventory = chunks.find((chunk) => chunk.type === "convoy.commands");
    expect(inventory).toBeDefined();
    expect(JSON.parse(inventory?.data ?? "{}").commands).toContain("plan");
  });

  it("aborting kills the subprocess and fails the run", async () => {
    writeFakeCursorAgent(`
console.log(JSON.stringify({ type: "assistant", session_id: "sess-abort", message: { role: "assistant", content: [] } }));
setInterval(() => {}, 1000); // keep the process alive
`);

    const runner = createCursorRunner();
    const gen = runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "cursor" });

    // Consume until the first JSONL chunk (a commands chunk may precede it).
    let first = await gen.next();
    while (
      !first.done &&
      (first.value as ContentChunk).type === "convoy.commands"
    ) {
      first = await gen.next();
    }
    expect(first.done).toBe(false);
    runner.abort();

    let error: unknown;
    try {
      let step = await gen.next();
      while (!step.done) {
        step = await gen.next();
      }
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("aborted");
  }, 15_000);
});

describe("buildCursorSubprocessEnv", () => {
  it("sets the thread id and strips the Convoy API key", () => {
    process.env.CONVOY_API_KEY = "sk_user_secret";
    try {
      const env = buildCursorSubprocessEnv("thread_test");
      expect(env.CONVOY_THREAD_ID).toBe("thread_test");
      expect(env.CONVOY_API_KEY).toBeUndefined();
    } finally {
      delete process.env.CONVOY_API_KEY;
    }
  });
});
