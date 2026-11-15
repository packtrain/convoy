import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RunnerExecutionError,
  type ContentChunk,
  type InteractionBridge,
  type InteractionRequestInput,
} from "../contracts.js";
import { CODEX_EXECUTABLE_ENV } from "./runner.js";
import {
  collaborationModeForRun,
  createCodexAppServerRunner,
  parseCodexUserInputQuestions,
  threadPermissionsForMode,
  toCodexApprovalDecision,
  toCodexUserInputAnswers,
} from "./app-server-runner.js";
import { threadIdentityInstruction } from "../agent-instructions.js";

const authEvents=vi.hoisted(()=>({emit:vi.fn()}));
vi.mock("../../../lib/connect-events.js",()=>({emitConnectEvent:authEvents.emit}));

const IDENTITY_LINE = threadIdentityInstruction("thread_test");

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

describe("threadPermissionsForMode", () => {
  it("gives agent and unset modes full access without prompts", () => {
    for (const mode of [undefined, "agent" as const]) {
      expect(threadPermissionsForMode(mode)).toEqual({
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      });
    }
  });

  it("keeps auto/dontAsk sandboxed and silent like the exec transport", () => {
    for (const mode of ["auto", "dontAsk"] as const) {
      expect(threadPermissionsForMode(mode)).toEqual({
        approvalPolicy: "never",
        sandbox: "workspace-write",
      });
    }
  });

  it("asks for untrusted actions in default mode", () => {
    expect(threadPermissionsForMode("default")).toEqual({
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
    });
  });

  it("makes plan mode read-only", () => {
    expect(threadPermissionsForMode("plan")).toEqual({
      approvalPolicy: "on-request",
      sandbox: "read-only",
    });
  });

  it("isolation downgrades agent mode to workspace-write and leaves other modes unchanged (OS-1242)", () => {
    for (const mode of [undefined, "agent" as const]) {
      expect(threadPermissionsForMode(mode, true)).toEqual({
        approvalPolicy: "never",
        sandbox: "workspace-write",
      });
    }
    expect(threadPermissionsForMode("plan", true)).toEqual({
      approvalPolicy: "on-request",
      sandbox: "read-only",
    });
    expect(threadPermissionsForMode("default", true)).toEqual({
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
    });
  });
});

describe("collaborationModeForRun", () => {
  it("explicitly exits plan mode for implementation", () => {
    expect(collaborationModeForRun({ cliMode: "agent", model: "gpt-5.5" })).toMatchObject({
      mode: "default",
      settings: { developer_instructions: null },
    });
  });

  it("builds a plan collaboration mode from the run model", () => {
    const mode = collaborationModeForRun({
      cliMode: "plan",
      model: "gpt-5.5",
      runEffort: "high",
    });
    expect(mode).toMatchObject({
      mode: "plan",
      settings: { model: "gpt-5.5", reasoning_effort: "high" },
    });
  });

  it("uses the resolved model and rejects an unresolved model", () => {
    expect(collaborationModeForRun({ cliMode: "plan", model: "gpt-5.4" })).toMatchObject({
      settings: { model: "gpt-5.4", reasoning_effort: null },
    });
    expect(() => collaborationModeForRun({ cliMode: "plan" })).toThrow(/model/i);
  });

  it("keeps the built-in plan instructions when no agent prompt is bound", () => {
    const mode = collaborationModeForRun({ cliMode: "plan", model: "gpt-5.5" });
    expect(mode).toMatchObject({
      settings: { developer_instructions: null },
    });
  });
});

describe("toCodexApprovalDecision", () => {
  it("maps web decisions to codex decisions", () => {
    expect(toCodexApprovalDecision(JSON.stringify({ decision: "allow" }))).toBe("accept");
    expect(toCodexApprovalDecision(JSON.stringify({ decision: "allow-always" }))).toBe(
      "acceptForSession"
    );
    expect(toCodexApprovalDecision(JSON.stringify({ decision: "deny" }))).toBe("decline");
  });

  it("declines malformed responses", () => {
    expect(toCodexApprovalDecision("not json")).toBe("decline");
    expect(toCodexApprovalDecision("{}")).toBe("decline");
  });
});

describe("user input questions", () => {
  const rawQuestions = [
    {
      id: "q1",
      header: "Scope",
      question: "Which scope?",
      isOther: false,
      isSecret: false,
      options: [
        { label: "Frontend", description: "UI only" },
        { label: "Backend" },
      ],
    },
    { id: "q2", header: "", question: "Proceed?", options: null },
    { question: "missing id" },
  ];

  it("preserves custom-answer and secret flags", () => {
    expect(parseCodexUserInputQuestions([{ id: "secret", question: "Token?", isOther: false, isSecret: true }])[0])
      .toMatchObject({ id: "secret", isOther: false, isSecret: true });
  });

  it("keeps answers to identical question text separate by provider ID", () => {
    const questions = parseCodexUserInputQuestions([
      { id: "first", question: "Choose", options: null },
      { id: "second", question: "Choose", options: null },
    ]);
    expect(toCodexUserInputAnswers(questions, JSON.stringify({ answers: { first: "A", second: "B" } })))
      .toEqual({ answers: { first: { answers: ["A"] }, second: { answers: ["B"] } } });
  });

  it("parses questions and drops malformed entries", () => {
    const parsed = parseCodexUserInputQuestions(rawQuestions);
    expect(parsed).toEqual([
      {
        id: "q1",
        header: "Scope",
        question: "Which scope?",
        isOther: false,
        isSecret: false,
        options: [
          { label: "Frontend", description: "UI only" },
          { label: "Backend", description: "" },
        ],
      },
      { id: "q2", header: "", question: "Proceed?", options: [] },
    ]);
  });

  it("maps web answers keyed by question text back to question ids", () => {
    const questions = parseCodexUserInputQuestions(rawQuestions);
    const answers = toCodexUserInputAnswers(
      questions,
      JSON.stringify({ answers: { "Which scope?": "Frontend" } })
    );
    expect(answers).toEqual({
      answers: {
        q1: { answers: ["Frontend"] },
        q2: { answers: [] },
      },
    });
  });
});

/**
 * Fake `codex app-server`: speaks newline-delimited JSON-RPC over stdio.
 * Behavior is driven by the FAKE_BEHAVIOR env marker baked into the script.
 */
