import * as resolution from "./resolution.js";
import { ServiceCompatibilityError, ServiceRejectedError, ServiceUnavailableError } from "../service/errors.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { serviceServer } from "../service/server.js";
import { ServiceClient } from "../service/client.js";
import type { ServiceRequest } from "../service/validators.js";
import { Browser } from "./workflow.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function fixture(execute?: (request: ServiceRequest) => Promise<unknown>, inspection: unknown = { nodeVersion: "v22", profiles: [] }) {
  const directory = mkdtempSync(join(tmpdir(), "cv-tui-"));
  const socket = join(directory, "s");
  const requests: ServiceRequest[] = [];
  const profiles = ["a", "b"];
  const control = serviceServer(() => ({ pid: 123, stopping: false, profiles: profiles.map(profile => ({ profile, status: "online", attempts: 1 })) }), async request => {
    requests.push(request);
    if (request.op === "inspect") {
      if (inspection instanceof Error) throw inspection;
      return { result: typeof inspection === "function" ? await inspection() : inspection };
    }
    if (request.op === "logs") return { entries: [], cursor: request.after ?? 0 };
    return { result: execute ? await execute(request) : page(request.profile!) };
  }, () => {});
  await new Promise<void>(resolve => control.server.listen(socket, resolve));
  cleanups.push(async () => { control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  return { control, requests, profiles, connection: { id: socket, name: "Test", endpoint: socket, transport: "unix", open: (signal: AbortSignal) => ServiceClient.open(socket, signal) } };
}
function page(profile: string, isDone = true) { return { page: [{ threadId: `${profile}-thread`, title: "Unicode 日本語 🚀", status: "pending", lastActivityAt: 1 }], isDone, continueCursor: "next" }; }
async function start(browser: Browser) {
  cleanups.push(() => browser.dispose()); browser.start();
  await vi.waitFor(() => expect(browser.getSnapshot().observations[0].health).toBe("connected"));
}
async function ready(browser: Browser, profile: string) {
  await vi.waitFor(() => expect(browser.getSnapshot().rows[0]?.profile).toBe(profile));
}

it("keeps details DB-free and pages All projects without fan-out or accumulated rows", async () => {
  const f = await fixture(); const browser = new Browser([f.connection]); await start(browser);
  expect(f.requests.map(r => r.op)).toEqual(["inspect"]);
  browser.select({ connection: 0, details: false }); await ready(browser, "a");
  expect(f.requests.filter(r => r.op === "runs.list")).toHaveLength(1);
  browser.next(); await ready(browser, "b");
  expect(browser.getSnapshot().rows).toHaveLength(1);
  expect(browser.getSnapshot().next).toBeUndefined();
  browser.back(); await ready(browser, "a");
});

it("keeps independent clients' navigation and requests separate", async () => {
  const f = await fixture(); const a = new Browser([f.connection]), b = new Browser([f.connection]);
  await start(a); await start(b);
  a.select({ connection: 0, details: false, profile: "a" });
  b.select({ connection: 0, details: false, profile: "b" });
  await ready(a, "a"); await ready(b, "b");
  a.dispose(); b.retryNow(); await ready(b, "b");
  expect(b.getSnapshot().observations[0].health).toBe("connected");
});

it("discards an old scope response and does not overlap page requests", async () => {
  let release!: (value: unknown) => void;
  const f = await fixture(request => request.profile === "a" ? new Promise(resolve => { release = resolve; }) : Promise.resolve(page("b")));
  const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false, profile: "a" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  browser.select({ connection: 0, details: false, profile: "b" });
  expect(f.requests.filter(r => r.op === "runs.list")).toHaveLength(1);
  release(page("a")); await ready(browser, "b");
  expect(browser.getSnapshot().rows.some(row => row.profile === "a")).toBe(false);
});

it("reconnects with a new snapshot and marks disconnected data stale", async () => {
  const f = await fixture(); const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false, profile: "a" }); await ready(browser, "a");
  f.control.dispose();
  await vi.waitFor(() => expect(browser.getSnapshot().stale).toBe(true));
  browser.retryNow();
  await vi.waitFor(() => expect(browser.getSnapshot().observations[0].health).toBe("connected"));
  await ready(browser, "a");
  expect(f.requests.filter(r => r.op === "inspect")).toHaveLength(2);
});

