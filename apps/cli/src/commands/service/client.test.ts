import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { serviceRequest } from "./client.js";

it("aborts a pending hello and releases its transport", async () => {
  const { Duplex } = await import("node:stream");
  const { ServiceClient } = await import("./client.js");
  const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
  const controller = new AbortController();
  const opened = ServiceClient.open(socket, controller.signal);
  controller.abort();
  await expect(opened).rejects.toThrow("detached");
  expect(socket.destroyed).toBe(true);
});

it.each(["malformed", "error"])("reports %s responses instead of accepting them or claiming the service is absent", async (kind) => {
  const directory = mkdtempSync(join(tmpdir(), "cv-client-")); const path = join(directory, "s");
  const server = createServer((socket) => {
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString());
      socket.end(JSON.stringify(kind === "error"
        ? { v: 1, id: request.id, ok: false, error: "Unsupported protocol version. Restart with a matching CLI." }
        : { v: 1, id: request.id, ok: true, profiles: "not-an-array" }) + "\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try { await expect(serviceRequest(path, { op: "status" })).rejects.toThrow(kind === "error" ? "Unsupported protocol" : "Invalid service response"); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("does not classify a lost mutation acknowledgement as an absent service", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-client-")); const path = join(directory, "s");
  const server = createServer((socket) => socket.once("data", () => socket.end()));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    await expect(serviceRequest(path, { op: "project.remove", profile: "a", interrupt: true }))
      .rejects.toThrow("outcome is unknown");
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("reads the bounded 128-worker status with pending credential descriptors", async () => {
  const directory=mkdtempSync(join(tmpdir(),"cv-client-"));const path=join(directory,"s");
  const descriptor={mode:"managed",name:"n".repeat(80),entryId:"i".repeat(80),revision:1};
  const profiles=Array.from({length:128},(_,i)=>({profile:"p".repeat(77)+i,identity:"a".repeat(64),status:"online",attempts:1,auth:descriptor,desiredAuth:{...descriptor,revision:2},pending:true}));
  const server=createServer(socket=>socket.on("data",chunk=>{const request=JSON.parse(chunk.toString());socket.write(JSON.stringify(request.op === "hello" ? {v:1,id:request.id,ok:true,epoch:"00000000-0000-4000-8000-000000000000",capabilities:["attach-v1"]} : {v:1,id:request.id,ok:true,pid:123,stopping:false,profiles})+"\n");}));
  await new Promise<void>(resolve=>server.listen(path,resolve));
  try {expect((await serviceRequest(path,{op:"status"})).profiles).toHaveLength(128);}
  finally {await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(directory,{recursive:true,force:true});}
});

it("explains how to restart an incompatible running service", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-old-")); const path = join(directory, "s");
  const server = createServer(socket => socket.once("data", data => socket.end(JSON.stringify({ v: 1, id: JSON.parse(data.toString()).id, ok: false, error: "Invalid version 1 service request." }) + "\n")));
  await new Promise<void>(resolve => server.listen(path, resolve));
  try { await expect(serviceRequest(path, { op: "status" })).rejects.toMatchObject({ name: "ServiceCompatibilityError", message: expect.stringMatching(/previous CLI.*restart/i) }); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("closes a silent subscribed service after a tolerant heartbeat deadline", async () => {
  const { vi } = await import("vitest"); const { ServiceClient } = await import("./client.js");
  const directory = mkdtempSync(join(tmpdir(), "cv-heartbeat-")); const path = join(directory, "s");
  const server = createServer(socket => socket.on("data", data => {
    const request = JSON.parse(data.toString());
    socket.write(JSON.stringify({ v: 1, id: request.id, ok: true, epoch: "00000000-0000-4000-8000-000000000000", capabilities: ["attach-v1"], ...(request.op === "subscribe" && { event: "snapshot", cursor: 0 }) }) + "\n");
  }));
  await new Promise<void>(resolve => server.listen(path, resolve));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let client: import("./client.js").ServiceClient | undefined;
  try {
    client = await ServiceClient.open(path); await client.subscribe({}, () => {});
    const closed = vi.fn(); void client.closed.then(closed);
    await vi.advanceTimersByTimeAsync(14000); expect(closed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1001); expect(closed).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("heartbeat") }));
  } finally { client?.close(); vi.useRealTimers(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("distinguishes an explicit rejection from a lost reply even if the socket closes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-rejected-")); const path = join(directory, "s");
  const server = createServer(socket => socket.once("data", chunk => {
    const request = JSON.parse(chunk.toString());
    socket.end(JSON.stringify({ v: 1, id: request.id, ok: false, error: "Rejected deliberately" }) + "\n");
  }));
  await new Promise<void>(resolve => server.listen(path, resolve));
  try { await expect(serviceRequest(path, { op: "status" })).rejects.toMatchObject({ name: "ServiceRejectedError", message: "Rejected deliberately" }); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});
