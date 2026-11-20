import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createAcpClient } from "./client.js";

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
    await expect(opened).resolves.toEqual({ sessionId: "s-1" });

    const prompted = acp.prompt("s-1", "hi");
    await tick();
    expect(written[1]).toMatchObject({ method: "session/prompt", params: { sessionId: "s-1", prompt: [{ type: "text", text: "hi" }] } });
    receive({ jsonrpc: "2.0", id: 2, result: { stopReason: "cancelled" } });
    await expect(prompted).resolves.toEqual({ stopReason: "cancelled" });

    acp.cancel("s-1");
    await tick();
    expect(written[2]).toEqual({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "s-1" } });
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
});
