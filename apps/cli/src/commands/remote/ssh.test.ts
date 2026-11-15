import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: undefined as undefined | (() => unknown) }));
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => mocks.spawn ? mocks.spawn() : actual.spawn(...args) };
});
import { ServiceClient } from "../service/client.js";
import { serviceServer } from "../service/server.js";
import { servicePaths } from "../service/paths.js";
import { CAPABILITIES } from "../service/server.js";
import { remoteVersion, sshArgs, sshBridge } from "./ssh.js";
import { remoteTarget } from "./workflow.js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const cli = resolve("bin/convoy.ts");
let directory: string, path: string, home: string;
// Fake ssh: drops options, prints shell startup noise, then runs the remote command like sshd.
const fakeSsh = (body: string) => {
  // Records the command unwrapped from the login shell's -lc argument, then runs it in a plain sh as that shell.
  writeFileSync(join(directory, "bin", "ssh"), `#!/bin/sh\nfor last; do :; done\nprintf '%s\\n' "$@" > "${directory}/args"
SHELL="${directory}/bin/print-command" /bin/sh -c "$last" >> "${directory}/args"\nexport SHELL="${directory}/bin/login-shell"\n${body}\n`);
  chmodSync(join(directory, "bin", "ssh"), 0o755);
  writeFileSync(join(directory, "bin", "print-command"), `#!/bin/sh\nprintf '%s\\n' "$2"\n`);
  writeFileSync(join(directory, "bin", "login-shell"), `#!/bin/sh\nexec /bin/sh -c "$2"\n`);
  for (const name of ["print-command", "login-shell"]) chmodSync(join(directory, "bin", name), 0o755);
};
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cv-ssh-"));
  mkdirSync(join(directory, "bin")); mkdirSync(join(directory, "my bin"));
  home = join(directory, "home"); mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(directory, "my bin", "convoy"), `#!/bin/sh\nexec "${process.execPath}" --import tsx "${cli}" "$@"\n`);
  chmodSync(join(directory, "my bin", "convoy"), 0o755);
  path = process.env.PATH!; process.env.PATH = `${join(directory, "bin")}:${path}`;
});
afterEach(() => { mocks.spawn = undefined; process.env.PATH = path; rmSync(directory, { recursive: true, force: true }); });
const remote = () => ({ name: "vm", host: "dev@vm", command: join(directory, "my bin", "convoy") });
// A local service behind the fake ssh; the remote setup command only records its stdin.
async function withService(run: () => Promise<void>) {
  const control = serviceServer(() => ({ profiles: [], pid: 1 }), async () => ({}), () => {});
  await new Promise<void>(done => control.server.listen(servicePaths(home).socket, done));
  try { await run(); } finally { control.dispose(); await new Promise<void>(done => control.server.close(() => done())); }
}
const setupSsh = (result: string) => fakeSsh(`case "$last" in *project*setup*) cat > "${directory}/stdin"; echo convoy-bridge-ready-1; echo noise; echo '${result}';;
  *) HOME="${home}" exec /bin/sh -c "$last";; esac`);
const guided = { url: "https://demo.convex.cloud", apiKey: "secret-key", profileKey: "a", profileName: "A", project: "p" };

