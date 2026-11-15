import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { serviceServer } from "./server.js";
import { ServiceClient } from "./client.js";
import { frameParser } from "./parsers.js";
import type { ServiceResponse } from "./validators.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture(execute = vi.fn(async () => ({ applied: true })), stopped = vi.fn()) {
  const directory = mkdtempSync(join(tmpdir(), "cv-stream-"));
  const path = join(directory, "s");
  const control = serviceServer(() => ({ pid: 1, stopping: false, profiles: [{ profile: "a", status: "online", attempts: 1 }, { profile: "b", status: "online", attempts: 1 }] }), execute, stopped);
  await new Promise<void>(resolve => control.server.listen(path, resolve));
  cleanup.push(async () => { control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  return { path, control, execute };
}
it("isolates subscriptions and detaches without stopping the service", async () => {
  const { path, control, execute } = await fixture();
  const a = await ServiceClient.open(path), b = await ServiceClient.open(path);
  const eventsA: ServiceResponse[] = [], eventsB: ServiceResponse[] = [];
  await a.subscribe({ profile: "a" }, e => eventsA.push(e));
  await b.subscribe({ profile: "b" }, e => eventsB.push(e));
  control.publish({ threadId: "thread-a", phase: "streaming" }, "a");
  await vi.waitFor(() => expect(eventsA.some(e => e.event === "change")).toBe(true));
  expect(eventsB.some(e => e.event === "change")).toBe(false);
  a.close();
  control.publish({ threadId: "thread-b", phase: "completed" }, "b");
  await vi.waitFor(() => expect(eventsB.some(e => e.event === "change")).toBe(true));
  expect(execute).not.toHaveBeenCalled(); b.close();
});
it("shares duplicate mutations, rejects conflicts and exposes reconnect outcomes", async () => {
  const { path, execute } = await fixture();
  const a = await ServiceClient.open(path), b = await ServiceClient.open(path);
  const first = await a.request({ op: "reconcile" }, "same");
  expect(await b.request({ op: "reconcile" }, "same")).toEqual(first);
  expect(execute).toHaveBeenCalledTimes(1);
  await expect(b.request({ op: "reconcile", profile: "a" }, "same")).rejects.toThrow("different arguments");
  expect(await b.request({ op: "outcome", requestId: "same" })).toMatchObject({ outcome: "complete", result: first });
  a.close(); b.close();
});
it("reports retention and restart gaps and rejects stale mutation epochs", async () => {
  const { path, control } = await fixture();
  const a = await ServiceClient.open(path);
  const snapshots: ServiceResponse[] = [];
  await a.subscribe({}, e => snapshots.push(e));
  const epoch = snapshots[0].epoch;
  for (let i = 0; i < 520; i++) control.publish({ threadId: `t${i}` }, "a");
  const b = await ServiceClient.open(path);
  const events: ServiceResponse[] = [];
  await b.subscribe({ after: 0, epoch }, e => events.push(e));
  expect(events.at(-1)).toMatchObject({ event: "snapshot", gap: true });
  await expect(b.request({ op: "reconcile", epoch: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("restarted");
  expect(await b.request({ op: "outcome", requestId: "unknown" })).toMatchObject({ outcome: "unknown" });
  a.close(); b.close();
});
it("requires negotiation before mutations", async () => {
  const { path, execute } = await fixture();
  const socket = connect(path);
  const reply = new Promise<string>(resolve => socket.once("data", data => resolve(data.toString())));
  socket.write('{"v":1,"id":"x","op":"stop"}\n');
  expect(JSON.parse(await reply)).toMatchObject({ code: "hello_required", ok: false });
  expect(execute).not.toHaveBeenCalled(); socket.destroy();
});
it("frames split UTF-8 and coalesced messages, bounding unterminated input", () => {
  const rows: unknown[] = []; const fail = vi.fn();
  const parse = frameParser(32, row => rows.push(row), fail);
  const frame = Buffer.from('{"text":"€"}\n{}\n');
  parse(frame.subarray(0, 10)); parse(frame.subarray(10));
  expect(rows).toEqual([{ text: "€" }, {}]);
  parse(Buffer.alloc(33, 120)); expect(fail).toHaveBeenCalledTimes(1);
});

it("does not block a healthy reader behind a backpressured reader", async () => {
  const { path, control } = await fixture();
  const sockets: import("node:net").Socket[] = [];
  control.server.on("connection", socket => sockets.push(socket));
  const slow = await ServiceClient.open(path), fast = await ServiceClient.open(path);
  const fastEvents: ServiceResponse[] = [];
  await slow.subscribe({}, () => {});
  await fast.subscribe({}, event => fastEvents.push(event));
  Object.defineProperty(sockets[0], "writableLength", { get: () => 524288 });
  control.publish({ threadId: "new" });
  await vi.waitFor(() => expect(fastEvents.some(e => e.event === "change")).toBe(true));
  expect(sockets[0].destroyed).toBe(true);
  expect(sockets[1].destroyed).toBe(false);
  slow.close(); fast.close();
});
it("keeps an in-flight mutation after caller loss and coalesces a second caller", async () => {
  let finish!: () => void;
  const execute = vi.fn(() => new Promise<{ applied: boolean }>(resolve => { finish = () => resolve({ applied: true }); }));
  const { path } = await fixture(execute);
  const a = await ServiceClient.open(path), b = await ServiceClient.open(path);
  const pendingA = a.request({ op: "reconcile" }, "pending").catch(() => undefined);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  a.close(); await pendingA;
  expect(await b.request({ op: "outcome", requestId: "pending" })).toMatchObject({ outcome: "pending" });
  const pendingB = b.request({ op: "reconcile" }, "pending");
  finish();
  expect(await pendingB).toMatchObject({ applied: true });
  expect(execute).toHaveBeenCalledTimes(1); b.close();
});
it("expires remembered outcomes without claiming durable exactly-once behavior", async () => {
  const { path } = await fixture();
  const a = await ServiceClient.open(path);
  await a.request({ op: "reconcile" }, "expire");
  const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600001);
  try { expect(await a.request({ op: "outcome", requestId: "expire" })).toMatchObject({ outcome: "unknown" }); }
  finally { spy.mockRestore(); a.close(); }
});
it("rejects unknown profile subscriptions and does not leak thrown backend secrets", async () => {
  const { path } = await fixture(vi.fn(async () => { throw new Error("private-key-should-not-leak"); }));
  const a = await ServiceClient.open(path);
  await expect(a.subscribe({ profile: "missing" }, () => {})).rejects.toThrow("Unknown service profile");
  await expect(a.request({ op: "runs.list", profile: "a" })).rejects.toThrow("Service operation failed");
  a.close();
});

it("reports an oversized reply as a bounded error rather than an unknown outcome", async () => {
  const { path } = await fixture(vi.fn(async () => ({ applied: true, result: "x".repeat(262144) })));
  const client = await ServiceClient.open(path);
  try { await expect(client.request({ op: "runs.list", profile: "a" })).rejects.toThrow("Response exceeds frame limit"); }
  finally { client.close(); }
});
it("includes request identity and epoch when a mutation reply is lost", async () => {
  const { path, control, execute } = await fixture();
  execute.mockImplementation(async () => { control.dispose(); return { applied: true }; });
  const client = await ServiceClient.open(path);
  await expect(client.request({ op: "reconcile" }, "trace-me")).rejects.toThrow(/Request ID: trace-me.*epoch:/);
});

it("replays retained profile events before the new snapshot without mixing profiles", async () => {
  const { path, control } = await fixture();
  const first = await ServiceClient.open(path); const snapshots: ServiceResponse[] = [];
  await first.subscribe({ profile: "a" }, event => snapshots.push(event));
  const initial = snapshots[0]; first.close();
  control.publish({ threadId: "retained-a" }, "a"); control.publish({ threadId: "retained-b" }, "b");
  const next = await ServiceClient.open(path); const replayed: ServiceResponse[] = [];
  await next.subscribe({ profile: "a", after: initial.cursor, epoch: initial.epoch }, event => replayed.push(event));
  expect(replayed.map(e => e.event)).toEqual(["change", "snapshot"]);
  expect(JSON.stringify(replayed)).toContain("retained-a");
  expect(JSON.stringify(replayed)).not.toContain("retained-b");
  expect(replayed.at(-1)?.gap).toBe(false); next.close();
});

it("retains immutable event snapshots when the source state changes", async () => {
  const { path, control } = await fixture();
  const first = await ServiceClient.open(path); const snapshots: ServiceResponse[] = [];
  await first.subscribe({}, event => snapshots.push(event)); first.close();
  const payload = { phase: "claimed" };
  control.publish(payload, "a"); payload.phase = "completed";
  const next = await ServiceClient.open(path); const events: ServiceResponse[] = [];
  await next.subscribe({ epoch: snapshots[0].epoch, after: snapshots[0].cursor }, event => events.push(event));
  expect(events[0].result).toEqual({ profile: "a", event: { phase: "claimed" } }); next.close();
});

it("does not execute frames after a rejected version on the same connection", async () => {
  const { path, execute } = await fixture();
  const socket = connect(path);
  const hello = new Promise<ServiceResponse>(resolve => socket.once("data", chunk => resolve(JSON.parse(chunk.toString()))));
  socket.write('{"v":1,"id":"hello","op":"hello"}\n');
  const { epoch } = await hello;
  const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
  socket.write(JSON.stringify({ v: 2, id: "bad", op: "status" }) + "\n" + JSON.stringify({ v: 1, id: "mutation", op: "reconcile", epoch }) + "\n");
  await closed;
  expect(execute).not.toHaveBeenCalled();
});

it("waits for all admitted stop replies before service teardown", async () => {
  const finish: Array<() => void> = [];
  const execute = vi.fn(() => new Promise<{ applied: boolean }>(resolve => finish.push(() => resolve({ applied: true }))));
  const stopped = vi.fn();
  const { path, control } = await fixture(execute, stopped);
  const sockets: import("node:net").Socket[] = [];
  control.server.on("connection", socket => sockets.push(socket));
  const a = await ServiceClient.open(path), b = await ServiceClient.open(path);
  const drains: Array<() => void> = [];
  const spy = vi.spyOn(sockets[0], "end").mockImplementation(((callback: () => void) => { drains.push(callback); return sockets[0]; }) as typeof sockets[0]["end"]);
  try {
    const first = a.request({ op: "stop" });
    const second = b.request({ op: "stop" }).catch(() => undefined);
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish[0](); await first;
    drains[0]();
    expect(stopped).not.toHaveBeenCalled();
    b.close(); await second;
    finish[1]();
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
  } finally { spy.mockRestore(); a.close(); b.close(); }
});
it("preserves the intentional shutdown deadline diagnostic", async () => {
  const { path } = await fixture(vi.fn(async () => { throw new Error("Worker cleanup could not be confirmed before the shutdown deadline."); }));
  const client = await ServiceClient.open(path);
  try { await expect(client.request({ op: "stop" })).rejects.toThrow("Worker cleanup could not be confirmed"); }
  finally { client.close(); }
});
it("rejects a second raw subscription without replacing the first", async () => {
  const { path, control } = await fixture(); const client = await ServiceClient.open(path);
  const events: ServiceResponse[] = [];
  try {
    await client.subscribe({ profile: "a" }, e => events.push(e));
    await expect(client.request({ op: "subscribe", profile: "b" })).rejects.toThrow("already has a subscription");
    control.publish({ phase: "completed" }, "a");
    await vi.waitFor(() => expect(events.some(e => e.event === "change")).toBe(true));
  } finally { client.close(); }
});

it.each([
  "Managed Anthropic keys require an updated launcher. Follow the VM upgrade instructions.",
  "Managed AWS credentials require an updated launcher. Follow the VM upgrade instructions.",
  "Claude Code needs a managed Anthropic, Mantle or Bedrock key.",
  "Codex needs a managed OpenAI, Mantle or Bedrock key.",
  "Cursor needs a managed Cursor account key.",
  "Managed Cursor keys require an updated launcher. Follow the VM upgrade instructions.",
  "Invalid managed credential request.",
  "Unsafe credential directory: /home/u is writable by group or others. Run chmod go-w /home/u.",
  "Credential directory must be owner-only (0700)",
  "Cannot read managed credentials. Check schema, ownership and private file permissions.",
  "Cannot inspect project registry. Check launcher setup and registry lock.",
])("passes the credential diagnostic %s through", async message => {
  const { path } = await fixture(vi.fn(async () => { throw new Error(message); }));
  const client = await ServiceClient.open(path);
  try { await expect(client.request({ op: "reconcile" })).rejects.toThrow(message); }
  finally { client.close(); }
});