it("keeps repeated executions distinct and fetches history only when opened", async () => {
  const f = await fixture(async request => request.op === "runs.history" ? {
    page: ["one", "two"].map(id => ({ threadId: "a-thread", messageId: id, runId: id, status: "completed", createdAt: 1, updatedAt: 1 })),
    isDone: true, continueCursor: "",
  } : page("a"));
  const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false, profile: "a" }); await ready(browser, "a");
  expect(f.requests.some(r => r.op === "runs.history")).toBe(false);
  browser.history(browser.getSnapshot().rows[0]);
  await vi.waitFor(() => expect(browser.getSnapshot().rows.map(r => r.run?.runId)).toEqual(["one", "two"]));
  browser.history(); await ready(browser, "a");
});

it("reports failures without replacing the last good page with an empty success", async () => {
  let fail = false;
  const f = await fixture(async () => { if (fail) throw new Error("backend unavailable"); return page("a"); });
  const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false, profile: "a" }); await ready(browser, "a");
  fail = true; browser.retryNow();
  await vi.waitFor(() => expect(browser.getSnapshot().error).toContain("Run page unavailable"));
  expect(browser.getSnapshot().stale).toBe(true);
  expect(browser.getSnapshot().rows).toHaveLength(1);
});

it("closes the old target and ignores late target replies", async () => {
  let release!: (value: unknown) => void;
  const a = await fixture(() => new Promise(resolve => { release = resolve; }));
  const b = await fixture(); const browser = new Browser([a.connection, b.connection]); await start(browser);
  expect(browser.getSnapshot().observations[1].health).toBe("unknown");
  browser.select({ connection: 0, profile: "a", details: false });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  browser.select({ connection: 1, profile: "b", details: false }); await ready(browser, "b");
  release(page("a"));
  expect(browser.getSnapshot().rows[0].profile).toBe("b");
  expect(browser.getSnapshot().observations[0].health).toBe("unknown");
});

it.each([{ invalid: true }, new Error("optional metadata unavailable")])("keeps a healthy connection when optional inspection fails: %s", async inspection => {
  const f = await fixture(undefined, inspection);
  const browser = new Browser([f.connection]); await start(browser);
  expect(browser.getSnapshot().observations[0].inspection).toBeUndefined();
  browser.select({ connection: 0, details: false }); await ready(browser, "a");
  expect(f.requests.map(r => r.op)).toEqual(["inspect", "runs.list"]);
});

it.each([false, true])("keeps retained rows stale until reconnect page settles, failure=%s", async fail => {
  let delayed = false;
  let release!: () => void;
  const f = await fixture(async () => {
    if (delayed) await new Promise<void>((resolve, reject) => { release = () => fail ? reject(new Error("offline")) : resolve(); });
    return page("a");
  });
  const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false }); await ready(browser, "a");
  delayed = true; f.control.dispose();
  await vi.waitFor(() => expect(browser.getSnapshot().stale).toBe(true));
  browser.retryNow();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(browser.getSnapshot().rows).toHaveLength(1);
  expect(browser.getSnapshot().stale).toBe(true);
  release();
  await vi.waitFor(() => expect(browser.getSnapshot().loading).toBe(false));
  expect(browser.getSnapshot().stale).toBe(fail);
});