it("quotes the remote command, runs it through the login shell and keeps forwarding and prompts disabled", () => {
  const args = sshArgs({ name: "vm", host: "vm", container: "box", command: "/opt/my convoy" }, ["project", "add", "/srv/it's here"]);
  expect(args.slice(0, -1)).toEqual(["-T", "-o", "BatchMode=yes", "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes",
    "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "--", "vm"]);
  // The remote account's shell gets the command as one -lc argument, so its profile's PATH applies.
  const login = join(directory, "login-shell");
  writeFileSync(login, `#!/bin/sh\nprintf '%s\\n' "$@"\n`); chmodSync(login, 0o755);
  expect(execFileSync("/bin/sh", ["-c", args.at(-1)!], { env: { SHELL: login }, encoding: "utf8" }))
    .toBe("-lc\nexec 'docker' 'exec' '-i' 'box' '/opt/my convoy' 'project' 'add' '/srv/it'\\''s here'\n");
  expect(sshArgs({ name: "vm", host: "vm" }, ["attach"], { tty: true }).slice(0, 1)).toEqual(["-t"]);
});

it("negotiates through startup noise and detaches without stopping the service", async () => {
  const control = serviceServer(() => ({ profiles: [], pid: 1 }), async () => ({}), () => {});
  await new Promise<void>(done => control.server.listen(servicePaths(home).socket, done));
  fakeSsh(`echo "Welcome to the VM"; printf 'no newline'; HOME="${home}" exec /bin/sh -c "$last"`);
  try {
    const client = await ServiceClient.open(sshBridge(remote()));
    expect(client.hello?.capabilities).toContain("attach-v1");
    client.close(); await client.closed;
    expect(control.server.listening).toBe(true);
  } finally { control.dispose(); await new Promise<void>(done => control.server.close(() => done())); }
}, 20_000);

it.each([
  ["a host-key failure", 'echo "Host key verification failed." >&2; exit 255', "SSH to dev@vm failed: Host key verification failed."],
  ["a missing executable", 'exec /bin/sh -c "missing-convoy"', "Convoy CLI not found on vm"],
  ["a stopped service", () => `HOME="${home}" exec /bin/sh -c "$last"`, "Service unavailable. Start it with convoy service start -b --remote vm."],
])("reports %s", async (_name, body, message) => {
  fakeSsh(typeof body === "function" ? body() : body);
  const opened = ServiceClient.open(sshBridge(remote()));
  await expect(opened).rejects.toThrow(message);
  await expect(opened).rejects.not.toThrow("Request ID");
}, 20_000);

it("starts the remote service in the background and reports its refusal", async () => {
  // An isolated record without the launcher registry makes the remote refuse.
  mkdirSync(join(home, ".convoy"), { mode: 0o700 });
  writeFileSync(join(home, ".convoy/environment.json"), JSON.stringify({ schema: 1, mode: "isolated" }), { mode: 0o600 });
  fakeSsh(`echo noise; HOME="${home}" exec /bin/sh -c "$last"`);
  await expect(remoteTarget(remote()).start()).rejects.toThrow("launcher registry");
  expect(readFileSync(join(directory, "args"), "utf8")).toContain("'service' 'start' '-b'");
}, 20_000);

it("reads saved operational logs from the remote while its service is stopped", async () => {
  mkdirSync(join(home, ".convoy/service"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, ".convoy/service/operations.ndjson"), JSON.stringify({ seq: 1, ts: 1, profile: "a", message: "stopped" }) + "\n", { mode: 0o600 });
  fakeSsh(`echo noise; HOME="${home}" exec /bin/sh -c "$last"`);
  const page = await remoteTarget(remote()).savedLogs(0, "a");
  expect(page).toEqual({ entries: [{ seq: 1, ts: 1, profile: "a", message: "stopped" }], cursor: 1, gap: false });
}, 20_000);

it("opens the confirmed project shell and reports its exit status", async () => {
  fakeSsh("exit 3");
  await expect(remoteTarget(remote()).shell("a", "id-a", new AbortController().signal)).rejects.toThrow("Project shell exited with status 3.");
  expect(readFileSync(join(directory, "args"), "utf8")).toContain("'project' 'shell' 'a' '--expected-identity' 'id-a'");
});

it("forwards a runtime login to the remote project shell", async () => {
  fakeSsh("exit 0");
  await remoteTarget(remote()).shell("a", "id-a", new AbortController().signal, "codex");
  expect(readFileSync(join(directory, "args"), "utf8")).toContain("'project' 'shell' 'a' '--expected-identity' 'id-a' '--login' 'codex'");
});

it("registers a guided project with the API key on stdin only", async () => {
  setupSsh('{"ok":true,"registered":true,"applied":true,"retrySafe":false,"phase":"complete"}');
  await withService(async () => {
    const target = remoteTarget(remote());
    await expect(target.checkProject()).resolves.toBe(true);
    await expect(target.addProject("repo", guided)).resolves.toMatchObject({ ok: true, phase: "complete" });
  });
  expect(JSON.parse(readFileSync(join(directory, "stdin"), "utf8"))).toEqual({ guided: true, directory: "repo", options: guided });
  expect(readFileSync(join(directory, "args"), "utf8")).toContain("'project' 'setup'");
  expect(readFileSync(join(directory, "args"), "utf8")).not.toContain("secret-key");
}, 20_000);

it("sends nothing to a service without guided setup support", async () => {
  setupSsh("{}");
  const index = CAPABILITIES.indexOf("project-setup-v1");
  expect(index).toBeGreaterThanOrEqual(0);
  CAPABILITIES.splice(index, 1);
  try {
    await withService(async () => {
      const target = remoteTarget(remote());
      await expect(target.checkProject()).resolves.toBe(false);
      await expect(target.addProject("repo", guided)).resolves.toMatchObject({ ok: false, reason: "target-incompatible", retrySafe: true });
    });
  } finally { CAPABILITIES.splice(index, 0, "project-setup-v1"); }
  expect(readFileSync(join(directory, "args"), "utf8")).not.toContain("'project' 'setup'");
}, 20_000);

it("reports a stopped remote service before registration starts", async () => {
  setupSsh("{}");
  const target = remoteTarget(remote());
  await expect(target.checkProject()).rejects.toThrow("Service unavailable");
  await expect(target.addProject("repo", guided)).resolves.toMatchObject({ ok: false, reason: "environment-unavailable" });
  expect(readFileSync(join(directory, "args"), "utf8")).not.toContain("'project' 'setup'");
}, 20_000);

it("reads managed credential status over SSH", async () => {
  fakeSsh(`echo convoy-bridge-ready-1; echo '{"service":true,"compatible":true,"configurationError":false,"entries":[],"projects":[]}'`);
  await expect(remoteTarget(remote()).credentials.status()).resolves.toMatchObject({ service: true, entries: [] });
  expect(readFileSync(join(directory, "args"), "utf8")).toContain("'keys' 'status' '--json'");
});

it("reports a remote that never answers the version check", async () => {
  fakeSsh("exec sleep 5");
  await expect(remoteVersion(remote(), 2000)).rejects.toThrow("Remote vm did not answer within 2 seconds.");
});

it("reads the installed version for remote checks", async () => {
  fakeSsh(`echo noise; exec /bin/sh -c "$last"`);
  await expect(remoteVersion(remote())).resolves.toEqual({ version: expect.stringMatching(/^\d+\.\d+\.\d+/) });
}, 20_000);

it("finds the CLI at an install path when it is not on the SSH PATH", async () => {
  fakeSsh(`echo noise; PATH=/usr/bin:/bin exec /bin/sh -c "$last"`);
  const found = join(directory, "my bin", "convoy");
  await expect(remoteVersion({ name: "vm", host: "vm" }, 20_000, [join(directory, "missing"), found]))
    .resolves.toEqual({ version: expect.stringMatching(/^\d+\.\d+\.\d+/), command: found });
}, 30_000);

it("keeps an explicit command that is missing", async () => {
  fakeSsh(`PATH=/usr/bin:/bin exec /bin/sh -c "$last"`);
  const found = join(directory, "my bin", "convoy");
  await expect(remoteVersion({ name: "vm", host: "vm", command: join(directory, "missing") }, 20_000, [found])).rejects.toThrow("Convoy CLI not found on vm");
  expect(readFileSync(join(directory, "args"), "utf8")).not.toContain(found);
});

it("turns an ssh stdout failure into a stream error instead of crashing", async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  mocks.spawn = () => child;
  const stream = sshBridge(remote());
  const failed = new Promise(resolve => stream.once("error", resolve));
  child.stdout.emit("error", new Error("read failed"));
  await expect(failed).resolves.toBeInstanceOf(Error);
});

it("reads native account status on the remote with the confirmed project identity", async () => {
  const result = { codex: { status: "signed-in", method: "ChatGPT" }, "claude-code": { status: "signed-out" } };
  fakeSsh(`echo 'convoy-bridge-ready-1'; echo '${JSON.stringify(result)}'`);
  expect(await remoteTarget(remote()).account("a", "id-a")).toEqual(result);
  expect(readFileSync(join(directory, "args"), "utf8")).toContain("'project' 'account' 'a' '--expected-identity' 'id-a'");
});