const FAKE_APP_SERVER = String.raw`
const readline = require("node:readline");
const behavior = process.env.FAKE_BEHAVIOR ?? "happy";
if (process.argv.includes("--version")) { process.stdout.write("codex-cli " + (process.env.FAKE_CODEX_VERSION ?? "0.156.1") + "\n"); process.exit(0); }
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const notify = (method, params) => send({ method, params });

let activeTurn = null;
let openParams = null;
let openProvider = null;
let asyncAnswers = 0;
let authenticated = false;
// Native goal lifecycle of codex-cli 0.166.0 (OS-2277 traces C1–C8, R1, R2).
let goal = process.env.FAKE_GOAL_STATUS ? { objective: "count.txt holds 3", status: process.env.FAKE_GOAL_STATUS, tokensUsed: 0, updatedAt: 100 } : null;
let goalClock = 100;
let goalTurns = 0;
let loadedThread = null;
const goalJson = (threadId) => goal && { threadId, objective: goal.objective, status: goal.status, tokenBudget: null,
  tokensUsed: goal.tokensUsed, timeUsedSeconds: 0, createdAt: 100, updatedAt: goal.updatedAt };
const touchGoal = (patch) => { goal = { ...goal, ...patch, updatedAt: ++goalClock }; };
function runGoalTurn(threadId) {
  if (!goal || goal.status !== "active" || loadedThread !== threadId || activeTurn) return;
  const id = "goal-turn-" + (++goalTurns);
  activeTurn = id;
  notify("turn/started", { threadId, turn: { id } });
  if (behavior.startsWith("goal-hang")) return;
  touchGoal({ tokensUsed: goal.tokensUsed + 5 });
  notify("thread/goal/updated", { threadId, turnId: id, goal: goalJson(threadId) });
  notify("thread/goal/updated", { threadId: "child-a", turnId: "child-turn", goal: { ...goalJson("child-a"), status: "complete" } });
  notify("item/completed", { threadId, turnId: id, item: { type: "agentMessage", id: "msg-" + id, text: "progress " + goalTurns } });
  if (goalTurns >= Number(process.env.FAKE_GOAL_TURNS ?? 3)) {
    touchGoal({ status: "complete" });
    notify("thread/goal/updated", { threadId, turnId: id, goal: goalJson(threadId) });
  }
  activeTurn = null;
  notify("turn/completed", { threadId, turn: { id, status: "completed" } });
  if (behavior !== "goal-stall") setTimeout(() => runGoalTurn(threadId), 5);
}
function handleGoal(msg) {
  const threadId = msg.params?.threadId;
  if (msg.method === "thread/goal/get") { send({ id: msg.id, result: { goal: goalJson(threadId) } }); return true; }
  if (msg.method === "thread/goal/set") {
    if (behavior === "goal-hang-pause-fails" && msg.params.status === "paused") {
      send({ id: msg.id, error: { code: -32000, message: "pause failed" } }); return true;
    }
    if (msg.params.objective) goal = { objective: msg.params.objective, status: "active", tokensUsed: 0, updatedAt: goalClock };
    if (!goal) { send({ id: msg.id, error: { code: -32600, message: "no goal" } }); return true; }
    touchGoal({ status: msg.params.status ?? goal.status });
    send({ id: msg.id, result: { goal: goalJson(threadId) } });
    notify("thread/goal/updated", { threadId, turnId: null, goal: goalJson(threadId) });
    setTimeout(() => runGoalTurn(threadId), 5);
    return true;
  }
  if (msg.method === "thread/goal/clear") {
    const had = goal !== null;
    goal = null;
    send({ id: msg.id, result: { cleared: had } });
    if (had) notify("thread/goal/cleared", { threadId });
    return true;
  }
  if (msg.method === "thread/settings/update") { send({ id: msg.id, result: {} }); return true; }
  if (msg.method === "turn/interrupt") {
    send({ id: msg.id, result: {} });
    if (activeTurn) { const id = activeTurn; activeTurn = null; notify("turn/completed", { threadId, turn: { id, status: "interrupted" } }); }
    return true;
  }
  if (msg.method === "turn/start") {
    activeTurn = "turn-1";
    send({ id: msg.id, result: { turn: { id: "turn-1" } } });
    notify("turn/started", { threadId, turn: { id: "turn-1" } });
    if (behavior === "goal-model") {
      goal = { objective: "model goal", status: "active", tokensUsed: 0, updatedAt: goalClock };
      touchGoal({});
      notify("thread/goal/updated", { threadId, turnId: "turn-1", goal: goalJson(threadId) });
    }
    notify("item/completed", { threadId, turnId: "turn-1", item: { type: "agentMessage", id: "answer", text: "answer" } });
    activeTurn = null;
    notify("turn/completed", { threadId, turn: { id: "turn-1", status: "completed" } });
    setTimeout(() => runGoalTurn(threadId), 5);
    return true;
  }
  return false;
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (process.env.FAKE_ERROR_METHOD && msg.method === process.env.FAKE_ERROR_METHOD) {
    send({id:msg.id,error:{code:-32000,message:process.env.FAKE_DIAGNOSTIC}});return;
  }
  if (process.env.FAKE_EXIT_METHOD && msg.method === process.env.FAKE_EXIT_METHOD) {
    const diagnostic = process.env.FAKE_DIAGNOSTIC ?? "";
    process.stderr.write(diagnostic, () => {
      if (process.env.FAKE_EXIT_SIGNAL) process.kill(process.pid, "SIGTERM");
      else process.exit(7);
    });
    return;
  }
  if (process.env.FAKE_RPC_LOG) require("node:fs").appendFileSync(process.env.FAKE_RPC_LOG, msg.method + "\n");
  if (process.env.FAKE_GOAL_LOG && msg.method) require("node:fs").appendFileSync(process.env.FAKE_GOAL_LOG, JSON.stringify([msg.method, msg.params ?? {}]) + "\n");
  if (behavior.startsWith("goal") && handleGoal(msg)) return;
  if (msg.method === "thread/goal/get") { send({ id: msg.id, error: { code: -32600, message: "Invalid request: unknown variant \`thread/goal/get\`, expected one of \`initialize\`" } }); return; }
  if (msg.method === "account/rateLimits/read") {
    send({ id: msg.id, result: { rateLimits: { limitId: "codex", primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1730947200 } } } });
    return;
  }
  if (msg.method === "initialize") {
    send({ id: msg.id, result: { userAgent: "fake" } });
    return;
  }
  if (msg.method === "config/read" && behavior.startsWith("aws")) {
    const provider = (process.argv.find((arg) => arg.startsWith("model_provider=")) ?? "").slice(16, -1) || "openai";
    send({id:msg.id,result:{config:{model_provider:provider,service_tier:process.env.FAKE_SERVICE_TIER ?? null,model_providers:{}}}});return;
  }
  if (msg.method === "config/read") {
    if (!process.argv.includes('cli_auth_credentials_store="ephemeral"') || process.env.OPENAI_API_KEY) { send({id:msg.id,error:{message:"unsafe auth environment"}}); return; }
    send({id:msg.id,result:{config:{cli_auth_credentials_store:"ephemeral",forced_login_method:"api",model_provider:"openai"}}});return;
  }
  if (msg.method === "account/login/start") {
    if (msg.params.apiKey !== "managed-sentinel") {send({id:msg.id,error:{message:"wrong key"}});return;}
    authenticated=true;send({id:msg.id,result:{type:"apiKey"}});return;
  }
  if (msg.method === "account/read" && behavior === "no-login") {
    send({id:msg.id,result:{account:null,requiresOpenaiAuth:true}});return;
  }
  if (msg.method === "account/read" && behavior === "no-auth-required") {
    send({id:msg.id,result:{account:null,requiresOpenaiAuth:false}});return;
  }
  if (msg.method === "account/read" && behavior === "usage-auth-notifications") notify("account/updated", {authMode:"chatgpt",planType:"plus"});
  if (msg.method === "account/read") {send({id:msg.id,result:{account:{type:authenticated?"apiKey":"chatgpt",email:"test@example.com"}}});return;}
  if (msg.method === "thread/start" || msg.method === "thread/resume" || msg.method === "thread/fork") {
    if (behavior.startsWith("managed") && (!authenticated || msg.params.modelProvider !== "openai")) {send({id:msg.id,error:{message:"thread opened before authentication"}});return;}
    openParams = { method: msg.method, developerInstructions: msg.params.developerInstructions ?? null,
      ...(msg.method === "thread/fork" ? { lastTurnId: msg.params.lastTurnId } : {}) };
    const threadId = msg.method === "thread/resume" ? msg.params.threadId : msg.method === "thread/fork" ? "t-fork-1" : "t-app-1";
    if (behavior === "early-notifications") {
      notify("thread/tokenUsage/updated", { threadId, tokenUsage: { total: { totalTokens: 77 } } });
      notify("error", { threadId: "early-child", error: { message: "child failed early" }, willRetry: false });
    }
    loadedThread = threadId;
    if (msg.method === "thread/resume" && behavior.startsWith("goal")) setTimeout(() => runGoalTurn(threadId), 5);
    openProvider = msg.params.modelProvider ?? null;
    const awsProvider = behavior.startsWith("aws") ? { modelProvider: process.env.FAKE_THREAD_PROVIDER ?? msg.params.modelProvider } : {};
    send({ id: msg.id, result: { thread: { id: threadId }, ...awsProvider, ...(behavior.startsWith("managed") ? {modelProvider:"openai"} : {}), ...(behavior.startsWith("no-model") ? {} : { model: "gpt-5.5" }) } });
    if (msg.method === "thread/resume") {
      notify("model/rerouted", { threadId, turnId: "old-turn", fromModel: "gpt-5.4", toModel: "gpt-5.5", reason: "highRiskRequest" });
      notify("thread/tokenUsage/updated", { threadId, turnId: "old-turn", tokenUsage: {
        total: { inputTokens: 300, cachedInputTokens: 120, cacheWriteInputTokens: 30, outputTokens: 60 },
        last: { inputTokens: 200, cachedInputTokens: 80, cacheWriteInputTokens: 20, outputTokens: 40 },
      }});
    }
    return;
  }
  if (msg.method === "model/list") {
    if (behavior === "no-model-rejected-catalog") {
      send({ id: msg.id, error: { code: -32601, message: "catalog unavailable" } });
      return;
    }
    if (behavior === "no-model-empty-catalog") {
      send({ id: msg.id, result: { data: [] } });
      return;
    }
    send({ id: msg.id, result: { data: [{ id: "gpt-5.5", model: "gpt-5.5", isDefault: true }] } });
    return;
  }
  if (msg.method === "turn/steer" && behavior === "async-case") {
    send({ id: msg.id, result: {} });
    notify("item/completed", { turnId: "turn-1", item: { type: "agentMessage", id: "answer-" + asyncAnswers, text: JSON.stringify(msg.params) } });
    if (++asyncAnswers === 2) notify("turn/completed", { threadId: "t-app-1", turn: { id: "turn-1", status: "completed" } });
    return;
  }
  if (msg.method === "turn/steer") {
    if (activeTurn !== null && msg.params.expectedTurnId === activeTurn) {
      send({ id: msg.id, result: {} });
      notify("item/completed", {
        turnId: activeTurn,
        item: { type: "agentMessage", id: "steer-echo", text: "steered:" + msg.params.input[0].text },
      });
    } else {
      send({ id: msg.id, error: { code: -32600, message: "turn not active" } });
    }
    return;
  }
  if (msg.method === "thread/compact/start") {
    // Mirrors the real app-server (codex-cli 0.146.0): the RPC returns an
    // empty result and the compaction then runs as an ordinary turn.
    send({ id: msg.id, result: {} });
    activeTurn = "turn-compact";
    notify("turn/started", { threadId: msg.params.threadId, turn: { id: "turn-compact" } });
    notify("item/started", {
      threadId: msg.params.threadId,
      turnId: "turn-compact",
      item: { type: "contextCompaction", id: "compaction-1" },
    });
    notify("item/completed", {
      threadId: msg.params.threadId,
      turnId: "turn-compact",
      item: { type: "contextCompaction", id: "compaction-1" },
    });
    activeTurn = null;
    notify("turn/completed", {
      threadId: msg.params.threadId,
      turn: { id: "turn-compact", status: "completed", error: null },
    });
    return;
  }
  if (behavior === "drain-nested-child" && msg.id === 901 && msg.result) {
    notify("thread/started", { thread: { id: "nested", source: { subAgent: { thread_spawn: { parent_thread_id: "child-drain", agent_path: "/root/reviewer/nested" } } } } });
    notify("turn/started", { threadId: "nested", turn: { id: "nested-turn" } });
    notify("turn/completed", { threadId: "child-drain", turn: { id: "child-turn", status: "completed" } });
    send({ id: 902, method: "item/commandExecution/requestApproval", params: { threadId: "nested", turnId: "nested-turn", itemId: "nested-command", command: "true" } });
    return;
  }
  if (behavior === "drain-nested-child" && msg.id === 902 && msg.result) {
    notify("item/completed", { threadId: "nested", turnId: "nested-turn", item: { type: "agentMessage", id: "findings", text: "child findings survived" } });
    notify("turn/completed", { threadId: "nested", turn: { id: "nested-turn", status: "completed" } });
    return;
  }
  if (behavior === "drain-exit" && msg.id === 901 && msg.result) { process.exit(5); }
  if (behavior === "drain-child" && msg.id === 901 && msg.result) {
    notify("item/completed", { threadId: "child-drain", turnId: "child-turn", item: { type: "agentMessage", id: "findings", text: "child findings survived" } });
    notify("turn/completed", { threadId: "child-drain", turn: { id: "child-turn", status: "completed" } });
    return;
  }
  if (msg.method === "turn/start") {
    activeTurn = "turn-1";
    send({ id: msg.id, result: { turn: { id: "turn-1" } } });
    notify("turn/started", { threadId: msg.params.threadId, turn: { id: "turn-1" } });
    if (behavior.startsWith("drain-")) {
      notify("thread/started", { thread: { id: "child-drain", source: { subAgent: { thread_spawn: { parent_thread_id: msg.params.threadId, agent_path: "/root/reviewer" } } } } });
      notify("turn/started", { threadId: "child-drain", turn: { id: "child-turn" } });
      notify("turn/completed", { threadId: msg.params.threadId, turn: { id: "turn-1", status: "completed" } });
      send({ id: 901, method: "item/commandExecution/requestApproval", params: { threadId: "child-drain", turnId: "child-turn", itemId: "child-command", command: "true" } });
      return;
    }
    if (behavior === "async-case") {
      for (const threadId of [msg.params.threadId, "child-a"]) {
        const turnId = threadId === "child-a" ? "child-turn" : "turn-1";
        notify("turn/started", { threadId, turn: { id: turnId } });
        notify("item/agentMessage/delta", { threadId, turnId, itemId: "question", delta: "Choosing" });
        const params = { threadId, turnId, item: { type: "agentMessage", id: "question", delivery: "async", text: "Choosing a color", questions: [{ title: "Color?", options: ["Blue", "Red"] }] } };
        notify("item/completed", params);
        notify("item/completed", params);
      }
      return;
    }
    if (behavior === "resolved-case") {
      send({ id: 100, method: "item/tool/requestUserInput", params: { threadId: "child-a", turnId: "child-turn", questions: [{ id: "q", question: "First?" }] } });
      notify("serverRequest/resolved", { threadId: "child-a", requestId: 100 });
      send({ id: 101, method: "item/tool/requestUserInput", params: { threadId: "child-b", turnId: "other-turn", questions: [{ id: "q", question: "Second?" }] } });
      return;
    }
    if (behavior === "interaction-case") {
      send({ id: 100, method: process.env.FAKE_REQUEST_METHOD, params: {
        threadId: msg.params.threadId, turnId: "turn-1", itemId: "call-1",
        ...JSON.parse(process.env.FAKE_REQUEST_PARAMS || "{}"),
      }});
      return;
    }
    if (behavior === "child-file-approval") {
      for (const threadId of ["child-a", msg.params.threadId]) {
        notify("item/started", { threadId, turnId: "turn-1", item: {
          type: "fileChange", id: "shared-item", changes: [{ path: threadId + ".ts", diff: "+ child edit" }],
        }});
      }
      send({ id: 100, method: "item/fileChange/requestApproval", params: {
        threadId: "child-a", turnId: "turn-1", itemId: "shared-item",
      }});
      return;
    }
    if (behavior.startsWith("child-")) {
      const threadId = "child-a";
      if (behavior === "child-start") notify("turn/started", { threadId, turn: { id: "child-turn" } });
      if (behavior === "child-completion") notify("turn/completed", { threadId, turn: { id: "child-turn", status: "completed" } });
      if (behavior === "child-error") notify("error", { threadId, turnId: "child-turn", error: { message: "child failed" }, willRetry: false });
      if (behavior === "child-usage") notify("thread/tokenUsage/updated", { threadId, turnId: "child-turn", tokenUsage: { total: { totalTokens: 999999 } } });
      if (behavior === "child-malformed-root") notify("turn/completed", { threadId: msg.params.threadId, turn: { status: "completed" } });
      if (behavior === "child-stale-root") notify("turn/completed", { threadId: msg.params.threadId, turn: { id: "old-turn", status: "failed", error: { message: "old failure" } } });
    }
    if (behavior === "echo-instructions" || behavior.startsWith("no-model")) {
      const collaboration = msg.params.collaborationMode ?? null;
      notify("item/completed", {
        turnId: "turn-1",
        item: { type: "agentMessage", id: "di-echo", text: "di-echo:" + JSON.stringify({
          open: openParams,
          collaboration,
          collaborationDeveloperInstructions:
            collaboration && collaboration.settings ? collaboration.settings.developer_instructions ?? null : null,
        }) },
      });
      activeTurn = null;
      notify("turn/completed", { turn: { id: "turn-1", status: "completed", error: null } });
      return;
    }
    if (behavior === "aws") {
      const echo = { args: process.argv.slice(2), token: process.env.AWS_BEARER_TOKEN_BEDROCK === "aws-sentinel",
        region: process.env.AWS_REGION ?? null, claudeMarker: process.env.CONVOY_CLAUDE_PROVIDER_ENV ?? null,
        model: msg.params.model, openProvider };
      notify("item/agentMessage/delta", { threadId: msg.params.threadId, turnId: "turn-1", itemId: "echo", delta: "aws-" });
      notify("item/completed", { threadId: msg.params.threadId, turnId: "turn-1", item: { type: "agentMessage", id: "echo", text: "aws-echo:" + JSON.stringify(echo) + " leaked aws-sentinel" } });
      activeTurn = null;
      notify("turn/completed", { threadId: msg.params.threadId, turn: { id: "turn-1", status: "completed", error: null } });
      return;
    }
    if (behavior === "aws-401") {
      notify("turn/completed", { threadId: msg.params.threadId, turn: { id: "turn-1", status: "failed",
        error: { message: "unexpected status 401 Unauthorized: Invalid bearer token aws-sentinel, url: https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses" } } });
      return;
    }
    if (behavior === "failed-turn") {
      notify("turn/completed", {
        threadId: msg.params.threadId,
        turn: { id: "turn-1", status: "failed", error: { message: "usage limit reached" } },
      });
      return;
    }
    notify("item/started", {
      threadId: msg.params.threadId,
      turnId: "turn-1",
      item: { type: "commandExecution", id: "call-1", command: "touch x", status: "inProgress" },
    });
    // Server->client approval request; item completion waits for the answer.
    send({ id: 100, method: "item/commandExecution/requestApproval", params: {
      threadId: msg.params.threadId, turnId: "turn-1", itemId: "call-1",
      startedAtMs: 1, environmentId: null, command: "touch x", cwd: "/tmp",
    }});
    return;
  }
  if (behavior === "resolved-case" && msg.id === 101) {
    notify("turn/completed", { threadId: "t-app-1", turn: { id: "turn-1", status: "completed" } });
    return;
  }
  if (behavior === "resolved-case" && msg.id === 100) return;
  if (msg.id === 100) {
    if (behavior === "interaction-case") {
      notify("item/completed", { turnId: "turn-1", item: { type: "agentMessage", id: "response", text: JSON.stringify(msg) } });
      notify("turn/completed", { turn: { id: "turn-1", status: "completed" } });
      return;
    }
    if (behavior === "managed-error-id") {
      notify("turn/completed",{turn:{id:"turn-1",status:"failed",error:{message:"Failed processing item 140123"}}});
      return;
    }
    if (behavior.startsWith("managed-split")) {
      for (const tid of ["t-app-1", "child-1"]) {
        for (const method of ["item/agentMessage/delta", "item/reasoning/textDelta", "item/commandExecution/outputDelta", "item/plan/delta"]) {
          for (let at=1;at<"managed-sentinel".length;at++) {
            notify(method, {threadId:tid, turnId:"turn-1", itemId:method, delta:"managed-sentinel".slice(0,at)});
            notify(method, {threadId:tid, turnId:"turn-1", itemId:method, delta:"managed-sentinel".slice(at)});
          }
        }
        notify("item/agentMessage/delta", {threadId:tid, turnId:"turn-1", itemId:"whole", delta:"key managed-sentinel"});
        notify("item/completed", {threadId:tid, turnId:"turn-1", item:{type:"agentMessage",id:"secret",text:"managed-sentinel"}});
      }
    }
    // Approval answer arrived; finish the run.
    notify("item/completed", {
      turnId: "turn-1",
      item: { type: "commandExecution", id: "call-1", command: "touch x",
        status: "completed", exitCode: 0, aggregatedOutput: "decision:" + msg.result.decision },
    });
    notify("turn/plan/updated", { threadId: "t-app-1", turnId: "turn-1",
      plan: [{ step: "Alpha", status: "completed" }, { step: "Beta", status: "inProgress" }] });
    notify("item/agentMessage/delta", { turnId: "turn-1", itemId: "msg-1", delta: "do" });
    notify("item/completed", { turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "done" } });
    if (behavior === "rerouted") notify("model/rerouted", {
      threadId: "t-app-1", turnId: "turn-1", fromModel: "gpt-5.5", toModel: "gpt-6-astra", reason: "highRiskRequest",
    });
    notify("thread/tokenUsage/updated", { turnId: "turn-1", tokenUsage: {
      total: { totalTokens: 100 }, last: { totalTokens: 50, inputTokens: 40, cachedInputTokens: 10, outputTokens: 10 },
      modelContextWindow: 1000,
    }});
    activeTurn = null;
    notify("turn/completed", { turn: { id: "turn-1", status: "completed", error: null } });
  }
});
`;