it("offers an update for missing browsing capability without polling or retrying", async () => {
  const f = await fixture();
  const open = vi.fn(async (signal: AbortSignal) => {
    const client = await f.connection.open(signal);
    client.hello!.capabilities = ["attach-v1"];
    return client;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanups.push(() => { vi.useRealTimers(); });
  const browser = new Browser([{ ...f.connection, id: "example", transport: "docker", open }]);
  cleanups.push(() => browser.dispose()); browser.start();
  await vi.waitFor(() => expect(browser.getSnapshot().error).toContain("update"));
  expect(browser.getSnapshot().observations[0].guidance?.join("\n")).toContain("--environment example");
  expect(f.requests).toHaveLength(0);
  expect(browser.getSnapshot().observations[0].health).toBe("incompatible");
  await vi.advanceTimersByTimeAsync(10000);
  expect(open).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("browses without the unrelated host management capability", async () => {
  const f = await fixture();
  const browser = new Browser([{ ...f.connection, open: async signal => {
    const client = await f.connection.open(signal);
    client.hello!.capabilities = ["attach-v1", "runs-v1"];
    return client;
  } }]);
  await start(browser); browser.select({ connection: 0, details: false }); await ready(browser, "a");
});

it("never marks a transport failure during inspection connected", async () => {
  const f = await fixture(undefined, () => { f.control.dispose(); return new Promise(() => {}); });
  const browser = new Browser([f.connection]);
  const health: string[] = [];
  browser.subscribe(() => { health.push(browser.getSnapshot().observations[0].health); });
  cleanups.push(() => browser.dispose()); browser.start();
  await vi.waitFor(() => expect(browser.getSnapshot().observations[0].health).toBe("reconnecting"));
  expect(health).not.toContain("connected");
  expect(browser.getSnapshot().stale).toBe(true);
});

it("suspends list reads in detail, sends raw requests and restores history on Escape", async () => {
  const f = await fixture(async request => request.op === "runs.logs" ? { raw: true } : page("a"));
  const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false, profile: "a" }); await ready(browser, "a");
  const row = { ...browser.getSnapshot().rows[0], run: { threadId: "a-thread", messageId: "message", status: "streaming", createdAt: 1, updatedAt: 1 } };
  browser.logs(row);
  expect(browser.getSnapshot().detail).toEqual(row);
  await browser.readLogs(row, { chunkBefore: 50 });
  expect(f.requests.at(-1)).toMatchObject({ op: "runs.logs", rawLogs: true, chunkBefore: 50, messageId: "message" });
  const count = f.requests.filter(request => request.op === "runs.list").length;
  browser.retryNow();
  await vi.waitFor(() => expect(browser.getSnapshot().loading).toBe(false));
  expect(f.requests.filter(request => request.op === "runs.list")).toHaveLength(count);
  browser.logs(); await vi.waitFor(() => expect(f.requests.filter(request => request.op === "runs.list")).toHaveLength(count + 1));
  browser.logs(row); browser.select({ connection: 0, details: true });
  expect(browser.getSnapshot().detail).toBeUndefined();
});

it("distinguishes disconnected service from missing raw-log capability", async () => {
  const f = await fixture();
  const row = { profile: "a", thread: { threadId: "thread", title: "test", lastActivityAt: 1 } };
  const disconnected = new Browser([f.connection]);
  await expect.soft(disconnected.readLogs(row, {})).rejects.toBeInstanceOf(ServiceUnavailableError);
  const browser = new Browser([{ ...f.connection, open: async signal => {
    const client = await f.connection.open(signal);
    client.hello!.capabilities = ["attach-v1", "runs-v1"];
    return client;
  } }]);
  await start(browser);
  await expect(browser.readLogs(row, {})).rejects.toBeInstanceOf(ServiceCompatibilityError);
});

it("locks exact run identity during confirmation and never cancels a replacement", async () => {
  const run = { threadId: "a-thread", messageId: "message", runId: "old-run", status: "streaming", createdAt: 1, updatedAt: 1 };
  const cancel = vi.fn(async () => { throw new Error("Selected run is no longer active"); });
  const f = await fixture(async request => request.op === "runs.history" ? { page: [run], isDone: true, continueCursor: "" } : request.op === "runs.cancel" ? cancel() : page("a"));
  const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false, profile: "a" }); await ready(browser, "a");
  browser.history(browser.getSnapshot().rows[0]);
  await vi.waitFor(() => expect(browser.getSnapshot().rows[0]?.run?.runId).toBe("old-run"));
  const row = browser.getSnapshot().rows[0]; browser.showActions(true); browser.beginAction("cancel", row);
  browser.select({ connection: 0, details: true }); browser.showActions(false);
  expect(browser.getSnapshot().scope.profile).toBe("a"); expect(browser.getSnapshot().actions).toBe(true);
  browser.dismissAction(); expect(cancel).not.toHaveBeenCalled();
  browser.beginAction("cancel", row); browser.confirmAction(); browser.confirmAction();
  await vi.waitFor(() => expect(browser.getSnapshot().action?.message).toContain("Selected run is no longer active"));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(f.requests.at(-1)).toMatchObject({ op: "runs.cancel", runId: "old-run", threadId: "a-thread", profile: "a" });
});

