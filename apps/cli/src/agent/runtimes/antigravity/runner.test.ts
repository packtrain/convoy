import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunnerExecutionError, type ContentChunk } from "../contracts.js";
import { threadIdentityInstruction } from "../agent-instructions.js";
import { ANTIGRAVITY_EXECUTABLE_ENV, detectAntigravity } from "./detect.js";
import { ANTIGRAVITY_DISABLED_MESSAGE, ANTIGRAVITY_KEY_REFUSED_MESSAGE, ANTIGRAVITY_SIGN_IN_MESSAGE, createAntigravityRunner } from "./runner.js";

// Replays agy 1.5.13 ACP shapes recorded for OS-2468 (docs/specs/cli-antigravity-runtime.md).
const FAKE_AGY = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const behavior = process.env.FAKE_BEHAVIOR ?? "happy";
if (process.argv.includes("--version")) { process.stdout.write((process.env.FAKE_VERSION ?? "1.5.13") + "\n"); process.exit(0); }
const record = (entry) => fs.appendFileSync(process.env.FAKE_RECORD, JSON.stringify(entry) + "\n");
record({ argv: process.argv.slice(2), env: { thread: process.env.CONVOY_THREAD_ID ?? null, key: process.env.CONVOY_API_KEY ?? null, update: process.env.AGY_CLI_DISABLE_AUTO_UPDATE ?? null, ...(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? { gemini: process.env.GEMINI_API_KEY ?? null, google: process.env.GOOGLE_API_KEY ?? null } : {}) } });
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
const update = (sessionId, u) => send({ method: "session/update", params: { sessionId, update: u } });
let open = [];
let session = null;
let keyed = false;
const answer = (id, result) => { open = open.filter((entry) => entry !== id); send({ id, result }); };
// agy 1.5.13 advertises thinking levels only for the selected model.
const CATALOG = { "gemini-3.8-flash": { name: "Gemini 3.8 Flash", levels: ["low", "medium", "high"] }, "gpt-oss-120b-medium": { name: "GPT-OSS 120B (Medium)", levels: [] } };
let model = "gemini-3.8-flash";
let level = "high";
const config = () => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: model, options: Object.entries(CATALOG).map(([value, m]) => ({ value, name: m.name })) },
  ...(CATALOG[model].levels.length ? [{ id: "thought_level", category: "thought_level", type: "select", currentValue: level, options: CATALOG[model].levels.map((value) => ({ value, name: value })) }] : []),
  { id: "mode", category: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] },
];
const tool = { toolCallId: "call_1", name: "run_command", args: { CommandLine: "ls" }, kind: "execute", title: "ls", rawInput: { CommandLine: "ls" } };
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  record({ in: msg });
  if (msg.result !== undefined) {
    if (msg.id === "perm-late") finishLate();
    if (msg.id === "perm-ask") replyLate();
    return;
  }
  if (msg.method === "initialize") {
    const meta = behavior === "no-append" ? {} : { _meta: { antigravity: { systemPrompt: { append: true } } } };
    return send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, ...meta }, agentInfo: { name: "Antigravity ACP Server", version: "1.5.13" } } });
  }
  if (msg.method === "session/new") {
    if ((behavior === "signed-out" || behavior === "key-marker") && !keyed) return send({ id: msg.id, error: { code: -32000, message: "Authentication required" } });
    session = "sess-1";
    if (process.env.FAKE_SESSION_FILES) {
      const root = process.env.HOME + "/.gemini/antigravity-cli";
      fs.mkdirSync(root + "/conversations", { recursive: true });
      fs.mkdirSync(root + "/brain/" + session, { recursive: true });
      fs.writeFileSync(root + "/conversations/" + session + ".db", "");
    }
    return send({ id: msg.id, result: { sessionId: session, configOptions: config() } });
  }
  if (msg.method === "session/set_config_option") {
    const { configId, value } = msg.params;
    if (configId === "model") {
      if (!CATALOG[value]) return send({ id: msg.id, error: { code: -32602, message: "Unknown model ID: " + value } });
      model = value;
    } else if (configId === "thought_level") {
      if (!CATALOG[model].levels.includes(value)) return send({ id: msg.id, error: { code: -32602, message: "Thinking level not offered" } });
      level = value;
    }
    return send({ id: msg.id, result: { configOptions: config() } });
  }
  // agy 1.5.14 accepts gemini-api-key with any GEMINI_API_KEY; Google checks the key on the first prompt (OS-2476).
  if (msg.method === "authenticate" && msg.params.methodId === "gemini-api-key" && process.env.GEMINI_API_KEY && behavior !== "key-refused") { keyed = true; return send({ id: msg.id, result: {} }); }
  // A stored Google token signs in again without a browser once a key's marker is left behind.
  if (msg.method === "authenticate" && msg.params.methodId === "oauth-personal" && behavior === "key-marker") { keyed = true; return send({ id: msg.id, result: {} }); }
  if (msg.method === "authenticate") return send({ id: msg.id, error: { code: -32603, message: "No browser is available here" } });
  if (msg.method === "session/resume") { session = msg.params.sessionId; return send({ id: msg.id, result: { configOptions: config() } }); }
  if (msg.method === "session/cancel") {
    update(session, { sessionUpdate: "tool_call_update", ...tool, status: "failed", rawOutput: { output: "" } });
    // agy reports the command failed before it has killed it.
    if (behavior === "background-stop") setTimeout(() => fs.writeFileSync(process.env.FAKE_RECORD + ".reaped", ""), 200);
    return open.forEach((id) => answer(id, { stopReason: "cancelled" }));
  }
  if (msg.method === "session/prompt") {
    // agy 1.5.14: a second prompt answers the first with end_turn and the turn goes on under it.
    if (behavior === "steer" && open.length > 0) {
      answer(open[0], { stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 2 } });
      open.push(msg.id);
      update(session, { sessionUpdate: "tool_call_update", ...tool, status: "completed", rawOutput: { output: "ok" } });
      update(session, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Steered." } });
      update(session, { sessionUpdate: "usage_update", used: 20, size: 100 });
      return setTimeout(() => answer(msg.id, { stopReason: "end_turn", usage: { inputTokens: 7, outputTokens: 3 } }), 20);
    }
    open.push(msg.id);
    update(session, { sessionUpdate: "available_commands_update", availableCommands: [{ name: "compact", description: "Compact" }] });
    if (behavior === "crash") { process.stderr.write("panic: boom\n"); process.exit(3); }
    if (behavior === "permission-then-fail") {
      send({ id: "perm-1", method: "session/request_permission", params: { sessionId: session, toolCall: { toolCallId: "call_9" }, options: [{ optionId: "yes", kind: "allow_once" }] } });
      return setTimeout(() => send({ id: msg.id, error: { code: -32603, message: "provider failed" } }), 50);
    }
    if (behavior === "permission") send({ id: "perm-1", method: "session/request_permission", params: { sessionId: session, toolCall: { toolCallId: "call_9" }, options: [{ optionId: "deny", kind: "reject_once" }, { optionId: "yes", kind: "allow_once" }] } });
    update(session, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking " } });
    update(session, { sessionUpdate: "usage_update", used: 10, size: 100 });
    update(session, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hard." } });
    update(session, { sessionUpdate: "tool_call", ...tool, status: "in_progress" });
    if (behavior === "cancel" || behavior === "steer") return;
    // agy 1.5.14 backgrounds a command, ends the prompt, then reports it with no prompt open.
    if (behavior.startsWith("background") || behavior === "daemon") {
      if (behavior === "daemon") {
        update(session, { sessionUpdate: "tool_call", ...tool, toolCallId: "call_d", rawInput: { CommandLine: "serve", IsDaemon: true }, status: "in_progress" });
        // A partial update that leaves out rawInput.
        update(session, { sessionUpdate: "tool_call_update", toolCallId: "call_d", kind: "execute", status: "in_progress" });
      }
      update(session, { sessionUpdate: "tool_call_update", ...tool, status: behavior === "daemon" ? "completed" : "in_progress" });
      update(session, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Started." } });
      answer(msg.id, { stopReason: "end_turn" });
      update(session, { sessionUpdate: "usage_update", used: 20, size: 100 });
      if (behavior === "background-permission") return setTimeout(() => send({ id: "perm-late", method: "session/request_permission", params: { sessionId: session, toolCall: { toolCallId: "call_8" }, options: [{ optionId: "yes", kind: "allow_once" }] } }), 50);
      if (behavior === "background" || behavior === "background-chain" || behavior === "background-slow") setTimeout(finishLate, 50);
      // The command finishes and its reply asks before going on; the user takes a while.
      if (behavior === "background-ask") {
        setTimeout(() => {
          update(session, { sessionUpdate: "tool_call_update", ...tool, status: "completed", rawOutput: { output: "finished" } });
          update(session, { sessionUpdate: "usage_update", used: 25, size: 100 });
        }, 20);
        setTimeout(() => send({ id: "perm-ask", method: "session/request_permission", params: { sessionId: session, toolCall: { toolCallId: "call_7" }, options: [{ optionId: "yes", kind: "allow_once" }] } }), 50);
      }
      return;
    }
    const output = "Command exited with code 0.\n\nCommand output:\n" + "x".repeat(9000);
    update(session, { sessionUpdate: "tool_call_update", ...tool, status: "completed", rawOutput: { output, exit_code: 0 }, content: [{ type: "content", content: { type: "text", text: output } }] });
    update(session, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done " } });
    update(session, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "here." } });
    setTimeout(() => answer(msg.id, { stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 2 } }), 20);
  }
});
function replyLate() {
  update(session, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Finished." } });
  update(session, { sessionUpdate: "usage_update", used: 30, size: 100 });
}
function finishLate() {
  update(session, { sessionUpdate: "tool_call_update", ...tool, status: "completed", rawOutput: { output: "finished" } });
  const reply = () => {
    update(session, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Finished." } });
    update(session, { sessionUpdate: "usage_update", used: 30, size: 100 });
  };
  if (behavior === "background-slow") return setTimeout(reply, 900);
  reply();
  if (behavior !== "background-chain") return;
  // agy sends usage_update before every tool call, so a late reply can go on with another command.
  const next = { ...tool, toolCallId: "call_2", title: "make" };
  update(session, { sessionUpdate: "tool_call", ...next, status: "in_progress" });
  setTimeout(() => {
    update(session, { sessionUpdate: "tool_call_update", ...next, status: "completed", rawOutput: { output: "made" } });
    update(session, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Chained." } });
    update(session, { sessionUpdate: "usage_update", used: 40, size: 100 });
  }, 50);
}
`;

async function collect(gen: AsyncGenerator<ContentChunk, unknown, unknown>): Promise<{ chunks: ContentChunk[]; result: unknown }> {
  const chunks: ContentChunk[] = [];
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await gen.next();
  }
  return { chunks, result: step.value };
}

type SentMessage = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  result?: unknown;
  params: {
    _meta?: { antigravity: { systemPrompt: { append: string } } };
    prompt: Array<{ type: string; text: string }>;
    [key: string]: unknown;
  };
};
type RecordedEntry = { argv?: string[]; env?: Record<string, string | null>; in?: SentMessage };

function parse(chunk: ContentChunk): Record<string, unknown> {
  return JSON.parse(chunk.data) as Record<string, unknown>;
}

describe("createAntigravityRunner (fake agy)", () => {
  let tmpDir: string;
  let recordFile: string;

  const recorded = () =>
    readFileSync(recordFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as RecordedEntry);
  const sent = (method: string) =>
    recorded().flatMap((entry) => (entry.in?.method === method ? [entry.in] : []));

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agy-runner-test-"));
    recordFile = join(tmpDir, "record.jsonl");
    const file = join(tmpDir, "agy");
    writeFileSync(file, `#!/usr/bin/env node\n${FAKE_AGY}`);
    chmodSync(file, 0o755);
    vi.stubEnv(ANTIGRAVITY_EXECUTABLE_ENV, file);
    vi.stubEnv("FAKE_RECORD", recordFile);
    vi.stubEnv("CONVOY_API_KEY", "secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("streams a turn: session marker, closed segments, compacted tool updates and the prompt result", async () => {
    const runner = createAntigravityRunner({ partialStreaming: false });
    const { chunks, result } = await collect(
      runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity", agentPrompt: "Be terse." })
    );

    expect(result).toEqual({ continuationId: "sess-1" });
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "convoy/acp_session",
      "session/update",
      "session/update",
      "convoy/acp_reasoning",
      "session/update",
      "session/update",
      "convoy/acp_text",
      "convoy/acp_prompt_result",
    ]);
    expect(parse(chunks[0]!)).toEqual({ sessionId: "sess-1", agentVersion: "1.5.13" });
    // Command and usage updates are forwarded without closing the thought segment around them.
    expect(parse(chunks[1]!).update).toMatchObject({ sessionUpdate: "available_commands_update" });
    expect(parse(chunks[2]!).update).toEqual({ sessionUpdate: "usage_update", used: 10, size: 100 });
    expect(parse(chunks[3]!)).toEqual({ sessionId: "sess-1", text: "Thinking hard." });
    expect(parse(chunks[6]!)).toEqual({ sessionId: "sess-1", text: "Done here." });
    expect(parse(chunks[7]!)).toMatchObject({ stopReason: "end_turn", usage: { inputTokens: 5 } });

    const completed = (parse(chunks[5]!).update ?? {}) as { args?: unknown; content?: unknown; rawOutput: { output: string } };
    expect(completed.args).toBeUndefined();
    expect(completed.content).toEqual([]);
    expect(completed.rawOutput.output).toMatch(/^\[\d+ characters omitted\]\nx{8000}$/);

    const [launch] = recorded();
    expect(launch!.argv).toEqual(["acp", "--dangerously-skip-permissions"]);
    expect(launch!.env).toEqual({ thread: "thread_1", key: null, update: "1" });
    const [init] = sent("initialize");
    expect(init!.params.clientCapabilities).toEqual({ fs: { readTextFile: false, writeTextFile: false }, terminal: false });
    const [opened] = sent("session/new");
    expect(opened!.jsonrpc).toBe("2.0");
    expect(opened!.params).toMatchObject({ cwd: tmpDir, mcpServers: [] });
    expect(opened!.params._meta?.antigravity.systemPrompt.append).toBe(`Be terse.\n\n${threadIdentityInstruction("thread_1")}`);
    expect(sent("session/prompt")[0]!.params.prompt).toEqual([{ type: "text", text: "hello" }]);
  });

  it("puts image blocks ahead of the prompt text", async () => {
    const image = { type: "image", mimeType: "image/png", data: "cG5n" };
    const runner = createAntigravityRunner({});
    await collect(runner.execute(tmpDir, "What is this?", { threadId: "thread_1", cliType: "antigravity", bootstrapInput: [image] }));
    expect(sent("session/prompt")[0]!.params.prompt).toEqual([image, { type: "text", text: "What is this?" }]);
  });

  it("marks /compact as running, then finished, and drops the compaction call's usage", async () => {
    const runner = createAntigravityRunner({});
    const { chunks } = await collect(
      runner.execute(tmpDir, "/compact", { threadId: "thread_1", cliType: "antigravity", rawRuntimeCommand: true })
    );
    expect(chunks.some((chunk) => chunk.data.includes("usage_update"))).toBe(false);
    const markers = chunks.filter((chunk) => chunk.type === "convoy/antigravity_compaction").map((chunk) => parse(chunk).phase);
    expect(markers).toEqual(["started", "completed"]);
    expect(chunks.findIndex((chunk) => chunk.type === "convoy/antigravity_compaction")).toBe(1);
    expect(chunks.at(-1)!.type).toBe("convoy/acp_prompt_result");
  });

  it("resolves the pending compaction row when agy dies mid-compaction", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "crash");
    const runner = createAntigravityRunner({});
    const chunks: ContentChunk[] = [];
    const gen = runner.execute(tmpDir, "/compact", { threadId: "thread_1", cliType: "antigravity", rawRuntimeCommand: true });
    const error = await (async () => {
      for await (const chunk of gen) chunks.push(chunk);
    })().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerExecutionError);
    const markers = chunks.filter((chunk) => chunk.type === "convoy/antigravity_compaction").map((chunk) => parse(chunk).phase);
    expect(markers).toEqual(["started", "failed"]);
  });

  it("forwards message and thought chunks only with partial streaming", async () => {
    const runner = createAntigravityRunner({ partialStreaming: true });
    const { chunks } = await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }));
    const deltas = chunks.filter((chunk) => chunk.type === "session/update" && chunk.data.includes("_chunk"));
    expect(deltas).toHaveLength(4);
  });

  it("resumes the stored session and resends the system append", async () => {
    const runner = createAntigravityRunner({});
    const { result } = await collect(
      runner.execute(tmpDir, "again", { threadId: "thread_1", cliType: "antigravity", continuationId: "sess-old" })
    );
    expect(result).toEqual({ continuationId: "sess-old" });
    expect(sent("session/new")).toEqual([]);
    const [resumed] = sent("session/resume");
    expect(resumed!.params).toMatchObject({ sessionId: "sess-old", cwd: tmpDir });
    expect(resumed!.params._meta?.antigravity.systemPrompt.append).toContain("thread_1");
  });

  it("sets the resolved model and thinking level before the prompt", async () => {
    const runner = createAntigravityRunner({});
    await collect(
      runner.execute(tmpDir, "hello", {
        threadId: "thread_1",
        cliType: "antigravity",
        resolvedCliModel: "gemini-3.8-flash",
        resolvedCliEffort: "low",
      })
    );
    expect(sent("session/set_config_option").map((message) => message.params)).toEqual([
      { sessionId: "sess-1", configId: "model", value: "gemini-3.8-flash" },
      { sessionId: "sess-1", configId: "thought_level", value: "low" },
    ]);
    const methods = recorded().flatMap((entry) => (entry.in?.method ? [entry.in.method] : []));
    expect(methods.indexOf("session/set_config_option")).toBeLessThan(methods.indexOf("session/prompt"));
  });

  // session/resume comes back on the account default, so the model is set on every run.
  it("sets the model again on resume, and skips a level the model does not offer", async () => {
    const runner = createAntigravityRunner({});
    await collect(
      runner.execute(tmpDir, "again", {
        threadId: "thread_1",
        cliType: "antigravity",
        continuationId: "sess-old",
        resolvedCliModel: "gpt-oss-120b-medium",
        resolvedCliEffort: "high",
      })
    );
    expect(sent("session/set_config_option").map((message) => message.params)).toEqual([
      { sessionId: "sess-old", configId: "model", value: "gpt-oss-120b-medium" },
    ]);
  });

  // The backend prices the run's usage at this model (OS-2481).
  it("names the effective model in the prompt result, the account default when none is set", async () => {
    const runner = createAntigravityRunner({});
    const promptModel = async (resolvedCliModel?: string) => {
      const { chunks } = await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity", resolvedCliModel }));
      return parse(chunks.find((chunk) => chunk.type === "convoy/acp_prompt_result")!).model;
    };
    expect(await promptModel()).toBe("gemini-3.8-flash");
    expect(await promptModel("gpt-oss-120b-medium")).toBe("gpt-oss-120b-medium");
  });

  it("sends no config change for the default model and level", async () => {
    const runner = createAntigravityRunner({});
    await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }));
    expect(sent("session/set_config_option")).toEqual([]);
  });

  it("fails the run with agy's message when it refuses the model, keeping the session", async () => {
    const runner = createAntigravityRunner({});
    const error = await collect(
      runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity", resolvedCliModel: "gemini-retired" })
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("Unknown model ID: gemini-retired");
    expect((error as RunnerExecutionError).continuationId).toBe("sess-1");
    expect(sent("session/prompt")).toEqual([]);
  });

  it("prepends the instructions to the prompt when agy cannot append a system prompt", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "no-append");
    const runner = createAntigravityRunner({});
    await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }));
    expect(sent("session/new")[0]!.params._meta).toBeUndefined();
    expect(sent("session/prompt")[0]!.params.prompt[0].text).toBe(`${threadIdentityInstruction("thread_1")}\n\nhello`);
  });

  it("sends a raw runtime command alone even when agy cannot append a system prompt", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "no-append");
    const runner = createAntigravityRunner({});
    await collect(runner.execute(tmpDir, "/compact", { threadId: "thread_1", cliType: "antigravity", rawRuntimeCommand: true }));
    expect(sent("session/prompt")[0]!.params.prompt).toEqual([{ type: "text", text: "/compact" }]);
  });

  it("tries oauth-personal once when signed out, then fails with the sign-in message", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "signed-out");
    const runner = createAntigravityRunner({});
    await expect(collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }))).rejects.toThrow(
      ANTIGRAVITY_SIGN_IN_MESSAGE
    );
    expect(sent("authenticate").map((message) => message.params)).toEqual([{ methodId: "oauth-personal" }]);
    expect(sent("session/new")).toHaveLength(1);
  });

  it("runs on a managed Gemini key: key in the env, Google variables stripped, gemini-api-key before session/new (OS-2476)", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "signed-out");
    vi.stubEnv("GOOGLE_API_KEY", "ambient-google");
    vi.stubEnv("GEMINI_API_KEY", "ambient-gemini");
    const runner = createAntigravityRunner({ antigravityAuth: { mode: "managed", secret: "AIza-managed" } });
    const { result } = await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }));
    expect(result).toEqual({ continuationId: "sess-1" });
    expect(recorded()[0]!.env).toMatchObject({ key: null, gemini: "AIza-managed", google: null });
    expect(sent("authenticate").map((message) => message.params)).toEqual([{ methodId: "gemini-api-key" }]);
    const methods = recorded().flatMap((entry) => (entry.in?.method ? [entry.in.method] : []));
    expect(methods.indexOf("authenticate")).toBeLessThan(methods.indexOf("session/new"));
  });

  it("fails on a refused managed key with the key message and never tries a browser sign-in (OS-2476)", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "key-refused");
    const runner = createAntigravityRunner({ antigravityAuth: { mode: "managed", secret: "AIza-bad" } });
    await expect(collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }))).rejects.toThrow(
      ANTIGRAVITY_KEY_REFUSED_MESSAGE
    );
    expect(sent("authenticate").map((message) => message.params)).toEqual([{ methodId: "gemini-api-key" }]);
    expect(sent("session/new")).toHaveLength(0);
  });

  it("fails a disabled project at the start without spawning agy (OS-2476)", async () => {
    const runner = createAntigravityRunner({ antigravityAuth: { mode: "disabled" } });
    await expect(collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }))).rejects.toThrow(
      ANTIGRAVITY_DISABLED_MESSAGE
    );
    expect(existsSync(recordFile)).toBe(false);
  });

  it("answers permission requests with allow_once", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "permission");
    const runner = createAntigravityRunner({});
    await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }));
    const answer = recorded().find((entry) => entry.in?.id === "perm-1");
    expect(answer?.in?.result).toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
  });

  it("drops the skip-permissions flag in Ask to approve and asks the bridge", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "permission");
    const request = vi.fn(async () => JSON.stringify({ decision: "deny" }));
    const runner = createAntigravityRunner({});
    await collect(
      runner.execute(tmpDir, "hello", {
        threadId: "thread_1",
        cliType: "antigravity",
        cliMode: "default",
        interactionBridge: { request, cancel: vi.fn() },
      })
    );
    expect(recorded()[0]!.argv).toEqual(["acp"]);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ kind: "tool-approval" }), expect.any(AbortSignal));
    const answer = recorded().find((entry) => entry.in?.id === "perm-1");
    expect(answer?.in?.result).toEqual({ outcome: { outcome: "selected", optionId: "deny" } });
  });

  it("abandons an open approval when the prompt fails, rather than withdrawing it", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "permission-then-fail");
    const cancel = vi.fn();
    const request = vi.fn(
      (_input: unknown, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
    );
    const runner = createAntigravityRunner({});
    const error = await collect(
      runner.execute(tmpDir, "hello", {
        threadId: "thread_1",
        cliType: "antigravity",
        cliMode: "default",
        interactionBridge: { request, cancel },
      })
    ).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/provider failed/);
    expect(request).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls.map(([, opts]) => opts)).toEqual([{ abandoned: true, reason: "run ended" }]);
  });

  it("cancels on abort and ends the run as aborted with the session id", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "cancel");
    const runner = createAntigravityRunner({});
    const gen = runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" });
    const seen: ContentChunk[] = [];
    const error = await (async () => {
      for (let step = await gen.next(); !step.done; step = await gen.next()) {
        seen.push(step.value);
        if (step.value.data.includes('"sessionUpdate":"tool_call"')) runner.abort();
      }
    })().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toBe("Antigravity run aborted");
    expect((error as RunnerExecutionError).continuationId).toBe("sess-1");
    expect(sent("session/cancel").map((message) => message.params)).toEqual([{ sessionId: "sess-1" }]);
    expect(seen.at(-1)?.type).toBe("convoy/acp_prompt_result");
    expect(parse(seen.at(-1)!).stopReason).toBe("cancelled");
  }, 10_000);

  const textOf = (chunks: ContentChunk[]) =>
    chunks.filter((chunk) => chunk.type === "convoy/acp_text").map((chunk) => parse(chunk).text);
  const types = (chunks: ContentChunk[]) => chunks.map((chunk) => chunk.type);

  it("steers an open prompt with a second session/prompt and sums usage into one result", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "steer");
    const runner = createAntigravityRunner({});
    expect(await runner.steer!({ prompt: "early", inputFormat: "prompt" })).toBe(false);
    const gen = runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity", steerEnabled: true });
    const chunks: ContentChunk[] = [];
    const steered: boolean[] = [];
    for (let step = await gen.next(); !step.done; step = await gen.next()) {
      chunks.push(step.value);
      if (step.value.data.includes('"sessionUpdate":"tool_call"')) {
        steered.push(await runner.steer!({ prompt: "Stop at 10", inputFormat: "prompt", bootstrapInput: [{ type: "image", mimeType: "image/png", data: "cG5n" }] }));
      }
    }
    expect(steered).toEqual([true]);
    expect(sent("session/prompt").map((message) => message.params.prompt)).toEqual([
      [{ type: "text", text: "hello" }],
      [{ type: "image", mimeType: "image/png", data: "cG5n" }, { type: "text", text: "Stop at 10" }],
    ]);
    expect(textOf(chunks)).toEqual(["Steered."]);
    const results = chunks.filter((chunk) => chunk.type === "convoy/acp_prompt_result").map(parse);
    expect(results).toEqual([{ sessionId: "sess-1", stopReason: "end_turn", usage: { inputTokens: 12, outputTokens: 5 }, model: "gemini-3.8-flash" }]);
    expect(chunks.at(-1)!.type).toBe("convoy/acp_prompt_result");
    expect(await runner.steer!({ prompt: "late", inputFormat: "prompt" })).toBe(false);
  });

  it("keeps the run open for a backgrounded command until it completes and agy reports usage", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "background");
    const runner = createAntigravityRunner({});
    const gen = runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" });
    const chunks: ContentChunk[] = [];
    let steeredAfterPrompt: boolean | null = null;
    for (let step = await gen.next(); !step.done; step = await gen.next()) {
      chunks.push(step.value);
      if (step.value.type === "convoy/acp_prompt_result") steeredAfterPrompt = await runner.steer!({ prompt: "x", inputFormat: "prompt" });
    }
    // No prompt is open after the response, so a steer queues for the next run.
    expect(steeredAfterPrompt).toBe(false);
    expect(textOf(chunks)).toEqual(["Started.", "Finished."]);
    const resultAt = types(chunks).indexOf("convoy/acp_prompt_result");
    const completedAt = chunks.findIndex((chunk) => chunk.data.includes('"status":"completed"') && chunk.data.includes("finished"));
    expect(resultAt).toBeGreaterThan(0);
    expect(completedAt).toBeGreaterThan(resultAt);
    // The closing usage_update ends the run; the open text segment closes after it.
    expect(parse(chunks.at(-2)!).update).toEqual({ sessionUpdate: "usage_update", used: 30, size: 100 });
    expect(chunks.at(-1)!.type).toBe("convoy/acp_text");
    expect(sent("session/cancel")).toEqual([]);
  });

  it("keeps waiting when a late reply starts another command right after its usage_update", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "background-chain");
    const runner = createAntigravityRunner({});
    const { chunks } = await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }));
    expect(textOf(chunks)).toEqual(["Started.", "Finished.", "Chained."]);
  });

  // The usage_update before the command finished must not end the run under agy's slow reply.
  it("waits for the reply to a finished command even when it takes longer than the settle delay", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "background-slow");
    const runner = createAntigravityRunner({});
    const { chunks } = await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }));
    expect(textOf(chunks)).toEqual(["Started.", "Finished."]);
  });

  it("does not wait for a daemon command", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "daemon");
    const runner = createAntigravityRunner({});
    const { chunks, result } = await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" }));
    expect(result).toEqual({ continuationId: "sess-1" });
    expect(textOf(chunks)).toEqual(["Started."]);
  });

  it("asks the bridge for a permission request that arrives after the prompt", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "background-permission");
    const request = vi.fn(async () => JSON.stringify({ decision: "allow" }));
    const runner = createAntigravityRunner({});
    const { chunks } = await collect(
      runner.execute(tmpDir, "hello", {
        threadId: "thread_1",
        cliType: "antigravity",
        cliMode: "default",
        interactionBridge: { request, cancel: vi.fn() },
      })
    );
    expect(request).toHaveBeenCalledTimes(1);
    const answered = recorded().find((entry) => entry.in?.id === "perm-late");
    expect(answered?.in?.result).toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
    expect(textOf(chunks)).toEqual(["Started.", "Finished."]);
  });

  it("keeps the run open while a late permission request waits for the user", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "background-ask");
    const request = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return JSON.stringify({ decision: "allow" });
    });
    const runner = createAntigravityRunner({});
    const { chunks } = await collect(
      runner.execute(tmpDir, "hello", {
        threadId: "thread_1",
        cliType: "antigravity",
        cliMode: "default",
        interactionBridge: { request, cancel: vi.fn() },
      })
    );
    const answered = recorded().find((entry) => entry.in?.id === "perm-ask");
    expect(answered?.in?.result).toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
    expect(textOf(chunks)).toEqual(["Started.", "Finished."]);
  });

  it("stops a run waiting on a backgrounded command without waiting for the force kill", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "background-stop");
    const runner = createAntigravityRunner({});
    const gen = runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" });
    const seen: ContentChunk[] = [];
    let stoppedAt = 0;
    const error = await (async () => {
      for (let step = await gen.next(); !step.done; step = await gen.next()) {
        seen.push(step.value);
        if (step.value.type === "convoy/acp_prompt_result") {
          stoppedAt = Date.now();
          runner.abort();
        }
      }
    })().catch((e: unknown) => e);
    expect((error as RunnerExecutionError).message).toBe("Antigravity run aborted");
    expect(Date.now() - stoppedAt).toBeLessThan(2_000);
    expect(sent("session/cancel")).toHaveLength(1);
    // agy kills the command on cancel and reports it failed.
    expect(seen.at(-1)!.data).toContain('"status":"failed"');
    // The command runs in its own session, beyond the group kill, so agy gets time to reap it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(existsSync(`${recordFile}.reaped`)).toBe(true);
  }, 10_000);

  it("reports the exit and stderr when agy dies mid-turn", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "crash");
    const runner = createAntigravityRunner({});
    const error = await collect(runner.execute(tmpDir, "hello", { threadId: "thread_1", cliType: "antigravity" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toMatch(/exit code 3.*panic: boom/);
    expect((error as RunnerExecutionError).continuationId).toBe("sess-1");
  });
});

