import { describe, expect, it, vi } from "vitest";
import type { InteractionBridge, InteractionRequestInput } from "../contracts.js";
import type { AcpPermissionRequest } from "../acp/client.js";
import { createAntigravityInteractions } from "./interactions.js";

// Shapes recorded from agy 1.5.13 in `default` mode (OS-2469); the question is t3code's capture.
const command: AcpPermissionRequest = {
  sessionId: "s",
  toolCall: {
    toolCallId: "call_1",
    name: "run_command",
    kind: "execute",
    status: "pending",
    title: "ls -la",
    rawInput: { CommandLine: "ls -la", WaitMsBeforeAsync: 5000, toolSummary: "List workspace files" },
  },
  options: [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "deny", name: "Deny", kind: "reject_once" },
  ],
};

const risky: AcpPermissionRequest = {
  ...command,
  options: [
    {
      optionId: "always",
      name: "Allow Always (risky)",
      kind: "allow_always",
      _meta: { "agy.security.warning": { title: "Allowing always can be risky", message: "Untrusted files could re-run this action." } },
    },
    ...command.options,
  ],
};

const question: AcpPermissionRequest = {
  sessionId: "s",
  toolCall: { toolCallId: "interaction_99", status: "pending", title: "Which label?", rawInput: {} },
  options: [
    { optionId: "1", name: "Verified", kind: "allow_once" },
    { optionId: "2", name: "Do not trust", kind: "reject_once" },
  ],
};

const cancelled = { outcome: { outcome: "cancelled" } };
const selected = (optionId: string) => ({ outcome: { outcome: "selected", optionId } });

/** A bridge whose requests wait until the test answers them. */
function fakeBridge() {
  const requests: Array<InteractionRequestInput & { payload: Record<string, unknown>; answer: (json: string) => void }> = [];
  const bridge: InteractionBridge = {
    request: (input, signal) =>
      new Promise<string>((resolve, reject) => {
        requests.push({ ...input, payload: JSON.parse(input.payloadJson) as Record<string, unknown>, answer: resolve });
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    cancel: vi.fn(),
  };
  return { bridge, requests };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function open(bridge?: InteractionBridge) {
  const run = new AbortController();
  const interactions = createAntigravityInteractions({ bridge, signal: run.signal });
  interactions.startPrompt();
  return { interactions, run };
}

async function answerApproval(request: AcpPermissionRequest, response: string) {
  const { bridge, requests } = fakeBridge();
  const { interactions } = open(bridge);
  const reply = interactions.onRequestPermission(request);
  await tick();
  requests[0]!.answer(response);
  return { reply: await reply, sent: requests[0]! };
}

describe("antigravity tool approvals", () => {
  it("asks the bridge with the command and no always button when agy offers none", async () => {
    const { reply, sent } = await answerApproval(command, JSON.stringify({ decision: "allow" }));
    expect(reply).toEqual(selected("allow"));
    expect(sent.kind).toBe("tool-approval");
    expect(sent.payload).toMatchObject({ toolName: "run_command", title: "Antigravity wants to run a command", hasSuggestions: false });
    expect(JSON.parse(sent.payload.inputJson as string)).toMatchObject({ command: "ls -la" });
  });

  it("maps each decision to an offered option by kind, never inventing an id", async () => {
    expect((await answerApproval(risky, JSON.stringify({ decision: "allow-always" }))).reply).toEqual(selected("always"));
    expect((await answerApproval(command, JSON.stringify({ decision: "allow-always" }))).reply).toEqual(selected("allow"));
    expect((await answerApproval(command, JSON.stringify({ decision: "deny" }))).reply).toEqual(selected("deny"));
    expect((await answerApproval({ ...command, options: [command.options[0]!] }, JSON.stringify({ decision: "deny" }))).reply).toEqual(cancelled);
    expect((await answerApproval(command, "not json")).reply).toEqual(cancelled);
  });

  it("shows the always button and agy's security warning when allow_always is offered", async () => {
    const { sent } = await answerApproval(risky, JSON.stringify({ decision: "deny" }));
    expect(sent.payload).toMatchObject({ hasSuggestions: true, description: "Untrusted files could re-run this action." });
  });
});

describe("antigravity questions", () => {
  it("asks one single-choice question without free text and answers by label", async () => {
    const { reply, sent } = await answerApproval(question, JSON.stringify({ answers: { interaction_99: "Do not trust" } }));
    expect(reply).toEqual(selected("2"));
    expect(sent.kind).toBe("question");
    expect(sent.payload).toEqual({
      toolName: "AskUserQuestion",
      questions: [
        {
          id: "interaction_99",
          header: "",
          question: "Which label?",
          multiSelect: false,
          isOther: false,
          options: [{ label: "Verified" }, { label: "Do not trust" }],
        },
      ],
    });
  });

  it("cancels an answer that matches no option or more than one", async () => {
    expect((await answerApproval(question, JSON.stringify({ answers: { interaction_99: "Other text" } }))).reply).toEqual(cancelled);
    const twins = { ...question, options: question.options.map((option) => ({ ...option, name: "Same" })) };
    expect((await answerApproval(twins, JSON.stringify({ answers: { interaction_99: "Same" } }))).reply).toEqual(cancelled);
  });
});

describe("antigravity interaction lifecycle", () => {
  it("keeps slice 1 answers without a bridge", async () => {
    const { interactions } = open(undefined);
    await expect(interactions.onRequestPermission(command)).resolves.toEqual(selected("allow"));
    await expect(interactions.onRequestPermission(question)).resolves.toEqual(cancelled);
  });

  it("cancels a request that arrives with no open prompt, without asking", async () => {
    const { bridge, requests } = fakeBridge();
    const { interactions } = open(bridge);
    interactions.endPrompt();
    await expect(interactions.onRequestPermission(command)).resolves.toEqual(cancelled);
    expect(requests).toEqual([]);
  });

  it("withdraws pending requests when the prompt ends, and abandons them when the run does", async () => {
    const { bridge, requests } = fakeBridge();
    const { interactions, run } = open(bridge);
    const withdrawn = interactions.onRequestPermission(command);
    await tick();
    expect(interactions.pendingCount()).toBe(1);
    interactions.endPrompt();
    await expect(withdrawn).resolves.toEqual(cancelled);
    expect(bridge.cancel).toHaveBeenCalledWith(requests[0]!.requestId, { abandoned: false, reason: "prompt ended" });

    interactions.startPrompt();
    const abandoned = interactions.onRequestPermission(question);
    await tick();
    run.abort();
    await expect(abandoned).resolves.toEqual(cancelled);
    expect(bridge.cancel).toHaveBeenLastCalledWith(requests[1]!.requestId, { abandoned: true, reason: "run ended" });
    expect(interactions.pendingCount()).toBe(0);
  });
});
