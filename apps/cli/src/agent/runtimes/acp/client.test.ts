import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createAcpClient, parseAcpConfigOptions } from "./client.js";

function createIo() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const written: Array<Record<string, unknown>> = [];
  stdin.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) if (line.trim()) written.push(JSON.parse(line));
  });
  return { io: { stdin, stdout }, written, receive: (message: object) => stdout.write(`${JSON.stringify(message)}\n`) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("createAcpClient", () => {
  it("sends ACP requests in the JSON-RPC 2.0 envelope and reads the results", async () => {
    const { io, written, receive } = createIo();
    const acp = createAcpClient(io, { onSessionUpdate: vi.fn(), onRequestPermission: vi.fn() }, "Agent");

    const opened = acp.newSession({ cwd: "/repo", _meta: { a: 1 } });
    await tick();
    expect(written[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/repo", mcpServers: [], _meta: { a: 1 } } });
    receive({ jsonrpc: "2.0", id: 1, result: { sessionId: "s-1" } });
    await expect(opened).resolves.toEqual({ sessionId: "s-1", configOptions: [] });

    const prompted = acp.prompt("s-1", [{ type: "text", text: "hi" }]);
    await tick();
    expect(written[1]).toMatchObject({ method: "session/prompt", params: { sessionId: "s-1", prompt: [{ type: "text", text: "hi" }] } });
    receive({ jsonrpc: "2.0", id: 2, result: { stopReason: "cancelled" } });
    await expect(prompted).resolves.toEqual({ stopReason: "cancelled" });

    acp.cancel("s-1");
    await tick();
    expect(written[2]).toEqual({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "s-1" } });
  });

  it("sets a config option and reads back the updated options", async () => {
    const { io, written, receive } = createIo();
    const acp = createAcpClient(io, { onSessionUpdate: vi.fn(), onRequestPermission: vi.fn() }, "Agent");

    const set = acp.setConfigOption("s-1", "model", "gemini-3.8-flash");
    await tick();
    expect(written[0]).toMatchObject({ method: "session/set_config_option", params: { sessionId: "s-1", configId: "model", value: "gemini-3.8-flash" } });
    receive({
      jsonrpc: "2.0",
      id: 1,
      result: { configOptions: [{ id: "thought_level", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }] }] },
    });
    await expect(set).resolves.toEqual([{ id: "thought_level", category: "thought_level", currentValue: "medium", options: [{ value: "low", name: "Low" }] }]);
  });

  it("flattens grouped config choices and skips malformed options", () => {
    expect(
      parseAcpConfigOptions([
        {
          id: "model",
          category: "model",
          type: "select",
          options: [{ group: "g", name: "Gemini", options: [{ value: "gemini-4-neon", name: "Gemini 4 Neon" }, { value: "" }] }, { value: "plain" }],
        },
        { id: "toggle", type: "boolean", currentValue: true },
        { type: "select", options: [] },
      ])
    ).toEqual([{ id: "model", category: "model", options: [{ value: "gemini-4-neon", name: "Gemini 4 Neon" }, { value: "plain", name: "plain" }] }]);
    expect(parseAcpConfigOptions(undefined)).toEqual([]);
  });

  it("routes session updates and permission requests, and refuses other agent requests", async () => {
    const { io, written, receive } = createIo();
    const onSessionUpdate = vi.fn();
    const acp = createAcpClient(io, { onSessionUpdate, onRequestPermission: async () => ({ outcome: { outcome: "cancelled" } }) }, "Agent");

    receive({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s-1", update: { sessionUpdate: "plan" } } });
    receive({ jsonrpc: "2.0", id: 7, method: "session/request_permission", params: {} });
    receive({ jsonrpc: "2.0", id: 8, method: "fs/read_text_file", params: {} });
    await tick();

    expect(onSessionUpdate).toHaveBeenCalledWith({ sessionId: "s-1", update: { sessionUpdate: "plan" } });
    expect(written).toContainEqual({ jsonrpc: "2.0", id: 7, result: { outcome: { outcome: "cancelled" } } });
    expect(written.find((message) => message.id === 8)).toMatchObject({ error: { code: -32601 } });
    acp.close();
  });

  it("hands the handler a typed request and answers a malformed one as cancelled", async () => {
    const { io, written, receive } = createIo();
    const onRequestPermission = vi.fn(async () => ({ outcome: { outcome: "selected" as const, optionId: "a" } }));
    const acp = createAcpClient(io, { onSessionUpdate: vi.fn(), onRequestPermission }, "Agent");
    const toolCall = { toolCallId: "call_1", name: "run_command", title: "ls" };

    receive({ jsonrpc: "2.0", id: 1, method: "session/request_permission", params: { sessionId: "s", toolCall, options: [{ optionId: "a", name: "Allow", kind: "allow_once" }] } });
    receive({ jsonrpc: "2.0", id: 2, method: "session/request_permission", params: { sessionId: "s", toolCall, options: [{ optionId: "a", name: "A", kind: "allow_once" }, { optionId: "a", name: "B", kind: "reject_once" }] } });
    receive({ jsonrpc: "2.0", id: 3, method: "session/request_permission", params: { sessionId: "s", toolCall, options: [{ optionId: "", name: "A", kind: "allow_once" }] } });
    receive({ jsonrpc: "2.0", id: 4, method: "session/request_permission", params: { sessionId: "s", toolCall: {}, options: [{ optionId: "a", name: "A", kind: "allow_once" }] } });
    await tick();

    expect(onRequestPermission).toHaveBeenCalledTimes(1);
    expect(onRequestPermission).toHaveBeenCalledWith({ sessionId: "s", toolCall, options: [{ optionId: "a", name: "Allow", kind: "allow_once" }] });
    expect(written).toContainEqual({ jsonrpc: "2.0", id: 1, result: { outcome: { outcome: "selected", optionId: "a" } } });
    for (const id of [2, 3, 4]) expect(written).toContainEqual({ jsonrpc: "2.0", id, result: { outcome: { outcome: "cancelled" } } });
    acp.close();
  });
});