describe("detectAntigravity", () => {
  let tmpDir: string;
  let recordFile: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agy-detect-test-"));
    recordFile = join(tmpDir, "record.jsonl");
    const file = join(tmpDir, "agy");
    writeFileSync(file, `#!/usr/bin/env node\n${FAKE_AGY}`);
    chmodSync(file, 0o755);
    vi.stubEnv(ANTIGRAVITY_EXECUTABLE_ENV, file);
    vi.stubEnv("FAKE_RECORD", recordFile);
    // The inventory deletes the session's files under ~/.gemini; keep them in the test dir.
    vi.stubEnv("HOME", tmpDir);
    vi.stubEnv("FAKE_SESSION_FILES", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("advertises agy 1.5.12 and newer only", async () => {
    vi.stubEnv("FAKE_VERSION", "1.5.13");
    await expect(detectAntigravity()).resolves.toMatchObject({ type: "antigravity", version: "1.5.13" });
    vi.stubEnv("FAKE_VERSION", "1.5.11");
    await expect(detectAntigravity()).resolves.toBeNull();
  });

  it("selects each model once to learn its thinking levels", async () => {
    await expect(detectAntigravity()).resolves.toEqual({
      type: "antigravity",
      version: "1.5.13",
      models: [
        { slug: "gemini-3.8-flash", name: "Gemini 3.8 Flash", variants: ["low", "medium", "high"] },
        { slug: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
      ],
    });
  });

  it("leaves no temp directory and no agy conversation behind", async () => {
    await detectAntigravity();
    const [opened] = readFileSync(recordFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as RecordedEntry)
      .flatMap((entry) => (entry.in?.method === "session/new" ? [entry.in] : []));
    const cwd = opened!.params.cwd as string;
    expect(cwd).toContain("convoy-agy-models-");
    expect(existsSync(cwd)).toBe(false);
    expect(existsSync(join(tmpDir, ".gemini/antigravity-cli/conversations/sess-1.db"))).toBe(false);
    expect(existsSync(join(tmpDir, ".gemini/antigravity-cli/brain/sess-1"))).toBe(false);
  });

  it("registers without models when the inventory cannot create its temp directory", async () => {
    const notADirectory = join(tmpDir, "not-a-dir");
    writeFileSync(notADirectory, "");
    vi.stubEnv("TMPDIR", notADirectory);
    await expect(detectAntigravity()).resolves.toEqual({ type: "antigravity", version: "1.5.13" });
  });

  it("runs the inventory on a managed Gemini key, so the catalog shows what the key unlocks (OS-2476)", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "signed-out");
    const detected = await detectAntigravity({ antigravityAuth: { mode: "managed", secret: "AIza-managed" } });
    expect(detected?.provider).toBe("gemini");
    expect(detected?.models?.map((model) => model.slug)).toEqual(["gemini-3.8-flash", "gpt-oss-120b-medium"]);
    const entries = readFileSync(recordFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as RecordedEntry);
    expect(entries.find((entry) => entry.env)?.env).toMatchObject({ gemini: "AIza-managed" });
    expect(entries.flatMap((entry) => (entry.in?.method === "authenticate" ? [entry.in.params] : []))).toEqual([{ methodId: "gemini-api-key" }]);
  });

  it("signs the native inventory back in with Google after a managed key left its auth marker (OS-2476)", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "key-marker");
    const cache = join(tmpDir, ".gemini/antigravity-cli/cache");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "acp-auth-state.json"), JSON.stringify({ methodId: "gemini-api-key" }));
    const detected = await detectAntigravity();
    expect(detected?.models?.map((model) => model.slug)).toEqual(["gemini-3.8-flash", "gpt-oss-120b-medium"]);
    const entries = readFileSync(recordFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as RecordedEntry);
    expect(entries.flatMap((entry) => (entry.in?.method === "authenticate" ? [entry.in.params] : []))).toEqual([{ methodId: "oauth-personal" }]);
  });

  // Signed out, `models` stays absent so the stored catalog is left alone.
  it("registers without models when the inventory fails", async () => {
    vi.stubEnv("FAKE_BEHAVIOR", "signed-out");
    await expect(detectAntigravity()).resolves.toEqual({ type: "antigravity", version: "1.5.13" });
    // Without a key's marker, an unattended inventory never starts a Google sign-in.
    expect(readFileSync(recordFile, "utf8")).not.toContain('"authenticate"');
  });
});