it("disables stale controls and refuses a stop confirmation after service reconnection", async () => {
  const f = await fixture(); const browser = new Browser([f.connection]); await start(browser);
  browser.showActions(true); browser.beginAction("stop");
  f.control.dispose();
  await vi.waitFor(() => expect(browser.getSnapshot().stale).toBe(true));
  expect(browser.unavailable("stop")).toContain("disconnected");
  browser.retryNow();
  await vi.waitFor(() => expect(browser.getSnapshot().observations[0].health).toBe("connected"));
  browser.confirmAction();
  expect(browser.getSnapshot().action?.message).toContain("Service changed");
  expect(f.requests.some(request => request.op === "stop")).toBe(false);
});

it("reads bounded saved logs without a service and preserves Actions across targets", async () => {
  const savedLogs = vi.fn(async (after: number) => ({ entries: [{ seq: after + 1, ts: 1, profile: "a", message: "stopped" }], cursor: after + 1, gap: after > 0 }));
  const f = await fixture(); const browser = new Browser([{ ...f.connection, savedLogs }, f.connection]); cleanups.push(() => browser.dispose());
  browser.showActions(true); browser.beginAction("logs");
  await vi.waitFor(() => expect(browser.getSnapshot().action?.entries).toHaveLength(1));
  browser.moreOperationalLogs();
  await vi.waitFor(() => expect(browser.getSnapshot().action?.cursor).toBe(2));
  expect(browser.getSnapshot().action?.message).toContain("Retention gap");
  expect(savedLogs.mock.calls).toEqual([[0, undefined], [1, undefined]]);
  browser.select({ connection: 1, details: true });
  expect(browser.getSnapshot().actions).toBe(true); expect(browser.getSnapshot().action).toBeUndefined();
});

it("keeps a request outcome visible without replaying after a lost stop reply", async () => {
  const f = await fixture(async request => { if (request.op === "stop") { f.control.dispose(); return {}; } return page("a"); });
  const browser = new Browser([f.connection]); await start(browser);
  browser.showActions(true); browser.beginAction("stop"); browser.confirmAction();
  await vi.waitFor(() => expect(browser.getSnapshot().action?.message).toContain("Outcome unknown"));
  expect(browser.getSnapshot().action?.message).toContain("Request ID");
  expect(f.requests.filter(request => request.op === "stop")).toHaveLength(1);
});

it("starts only after confirmation and releases late log results on detach", async () => {
  const f = await fixture(); const startService = vi.fn(async () => {});
  let release!: (value: { entries: []; cursor: number; gap: boolean }) => void;
  const browser = new Browser([{ ...f.connection, start: startService, savedLogs: () => new Promise(resolve => { release = resolve; }) }]);
  cleanups.push(() => browser.dispose()); browser.showActions(true); browser.beginAction("start");
  expect(startService).not.toHaveBeenCalled(); browser.dismissAction();
  browser.beginAction("start"); browser.confirmAction();
  await vi.waitFor(() => expect(browser.getSnapshot().action?.message).toContain("start completed"));
  expect(startService).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(browser.getSnapshot().observations[0].health).toBe("connected"));
  browser.dispose();
  const offline = new Browser([{ ...f.connection, savedLogs: () => new Promise(resolve => { release = resolve; }) }]);
  offline.showActions(true); offline.beginAction("logs"); offline.dispose();
  release({ entries: [], cursor: 0, gap: false });
  await Promise.resolve(); expect(offline.getSnapshot().action?.entries).toBeUndefined();
});

it("releases retained operational log buffers when detached", async () => {
  const f = await fixture();
  const browser = new Browser([{ ...f.connection, savedLogs: async () => ({ entries: [{ seq: 1, ts: 1, profile: "a", message: "stopped" }], cursor: 1, gap: false }) }]);
  browser.showActions(true); browser.beginAction("logs");
  await vi.waitFor(() => expect(browser.getSnapshot().action?.entries).toHaveLength(1));
  browser.dispose(); expect(browser.getSnapshot().action).toBeUndefined();
});

