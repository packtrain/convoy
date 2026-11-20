import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createJsonRpc, JsonRpcError, type JsonRpcOptions } from "./json-rpc.js";

const CODEX: JsonRpcOptions = {
  label: "Codex app-server",
  serverRequestKey: (id, params) => JSON.stringify([params.threadId, id]),
  withdrawnRequestKey: (method, params) =>
    method === "serverRequest/resolved" ? JSON.stringify([params.threadId, params.requestId]) : undefined,
};

function createIo() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const written: string[] = [];
  stdin.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (line.trim()) {
        written.push(line);
      }
    }
  });
  return {
    io: { stdin, stdout },
    written,
    receive(message: Record<string, unknown>) {
      stdout.write(`${JSON.stringify(message)}\n`);
    },
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("createJsonRpc", () => {
  it("correlates responses to requests by id and resolves results", async () => {
    const { io, written, receive } = createIo();
    const rpc = createJsonRpc(io, {}, CODEX);

    const promise = rpc.request("thread/start", { cwd: "/tmp" });
    await tick();
    expect(JSON.parse(written[0]!)).toEqual({
      id: 1,
      method: "thread/start",
      params: { cwd: "/tmp" },
    });

    receive({ id: 1, result: { thread: { id: "t-1" } } });
    await expect(promise).resolves.toEqual({ thread: { id: "t-1" } });
  });

  it("rejects a request when the server replies with an error", async () => {
    const { io, receive } = createIo();
    const rpc = createJsonRpc(io, {}, CODEX);

    const promise = rpc.request("thread/resume", { threadId: "missing" });
    await tick();
    receive({ id: 1, error: { code: -32000, message: "thread not found" } });

    await expect(promise).rejects.toThrow(/thread\/resume: thread not found/);
    await expect(promise).rejects.toMatchObject({ code: -32000 });
  });

  it("stamps the JSON-RPC envelope when asked", async () => {
    const { io, written } = createIo();
    const rpc = createJsonRpc(io, {}, { label: "ACP agent", envelope: true });

    rpc.request("initialize", { protocolVersion: 1 }).catch(() => {});
    rpc.notify("session/cancel", { sessionId: "s-1" });
    await tick();
    expect(written.map((line) => JSON.parse(line))).toEqual([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } },
      { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "s-1" } },
    ]);
    rpc.close();
    await expect(rpc.request("session/new")).rejects.toThrow("ACP agent connection is closed");
  });

  it("answers a server request once per id without Codex options", async () => {
    const { io, written, receive } = createIo();
    createJsonRpc(io, { onRequest: async () => ({ ok: true }) }, { label: "ACP agent" });

    receive({ id: 4, method: "session/request_permission", params: { threadId: "a" } });
    receive({ id: 4, method: "session/request_permission", params: { threadId: "b" } });
    await tick();
    expect(written.map((line) => JSON.parse(line))).toEqual([{ id: 4, result: { ok: true } }]);
  });

  it("omits params when notifying without a payload", async () => {
    const { io, written } = createIo();
    const rpc = createJsonRpc(io, {}, CODEX);

    rpc.notify("initialized");
    await tick();
    expect(JSON.parse(written[0]!)).toEqual({ method: "initialized" });
  });

  it("dispatches notifications and buffers partial lines", async () => {
    const { io } = createIo();
    const onNotification = vi.fn();
    createJsonRpc(io, { onNotification }, CODEX);

    const line = `${JSON.stringify({ method: "turn/started", params: { turn: { id: "turn-1" } } })}\n`;
    io.stdout.write(line.slice(0, 10));
    await tick();
    expect(onNotification).not.toHaveBeenCalled();
    io.stdout.write(line.slice(10));
    await tick();

    expect(onNotification).toHaveBeenCalledWith("turn/started", {
      turn: { id: "turn-1" },
    });
  });

  it("passes the provider request ID and suppresses replies after provider resolution", async () => {
    const { io, written, receive } = createIo();
    let resolveRequest: (value: unknown) => void = () => {};
    const onRequest = vi.fn(() => new Promise(resolve => { resolveRequest = resolve; }));
    createJsonRpc(io, { onRequest }, CODEX);
    receive({ id: "native-1", method: "item/tool/requestUserInput", params: { threadId: "child" } });
    expect(onRequest).toHaveBeenCalledWith("item/tool/requestUserInput", { threadId: "child" }, "native-1");
    receive({ method: "serverRequest/resolved", params: { threadId: "child", requestId: "native-1" } });
    resolveRequest({ answers: {} });
    await tick();
    expect(written).toEqual([]);
  });

  it("answers server requests with the handler result", async () => {
    const { io, written, receive } = createIo();
    createJsonRpc(io, {
      onRequest: async () => ({ decision: "accept" }),
    }, CODEX);

    receive({ id: 7, method: "item/commandExecution/requestApproval", params: {} });
    await tick();

    expect(JSON.parse(written[0]!)).toEqual({
      id: 7,
      result: { decision: "accept" },
    });
  });

  it("replies with a JSON-RPC error for unhandled server requests", async () => {
    const { io, written, receive } = createIo();
    createJsonRpc(io, {}, CODEX);

    receive({ id: 9, method: "attestation/generate", params: {} });
    await tick();

    const reply = JSON.parse(written[0]!) as { id: number; error: { code: number } };
    expect(reply.id).toBe(9);
    expect(reply.error.code).toBe(-32601);
  });

  it("rejects pending and future requests after close", async () => {
    const { io } = createIo();
    const rpc = createJsonRpc(io, {}, CODEX);

    const pending = rpc.request("initialize", {});
    rpc.close("process exited");

    await expect(pending).rejects.toThrow(JsonRpcError);
    await expect(rpc.request("thread/start", {})).rejects.toThrow(
      /connection is closed/
    );
  });
});
