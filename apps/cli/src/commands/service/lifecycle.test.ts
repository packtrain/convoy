import { afterEach, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serviceRequest } from "./client.js";

const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill("SIGTERM"); await closed;
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function launch(directory: string) {
  const child = spawn("/usr/bin/flock", ["--nonblock", "--no-fork", "--conflict-exit-code", "73",
    join(directory, "owner.lock"), process.execPath, "--import", "tsx",
    fileURLToPath(new URL("./__tests__/service-entrypoint.ts", import.meta.url)), directory], {
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  children.push(child); return child;
}
function ready(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    child.stdout?.once("data", () => resolve());
    child.once("exit", (code) => reject(new Error(`Early fixture exit ${code}`)));
    child.once("error", reject);
  });
}
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) { if (check()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error("Condition timed out");
}

it.skipIf(process.platform !== "linux" || !existsSync("/usr/bin/flock"))("holds a kernel singleton lock, survives viewer loss and recovers after supervisor death", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cv-lifetime-")); directories.push(directory);
  const owner = launch(directory); await ready(owner);
  const duplicate = launch(directory);
  expect(await new Promise((resolve) => duplicate.once("exit", resolve))).toBe(73);
  const socket = join(directory, "control.sock");
  await serviceRequest(socket, { op: "logs" });
  expect((await serviceRequest(socket, { op: "status" })).profiles).toHaveLength(1);
  owner.stdout?.destroy(); owner.stderr?.destroy();
  expect((await serviceRequest(socket, { op: "status" })).pid).toBe(owner.pid);
  owner.kill("SIGKILL");
  await until(() => existsSync(join(directory, "cleaned")));
  expect(existsSync(socket)).toBe(true);
  const replacement = launch(directory); await ready(replacement);
  await serviceRequest(socket, { op: "stop" });
  await until(() => replacement.exitCode === 0);
  expect(existsSync(socket)).toBe(false);
}, 10000);