it.each(["pending", "running"])("does not offer cancellation for backend-rejected status %s", async status => {
  const run = { threadId: "a-thread", messageId: "message", runId: "run", status, createdAt: 1, updatedAt: 1 };
  const f = await fixture(async request => request.op === "runs.history" ? { page: [run], isDone: true, continueCursor: "" } : page("a"));
  const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false, profile: "a" }); await ready(browser, "a");
  browser.history(browser.getSnapshot().rows[0]);
  await vi.waitFor(() => expect(browser.getSnapshot().rows[0]?.run).toBeDefined());
  browser.showActions(true); browser.beginAction("cancel", browser.getSnapshot().rows[0]);
  expect(browser.getSnapshot().action?.pending).not.toBe(true);
  expect(browser.getSnapshot().action?.message).toContain("Select an active execution");
});

it("pages operational logs through the current client after reconnect", async () => {
  const f = await fixture();
  const savedLogs = vi.fn(async () => ({ entries: [], cursor: 0, gap: false }));
  const browser = new Browser([{ ...f.connection, savedLogs }]); await start(browser);
  browser.showActions(true); browser.beginAction("logs");
  await vi.waitFor(() => expect(browser.getSnapshot().action?.cursor).toBeDefined());
  f.control.dispose();
  await vi.waitFor(() => expect(browser.getSnapshot().observations[0].health).toBe("reconnecting"));
  browser.retryNow();
  await vi.waitFor(() => expect(browser.getSnapshot().observations[0].health).toBe("connected"));
  browser.moreOperationalLogs();
  await vi.waitFor(() => expect(browser.getSnapshot().action?.busy).not.toBe(true));
  expect(savedLogs).not.toHaveBeenCalled();
  expect(f.requests.filter(request => request.op === "logs")).toHaveLength(2);
});

it("does not reopen a transport when maintenance finishes after detach", async () => {
  const open = vi.fn(async () => { throw new Error("detached"); });
  const browser = new Browser([{ id: "target", name: "Target", transport: "docker", endpoint: "target", open }]);
  browser.dispose();
  await browser.refreshEnvironment({ serviceVersion: "0.103.0", serviceRunning: true });
  expect(open).not.toHaveBeenCalled();
});

it("does not open environment lifecycle controls on unsupported transports", () => {
  const browser = new Browser([{ id: "local", name: "Local", transport: "unix", endpoint: "local", open: async () => { throw new Error(); } }]);
  browser.openEnvironment("update");
  expect(browser.getSnapshot().environment).toBeUndefined();
  expect(browser.getSnapshot().error).toContain("unavailable");
  browser.dispose();
});

it.each([false, true])("creates and selects an environment without stale observations, existing=%s", async existing => {
  const a = await fixture(), b = await fixture();
  const target = { ...b.connection, id: "managed", transport: "docker" };
  const create = vi.spyOn(resolution, "createConnection").mockResolvedValue(target);
  cleanups.push(() => create.mockRestore());
  const browser = new Browser(existing ? [a.connection, target] : [a.connection]); await start(browser);
  browser.showActions(true);
  browser.openEnvironment("create");
  await browser.createEnvironment({ name: "managed", deployment: "", domains: "" }, () => {});
  expect(browser.getSnapshot().actions).toBe(false);
  expect(browser.targets).toHaveLength(2);
  expect(browser.getSnapshot().observations).toHaveLength(2);
  expect(browser.getSnapshot().scope).toEqual({ connection: 1, details: true });
  expect(browser.getSnapshot().observations[1].health).toBe("connected");
  expect(browser.getSnapshot().observations[0].health).toBe("unknown");
  expect(b.requests.map(request => request.op)).toEqual(["inspect"]);
});

it("inspects managed status in Details without opening an operation menu", async () => {
  let reads = 0;
  const browser = new Browser([{ id: "managed", name: "Managed", transport: "docker", endpoint: "test", open: async () => { throw new Error("unused"); }, maintenance: {
    status: async () => { reads++; return { running: false, serviceRunning: false }; },
    release: async () => ({ installed: "1.0.0", proposed: "1.0.1" }), execute: async () => ({}),
  } }]);
  try {
    expect(typeof browser.inspectEnvironment).toBe("function");
    await browser.inspectEnvironment();
    expect(reads).toBe(1);
    expect(browser.getSnapshot().observations[0].environmentStatus).toEqual({ running: false, serviceRunning: false });
    expect(browser.getSnapshot().environment).toBeUndefined();
  } finally { browser.dispose(); }
});