function createBridge(decision: string): {
  bridge: InteractionBridge;
  requests: InteractionRequestInput[];
} {
  const requests: InteractionRequestInput[] = [];
  return {
    requests,
    bridge: {
      async request(input) {
        requests.push(input);
        return JSON.stringify({ decision });
      },
      cancel() {},
    },
  };
}

describe("createCodexAppServerRunner (fake app-server executable)", () => {
  let tmpDir: string;
  let previousExecutable: string | undefined;
  let previousBehavior: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "codex-app-server-test-"));
    previousExecutable = process.env[CODEX_EXECUTABLE_ENV];
    previousBehavior = process.env.FAKE_BEHAVIOR;
    const file = join(tmpDir, "codex");
    writeFileSync(file, `#!/usr/bin/env node\n${FAKE_APP_SERVER}`);
    chmodSync(file, 0o755);
    process.env[CODEX_EXECUTABLE_ENV] = file;
  });

  afterEach(() => {
    if (previousExecutable === undefined) {
      delete process.env[CODEX_EXECUTABLE_ENV];
    } else {
      process.env[CODEX_EXECUTABLE_ENV] = previousExecutable;
    }
    if (previousBehavior === undefined) {
      delete process.env.FAKE_BEHAVIOR;
    } else {
      process.env.FAKE_BEHAVIOR = previousBehavior;
    }
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(["drain-child", "drain-nested-child"])("retains child findings after the parent turn completes: %s", async (behavior) => {
    process.env.FAKE_BEHAVIOR = behavior;
    const runner = createCodexAppServerRunner();
    const { chunks } = await collectChunks(runner.execute(tmpDir, "test", {
      threadId: "thread_test", cliType: "codex", interactionBridge: createBridge("allow").bridge,
    }));
    const findings = chunks.findIndex((chunk) => chunk.type === "convoy/child" && chunk.data.includes("child findings survived"));
    expect(findings).toBeGreaterThanOrEqual(0);
    expect(chunks.findIndex((chunk) => chunk.type === "turn/completed")).toBeGreaterThan(findings);
  });

  it("fails if the server exits before the remaining child completes", async () => {
    process.env.FAKE_BEHAVIOR = "drain-exit";
    const runner = createCodexAppServerRunner();
    await expect(collectChunks(runner.execute(tmpDir, "test", {
      threadId: "thread_test", cliType: "codex", interactionBridge: createBridge("allow").bridge,
    }))).rejects.toThrow("exit code 5");
  });

  it("can stop while draining a child approval", async () => {
    process.env.FAKE_BEHAVIOR = "drain-child";
    let ready!: () => void;
    const parked = new Promise<void>((resolve) => { ready = resolve; });
    const runner = createCodexAppServerRunner();
    const collecting = collectChunks(runner.execute(tmpDir, "test", {
      threadId: "thread_test", cliType: "codex", interactionBridge: {
        request: () => { ready(); return new Promise<string>(() => {}); }, cancel() {},
      },
    }));
    const rejected = expect(collecting).rejects.toThrow("aborted");
    await parked;
    expect(await runner.steer!({ prompt: "late", inputFormat: "prompt" })).toBe(false);
    runner.abort();
    await rejected;
  });

  it.each([undefined,"existing-thread"])("authenticates before managed start/resume: %s", async (continuationId) => {
    process.env.FAKE_BEHAVIOR="managed"; vi.stubEnv("OPENAI_API_KEY","inherited-wrong-key");
    const runner=createCodexAppServerRunner({codexAuth:{mode:"managed",secret:"managed-sentinel"}});
    const {chunks}=await collectChunks(runner.execute(tmpDir,"test",{threadId:"thread_test",cliType:"codex",continuationId}));
    expect(chunks.some(c=>c.type==="turn/completed")).toBe(true);
    expect(JSON.stringify(chunks)).not.toContain("managed-sentinel");
  });

  it("streams managed deltas with the whole key redacted", async () => {
    process.env.FAKE_BEHAVIOR="managed-split";
    const runner=createCodexAppServerRunner({partialStreaming:true,codexAuth:{mode:"managed",secret:"managed-sentinel"}});
    const {chunks}=await collectChunks(runner.execute(tmpDir,"test",{threadId:"thread_test",cliType:"codex"}));
    const deltas=chunks.filter(c=>/delta$/i.test(c.type)).map(c=>JSON.parse(c.data).delta);
    expect(deltas).toContain("key [redacted]");
    expect(deltas).toContain("managed-sentin");
    expect(JSON.stringify(chunks)).not.toContain("managed-sentinel");
  });

  it("does not classify digits inside an identifier as an HTTP auth error", async()=>{
    process.env.FAKE_BEHAVIOR="managed-error-id";
    authEvents.emit.mockClear();
    const runner=createCodexAppServerRunner({codexAuth:{mode:"managed",secret:"managed-sentinel"}});
    await expect(collectChunks(runner.execute(tmpDir,"test",{threadId:"thread_test",cliType:"codex"}))).rejects.toThrow("140123");
    expect(authEvents.emit).toHaveBeenLastCalledWith({event:"auth",runtime:"codex",result:"request-failed"});
  });

  describe("AWS providers (OS-2105)", () => {
    const mantle = { provider: "mantle" as const, token: "aws-sentinel", region: "us-east-1" };
    const run = (provider: typeof mantle | { provider: "bedrock"; token: string; region: string }, options: Record<string, unknown> = {}) =>
      collectChunks(createCodexAppServerRunner({ codexProvider: provider, partialStreaming: true }).execute(tmpDir, "test", {
        threadId: "thread_test", cliType: "codex", resolvedCliModel: "openai.gpt-6-sol", ...options,
      }));
    const echoOf = (chunks: ContentChunk[]) => {
      const text = chunks.map((chunk) => chunk.data).find((data) => data.includes("aws-echo:"))!;
      const item = JSON.parse(text).item as { text: string };
      return { echo: JSON.parse(item.text.slice(9, item.text.indexOf(" leaked"))), text: item.text };
    };

    it("runs Mantle with the built-in provider, child-only credentials and redaction", async () => {
      process.env.FAKE_BEHAVIOR = "aws";
      const log = join(tmpDir, "rpc.log");
      vi.stubEnv("FAKE_RPC_LOG", log);
      const { chunks } = await run(mantle);
      const { echo, text } = echoOf(chunks);
      expect(echo).toMatchObject({ token: true, region: "us-east-1", model: "openai.gpt-6-sol", openProvider: "amazon-bedrock" });
      expect(echo.args).toContain('model_provider="amazon-bedrock"');
      expect(echo.args.join(" ")).not.toContain("aws-sentinel");
      expect(text).toContain("[redacted]");
      expect(JSON.stringify(chunks)).not.toContain("aws-sentinel");
      expect(chunks.filter((chunk) => /delta$/i.test(chunk.type)).map((chunk) => JSON.parse(chunk.data).delta)).toEqual(["aws-"]);
      expect(readFileSync(log, "utf8")).not.toContain("account/");
    });

    it("runs Bedrock Runtime with inference profiles and hosted web search off", async () => {
      process.env.FAKE_BEHAVIOR = "aws";
      const { chunks } = await run({ ...mantle, provider: "bedrock" }, { resolvedCliModel: "global.openai.gpt-6-sol" });
      const { echo } = echoOf(chunks);
      expect(echo.args).toEqual(expect.arrayContaining(['model_provider="amazon-bedrock-runtime"', 'web_search="disabled"']));
      expect(echo.openProvider).toBe("amazon-bedrock-runtime");
    });

    it.each([
      ["no model", undefined],
      ["a native model", "gpt-6-sol"],
      ["a Bedrock profile", "global.openai.gpt-6-sol"],
    ])("fails before spawning with %s", async (_label, model) => {
      process.env.FAKE_BEHAVIOR = "aws";
      const log = join(tmpDir, "rpc.log");
      vi.stubEnv("FAKE_RPC_LOG", log);
      await expect(run(mantle, { resolvedCliModel: model })).rejects.toThrow(/Select a GPT-6 or GPT-5\.6 model/);
      expect(() => readFileSync(log, "utf8")).toThrow();
    });

    it("fails a resume that cannot continue on the selected provider", async () => {
      process.env.FAKE_BEHAVIOR = "aws";
      vi.stubEnv("FAKE_THREAD_PROVIDER", "openai");
      await expect(run(mantle, { continuationId: "existing-thread" })).rejects.toThrow(/Start a new thread/);
    });

    it("rejects an inherited Fast mode setting", async () => {
      process.env.FAKE_BEHAVIOR = "aws";
      vi.stubEnv("FAKE_SERVICE_TIER", "fast");
      await expect(run(mantle)).rejects.toThrow(/Fast mode is not available on AWS Bedrock \(Mantle\)/);
    });

    it("explains /usage instead of reading a ChatGPT account", async () => {
      process.env.FAKE_BEHAVIOR = "aws";
      await expect(run(mantle, { resolvedCliModel: undefined, runtimeCommand: { command: "usage" } })).rejects.toThrow(/AWS console/);
    });

    it("reports rejected credentials with AWS guidance and no native login hint", async () => {
      process.env.FAKE_BEHAVIOR = "aws-401";
      const failure = run(mantle);
      await expect(failure).rejects.toThrow(/AWS Bedrock \(Mantle\) rejected the credentials/);
      await expect(failure).rejects.not.toThrow(/aws-sentinel|codex login/);
    });
  });

  it("refuses disabled managed Codex without native fallback", async () => {
    const runner = createCodexAppServerRunner({ codexAuth: {mode:"disabled"} });
    await expect(collectChunks(runner.execute(tmpDir,"test",{threadId:"thread_test",cliType:"codex"}))).rejects.toThrow("disabled");
  });

  it("renders async questions once after partial text and steers concurrent child answers", async () => {
    process.env.FAKE_BEHAVIOR = "async-case";
    const runner = createCodexAppServerRunner({ partialStreaming: true });
    const requests: InteractionRequestInput[] = [];
    const answers: Array<(response: string) => void> = [];
    const run = collectChunks(runner.execute(tmpDir, "test", {
      threadId: "thread_test", cliType: "codex",
      interactionBridge: {
        request(input, signal) {
          requests.push(input);
          return new Promise((resolve, reject) => { answers.push(resolve); signal.addEventListener("abort", () => reject(new Error("aborted"))); });
        }, cancel() {},
      },
    }));
    try {
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[0]!.requestId).not.toBe(requests[1]!.requestId);
      for (const [index, request] of requests.entries()) {
        const payload = JSON.parse(request.payloadJson);
        expect(payload).toMatchObject({ isBlocking: false, responseMode: "message", questions: [{ question: "Color?", options: [{ label: "Blue" }, { label: "Red" }] }] });
        answers[index]!(JSON.stringify({ answers: { [payload.questions[0].id]: "Blue" } }));
      }
      const { chunks } = await run;
      const delivered = chunks.map(c => JSON.parse(c.data)).filter(c => c.item?.id?.startsWith("answer-")).map(c => JSON.parse(c.item.text));
      expect(delivered).toEqual(expect.arrayContaining([
        expect.objectContaining({ threadId: "t-app-1", expectedTurnId: "turn-1" }),
        expect.objectContaining({ threadId: "child-a", expectedTurnId: "child-turn" }),
      ]));
    } finally { runner.abort(); await run.catch(() => {}); }
  });

  it("cancels provider-resolved requests without cancelling concurrent child prompts", async () => {
    process.env.FAKE_BEHAVIOR = "resolved-case";
    const runner = createCodexAppServerRunner();
    const requests: Array<{ input: InteractionRequestInput; signal: AbortSignal; resolve: (value: string) => void }> = [];
    const cancel = vi.fn();
    const run = collectChunks(runner.execute(tmpDir, "test", {
      threadId: "thread_test", cliType: "codex", interactionBridge: {
        request(input, signal) { return new Promise((resolve, reject) => {
          requests.push({ input, signal, resolve });
          signal.addEventListener("abort", () => reject(new Error("resolved")));
        }); }, cancel,
      },
    }));
    try {
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[0]!.signal.aborted).toBe(true);
      expect(requests[1]!.signal.aborted).toBe(false);
      expect(cancel).toHaveBeenCalledWith(requests[0]!.input.requestId, expect.objectContaining({ abandoned: false }));
      requests[1]!.resolve(JSON.stringify({ answers: { q: "yes" } }));
      await run;
    } finally { runner.abort(); await run.catch(() => {}); }
  });

  async function interactionCase(method: string, params: Record<string, unknown>, response: unknown) {
    process.env.FAKE_BEHAVIOR = "interaction-case";
    vi.stubEnv("FAKE_REQUEST_METHOD", method);
    vi.stubEnv("FAKE_REQUEST_PARAMS", JSON.stringify(params));
    const requests: InteractionRequestInput[] = [];
    const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "test", {
      threadId: "thread_test", cliType: "codex",
      interactionBridge: {
        async request(input) { requests.push(input); return JSON.stringify(response); },
        cancel() {},
      },
    }));
    const item = chunks.map(chunk => JSON.parse(chunk.data)).find(data => data.item?.id === "response").item;
    return { requests, reply: JSON.parse(item.text) };
  }

  it("bridges permission requests with the requested permissions and selected scope", async () => {
    const permissions = { network: { enabled: true }, fileSystem: null };
    const { requests, reply } = await interactionCase("item/permissions/requestApproval", { permissions }, { decision: "allow-always" });
    expect(reply.result).toEqual({ permissions: { network: { enabled: true } }, scope: "session" });
    expect(JSON.parse(requests[0]!.payloadJson)).toMatchObject({ permissions });
  });

  it.each(["accept", "decline", "cancel"])("bridges MCP form %s", async (action) => {
    const content = { count: 3, enabled: false };
    const { reply } = await interactionCase("mcpServer/elicitation/request", {
      mode: "form", serverName: "test", message: "Details", requestedSchema: {
        type: "object", properties: { count: { type: "integer" }, enabled: { type: "boolean" } }, required: ["count"],
      },
    }, { action, content });
    expect(reply.result).toEqual({ action, content: action === "accept" ? content : null, _meta: null });
  });

  it("preserves available approval decisions and permission context", async () => {
    const amendment = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["pnpm", "test"] } };
    const params = { availableDecisions: [amendment, "decline"], proposedExecpolicyAmendment: ["pnpm", "test"], networkApprovalContext: { host: "example.com", protocol: "https" }, additionalPermissions: { network: { enabled: true } } };
    const { reply, requests } = await interactionCase("item/commandExecution/requestApproval", params, { decisionIndex: 0 });
    expect(reply.result).toEqual({ decision: amendment });
    expect(JSON.parse(requests[0]!.payloadJson)).toMatchObject(params);
  });

  it("does not accept choices absent from availableDecisions", async () => {
    const { reply } = await interactionCase("item/commandExecution/requestApproval", { availableDecisions: ["decline"] }, { decision: "allow-always" });
    expect(reply.result).toEqual({ decision: "decline" });
  });

  it("preserves nonblocking requests and question IDs in the bridge", async () => {
    const { reply, requests } = await interactionCase("item/tool/requestUserInput", { isBlocking: false, questions: [{ id: "q", question: "Pick?", isOther: false, isSecret: true }] }, { answers: { q: "value" } });
    expect(JSON.parse(requests[0]!.payloadJson)).toMatchObject({ isBlocking: false, questions: [{ id: "q", isOther: false, isSecret: true }] });
    expect(reply.result).toEqual({ answers: { q: { answers: ["value"] } } });
  });

  it("preserves child approval changes when root and child reuse an item ID", async () => {
    process.env.FAKE_BEHAVIOR = "child-file-approval";
    const { bridge, requests } = createBridge("allow");
    await collectChunks(
      createCodexAppServerRunner().execute(tmpDir, "hi", {
        threadId: "thread_test",
        cliType: "codex",
        interactionBridge: bridge,
      })
    );
    const payload = JSON.parse(requests[0]!.payloadJson);
    expect(JSON.parse(payload.inputJson).changes).toEqual([
      { path: "child-a.ts", diff: "+ child edit" },
    ]);
  });

  it("classifies early notifications only after root identity is known", async () => {
    process.env.FAKE_BEHAVIOR = "early-notifications";
    const { chunks, result } = await collectChunks(
      createCodexAppServerRunner().execute(tmpDir, "hi", {
        threadId: "thread_test",
        cliType: "codex",
        interactionBridge: createBridge("allow").bridge,
      })
    );
    expect(result).toEqual({ continuationId: "t-app-1", turnId: "turn-1" });
    expect(
      chunks.some(
        (chunk) =>
          chunk.type === "thread/tokenUsage/updated" &&
          JSON.parse(chunk.data).tokenUsage.total.totalTokens === 77
      )
    ).toBe(true);
    expect(
      chunks.some(
        (chunk) => chunk.type === "convoy/child" && chunk.data.includes("child failed early")
      )
    ).toBe(true);
    expect(chunks.filter((chunk) => chunk.type === "turn/completed")).toHaveLength(1);
  });

  it.each([
    "child-start",
    "child-completion",
    "child-error",
    "child-usage",
    "child-stale-root",
    "child-malformed-root",
  ])("isolates %s from root steering, completion, and accounting", async (behavior) => {
    process.env.FAKE_BEHAVIOR = behavior;
    const runner = createCodexAppServerRunner();
    let steered = false;
    const { chunks, result } = await collectChunks(
      runner.execute(tmpDir, "hi", {
        threadId: "thread_test",
        cliType: "codex",
        steerEnabled: true,
        interactionBridge: {
          async request() {
            steered = await runner.steer!({ prompt: "keep going", inputFormat: "prompt" });
            return JSON.stringify({ decision: "allow" });
          },
          cancel() {},
        },
      })
    );
    expect(steered).toBe(true);
    expect(result).toEqual({ continuationId: "t-app-1", turnId: "turn-1" });
    expect(chunks.filter((chunk) => chunk.type === "turn/completed")).toHaveLength(1);
    expect(chunks.filter((chunk) => chunk.type === "thread/tokenUsage/updated")).toHaveLength(1);
    expect(
      chunks.some(
        (chunk) => chunk.type === "item/completed" && chunk.data.includes('"text":"done"')
      )
    ).toBe(true);
    expect(await runner.steer!({ prompt: "late", inputFormat: "prompt" })).toBe(false);
  });

  it.each([
    { resolvedCliModel: undefined, continuationId: undefined, expected: "gpt-5.5" },
    { resolvedCliModel: "gpt-6-astra", continuationId: undefined, expected: "gpt-6-astra" },
    { resolvedCliModel: "gpt-5.6-sol", continuationId: "resumed-thread", expected: "gpt-5.6-sol" },
  ])("reports the resolved startup model $expected", async ({ expected, ...options }) => {
    const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", {
      threadId: "thread_test", cliType: "codex", ...options,
      interactionBridge: createBridge("allow").bridge,
    }));
    expect(JSON.parse(chunks.find((chunk) => chunk.type === "thread/started")!.data)).toEqual({
      thread: { id: options.continuationId ?? "t-app-1" }, model: expected,
    });
  });

  it.each(["initialize", "thread/start", "thread/resume", "turn/start"])(
    "preserves startup diagnostics when exiting during %s", async (method) => {
      vi.stubEnv("FAKE_EXIT_METHOD", method);
      vi.stubEnv("FAKE_DIAGNOSTIC", "Error loading configuration: CODEX_HOME does not exist\n");
      const run = collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", {
        threadId: "thread_test", cliType: "codex",
        ...(method === "thread/resume" ? { continuationId: "existing-thread" } : {}),
      }));
      await expect(run).rejects.toThrow(/exit code 7.*CODEX_HOME does not exist/);
      await expect(run).rejects.not.toThrow(/codex login/);
      if (method === "thread/resume") await expect(run).rejects.toMatchObject({ continuationId: "existing-thread" });
    }
  );

  it.each([false, true])("reports an unexplained exit, signal=%s", async (signal) => {
    vi.stubEnv("FAKE_EXIT_METHOD", "initialize");
    if (signal) vi.stubEnv("FAKE_EXIT_SIGNAL", "1");
    const run = collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex" }));
    await expect(run).rejects.toThrow(signal ? /signal SIGTERM/ : /exit code 7/);
    await expect(run).rejects.not.toThrow(/authentication|codex login/i);
  });

  it("explains confirmed missing native authentication", async () => {
    process.env.FAKE_BEHAVIOR = "no-login";
    const run = collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex" }));
    await expect(run).rejects.toThrow(/not authenticated/);
    await expect(run).rejects.toThrow(/project.*shell.*codex login --device-auth/);
    await expect(run).rejects.toThrow(/managed OpenAI API key/);
  });

  it("allows a provider that explicitly requires no OpenAI authentication", async () => {
    process.env.FAKE_BEHAVIOR = "no-auth-required";
    await expect(collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", {
      threadId: "thread_test", cliType: "codex", interactionBridge: createBridge("allow").bridge,
    }))).resolves.toHaveProperty("result.continuationId", "t-app-1");
  });

  it.each([undefined, { mode: "managed" as const, secret: "managed-sentinel" }])(
    "sanitizes startup diagnostics before errors and debug logging: %s", async (codexAuth) => {
      vi.stubEnv("FAKE_EXIT_METHOD", "initialize");
      vi.stubEnv("FAKE_DIAGNOSTIC", 'invalid API key: sk-proj-secret1234567890 Authorization: Bearer bearer-sentinel "access_token":"access-sentinel" managed-sentinel\n');
      vi.stubEnv("CONVOY_CLI_DEBUG", "1");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const error = await collectChunks(createCodexAppServerRunner({ codexAuth }).execute(tmpDir, "hi", {
          threadId: "thread_test", cliType: "codex",
        })).catch((e: Error) => e);
        expect(error).toBeInstanceOf(RunnerExecutionError);
        const output = JSON.stringify([error instanceof Error ? error.message : error, log.mock.calls]);
        expect(output).not.toContain("secret1234567890");
        expect(output).not.toContain("bearer-sentinel");
        expect(output).not.toContain("access-sentinel");
        if (codexAuth) expect(output).not.toContain("managed-sentinel");
        expect(output).toContain("[redacted]");
        expect(output).toContain("authentication failed");
      } finally { log.mockRestore(); }
    }
  );

  it("bounds stderr including a huge unterminated line", async () => {
    vi.stubEnv("FAKE_EXIT_METHOD", "initialize");
    vi.stubEnv("FAKE_DIAGNOSTIC", "x".repeat(60000));
    const error = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", {
      threadId: "thread_test", cliType: "codex",
    })).catch((e: Error) => e);
    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as Error).message).toContain("diagnostic line omitted");
    expect((error as Error).message.length).toBeLessThan(8000);
  });

  it("preserves an RPC authentication error and redacts its key", async () => {
    vi.stubEnv("FAKE_ERROR_METHOD", "thread/start");
    vi.stubEnv("FAKE_DIAGNOSTIC", "Incorrect API key: sk-proj-rpc-secret");
    const run = collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex" }));
    await expect(run).rejects.toThrow(/thread\/start: Incorrect API key/);
    await expect(run).rejects.toThrow(/authentication failed/);
    await expect(run).rejects.not.toThrow(/rpc-secret/);
  });

  it("shutdown waits for the app-server process to exit", async () => {
    const file = join(tmpDir, "codex");
    const pidFile = join(tmpDir, "pid");
    writeFileSync(file, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${FAKE_APP_SERVER}`);
    const runner = createCodexAppServerRunner();
    const execution = runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex" });
    try {
      await execution.next();
      const pid = Number(readFileSync(pidFile, "utf8"));
      vi.useFakeTimers();
      const shutdown = runner.shutdown();
      await vi.advanceTimersByTimeAsync(5_000);
      await shutdown;
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      runner.abort();
      await execution.return({}).catch(() => {});
      vi.useRealTimers();
    }
  });

  it("keeps user cancellation distinct from a process failure", async () => {
    const runner = createCodexAppServerRunner();
    const run = collectChunks(runner.execute(tmpDir, "hi", {
      threadId: "thread_test", cliType: "codex", interactionBridge: {
        async request() { runner.abort(); throw new Error("canceled"); },
        cancel() {},
      },
    }));
    await expect(run).rejects.toMatchObject({ message: "Codex run aborted", continuationId: "t-app-1" });
  });

  it("classifies a missing-cwd spawn failure before the agent starts", async () => {
    const runner = createCodexAppServerRunner();
    try {
      await expect(collectChunks(runner.execute(join(tmpDir, "missing"), "hello", {
        cliType: "codex", threadId: "thread_test",
      }))).rejects.toMatchObject({ launchFailed: true });
    } finally {
      await runner.shutdown();
    }
  });

  it("forwards confirmed model reroutes in stream order", async () => {
    process.env.FAKE_BEHAVIOR = "rerouted";
    const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", {
      threadId: "thread_test", cliType: "codex", interactionBridge: createBridge("allow").bridge,
    }));
    const index = chunks.findIndex((chunk) => chunk.type === "model/rerouted");
    expect(index).toBeGreaterThan(-1);
    expect(JSON.parse(chunks[index]!.data)).toMatchObject({ toModel: "gpt-6-astra", turnId: "turn-1" });
    expect(chunks[index + 1]?.type).toBe("thread/tokenUsage/updated");
  });

  it("runs a turn end-to-end with an approval round-trip", async () => {
    const { bridge, requests } = createBridge("allow");
    const runner = createCodexAppServerRunner();
    const { chunks, result } = await collectChunks(
      runner.execute(tmpDir, "hi", {
        threadId: "thread_test",
        cliType: "codex",
        cliMode: "default",
        interactionBridge: bridge,
      })
    );

    expect(result).toEqual({ continuationId: "t-app-1", turnId: "turn-1" });
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "thread/started",
      "convoy.commands",
      "turn/started",
      "convoy/background_tasks",
      "item/started",
      "convoy/background_tasks",
      "item/completed",
      // Plan snapshots forward regardless of the partial-streaming flag.
      "turn/plan/updated",
      "item/completed",
      "thread/tokenUsage/updated",
      "turn/completed",
    ]);

    expect(chunks.filter((chunk) => chunk.type === "convoy/background_tasks")
      .map((chunk) => JSON.parse(chunk.data))).toEqual([
      { session_id: "t-app-1", total_count: 1, tasks: [{ task_id: "command:call-1", task_type: "local_bash", description: "touch x" }] },
      { session_id: "t-app-1", total_count: 0, tasks: [] },
    ]);

    // The bridge saw a Shell tool approval and codex got "accept" back.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.kind).toBe("tool-approval");
    const payload = JSON.parse(requests[0]!.payloadJson) as { toolName: string };
    expect(payload.toolName).toBe("Shell");
    const commandChunk = chunks.find(
      (chunk) => chunk.type === "item/completed" && chunk.data.includes("decision:")
    );
    expect(commandChunk?.data).toContain("decision:accept");
  });

  it.each([undefined, "existing-session"])("reads /usage without opening a thread or executing a model: %s", async continuationId => {
    process.env.FAKE_BEHAVIOR = "usage-auth-notifications";
    const log = join(tmpDir, "usage-rpcs");
    process.env.FAKE_RPC_LOG = log;
    try {
      const { chunks, result } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "/usage", {
        threadId: "thread_test", cliType: "codex", continuationId,
        runtimeCommand: { command: "usage" },
      }));
      expect(result).toEqual({ continuationId });
      const report = chunks.find(chunk => chunk.type === "convoy.account_usage");
      expect(report).toBeDefined();
      expect(JSON.parse(report!.data)).toMatchObject({
        account: expect.any(String), refreshedAt: expect.any(Number),
        buckets: [{ id: "codex", windows: [{ name: "primary", usedPercent: 25 }] }],
      });
      const methods = readFileSync(log, "utf8").trim().split("\n");
      expect(methods).toContain("account/rateLimits/read");
      expect(methods).not.toContain("thread/start");
      expect(methods).not.toContain("thread/resume");
      expect(methods).not.toContain("turn/start");
      expect(methods).not.toContain("model/list");
    } finally {
      delete process.env.FAKE_RPC_LOG;
    }
  });

  it.each(["no-login", "rpc-error", "arguments"])("fails /usage without model execution: %s", async behavior => {
    const log = join(tmpDir, "usage-error-rpcs");
    process.env.FAKE_RPC_LOG = log;
    if (behavior === "no-login") process.env.FAKE_BEHAVIOR = behavior;
    if (behavior === "rpc-error") {
      process.env.FAKE_ERROR_METHOD = "account/rateLimits/read";
      process.env.FAKE_DIAGNOSTIC = "quota unavailable";
    }
    try {
      await expect(collectChunks(createCodexAppServerRunner().execute(tmpDir, "/usage", {
        threadId: "thread_test", cliType: "codex",
        runtimeCommand: { command: "usage", ...(behavior === "arguments" ? { arguments: "extra" } : {}) },
      }))).rejects.toThrow(behavior === "no-login" ? /ChatGPT login/ : behavior === "rpc-error" ? /quota unavailable/ : /does not accept arguments/);
      const methods = readFileSync(log, "utf8");
      expect(methods).not.toContain("thread/start");
      expect(methods).not.toContain("turn/start");
    } finally {
      delete process.env.FAKE_RPC_LOG;
      delete process.env.FAKE_ERROR_METHOD;
      delete process.env.FAKE_DIAGNOSTIC;
    }
  });

  it("runs /compact through thread/compact/start, not turn/start (OS-1582)", async () => {
    const { bridge } = createBridge("allow");
    const runner = createCodexAppServerRunner();
    const { chunks, result } = await collectChunks(
      runner.execute(tmpDir, "/compact", {
        threadId: "thread_test",
        cliType: "codex",
        runtimeCommand: { command: "compact" },
        interactionBridge: bridge,
      })
    );

    expect(result).toEqual({ continuationId: "t-app-1", turnId: "turn-compact" });
    // A real compaction: the contextCompaction item is what the web renders
    // as "Conversation compacted". The prose path produced an agentMessage
    // saying "Context compacted." and no compaction item at all.
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "thread/started",
      "convoy.commands",
      "turn/started",
      "item/started",
      "item/completed",
      "turn/completed",
    ]);
    const compactionItems = chunks.filter((chunk) =>
      chunk.data.includes("contextCompaction")
    );
    expect(compactionItems).toHaveLength(2);
    expect(chunks.some((chunk) => chunk.data.includes("agentMessage"))).toBe(false);
  });

  it("advertises the executable command inventory for the composer (OS-1582)", async () => {
    const { bridge } = createBridge("allow");
    const runner = createCodexAppServerRunner();
    const { chunks } = await collectChunks(
      runner.execute(tmpDir, "hi", {
        threadId: "thread_test",
        cliType: "codex",
        interactionBridge: bridge,
      })
    );

    const inventory = chunks.find((chunk) => chunk.type === "convoy.commands");
    expect(inventory).toBeDefined();
    expect(JSON.parse(inventory!.data)).toEqual({ commands: ["compact", "usage", expect.objectContaining({ name: "goal" })] });
  });

  it("fails a command the runner cannot map to an RPC", async () => {
    const { bridge } = createBridge("allow");
    const runner = createCodexAppServerRunner();
    const gen = runner.execute(tmpDir, "/nope", {
      threadId: "thread_test",
      cliType: "codex",
      runtimeCommand: { command: "nope" },
      interactionBridge: bridge,
    });

    let error: unknown;
    try {
      await collectChunks(gen);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("/nope");
  });

  it("uses the advertised default when opening a thread returns no model", async () => {
    process.env.FAKE_BEHAVIOR = "no-model";
    const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "Plan", { threadId: "thread_test", cliType: "codex", cliMode: "plan" }));
    const echo = chunks.find(chunk => chunk.data.includes("di-echo:"));
    expect(echo?.data).toContain("gpt-5.5");
    const started = chunks.find(chunk => chunk.type === "thread/started");
    expect(JSON.parse(started!.data).model).toBe("gpt-5.5");
  });

  it.each(["no-model-empty-catalog", "no-model-rejected-catalog"])("runs compact without model resolution: %s", async behavior => {
    process.env.FAKE_BEHAVIOR = behavior;
    const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "/compact", {
      threadId: "thread_test",
      cliType: "codex",
      continuationId: "existing-thread",
      runtimeCommand: { command: "compact" },
    }));
    expect(chunks.some(chunk => chunk.data.includes("contextCompaction"))).toBe(true);
  });

  it.each(["plan", "agent"] as const)("rejects an unknown resumed model in %s instead of selecting the catalog default", async cliMode => {
    process.env.FAKE_BEHAVIOR = "no-model";
    await expect(collectChunks(createCodexAppServerRunner().execute(tmpDir, "Continue", {
      threadId: "thread_test", cliType: "codex", cliMode, continuationId: "existing-thread",
    }))).rejects.toThrow("Codex did not report the resumed thread's model. Select a model explicitly to continue.");
  });

  it("uses an explicit model when a resumed thread omits its model", async () => {
    process.env.FAKE_BEHAVIOR = "no-model";
    const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "Continue", {
      threadId: "thread_test", cliType: "codex", cliMode: "agent",
      continuationId: "existing-thread", resolvedCliModel: "gpt-5.4",
    }));
    expect(JSON.parse(chunks.find(chunk => chunk.type === "thread/started")!.data).model).toBe("gpt-5.4");
    const echo = chunks.find(chunk => chunk.data.includes("di-echo:"));
    expect(echo?.data).toContain("gpt-5.4");
    expect(echo?.data).toContain("default");
  });

  it.each(["plan", "agent"] as const)("fails explicitly when the catalog lookup is rejected in %s", async cliMode => {
    process.env.FAKE_BEHAVIOR = "no-model-rejected-catalog";
    await expect(collectChunks(createCodexAppServerRunner().execute(tmpDir, "Continue", {
      threadId: "thread_test", cliType: "codex", cliMode,
    }))).rejects.toThrow("Could not resolve the Codex model: model/list: catalog unavailable");
  });

  it.each(["plan", "agent"] as const)("fails explicitly when the catalog is empty in %s", async cliMode => {
    process.env.FAKE_BEHAVIOR = "no-model-empty-catalog";
    await expect(collectChunks(createCodexAppServerRunner().execute(tmpDir, "Continue", {
      threadId: "thread_test", cliType: "codex", cliMode,
    }))).rejects.toThrow("Codex did not resolve a model");
  });

  it("forwards delta chunks only when partial streaming is enabled", async () => {
    const { bridge } = createBridge("allow");

    const withStreaming = createCodexAppServerRunner({ partialStreaming: true });
    const streamed = await collectChunks(
      withStreaming.execute(tmpDir, "hi", {
        threadId: "thread_test",
        cliType: "codex",
        interactionBridge: bridge,
      })
    );
    expect(
      streamed.chunks.some((chunk) => chunk.type === "item/agentMessage/delta")
    ).toBe(true);

    const withoutStreaming = createCodexAppServerRunner();
    const plain = await collectChunks(
      withoutStreaming.execute(tmpDir, "hi", {
        threadId: "thread_test",
        cliType: "codex",
        interactionBridge: bridge,
      })
    );
    expect(
      plain.chunks.some((chunk) => chunk.type === "item/agentMessage/delta")
    ).toBe(false);
    expect(
      plain.chunks.some((chunk) => chunk.type === "turn/plan/updated")
    ).toBe(true);
  });

  it("survives the idle timeout while parked on a bridge request (OS-1463)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let answerRequest: ((responseJson: string) => void) | null = null;
      // Read through a function: TS cannot see the closure assignment above
      // and narrows the direct read to `never` at the call site.
      const getAnswerRequest = () => answerRequest;
      let parkedResolve: (() => void) | undefined;
      const parked = new Promise<void>((resolve) => {
        parkedResolve = resolve;
      });
      const bridge: InteractionBridge = {
        request: () =>
          new Promise<string>((resolve) => {
            answerRequest = resolve;
            parkedResolve?.();
          }),
        cancel() {},
      };

      const runner = createCodexAppServerRunner();
      const collecting = collectChunks(
        runner.execute(tmpDir, "hi", {
          threadId: "thread_test",
          cliType: "codex",
          cliMode: "default",
          interactionBridge: bridge,
        })
      );
      collecting.catch(() => {});

      await parked;
      // Well past IDLE_TIMEOUT_MS (10 min) — the user is still deciding. The
      // watchdog must re-arm instead of SIGKILLing the parked run.
      await vi.advanceTimersByTimeAsync(25 * 60_000);

      getAnswerRequest()?.(JSON.stringify({ decision: "allow" }));
      const { chunks } = await collecting;

      const commandChunk = chunks.find(
        (chunk) => chunk.type === "item/completed" && chunk.data.includes("decision:")
      );
      expect(commandChunk?.data).toContain("decision:accept");
    } finally {
      vi.useRealTimers();
    }
  });

  it("declines approvals when the connection has no interaction bridge", async () => {
    const runner = createCodexAppServerRunner();
    const { chunks } = await collectChunks(
      runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex", cliMode: "default" })
    );

    const commandChunk = chunks.find(
      (chunk) => chunk.type === "item/completed" && chunk.data.includes("decision:")
    );
    expect(commandChunk?.data).toContain("decision:decline");
  });

  it("steers the active turn via turn/steer and falls back once the run ended", async () => {
    const runner = createCodexAppServerRunner();
    let midRunSteer: boolean | undefined;
    // The parked approval is the mid-turn hook: steer while codex waits.
    const bridge: InteractionBridge = {
      async request() {
        midRunSteer = await runner.steer?.({ prompt: "also do y", inputFormat: "prompt" });
        return JSON.stringify({ decision: "allow" });
      },
      cancel() {},
    };

    const { chunks } = await collectChunks(
      runner.execute(tmpDir, "hi", {
        threadId: "thread_test",
        cliType: "codex",
        cliMode: "default",
        interactionBridge: bridge,
        steerEnabled: true,
      })
    );

    expect(midRunSteer).toBe(true);
    expect(
      chunks.some(
        (chunk) => chunk.type === "item/completed" && chunk.data.includes("steered:also do y")
      )
    ).toBe(true);

    // No active run anymore: the message stays queued for the next run.
    expect(await runner.steer?.({ prompt: "late", inputFormat: "prompt" })).toBe(false);
  });

  describe("native goals (OS-2277)", () => {
    const goalCommand = (args?: string) => ({ command: "goal", ...(args ? { arguments: args } : {}) });
    function useGoalLog(): () => Array<[string, Record<string, unknown>]> {
      const log = join(tmpDir, "goal.log");
      vi.stubEnv("FAKE_GOAL_LOG", log);
      return () => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    }
    const methods = (calls: Array<[string, Record<string, unknown>]>) => calls.map(([method]) => method);
    const rootTurns = (chunks: ContentChunk[], type: string) =>
      chunks.filter((chunk) => chunk.type === type).map((chunk) => JSON.parse(chunk.data).turn.id);
    const goalChunks = (chunks: ContentChunk[]) =>
      chunks.filter((chunk) => chunk.type.includes("goal")).map((chunk) => [chunk.type, JSON.parse(chunk.data)]);

    it("sets a goal after thread/resume and the mode, and adopts the goal turns Codex starts, in one run (C1, C2)", async () => {
      process.env.FAKE_BEHAVIOR = "goal";
      const calls = useGoalLog();
      const runner = createCodexAppServerRunner();
      const { chunks, result } = await collectChunks(runner.execute(tmpDir, "/goal count.txt holds 3", {
        threadId: "thread_test", cliType: "codex", continuationId: "t-app-1", runtimeCommand: goalCommand("count.txt holds 3"),
      }));

      const sent = methods(calls());
      expect(sent).not.toContain("turn/start");
      expect(sent.filter((method) => method.startsWith("thread/"))).toEqual(
        ["thread/goal/get", "thread/resume", "thread/settings/update", "thread/goal/set"]);
      expect(rootTurns(chunks, "turn/started")).toEqual(["goal-turn-1", "goal-turn-2", "goal-turn-3"]);
      expect(rootTurns(chunks, "turn/completed")).toEqual(["goal-turn-1", "goal-turn-2", "goal-turn-3"]);
      // Usage-only ticks, the set echo, and the child goal stay local; only "complete" is forwarded.
      expect(goalChunks(chunks)).toMatchObject([
        ["convoy/goal/snapshot", { action: "set", goal: { objective: "count.txt holds 3", status: "active" } }],
        ["thread/goal/updated", { threadId: "t-app-1", goal: { status: "complete" }, convoyRootThreadId: "t-app-1" }],
      ]);
      expect(result).toEqual({ continuationId: "t-app-1", turnId: "goal-turn-3" });
    });

    it("sets a goal on a new thread after thread/start without sending turn/start", async () => {
      process.env.FAKE_BEHAVIOR = "goal";
      const calls = useGoalLog();
      const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "/goal count.txt holds 3", {
        threadId: "thread_test", cliType: "codex", runtimeCommand: goalCommand("count.txt holds 3"),
      }));
      const sent = methods(calls());
      expect(sent.slice(sent.indexOf("thread/start"))).toEqual(["thread/start", "thread/settings/update", "thread/goal/set"]);
      expect(rootTurns(chunks, "turn/completed")).toHaveLength(3);
    });

    it.each([
      [undefined, "read", []],
      ["pause", "pause", ["thread/goal/set"]],
      ["clear", "clear", ["thread/goal/clear"]],
    ])("answers /goal %s without opening the thread (R1, R2)", async (args, action, extra) => {
      process.env.FAKE_BEHAVIOR = "goal";
      process.env.FAKE_GOAL_STATUS = "active";
      const calls = useGoalLog();
      try {
        const { chunks, result } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "/goal", {
          threadId: "thread_test", cliType: "codex", continuationId: "t-app-1", runtimeCommand: goalCommand(args),
        }));
        expect(methods(calls()).filter((method) => method.startsWith("thread/") || method.startsWith("turn/")))
          .toEqual(["thread/goal/get", ...extra]);
        expect(chunks.map((chunk) => chunk.type)).toEqual(["convoy.commands", "convoy/goal/snapshot"]);
        expect(goalChunks(chunks)[0]![1]).toMatchObject({ action });
        expect(result).toEqual({ continuationId: "t-app-1" });
      } finally {
        delete process.env.FAKE_GOAL_STATUS;
      }
    });

    it("pauses an active goal before a plain message reopens the thread (C6)", async () => {
      process.env.FAKE_BEHAVIOR = "goal";
      process.env.FAKE_GOAL_STATUS = "active";
      const calls = useGoalLog();
      try {
        const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "what is in count.txt?", {
          threadId: "thread_test", cliType: "codex", continuationId: "t-app-1", resolvedCliModel: "gpt-5.5",
        }));
        const sent = calls().filter(([method]) => method.startsWith("thread/") || method.startsWith("turn/"));
        expect(sent).toMatchObject([
          ["thread/goal/get", { threadId: "t-app-1" }],
          ["thread/goal/set", { threadId: "t-app-1", status: "paused", origin: "automatic" }],
          ["thread/resume", {}],
          ["turn/start", {}],
        ]);
        expect(rootTurns(chunks, "turn/started")).toEqual(["turn-1"]);
        expect(goalChunks(chunks)).toMatchObject([["convoy/goal/snapshot", { action: "auto-pause", goal: { status: "paused" } }]]);
      } finally {
        delete process.env.FAKE_GOAL_STATUS;
      }
    });

    it("resumes a paused goal after thread/resume and keeps the run open (C4)", async () => {
      process.env.FAKE_BEHAVIOR = "goal";
      process.env.FAKE_GOAL_STATUS = "paused";
      const calls = useGoalLog();
      try {
        const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "/goal resume", {
          threadId: "thread_test", cliType: "codex", continuationId: "t-app-1", runtimeCommand: goalCommand("resume"),
        }));
        const sent = methods(calls());
        expect(sent.indexOf("thread/resume")).toBeLessThan(sent.indexOf("thread/goal/set"));
        expect(sent).not.toContain("turn/start");
        expect(rootTurns(chunks, "turn/completed")).toHaveLength(3);
      } finally {
        delete process.env.FAKE_GOAL_STATUS;
      }
    });

    it("keeps an ordinary run open while a goal the model created stays active (C8)", async () => {
      process.env.FAKE_BEHAVIOR = "goal-model";
      const { chunks, result } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "work until done", {
        threadId: "thread_test", cliType: "codex", resolvedCliModel: "gpt-5.5",
      }));
      expect(rootTurns(chunks, "turn/started")).toEqual(["turn-1", "goal-turn-1", "goal-turn-2", "goal-turn-3"]);
      expect(result).toMatchObject({ turnId: "goal-turn-3" });
    });

    it("fails the run when Codex does not continue an active goal", async () => {
      process.env.FAKE_BEHAVIOR = "goal-stall";
      const runner = createCodexAppServerRunner({ goalContinuationMs: 100 });
      await expect(collectChunks(runner.execute(tmpDir, "/goal count.txt holds 3", {
        threadId: "thread_test", cliType: "codex", runtimeCommand: goalCommand("count.txt holds 3"),
      }))).rejects.toThrow(/did not start the next goal turn/);
    });

    it.each([
      ["goal-hang", { goalPaused: true }],
      ["goal-hang-pause-fails", { goalPaused: false }],
    ])("Stop interrupts, then pauses the goal without blocking termination: %s", async (behavior, report) => {
      process.env.FAKE_BEHAVIOR = behavior;
      const calls = useGoalLog();
      const runner = createCodexAppServerRunner();
      const run = runner.execute(tmpDir, "/goal count.txt holds 9", {
        threadId: "thread_test", cliType: "codex", runtimeCommand: goalCommand("count.txt holds 9"),
      });
      const consumed = (async () => {
        for (let step = await run.next(); !step.done; step = await run.next()) {
          if (step.value.type === "turn/started") runner.abort();
        }
      })();
      await expect(consumed).rejects.toThrow("Codex run aborted");
      const sent = calls().filter(([method]) => method === "turn/interrupt" || method === "thread/goal/set").slice(1);
      expect(sent).toMatchObject([
        ["turn/interrupt", { turnId: "goal-turn-1" }],
        ["thread/goal/set", { status: "paused", origin: "user" }],
      ]);
      expect(runner.stopReport?.()).toEqual(report);
    });

    it.each([
      [undefined, "plan", "plan"],
      ["t-app-1", "plan", "plan"],
      ["t-app-1", "agent", "default"],
    ] as const)("configures effort and mode before the goal turn starts (CR1 #3, CR2 #1): %s %s", async (continuationId, cliMode, mode) => {
      process.env.FAKE_BEHAVIOR = "goal";
      process.env.FAKE_GOAL_STATUS = continuationId ? "active" : "";
      const calls = useGoalLog();
      try {
        await collectChunks(createCodexAppServerRunner().execute(tmpDir, "/goal resume", {
          threadId: "thread_test", cliType: "codex", continuationId, cliMode, resolvedCliEffort: "high",
          runtimeCommand: goalCommand(continuationId ? "resume" : "count.txt holds 3"),
        }));
        const sent = calls();
        const settings = sent.findIndex(([method]) => method === "thread/settings/update");
        expect(sent[settings]?.[1]).toEqual({
          threadId: "t-app-1", effort: "high",
          collaborationMode: { mode, settings: { model: "gpt-5.5", reasoning_effort: "high", developer_instructions: null } },
        });
        const activeSet = sent.map(([method, params]) => method === "thread/goal/set" && params.status === "active").lastIndexOf(true);
        expect(settings).toBeLessThan(activeSet);
        expect(sent.filter(([method]) => method === "turn/started" || method === "turn/start")).toEqual([]);
      } finally {
        delete process.env.FAKE_GOAL_STATUS;
      }
    });

    it("reopens the thread when this Codex has no goal RPCs", async () => {
      process.env.FAKE_BEHAVIOR = "echo-instructions";
      const { chunks } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", {
        threadId: "thread_test", cliType: "codex", continuationId: "t-app-1", resolvedCliModel: "gpt-5.5",
      }));
      expect(chunks.some((chunk) => chunk.type === "turn/completed")).toBe(true);
    });

    it("does no goal handling on a branch (F1–F3)", async () => {
      process.env.FAKE_BEHAVIOR = "goal";
      const calls = useGoalLog();
      await collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", {
        threadId: "thread_test", cliType: "codex", continuationId: "t-app-1", forkTurnId: "turn-0", resolvedCliModel: "gpt-5.5",
      }));
      expect(methods(calls()).filter((method) => method.startsWith("thread/"))).toEqual(["thread/fork"]);
    });
  });

  describe("agent prompt delivery (developerInstructions)", () => {
    type InstructionsEcho = {
      open: { method: string; developerInstructions: string | null; lastTurnId?: string } | null;
      collaborationDeveloperInstructions: string | null;
    };

    async function runAndReadEcho(options: {
      agentPrompt?: string;
      workspaceNotice?: string;
      continuationId?: string;
      forkTurnId?: string;
      cliMode?: "plan";
      resolvedCliModel?: string;
    }): Promise<InstructionsEcho> {
      process.env.FAKE_BEHAVIOR = "echo-instructions";
      const runner = createCodexAppServerRunner();
      const { chunks } = await collectChunks(
        runner.execute(tmpDir, "hi", {
          threadId: "thread_test",
          cliType: "codex",
          agentName: "Reviewer",
          ...options,
        })
      );
      const echoChunk = chunks.find(
        (chunk) => chunk.type === "item/completed" && chunk.data.includes("di-echo:")
      );
      expect(echoChunk).toBeDefined();
      const item = (JSON.parse(echoChunk!.data) as { item: { text: string } }).item;
      return JSON.parse(item.text.slice("di-echo:".length)) as InstructionsEcho;
    }

    it("passes the agent prompt as developerInstructions on thread/start", async () => {
      const echo = await runAndReadEcho({ agentPrompt: "You are a reviewer." });
      expect(echo.open).toEqual({
        method: "thread/start",
        developerInstructions: `You are a reviewer.\n\n${IDENTITY_LINE}`,
      });
      expect(echo.collaborationDeveloperInstructions).toBeNull();
    });

    it("re-passes the agent prompt as developerInstructions on thread/resume", async () => {
      const echo = await runAndReadEcho({
        agentPrompt: "You are a reviewer.",
        continuationId: "t-resume-9",
        workspaceNotice: "Working directory recovered to /workspace.",
      });
      expect(echo.open).toEqual({
        method: "thread/resume",
        developerInstructions: `You are a reviewer.\n\n${IDENTITY_LINE}\n\nWorking directory recovered to /workspace.`,
      });
    });

    it("forks the parent thread through the copied turn instead of resuming it (OS-2073)", async () => {
      const echo = await runAndReadEcho({ agentPrompt: "You are a reviewer.", continuationId: "t-parent", forkTurnId: "turn-7" });
      expect(echo.open).toEqual({
        method: "thread/fork",
        lastTurnId: "turn-7",
        developerInstructions: `You are a reviewer.\n\n${IDENTITY_LINE}`,
      });
    });

    it("sends the thread identity as developerInstructions without an agent prompt (OS-1223)", async () => {
      const echo = await runAndReadEcho({});
      expect(echo.open).toEqual({
        method: "thread/start",
        developerInstructions: IDENTITY_LINE,
      });
    });

    it("preserves thread instructions and selects the built-in plan mode", async () => {
      const echo = await runAndReadEcho({
        agentPrompt: "You are a reviewer.",
        cliMode: "plan",
        resolvedCliModel: "gpt-5.5",
      });
      expect(echo.collaborationDeveloperInstructions).toBeNull();
      expect(echo.open?.developerInstructions).toBe(`You are a reviewer.\n\n${IDENTITY_LINE}`);
    });
  });

  it("a branched run continues on the forked thread and records its turn (OS-2073)", async () => {
    const { chunks, result } = await collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", {
      threadId: "thread_test", cliType: "codex", continuationId: "t-parent", forkTurnId: "turn-7",
      interactionBridge: createBridge("allow").bridge,
    }));
    expect(result).toEqual({ continuationId: "t-fork-1", turnId: "turn-1" });
    expect(JSON.parse(chunks.find((chunk) => chunk.type === "thread/started")!.data).thread).toEqual({ id: "t-fork-1" });
  });

  it("refuses to branch on a codex older than the fork RPC (OS-2073)", async () => {
    vi.stubEnv("FAKE_CODEX_VERSION", "0.155.0");
    const run = collectChunks(createCodexAppServerRunner().execute(tmpDir, "hi", {
      threadId: "thread_test", cliType: "codex", continuationId: "t-parent", forkTurnId: "turn-7",
    }));
    await expect(run).rejects.toThrow(/0\.156\.1/);
  });

  it("resumes an existing thread and returns its continuation id", async () => {
    const runner = createCodexAppServerRunner();
    const { chunks, result } = await collectChunks(
      runner.execute(tmpDir, "hi", {
        threadId: "thread_test",
        cliType: "codex",
        continuationId: "t-resume-7",
        interactionBridge: createBridge("allow").bridge,
      })
    );
    expect(result).toEqual({ continuationId: "t-resume-7", turnId: "turn-1" });
    expect(chunks.some((chunk) => chunk.type === "model/rerouted")).toBe(false);
    const usage = chunks.filter((chunk) => chunk.type === "thread/tokenUsage/updated");
    expect(JSON.parse(usage[0]!.data)).toMatchObject({ convoyUsageBaseline: true });
    expect(JSON.parse(usage[1]!.data)).not.toHaveProperty("convoyUsageBaseline");
  });

  it("fails the run when the turn completes with a failed status", async () => {
    process.env.FAKE_BEHAVIOR = "failed-turn";
    const runner = createCodexAppServerRunner();

    let error: unknown;
    try {
      await collectChunks(runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex" }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).message).toContain("usage limit reached");
    expect((error as RunnerExecutionError).continuationId).toBe("t-app-1");
  });

  it("fails with the exit detail when the server dies mid-turn", async () => {
    const file = join(tmpDir, "codex");
    writeFileSync(
      file,
      `#!/usr/bin/env node
const readline = require("node:readline");
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ id: msg.id, result: {} });
  if (msg.method === "account/read") send({ id: msg.id, error: { code: -32601, message: "unsupported" } });
  if (msg.method === "thread/start") send({ id: msg.id, result: { thread: { id: "t-1" }, model: "m" } });
  if (msg.method === "turn/start") { console.error("boom"); process.exit(5); }
});
`
    );
    chmodSync(file, 0o755);

    const runner = createCodexAppServerRunner();
    let error: unknown;
    try {
      await collectChunks(runner.execute(tmpDir, "hi", { threadId: "thread_test", cliType: "codex" }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).continuationId).toBe("t-1");
    expect((error as RunnerExecutionError).message).toMatch(/exit code 5.*boom/);
  });
});
