import { describe, expect, it, vi } from "vitest";
import { createCodexInteractions } from "./interactions.js";
import type { InteractionRequestInput } from "../contracts.js";

function setup(response: unknown) {
  const requests: InteractionRequestInput[] = [];
  const signal = new AbortController();
  const cancel = vi.fn();
  const sendMessage = vi.fn().mockResolvedValue({});
  const pendingBlockingIds = new Set<string>();
  const interactions = createCodexInteractions({
    signal: signal.signal,
    pendingBlockingIds,
    sendMessage,
    bridge: {
      request: async (input) => {
        requests.push(input);
        return JSON.stringify(response);
      },
      cancel,
    },
  });
  return { interactions, requests, signal, cancel, sendMessage, pendingBlockingIds };
}

describe("Codex interactions", () => {
  it.each([
    [{ type: "string", format: "email" }, "invalid"],
    [{ type: "string", format: "uri" }, "invalid"],
    [{ type: "string", format: "date" }, "2026-99-99"],
    [{ type: "string", format: "date-time" }, "invalid"],
  ])("declines invalid MCP formatted fields %j", async (field, value) => {
    const { interactions } = setup({ action: "accept", content: { value } });
    const reply = await interactions.onRequest(
      "mcpServer/elicitation/request",
      {
        mode: "form",
        requestedSchema: { type: "object", properties: { value: field }, required: ["value"] },
      },
      1
    );
    expect(reply).toEqual({ action: "decline", content: null, _meta: null });
  });

  it("does not accept unknown elicitation modes", async () => {
    const { interactions } = setup({ action: "accept", content: {} });
    expect(
      await interactions.onRequest(
        "mcpServer/elicitation/request",
        {
          mode: "unknown",
          requestedSchema: { type: "object", properties: {} },
        },
        1
      )
    ).toEqual({ action: "decline", content: null, _meta: null });
  });

  it("does not accept unsafe elicitation URLs", async () => {
    const { interactions } = setup({ action: "accept" });
    expect(await interactions.onRequest("mcpServer/elicitation/request", { mode: "url", url: "javascript:alert(1)" }, 1)).toEqual({
      action: "decline",
      content: null,
      _meta: null,
    });
  });
});

describe("Codex interaction lifecycle", () => {
  const params = { threadId: "child", turnId: "turn", itemId: "item" };

  it.each([
    ["item/permissions/requestApproval", { permissions: { network: { enabled: true } } }, { permissions: {}, scope: "turn" }],
    ["mcpServer/elicitation/request", { mode: "url", url: "https://example.com" }, { action: "cancel", content: null, _meta: null }],
    ["item/commandExecution/requestApproval", {}, { decision: "cancel" }],
    ["item/tool/requestUserInput", { questions: [{ id: "q", question: "Choose" }] }, { answers: {} }],
  ])("stop releases %s without granting access", async (method, extra, expected) => {
    const controller = new AbortController();
    const pendingBlockingIds = new Set<string>();
    const cancel = vi.fn();
    const interactions = createCodexInteractions({
      signal: controller.signal,
      pendingBlockingIds,
      sendMessage: vi.fn(),
      bridge: {
        request: (_input, signal) =>
          new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")))),
        cancel,
      },
    });
    const response = interactions.onRequest(method, { ...params, ...extra }, 1);
    expect(pendingBlockingIds.size).toBe(1);
    controller.abort();
    expect(await response).toEqual(expected);
    expect(pendingBlockingIds.size).toBe(0);
    expect(cancel).toHaveBeenCalledWith(expect.any(String), { abandoned: true, reason: "run ended" });
  });

  it.each(["stop", "turn/completed"])("does not send a late async answer after %s", async (reason) => {
    const controller = new AbortController();
    let resolveAnswer: (value: string) => void = () => {};
    let requestSignal: AbortSignal | undefined;
    const sendMessage = vi.fn();
    const cancel = vi.fn();
    const pendingBlockingIds = new Set<string>();
    const interactions = createCodexInteractions({
      signal: controller.signal,
      pendingBlockingIds,
      sendMessage,
      bridge: {
        request: (_input, signal) => {
          requestSignal = signal;
          return new Promise((resolve) => {
            resolveAnswer = resolve;
          });
        },
        cancel,
      },
    });
    const item = { type: "agentMessage", id: "item", delivery: "async", questions: [{ title: "Choose", options: null }] };
    interactions.onNotification("item/completed", { ...params, item });
    expect(pendingBlockingIds.size).toBe(0);
    if (reason === "stop") controller.abort();
    else interactions.onNotification("turn/completed", { threadId: "child", turn: { id: "turn" } });
    expect(requestSignal?.aborted).toBe(true);
    resolveAnswer(JSON.stringify({ answers: { "item:0": "answer" } }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sendMessage).not.toHaveBeenCalled();
    if (reason !== "stop") expect(cancel).toHaveBeenCalledWith(expect.any(String), { abandoned: false, reason: "turn completed" });
  });

  it("grants only requested permissions even if the response includes broader access", async () => {
    const { interactions } = setup({ decision: "allow", permissions: { fileSystem: { write: ["/"] } } });
    expect(
      await interactions.onRequest("item/permissions/requestApproval", { permissions: { network: { enabled: true }, fileSystem: null } }, 1)
    ).toEqual({ permissions: { network: { enabled: true } }, scope: "turn" });
  });

  it.each(["item/tool/call", "account/chatgptAuthTokens/refresh"])("keeps %s a separate unsupported capability", async (method) => {
    const { interactions, requests } = setup({});
    await expect(interactions.onRequest(method, {}, 1)).rejects.toThrow("Unsupported codex app-server request");
    expect(requests).toHaveLength(0);
  });
});