it("checks unselected managed environments once at start", async () => {
  const a = await fixture();
  let selectedReads = 0;
  const managed = (status: () => Promise<Record<string, unknown>>) => ({ status, release: async () => ({ installed: "1.0.0", proposed: "1.0.1" }), execute: async () => ({}) });
  const browser = new Browser([
    { ...a.connection, maintenance: managed(async () => { selectedReads++; return {}; }) },
    { id: "up", name: "Up", transport: "docker", endpoint: "up", open: async () => { throw new Error("unused"); }, maintenance: managed(async () => ({ state: "running", serviceRunning: true })) },
    { id: "down", name: "Down", transport: "docker", endpoint: "down", open: async () => { throw new Error("unused"); }, maintenance: managed(async () => { throw new Error("Docker host unavailable."); }) },
    { id: "vm", name: "VM", transport: "ssh", endpoint: "vm", open: async () => { throw new Error("unused"); } },
  ]);
  try {
    browser.start();
    await vi.waitFor(() => expect(browser.getSnapshot().observations[2].environmentError).toBe("Docker host unavailable."));
    expect(browser.getSnapshot().observations[1].environmentStatus).toEqual({ state: "running", serviceRunning: true });
    expect(browser.getSnapshot().observations[3].environmentStatus).toBeUndefined();
    expect(selectedReads).toBe(0);
  } finally { browser.dispose(); }
});

it("keeps a stopped container observation after maintenance without reconnecting", async () => {
  let opens = 0;
  const browser = new Browser([{ id: "a", name: "A", transport: "docker", endpoint: "a", open: async () => { opens++; throw new Error("stopped"); } }]);
  try {
    await browser.refreshEnvironment({ stopped: true, dataRetained: true });
    expect(opens).toBe(0);
    expect(browser.getSnapshot().observations[0].environmentStatus?.state).toBe("stopped");
  } finally { browser.dispose(); }
});

it("shows a retained failed creation immediately without changing selection", async () => {
  const a = await fixture();
  const target = { ...a.connection, id: "failed", name: "failed", transport: "docker" };
  const create = vi.spyOn(resolution, "createConnection").mockRejectedValue(new Error("Build failed"));
  const discover = vi.spyOn(resolution, "connections").mockReturnValue({ targets: [a.connection, target], selected: 0, warnings: [] });
  cleanups.push(() => { create.mockRestore(); discover.mockRestore(); });
  const browser = new Browser([a.connection]); await start(browser);
  browser.openEnvironment("create");
  await expect(browser.createEnvironment({ name: "failed", deployment: "", domains: "" }, () => {})).rejects.toThrow("Build failed");
  expect(browser.targets.map(target => target.id)).toContain("failed");
  expect(browser.getSnapshot().observations).toHaveLength(2);
  expect(browser.getSnapshot().scope.connection).toBe(0);
});

it("removes a deleted target and selects the remaining local connection", async () => {
  const a = await fixture(), b = await fixture();
  const browser = new Browser([a.connection, { ...b.connection, id: "deleted", transport: "docker" }], 1);
  cleanups.push(() => browser.dispose());
  await browser.refreshEnvironment({ deleted: true });
  expect(browser.targets.map(target => target.id)).toEqual([a.connection.id]);
  expect(browser.getSnapshot().observations).toHaveLength(1);
  expect(browser.getSnapshot().scope).toEqual({ connection: 0, details: true });
  expect(browser.getSnapshot().observations[0].health).toBe("connected");
});

