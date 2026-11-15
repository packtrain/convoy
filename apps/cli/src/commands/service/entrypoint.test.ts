import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { serviceRequest } from "./client.js";

it.skipIf(process.platform !== "linux").each(["diagnostic", "closed-output"])("runs the real service entrypoint: %s", async (kind) => {
  const home = mkdtempSync(join(tmpdir(), "cv-entry-")); const preload = join(home, "preload.mjs");
  const socket = join(home, ".convoy/service/control.sock"); let pid: number | undefined;
  const entry = fileURLToPath(new URL("../../../bin/convoy.ts", import.meta.url));
  mkdirSync(join(home, ".config/convoy"), { recursive: true });
  if (kind === "diagnostic") writeFileSync(join(home, ".config/convoy/config.toml"), `
[profiles.a]
name="A"
url="https://example.com"
api_key="private-fixture-key"
project_id="p"
paths=["/missing"]
[profiles.a.project_isolation]
identity="${"a".repeat(64)}"
organization_id="o"
`);
  writeFileSync(preload, `
import fs from 'node:fs'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
const exists=fs.existsSync, sync=cp.spawnSync;
fs.existsSync=p=>p==='/etc/convoy-projects.json'||exists(p);
cp.spawnSync=(cmd,args,opts)=>cmd==='sudo'?{status:0,stdout:JSON.stringify({workspace:${JSON.stringify(home)},registrations:[]})}:sync(cmd,args,opts);
syncBuiltinESMExports();
if (${JSON.stringify(kind)}==='closed-output' && process.argv[1].includes('service-entrypoint')) setTimeout(()=>process.stderr.write('late diagnostic\\n'),700);
`);
  try {
    const result = spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), "--import", preload, entry, "service", "start", "-b"], {
      env: { ...process.env, HOME: home }, encoding: "utf8", timeout: 10000,
    });
    if (kind === "diagnostic") {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid service registration snapshot");
      expect(result.stderr).not.toContain("private-fixture-key");
    } else {
      expect(result.status, result.stderr).toBe(0);
      pid = (await serviceRequest(socket, { op: "status" })).pid;
      await new Promise((resolve) => setTimeout(resolve, 900));
      await expect(serviceRequest(socket, { op: "status" })).resolves.toMatchObject({ ok: true, pid, mode: "isolated" });
      expect((await serviceRequest(socket, { op: "inspect" })).result).toMatchObject({ mode: "isolated" });
      await serviceRequest(socket, { op: "stop" });
    }
  } finally {
    if (pid) { try { process.kill(pid, "SIGTERM"); } catch { /* Owner already stopped. */ } }
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);

it("advertises service management without the removed serve command",()=>{
 const entry=fileURLToPath(new URL("../../../bin/convoy.ts",import.meta.url));
 const result=spawnSync(process.execPath,["--import",createRequire(import.meta.url).resolve("tsx"),entry,"--help"],{encoding:"utf8"});
 expect(result.status).toBe(0);
 expect(result.stdout).toMatch(/\n\s+service\b/);
 expect(result.stdout).not.toMatch(/\n\s+serve\b/);
});

it.skipIf(process.platform === "win32")("starts a shared service without the launcher or flock and refuses a second owner", async () => {
  const home = mkdtempSync(join(tmpdir(), "cv-shared-entry-"));
  const entry = fileURLToPath(new URL("../../../bin/convoy.ts", import.meta.url));
  const socket = join(home, ".convoy/service/control.sock");
  const start = () => spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), entry, "service", "start", "-b"], {
    env: { ...process.env, HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 10000,
  });
  let pid: number | undefined;
  try {
    const first = start();
    expect(first.status, first.stderr).toBe(0);
    const status = await serviceRequest(socket, { op: "status" }); pid = status.pid;
    expect(status.mode).toBe("shared");
    expect(readFileSync(join(home, ".convoy/environment.json"), "utf8")).toContain('"shared"');
    const second = start();
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("Service already running");
    await serviceRequest(socket, { op: "stop" });
  } finally {
    if (pid) { try { process.kill(pid, "SIGTERM"); } catch { /* Owner already stopped. */ } }
    rmSync(home, { recursive: true, force: true });
  }
}, 25000);
