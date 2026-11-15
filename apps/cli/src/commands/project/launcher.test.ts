import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { loaded } from "../../__tests__/loaded-machine.mjs";
import { projectIdentity } from "./validators.js";

const refusedLaunch = (args: string[], env: Record<string, string> = {}) => {
  const home = mkdtempSync(join(tmpdir(), "cv-refusal-"));
  try {
    mkdirSync(join(home, ".config/convoy"), { recursive: true });
    writeFileSync(join(home, ".config/convoy/config.toml"), `
[profiles.a]
name = "A"
url = "https://example.convex.cloud"
api_key = "fixture-key"
project_id = "project"
paths = ["${home}"]
[profiles.a.project_isolation]
identity = "${projectIdentity("https://example.convex.cloud", "org", "project")}"
organization_id = "org"
`);
    mkdirSync(join(home, ".convoy"), { mode: 0o700 });
    writeFileSync(join(home, ".convoy/environment.json"), JSON.stringify({ schema: 1, mode: "isolated" }), { mode: 0o600 });
    const preload = join(home, "launcher.mjs");
    writeFileSync(preload, `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
${args.includes('--json') ? 'setInterval(() => {}, 1000);' : ''}
${args[0] === '--profile' ? "Object.defineProperty(process.stdin, 'isTTY', { value: true });" : ''}
const spawn = cp.spawn;
cp.spawn = (command, args, options) => command === 'sudo'
? spawn(process.execPath, ['-e', 'console.error("Project is active. Stop its foreground connection or shell before continuing."); process.exit(1)'], options)
: spawn(command, args, options);
syncBuiltinESMExports();
`);
    const result = spawnSync(process.execPath, ["--import", "tsx", "--import", preload,
      resolve("bin/convoy.ts"), ...args], { env: { ...process.env, HOME: home, ...env }, encoding: "utf8", timeout: 15000 });
    expect(result.stderr).toContain("Project is active");
    expect(result.status, "command must exit even if an error leaves a handle open").toBe(1);
    expect(result.stderr).not.toMatch(/at launchProject|Node\.js v|throw new Error/);
    expect(result.stderr).toContain("convoy service status");
    expect(result.stderr).toContain("If another connection");
    if (args.includes("--json")) {
      const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({ v: 1, event: "status", status: "failed" }));
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
};

it.each([["connect", "--profile", "a"], ["--profile", "a"], ["connect", "--profile", "a", "--json"]])(
  "reports a refused project launch without an unhandled stack: %j", (...args) => refusedLaunch(args), 20000,
);

// A loaded machine can start tsx past the hang guard; only a command that never exits may fail it (OS-2278).
it("reports a refused project launch when tsx starts slowly", () => refusedLaunch(["connect", "--profile", "a"], loaded({ LOADED_START_MS: "3500" })), 20000);
