import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { serviceRuns } from "./runs.js";
import { serviceServer } from "./server.js";
import { ServiceClient } from "./client.js";
import type { ServiceProfile } from "./validators.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const calls: Array<{ path: string; args: Array<{ apiKey: string }> }> = [];
  let rejection: string | undefined;
  const backend = createServer((request, response) => {
    let body = ""; request.on("data", data => { body += data; });
    request.on("end", () => {
      const call = JSON.parse(body); calls.push(call);
      response.setHeader("content-type", "application/json");
      const value = call.path.endsWith("getSummary") ? { projectId: "project" } : { page: [] };
      response.end(JSON.stringify(rejection && !call.path.endsWith("getSummary")
        ? { status: "error", errorMessage: "Transport stack containing private-secret", errorData: rejection }
        : { status: "success", value }));
    });
  });
  await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve));
  const entry: ServiceProfile = { key: "a", identity: "a".repeat(64), config: {
    convexUrl: `http://127.0.0.1:${(backend.address() as import("node:net").AddressInfo).port}`,
    apiKey: "private-secret", projectId: "project", organizationId: "org", profileKey: "a",
  } };
  const dir = mkdtempSync(join(tmpdir(), "cv-runs-")); const path = join(dir, "s");
  const control = serviceServer(() => ({}), async request => ({ result: await serviceRuns(entry, request) }), () => {});
  await new Promise<void>(resolve => control.server.listen(path, resolve));
  cleanup.push(async () => { control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); await new Promise<void>(resolve => backend.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); });
  return { path, entry, calls, reject: (message: string) => { rejection = message; } };
}
it.each(["Selected run is no longer active", "Thread not found", "Message not found", "Thread does not belong to the selected project"])("preserves safe backend rejection: %s", async message => {
  const fixtureValue = await fixture(); fixtureValue.reject(message);
  const client = await ServiceClient.open(fixtureValue.path);
  try { await expect(client.request({ op: "runs.cancel", profile: "a", threadId: "thread", runId: "run" })).rejects.toThrow(message); }
  finally { client.close(); }
});
it("does not expose arbitrary backend data, even with an allowed prefix", async () => {
  const f = await fixture(); f.reject("Selected run private-secret stack");
  const client = await ServiceClient.open(f.path);
  try { await expect(client.request({ op: "runs.cancel", profile: "a", threadId: "thread", runId: "run" })).rejects.toThrow("Service operation failed"); }
  finally { client.close(); }
});
it("reads authorized history and logs without redundant summary queries", async () => {
  const f = await fixture();
  for (const op of ["runs.history", "runs.logs"] as const) await serviceRuns(f.entry, { v: 1, id: "read", op, threadId: "thread", messageId: "message" });
  expect(f.calls.map(c => c.path)).toEqual(["cli/messages:listServiceRuns", "cli/messages:getServiceRunLogs"]);
});
it("reuses the HTTP client while refreshing credentials when the entry changes", async () => {
  const f = await fixture();
  const { ConvexHttpClient } = await import("convex/browser");
  const instances = new Set<unknown>();
  const original = ConvexHttpClient.prototype.query;
  const spy = vi.spyOn(ConvexHttpClient.prototype, "query").mockImplementation(function (this: unknown, ...args: Parameters<typeof original>) { instances.add(this); return Reflect.apply(original, this, args); });
  try {
    await serviceRuns(f.entry, { v: 1, id: "one", op: "runs.list" });
    await serviceRuns(f.entry, { v: 1, id: "two", op: "runs.list" });
    expect(instances.size).toBe(1);
    f.entry.config = { ...f.entry.config, apiKey: "replacement-secret" };
    await serviceRuns(f.entry, { v: 1, id: "three", op: "runs.list" });
    expect(f.calls.at(-1)?.args[0].apiKey).toBe("replacement-secret");
    expect(instances.size).toBe(2);
  } finally { spy.mockRestore(); }
});
