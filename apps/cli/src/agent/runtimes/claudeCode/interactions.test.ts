import { describe, expect, it, vi } from "vitest";
import { createClaudeCanUseTool, createClaudeOnElicitation, toClaudePermissionMode } from "./interactions.js";
import type { InteractionBridge } from "../contracts.js";

function bridgeReturning(responseJson: string): InteractionBridge {
  return {
    request: async () => responseJson,
    cancel: () => {},
  };
}

const options = { signal: new AbortController().signal, toolUseID: "t1", requestId: "request-1" };

describe("toClaudePermissionMode", () => {
  it("maps agent/undefined to bypassPermissions and passes others through", () => {
    expect(toClaudePermissionMode(undefined)).toBe("bypassPermissions");
    expect(toClaudePermissionMode("agent")).toBe("bypassPermissions");
    expect(toClaudePermissionMode("default")).toBe("default");
    expect(toClaudePermissionMode("auto")).toBe("auto");
    expect(toClaudePermissionMode("plan")).toBe("plan");
  });
});

describe("createClaudeCanUseTool", () => {
  it.each([
    "not json", "null", "[]",
    JSON.stringify({ decision: "deny", nextMode: "agent" }),
    JSON.stringify({ nextMode: "agent" }),
  ])("never changes permissions for an unapproved plan response: %s", async response => {
    const setPermissionMode = vi.fn();
    const canUseTool = createClaudeCanUseTool({
      bridge: bridgeReturning(response),
      getActiveQuery: () => ({ setPermissionMode }) as never,
    });
    expect((await canUseTool("ExitPlanMode", { plan: "# Plan" }, options)).behavior).toBe("deny");
    expect(setPermissionMode).not.toHaveBeenCalled();
  });
  it.each([
    ["agent", "bypassPermissions"],
    ["auto", "auto"],
    ["default", "default"],
    [undefined, "default"],
    ["plan", "default"],
  ])("plan approval switches %s to SDK mode %s before continuing", async (nextMode, expected) => {
    const setPermissionMode = vi.fn().mockResolvedValue(undefined);
    const canUseTool = createClaudeCanUseTool({
      bridge: bridgeReturning(JSON.stringify({ decision: "approve", nextMode })),
      getActiveQuery: () => ({ setPermissionMode }) as never,
    });
    const input = { plan: "# Plan" };
    const result = await canUseTool("ExitPlanMode", input, options);
    expect(setPermissionMode).toHaveBeenCalledWith(expected);
    expect(result).toEqual({ behavior: "allow", updatedInput: input });
  });

  it("allow results always include updatedInput (bridge schema requires it)", async () => {
    const canUseTool = createClaudeCanUseTool({
      bridge: bridgeReturning(JSON.stringify({ decision: "allow" })),
      getActiveQuery: () => null,
    });

    const input = { file_path: "a.txt", content: "hello" };
    const result = await canUseTool("Write", input, options);
    expect(result).toEqual({ behavior: "allow", updatedInput: input });
  });

  it("deny results carry a message", async () => {
    const canUseTool = createClaudeCanUseTool({
      bridge: bridgeReturning(JSON.stringify({ decision: "deny" })),
      getActiveQuery: () => null,
    });

    const result = await canUseTool("Write", {}, options);
    expect(result).toMatchObject({ behavior: "deny" });
    if (result.behavior === "deny") {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("question answers return updatedInput with sanitized string labels", async () => {
    const canUseTool = createClaudeCanUseTool({
      bridge: bridgeReturning(
        JSON.stringify({ answers: { "Which one?": "Option A", bad: 42 } })
      ),
      getActiveQuery: () => null,
    });

    const input = { questions: [{ question: "Which one?", options: [] }] };
    const result = await canUseTool("AskUserQuestion", input, options);
    expect(result).toEqual({
      behavior: "allow",
      updatedInput: {
        questions: input.questions,
        answers: { "Which one?": "Option A" },
      },
    });
  });

  it("plan approval denies when the permission mode switch fails", async () => {
    const canUseTool = createClaudeCanUseTool({
      bridge: bridgeReturning(
        JSON.stringify({ decision: "approve", nextMode: "acceptEdits" })
      ),
      getActiveQuery: () =>
        ({
          setPermissionMode: async () => {
            throw new Error("no control channel");
          },
        }) as never,
    });

    const result = await canUseTool("ExitPlanMode", { plan: "# Plan" }, options);
    expect(result.behavior).toBe("deny");
  });

  it("aborted requests resolve to a deny", async () => {
    const canUseTool = createClaudeCanUseTool({
      bridge: {
        request: async () => {
          throw new Error("Approval request aborted");
        },
        cancel: () => {},
      },
      getActiveQuery: () => null,
    });

    const result = await canUseTool("Write", {}, options);
    expect(result.behavior).toBe("deny");
  });
});

describe("createClaudeOnElicitation", () => {
  const form = { serverName: "survey", message: "Count", requestedSchema: {
    type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 5 } }, required: ["count"],
  } };
  it.each([
    [{ action: "accept", content: { count: 3 } }, { action: "accept", content: { count: 3 } }],
    [{ action: "accept", content: { count: 0 } }, { action: "decline" }],
    [{ action: "accept", content: { count: "3" } }, { action: "decline" }],
    [{ action: "accept", content: {} }, { action: "decline" }],
    [{ action: "decline", content: { count: 3 } }, { action: "decline" }],
    [{ action: "cancel" }, { action: "cancel" }],
    [null, { action: "decline" }],
  ])("validates form responses %j", async (response, expected) => {
    const callback = createClaudeOnElicitation({ bridge: bridgeReturning(JSON.stringify(response)) });
    expect(await callback(form, options)).toEqual(expected);
  });
  it.each(["accept", "decline", "cancel"] as const)("preserves URL identity and %s without content or metadata", async (action) => {
    const request = vi.fn().mockResolvedValue(JSON.stringify({ action, content: { ignored: true }, _meta: { ignored: true } }));
    const callback = createClaudeOnElicitation({ bridge: { request, cancel: vi.fn() } });
    const input = { serverName: "login", message: "Connect", mode: "url" as const, url: "https://example.com/login", elicitationId: "login-1" };
    expect(await callback(input, options)).toEqual({ action });
    expect(JSON.parse(request.mock.calls[0][0].payloadJson)).toMatchObject(input);
  });
  it("declines malformed JSON and unsafe URL acceptance", async () => {
    expect(await createClaudeOnElicitation({ bridge: bridgeReturning("broken") })(form, options)).toEqual({ action: "decline" });
    expect(await createClaudeOnElicitation({ bridge: bridgeReturning('{"action":"accept"}') })({
      serverName: "login", message: "Connect", mode: "url", url: "javascript:alert(1)",
    }, options)).toEqual({ action: "decline" });
  });
  it("cancels an aborted wait and preserves the server wind-down signal", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const request = vi.fn((_input, signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const callback = createClaudeOnElicitation({ bridge: { request, cancel } });
    const response = callback(form, { signal: controller.signal, requestId: "request-1" });
    controller.abort();
    expect(await response).toEqual({ action: "cancel" });
    expect(cancel).toHaveBeenCalledWith(request.mock.calls[0][0].requestId, expect.objectContaining({ abandoned: true }));
    await callback(form, { signal: controller.signal, requestId: "request-2" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("cancels on bridge disconnection", async () => {
    const callback = createClaudeOnElicitation({ bridge: { request: async () => { throw new Error("disconnected"); }, cancel: vi.fn() } });
    expect(await callback(form, options)).toEqual({ action: "cancel" });
  });
});
