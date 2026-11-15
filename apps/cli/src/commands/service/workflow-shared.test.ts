import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ServiceResponse } from "./validators.js";

const launcher = vi.hoisted(() => ({ shared: vi.fn(), isolated: vi.fn(), auth: vi.fn(() => ({})) }));
vi.mock("../../lib/config/credentials/resolution.js", async (original) => ({
  ...await original<typeof import("../../lib/config/credentials/resolution.js")>(), launchAuth: launcher.auth,
}));
vi.mock("../project/launcher.js", async (original) => ({
  ...await original<typeof import("../project/launcher.js")>(),
  spawnSharedWorker: launcher.shared, spawnProjectLauncher: launcher.isolated,
}));
const { runService } = await import("./workflow.js");
const { serviceRequest, ServiceClient } = await import("./client.js");
const { sharedServiceSnapshot } = await import("./resolution.js");

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); vi.clearAllMocks(); });
const online = () => spawn(process.execPath, ["-e", "console.log(JSON.stringify({v:1,event:'status',status:'online'})); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"], { stdio: "pipe" });
const profile = (path: string) => ({ name: "A", url: "https://example.convex.cloud", api_key: "k", project_id: "p", paths: [path], project_mode: "shared" as const, project_organization: "o" });
async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 150; n++) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error("Condition timed out");
}

it("runs a shared registration through the shared worker, never the launcher, and reaches online", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-shared-service-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const p = { directory, socket: join(directory, "control.sock") };
  launcher.shared.mockImplementation(online);
  let config = { profiles: { a: profile("/code/a") } };
  const service = await runService(p, sharedServiceSnapshot(config), undefined, 1000, 35000, { snapshot: () => sharedServiceSnapshot(config) });
  cleanup.push(() => service.close());
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "online");
  expect(launcher.shared).toHaveBeenCalledWith(expect.objectContaining({ key: "a", path: "/code/a" }));
  expect(launcher.isolated).not.toHaveBeenCalled();
  // A moved folder is a changed registration, so the live worker reports pending.
  config = { profiles: { a: profile("/code/moved") } };
  expect((await serviceRequest(p.socket, { op: "reconcile" })).applied).toBe(false);
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].pending).toBe(true);
});

it("reports the service's mode in status, subscribe snapshots and inspect (OS-2249)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-shared-service-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const p = { directory, socket: join(directory, "control.sock") };
  launcher.shared.mockImplementation(online);
  const snapshot = () => sharedServiceSnapshot({ profiles: { a: profile("/code/a") } });
  const service = await runService(p, snapshot(), undefined, 1000, 35000, { snapshot, mode: "shared" });
  cleanup.push(() => service.close());
  expect((await serviceRequest(p.socket, { op: "status" })).mode).toBe("shared");
  const client = await ServiceClient.open(p.socket); cleanup.push(() => client.close());
  const events: ServiceResponse[] = [];
  await client.subscribe({}, event => events.push(event));
  await until(async () => events.some(event => event.event === "snapshot"));
  expect(events.find(event => event.event === "snapshot")?.mode).toBe("shared");
  const inspection = (await serviceRequest(p.socket, { op: "inspect" })).result;
  expect(inspection).toMatchObject({ mode: "shared", profiles: [{ profile: "a", mode: "shared" }] });
});

it("delivers a shared registration's managed credentials in its worker frame (OS-2248)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-shared-service-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const p = { directory, socket: join(directory, "control.sock") };
  launcher.shared.mockImplementation(online);
  const claudeAuth = { mode: "bedrock", secret: "s", region: "us-east-1" };
  launcher.auth.mockReturnValue({ claudeAuth });
  const auth = { mode: "native" as const, claude: { mode: "managed" as const, name: "bedrock-a", entryId: "e", revision: 1 } };
  const snapshot = () => sharedServiceSnapshot({ profiles: { a: profile("/code/a") } }).map(entry => ({ ...entry, auth }));
  const service = await runService(p, snapshot(), undefined, 1000, 35000, { snapshot });
  cleanup.push(() => service.close());
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "online");
  expect(launcher.auth).toHaveBeenCalledWith(expect.any(String), auth);
  expect(launcher.shared).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ mode: "shared", claudeAuth }) }));
});