it("opens Credentials only for an environment or a project and keeps the tab across environments", async () => {
  const a = await fixture(), b = await fixture();
  const browser = new Browser([a.connection, b.connection]); await start(browser);
  browser.showCredentials(true);
  expect(browser.getSnapshot().credentials).toBe("view");
  browser.select({ connection: 1, details: true });
  expect(browser.getSnapshot().credentials).toBe("view");
  browser.editCredentials(true);
  browser.select({ connection: 0, details: true });
  expect(browser.getSnapshot().scope.connection).toBe(1);
  browser.editCredentials(false);
  browser.select({ connection: 1, details: false });
  expect(browser.getSnapshot().credentials).toBeUndefined();
  browser.showCredentials(true);
  expect(browser.getSnapshot().credentials).toBeUndefined();
  browser.select({ connection: 1, details: true, addProject: true });
  browser.showCredentials(true);
  expect(browser.getSnapshot().credentials).toBeUndefined();
  browser.select({ connection: 1, details: false, profile: "a" });
  browser.showCredentials(true);
  expect(browser.getSnapshot().credentials).toBe("editing");
});

it("closes a project's credential editor when another client removes the project", async () => {
  const f = await fixture(); const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false, profile: "a" });
  browser.showCredentials(true);
  f.profiles.splice(0, 1); f.control.publish();
  await vi.waitFor(() => expect(browser.getSnapshot().scope).toEqual({ connection: 0, details: true }));
  expect(browser.getSnapshot().credentials).toBeUndefined();
  expect(browser.locked).toBe(false);
});

it("maps credential mutation failures to retry guidance and opens AWS endpoints first", async () => {
  const bind = { action: "bind", profile: "a", binding: { mode: "native" } } as const;
  const idle = new Browser([(await fixture()).connection]); cleanups.push(() => idle.dispose());
  await expect(idle.mutateCredentials(bind)).rejects.toThrow("Service disconnected");

  const old = await fixture();
  const outdated = new Browser([{ ...old.connection, open: async signal => {
    const client = await old.connection.open(signal); client.hello!.capabilities = ["attach-v1", "runs-v1"]; return client;
  } }]); await start(outdated);
  await expect(outdated.mutateCredentials(bind)).rejects.toThrow("cannot change managed credentials");

  // A shared service started before 0.133.0 has no store handler at all (OS-2248).
  const sharedOld = await fixture();
  const stale = new Browser([{ ...sharedOld.connection, mode: "shared", open: async signal => {
    const client = await sharedOld.connection.open(signal); client.hello!.capabilities = ["credentials-v1", "attach-v1", "runs-v1"]; return client;
  } }]); await start(stale);
  await expect(stale.mutateCredentials(bind)).rejects.toThrow("This service predates shared-environment credentials. Restart it with [t] Restart service in environment Actions.");

  const order: string[] = [];
  const f = await fixture(async request => {
    if (request.op !== "credentials.mutate") return page("a");
    order.push(request.credentials!.action);
    if (request.credentials!.action === "rotate") f.control.dispose();
    if (request.credentials!.action === "disable") throw new Error("Managed credentials require a registered isolated profile.");
    return {};
  });
  const browser = new Browser([{ ...f.connection, credentials: { status: async () => { throw new Error("unused"); }, allowDomain: async host => { order.push(host); } } }]); await start(browser);
  await expect(browser.mutateCredentials({ action: "add", name: "m", secret: "sk-x", aws: { provider: "mantle", region: "us-east-1" } })).resolves.toBe(false);
  const rejected = await browser.mutateCredentials({ action: "disable", name: "m" }).catch(error => error);
  expect(rejected).toBeInstanceOf(ServiceRejectedError);
  expect(rejected.message).toContain("registered isolated profile");
  await expect(browser.mutateCredentials({ action: "rotate", name: "m", secret: "sk-y" })).rejects.toThrow("Outcome unknown. Press f to refresh");
  expect(order).toEqual(["bedrock-mantle.us-east-1.api.aws", "add", "disable", "rotate"]);
});

it("pauses run paging while a project's credential editor covers it", async () => {
  const f = await fixture(); const browser = new Browser([f.connection]); await start(browser);
  browser.select({ connection: 0, details: false, profile: "a" }); await ready(browser, "a");
  browser.showCredentials(true);
  const pages = f.requests.length;
  browser.retryNow(); await new Promise(resolve => setTimeout(resolve, 50));
  expect(f.requests.length).toBe(pages);
  browser.showCredentials(false);
  await vi.waitFor(() => expect(f.requests.length).toBeGreaterThan(pages));
});
