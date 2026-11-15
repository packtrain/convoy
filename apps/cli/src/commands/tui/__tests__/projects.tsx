import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { withEnvironmentLock } from "../../environment/paths.js";
import { run } from "../render.js";
import { ServiceClient } from "../../service/client.js";
import { serviceServer } from "../../service/server.js";
import type { WorkerState } from "../../service/validators.js";
import { gateInput } from "./test-helpers.js";
gateInput();
const directory = mkdtempSync(join(tmpdir(), "cv-terminal-projects-"));
const socket = join(directory, "s");
const home = join(directory, "a-home"), workspace = join(directory, "a-workspace");
mkdirSync(home); mkdirSync(workspace);
const projects: WorkerState[] = ["a", "b"].map(profile => ({ profile, identity: profile, status: "online", activeRuns: 1, attempts: 1 }));
const snapshot = () => ({ pid: process.pid, stopping: false, profiles: projects });
let pauses = 0, reloads = 0, removals = 0, shells = 0;
const control = serviceServer(snapshot, async request => {
  if (request.op === "status") return snapshot();
  if (request.op === "inspect") return { result: { nodeVersion: process.version, profiles: [] } };
  if (request.op === "reconcile") {
    assert.equal(request.profile, "a"); assert.equal(request.interrupt, true);
    projects[0].paused = Boolean(request.pause); projects[0].status = request.pause ? "stopped" : "online";
    if (request.pause) pauses++; else reloads++;
    control.publish(); return { applied: true };
  }
  if (request.op === "project.remove") {
    assert.equal(request.profile, "a"); projects.shift(); removals++;
    control.publish(); return { applied: true, registered: false };
  }
  return { result: { page: [], isDone: true, continueCursor: "" } };
}, () => {});
await new Promise<void>(resolve => control.server.listen(socket, resolve));
const peer = await ServiceClient.open(socket);
let peerProfiles: WorkerState[] = [];
await peer.subscribe({}, response => { if (response.profiles) peerProfiles = response.profiles; });
try {
  await run([{ id: "fixture", name: "Fixture", endpoint: socket, transport: "unix", open: signal => ServiceClient.open(socket, signal),
    shell: async (profile, _identity, signal) => {
      assert.equal(profile, "a"); assert.equal(process.stdin.isRaw, false);
      assert.equal(projects[0].paused, true); shells++;
      if (process.argv[2]?.startsWith("pending-")) {
        mkdirSync(join(directory, "lock"));
        console.log("SHELL_LOCK_WAIT");
        await withEnvironmentLock(directory, async () => { throw new Error("Unexpected shell launch"); }, 600000, signal);
      }
      const child = spawn(process.argv[2] === "launch-failure" ? "/nonexistent-convoy-shell-fixture" : "/usr/bin/script",
        ["--quiet", "--return", "--command", "env 'PS1=PROJECT_SHELL> ' /bin/bash --noprofile --norc", "/dev/null"],
        { stdio: "inherit", cwd: workspace, env: { ...process.env, HOME: home } });
      const abort = () => child.kill("SIGTERM");
      signal?.addEventListener("abort", abort, { once: true });
      const status = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      signal?.removeEventListener("abort", abort);
      if (status !== 0) throw new Error(`Project shell exited with status ${status}.`);
    },
  }]);
  assert.equal(process.stdin.isRaw, false);
  if (process.argv[2]?.includes("SIG")) {
    assert.equal(pauses, 1); assert.equal(shells, 1); assert.equal(reloads, 0); assert.equal(removals, 0);
    console.log("TERMINAL_SIGNAL_OK");
  } else {
  assert.equal(pauses, 1); assert.equal(shells, 1); assert.equal(reloads, 1); assert.equal(removals, 1);
  assert.equal(peerProfiles.length, 1); assert.equal(peerProfiles[0].profile, "b");
  assert.equal(projects[0].status, "online"); assert.equal(projects[0].activeRuns, 1);
  assert(existsSync(home) && existsSync(workspace));
  console.log("TERMINAL_PROJECTS_OK: raw mode restored, B unchanged, retained fixture files, peer refreshed");
  }
} finally { peer.close(); control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
