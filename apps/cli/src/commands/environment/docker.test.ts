import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { serviceServer } from "../service/server.js";
import { ServiceClient } from "../service/client.js";
import { bridge } from "./docker.js";

it("attaches two clients through real bridge subprocesses and detaches independently", async () => {
  const directory = mkdtempSync(join(tmpdir(), "convoy bridge "));
  const socket = join(directory, "control.sock");
  const source = fileURLToPath(new URL("../service/bridge.ts", import.meta.url));
  const code = `import { serviceBridge } from ${JSON.stringify(source)}; await serviceBridge(${JSON.stringify(socket)});`;
  writeFileSync(join(directory, "docker"), `#!/usr/bin/env node\nconst {spawn}=require('node:child_process');\nconst child=spawn(process.execPath,${JSON.stringify(["--import", createRequire(import.meta.url).resolve("tsx"), "--input-type=module", "-e", code])},{stdio:'inherit'});\nprocess.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code??1));\n`, { mode: 0o755 });
  const control = serviceServer(() => ({ pid: process.pid, stopping: false, profiles: [] }), async () => ({ pid: process.pid, stopping: false, profiles: [] }), () => {});
  await new Promise<void>(resolve => control.server.listen(socket, resolve));
  vi.stubEnv("PATH", `${directory}:${process.env.PATH}`);
  const environment = { schema: 1 as const, name: "demo", owner: "00000000-0000-4000-8000-000000000000", daemon: "engine", version: "0.75.0", deployment: "example", domains: "" };
  let a: ServiceClient | undefined, b: ServiceClient | undefined;
  try {
    a = await ServiceClient.open(bridge(environment)); b = await ServiceClient.open(bridge(environment));
    const receive = vi.fn();
    await a.subscribe({}, () => {}); await b.subscribe({}, receive);
    a.close();
    expect((await b.request({ op: "status" })).pid).toBe(process.pid);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ event: "snapshot" }));
  } finally {
    a?.close(); b?.close(); control.dispose();
    await new Promise<void>(resolve => control.server.close(() => resolve()));
    vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  }
}, 10000);

it("preserves project recovery details while redacting stdin credentials on target failure", async () => {
  const { docker } = await import("./docker.js");
  const directory = mkdtempSync(join(tmpdir(), "convoy error "));
  writeFileSync(join(directory, "docker"), "#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on('end',()=>{console.log('Created remote project Demo, ID project-123');console.error('Rejected private-fixture-key');process.exitCode=1;});\n", { mode: 0o755 });
  vi.stubEnv("PATH", `${directory}:${process.env.PATH}`);
  try {
    const failure = await docker(["exec"], { input: '{"apiKey":"private-fixture-key"}', redact: ["private-fixture-key"] }).catch(error => error as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("project-123");
    expect((failure as Error).message).not.toContain("private-fixture-key");
  } finally { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); }
});

it("forwards retained-log gap diagnostics without contaminating JSON stdout", async () => {
  const { docker } = await import("./docker.js");
  const directory = mkdtempSync(join(tmpdir(), "convoy diagnostic "));
  writeFileSync(join(directory, "docker"), "#!/usr/bin/env node\nconsole.error('Some operational logs have expired from retention.');console.log('{}');\n", { mode: 0o755 });
  vi.stubEnv("PATH", `${directory}:${process.env.PATH}`);
  const output = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    expect(await docker(["exec"], { diagnostics: true })).toBe("{}");
    expect(output.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("expired from retention");
  } finally { output.mockRestore(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); }
});
