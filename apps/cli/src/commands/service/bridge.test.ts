import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { serviceBridge } from "./bridge.js";
import { serviceServer } from "./server.js";

it("relays only validated frames and leaves the service alive after stdin closes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-bridge-")); const path = join(directory, "s");
  const control = serviceServer(() => ({ profiles: [], pid: 1 }), async () => ({}), () => {});
  await new Promise<void>(resolve => control.server.listen(path, resolve));
  const input = new PassThrough(), output = new PassThrough(); let frames = "";
  output.on("data", data => { frames += data; });
  try {
    const bridge = serviceBridge(path, input, output);
    input.write('{"v":1,"id":"hello","op":"hello"}\n');
    await vi.waitFor(() => expect(frames).toContain('"capabilities"'));
    input.end(); await bridge;
    expect(control.server.listening).toBe(true);
    expect(JSON.parse(frames)).toMatchObject({ id: "hello", ok: true });
    const badInput = new PassThrough();
    const rejected = serviceBridge(path, badInput, new PassThrough());
    badInput.write('not-json\n');
    await expect(rejected).rejects.toThrow("invalid frame");
  } finally { control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("drains a delayed mutation reply after input EOF", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-bridge-eof-")); const path = join(directory, "s");
  let release!: () => void;
  const execute = vi.fn(() => new Promise<Record<string, never>>(resolve => { release = () => resolve({}); }));
  const control = serviceServer(() => ({ profiles: [], pid: 1 }), execute, () => {});
  await new Promise<void>(resolve => control.server.listen(path, resolve));
  const input = new PassThrough(), output = new PassThrough(); let frames = "";
  output.on("data", data => { frames += data; });
  try {
    const bridge = serviceBridge(path, input, output);
    input.write('{"v":1,"id":"hello","op":"hello"}\n');
    await vi.waitFor(() => expect(frames).toContain('"epoch"'));
    const epoch = JSON.parse(frames).epoch;
    input.end(JSON.stringify({ v: 1, id: "remove", op: "project.remove", profile: "a", epoch }) + "\n");
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    release(); await bridge;
    expect(frames).toContain('"id":"remove","ok":true');
  } finally { control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("rejects truncated input at EOF", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-bridge-partial-")); const path = join(directory, "s");
  const control = serviceServer(() => ({}), async () => ({}), () => {});
  await new Promise<void>(resolve => control.server.listen(path, resolve));
  try {
    const input = new PassThrough();
    const bridge = serviceBridge(path, input, new PassThrough());
    input.end('{"v":1');
    await expect(bridge).rejects.toThrow(/invalid frame/i);
  } finally { control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("rejects truncated responses at socket EOF", async () => {
  const { createServer } = await import("node:net");
  const directory = mkdtempSync(join(tmpdir(), "cv-bridge-partial-")); const path = join(directory, "s");
  const server = createServer(socket => socket.end('{"v":1'));
  await new Promise<void>(resolve => server.listen(path, resolve));
  try { await expect(serviceBridge(path, new PassThrough(), new PassThrough())).rejects.toThrow(/invalid frame/i); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("waits for stdout writes even below their high-water mark", async () => {
  const { Writable } = await import("node:stream");
  const directory = mkdtempSync(join(tmpdir(), "cv-bridge-drain-")); const path = join(directory, "s");
  const control = serviceServer(() => ({}), async () => ({}), () => {});
  await new Promise<void>(resolve => control.server.listen(path, resolve));
  let release!: () => void;
  const output = new Writable({ write(_chunk, _encoding, callback) { release = callback; } });
  const input = new PassThrough(); let finished = false;
  const bridge = serviceBridge(path, input, output).then(() => { finished = true; });
  try {
    input.end('{"v":1,"id":"hello","op":"hello"}\n');
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(finished).toBe(false); release();
    await vi.waitFor(() => expect(finished).toBe(true), { timeout: 200 });
    await bridge;
  } finally { output.emit("drain"); control.dispose(); await bridge.catch(() => {}); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("reports an idle bridge timeout explicitly", async () => {
  const { createServer, Socket } = await import("node:net");
  const directory = mkdtempSync(join(tmpdir(), "cv-bridge-idle-")); const path = join(directory, "s");
  const sockets: InstanceType<typeof Socket>[] = [];
  const server = createServer(socket => sockets.push(socket)); await new Promise<void>(resolve => server.listen(path, resolve));
  let timeout!: () => void;
  const spy = vi.spyOn(Socket.prototype, "setTimeout").mockImplementation(function (this: InstanceType<typeof Socket>, _ms, callback) { timeout = callback!; return this; });
  try {
    const bridge = serviceBridge(path, new PassThrough(), new PassThrough());
    const assertion = expect(bridge).rejects.toThrow("timed out after 45 seconds");
    timeout(); await assertion;
  } finally { spy.mockRestore(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("reports a stopped service instead of a generic bridge failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-bridge-absent-"));
  try { await expect(serviceBridge(join(directory, "missing"), new PassThrough(), new PassThrough())).rejects.toThrow(/^Service unavailable\.$/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
