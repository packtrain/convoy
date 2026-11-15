import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { run } from "../render.js";
import { Browser } from "../workflow.js";
import { ServiceClient } from "../../service/client.js";
import { serviceServer } from "../../service/server.js";
import type { WorkerState } from "../../service/validators.js";
const directory = mkdtempSync(join(tmpdir(), "cv-access-terminal-"));
const socket = join(directory, "s");
const projects: WorkerState[] = ["a", "b"].map(profile => ({ profile, identity: profile, status: "online", attempts: 1, runtimes: ["codex", "claude-code"] }));
const snapshot = () => ({ pid: process.pid, stopping: false, profiles: projects });
let shells = 0, signedIn = false, assigned = false;
const control = serviceServer(snapshot, async request => {
  if (request.op === "status") return snapshot();
  if (request.op === "inspect") return { result: { nodeVersion: process.version, profiles: [] } };
  if (request.op === "reconcile") {
    assert.equal(request.profile, "a");
    projects[0].paused = Boolean(request.pause); projects[0].status = request.pause ? "stopped" : "online";
    control.publish(); return { applied: true };
  }
  if (request.op === "credentials.mutate" && process.argv[2] === "actions-save") {
    assert.deepEqual(request.credentials, { action: "bind", profile: "a", binding: { mode: "managed", name: "saved-key" } });
    assigned = true; return { applied: true };
  }
  assert.notEqual(request.op, "credentials.mutate");
  return { result: { page: [], isDone: true, continueCursor: "" } };
}, () => {});
await new Promise<void>(resolve => control.server.listen(socket, resolve));
const start = Browser.prototype.start;
Browser.prototype.start = function () {
  start.call(this);
  void (async () => {
    while (this.getSnapshot().observations[0].health !== "connected") await new Promise<void>(resolve => setImmediate(resolve));
    if (process.argv[2].startsWith("actions")) { this.select({ connection: 0, profile: "a", details: false }); this.showActions(true); return; }
    this.onboardingSession = { profile: "a", message: "Registered. Service applied the project.", step: "access",
      access: { draft: { codex: { mode: "managed", name: "unsaved-key" } }, saved: {}, reloadPending: false } };
    this.openOnboarding();
  })();
};
try {
  await run([{ id: "fixture", name: "Fixture", endpoint: socket, transport: "unix", open: signal => ServiceClient.open(socket, signal),
    account: async () => ({ codex: { status: "unknown" }, "claude-code": { status: signedIn ? "signed-in" : "signed-out", account: signedIn ? "me@example.com" : undefined } }),
    credentials: { status: async () => ({ service: true, compatible: true, configurationError: false, entries: process.argv[2] === "actions-save" ? [{ name: "saved-key", provider: "openai", auth: "api-key", billing: "api", enabled: true, revision: 1, retainedRevisions: [] }] : [], projects: assigned ? [{ identity: "a", profiles: ["a"], desired: { mode: "managed", name: "saved-key" }, state: "online", verified: false }] : [] }) },
    shell: async (profile, _identity, _signal, runtime) => {
      assert.equal(profile, "a"); assert.equal(runtime, "claude-code");
      assert.equal(process.stdin.isRaw, false); assert.equal(projects[0].paused, true); shells++;
      const child = spawn("/bin/sh", ["-c", `echo LOGIN_HANDOFF; exit ${process.argv[2] === "failure" ? 7 : 0}`], { stdio: "inherit" });
      const status = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      if (status !== 0) throw new Error("Login fixture failed.");
      signedIn = true;
    },
  }]);
  assert.equal(shells, process.argv[2] === "actions-save" ? 0 : 1); assert.equal(projects[1].status, "online"); assert.equal(projects[1].paused, undefined);
  console.log("ACCESS_TERMINAL_OK");
} finally { Browser.prototype.start = start; control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
