import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect, Socket } from "node:net";
import { runService } from "./workflow.js";
import { ServiceClient, serviceRequest } from "./client.js";
import { projectIdentity } from "../project/validators.js";
import { serviceSnapshot, sharedServiceSnapshot } from "./resolution.js";
import { ServiceLogs } from "./logs.js";

const temporary: string[] = [];
const services: Awaited<ReturnType<typeof runService>>[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function paths() {
  const directory = mkdtempSync(join(tmpdir(), "cv-service-")); temporary.push(directory);
  return { directory, socket: join(directory, "control.sock") };
}
function snapshot() {
  const identity = projectIdentity("https://example.convex.cloud", "org", "project");
  const profile = { name: "A", url: "https://example.convex.cloud", api_key: "secret-token", project_id: "project",
    paths: ["/srv/work/a"], project_isolation: { identity, organization_id: "org" } };
  return { config: { profiles: { a: profile } }, environment: { workspace: "/srv/work",
    registrations: [{ identity, path: "/srv/work/a", uid: 20000, active: false, status: "stopped" as const }] } };
}
async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 150; n++) { if (await check()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error("Condition timed out");
}

function sharedProfile(path = "/Users/me/code/a") {
  return { name: "A", url: "https://example.convex.cloud", api_key: "secret-token", project_id: "project",
    paths: [path], project_mode: "shared" as const, project_organization: "org" };
}
describe("shared startup snapshot", () => {
  it("accepts shared registrations without a launcher registry", () => {
    const result = sharedServiceSnapshot({ profiles: { a: sharedProfile() } });
    expect(result).toEqual([expect.objectContaining({ key: "a", identity: projectIdentity("https://example.convex.cloud", "org", "project"),
      path: "/Users/me/code/a", config: expect.objectContaining({ mode: "shared", apiKey: "secret-token", organizationId: "org", jsonEvents: true }) })]);
  });
  it("does not start ordinary profiles", () => {
    const { project_mode: _mode, project_organization: _org, ...ordinary } = sharedProfile();
    expect(sharedServiceSnapshot({ profiles: { a: ordinary, b: sharedProfile("/Users/me/code/b") } }).map(entry => entry.key)).toEqual(["b"]);
  });
  it("refuses isolated registrations, and the isolated snapshot refuses shared ones", () => {
    const { config, environment } = snapshot();
    expect(() => sharedServiceSnapshot({ profiles: { a: config.profiles.a, b: sharedProfile() } })).toThrow("isolated registrations");
    expect(() => serviceSnapshot({ profiles: { ...config.profiles, b: sharedProfile() } }, environment)).toThrow("shared registrations");
  });
  it("rejects relative paths, provider keys and a missing organization", () => {
    for (const profile of [sharedProfile("code/a"), { ...sharedProfile(), provider_key: "k" }, { ...sharedProfile(), project_organization: undefined }]) {
      expect(() => sharedServiceSnapshot({ profiles: { a: profile } })).toThrow("Invalid service registration");
    }
  });
  it("refuses aliases of one project at different folders in either order", () => {
    expect(() => sharedServiceSnapshot({ profiles: { a: sharedProfile("/code/different"), z: sharedProfile("/code/original") } })).toThrow("Invalid service registration");
    expect(() => sharedServiceSnapshot({ profiles: { z: sharedProfile("/code/original"), a: sharedProfile("/code/different") } })).toThrow("Invalid service registration");
    expect(sharedServiceSnapshot({ profiles: { a: sharedProfile(), b: sharedProfile() } }).map(entry => entry.key)).toEqual(["a"]);
  });
  it("carries each shared registration's credential assignment (OS-2248)", () => {
    const identity = projectIdentity("https://example.convex.cloud", "org", "project");
    const credentials = { version: 1 as const, generation: 1, bindings: {}, claudeBindings: { [identity]: { mode: "managed" as const, name: "bedrock-a" } },
      entries: { "bedrock-a": { id: "e", enabled: true, current: 1, revisions: [{ revision: 1, secret: "s", createdAt: 1 }], aws: { provider: "bedrock" as const, region: "us-east-1" } } } };
    expect(sharedServiceSnapshot({ profiles: { a: sharedProfile() } }, credentials)[0].auth)
      .toEqual({ mode: "native", claude: { mode: "managed", name: "bedrock-a", entryId: "e", revision: 1 } });
  });
  it("limits shared identities to 128", () => {
    const profiles = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`p${index}`, { ...sharedProfile(`/code/${index}`), project_id: `project-${index}` }]));
    expect(() => sharedServiceSnapshot({ profiles })).toThrow("at most 128");
  });
});
describe("startup snapshot", () => {
  it("rejects oversized profile labels before they can exceed control frame limits", () => {
    const { config, environment } = snapshot();
    expect(() => serviceSnapshot({ profiles: { ["a".repeat(65536)]: config.profiles.a } }, environment))
      .toThrow("Invalid service registration");
  });
  it("accepts empty configuration and collapses aliases without mixing credentials", () => {
    expect(serviceSnapshot({ profiles: {} }, { workspace: "/srv/work", registrations: [] })).toEqual([]);
    const { config, environment } = snapshot();
    const result = serviceSnapshot({ profiles: { b: config.profiles.a, ...config.profiles } }, environment);
    expect(result.map((entry) => entry.key)).toEqual(["a"]);
    expect(result[0].config.apiKey).toBe("secret-token");
  });
  it("rejects workspace, identity, pending and provider mismatches", () => {
    for (const change of ["path", "identity", "pending", "provider", "codex-provider"]) {
      const { config, environment } = snapshot();
      if (change === "path") config.profiles.a.paths = ["/elsewhere"];
      if (change === "identity") config.profiles.a.project_id = "other";
      if (change === "pending") Object.assign(environment.registrations[0], { status: "pending" });
      if (change === "provider") Object.assign(config.profiles.a, { provider_key: "shared" });
      if (change === "codex-provider") Object.assign(config.profiles.a, { codex_provider_key: "shared" });
      expect(() => serviceSnapshot(config, environment)).toThrow("Invalid service registration");
    }
  });
  it("refuses a bound AWS credential on a launcher without credentials-aws-v1 (OS-2107)", () => {
    const { config, environment } = snapshot();
    const identity = config.profiles.a.project_isolation.identity;
    const credentials = { version: 1 as const, generation: 1, bindings: { [identity]: { mode: "managed" as const, name: "work" } },
      entries: { work: { id: "id", enabled: true, current: 1, aws: { provider: "mantle" as const, region: "us-east-1" },
        revisions: [{ revision: 1, secret: "s", createdAt: 1 }] } } };
    expect(() => serviceSnapshot(config, { ...environment, capabilities: ["credentials-v1"] }, credentials)).toThrow("updated project launcher");
    expect(serviceSnapshot(config, { ...environment, capabilities: ["credentials-v1", "credentials-aws-v1"] }, credentials)[0].auth?.mode).toBe("managed");
  });
  it("refuses a Claude Code binding on a launcher without credentials-claude-v1 (OS-2108)", () => {
    const { config, environment } = snapshot();
    const identity = config.profiles.a.project_isolation.identity;
    const credentials = { version: 1 as const, generation: 1, bindings: {}, claudeBindings: { [identity]: { mode: "disabled" as const } }, entries: {} };
    expect(() => serviceSnapshot(config, { ...environment, capabilities: ["credentials-v1", "credentials-aws-v1"] }, credentials)).toThrow("updated project launcher");
    expect(serviceSnapshot(config, { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1"] }, credentials)[0].auth).toEqual({
      mode: "native", claude: { mode: "disabled" },
    });
  });
  it("refuses an Anthropic binding on a launcher without credentials-anthropic-v1 (OS-2016)", () => {
    const { config, environment } = snapshot();
    const identity = config.profiles.a.project_isolation.identity;
    const credentials = {
      version: 1 as const, generation: 1, bindings: {}, claudeBindings: { [identity]: { mode: "managed" as const, name: "work" } },
      entries: { work: { id: "id", enabled: true, current: 1, provider: "anthropic" as const, revisions: [{ revision: 1, secret: "sk-ant", createdAt: 1 }] } },
    };
    expect(() => serviceSnapshot(config, { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1"] }, credentials)).toThrow("updated project launcher");
    expect(serviceSnapshot(config, { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1", "credentials-anthropic-v1"] }, credentials)[0].auth?.claude?.mode).toBe("managed");
  });
  it("refuses an OpenCode binding on a launcher without credentials-opencode-v1 (OS-2018)", () => {
    const { config, environment } = snapshot();
    const identity = config.profiles.a.project_isolation.identity;
    const credentials = {
      version: 1 as const, generation: 1, bindings: {}, opencodeBindings: { [identity]: { openai: "work" } },
      entries: { work: { id: "id", enabled: true, current: 1, revisions: [{ revision: 1, secret: "key", createdAt: 1 }] } },
    };
    expect(() => serviceSnapshot(config, { ...environment, capabilities: ["credentials-v1", "credentials-cursor-v1"] }, credentials)).toThrow("updated project launcher");
    expect(serviceSnapshot(config, { ...environment, capabilities: ["credentials-opencode-v1"] }, credentials)[0].auth).toEqual({
      mode: "native", opencode: { openai: { mode: "managed", name: "work", entryId: "id", revision: 1 } },
    });
  });
  it("refuses an OpenCode Bedrock binding on a launcher without credentials-opencode-v2 (OS-2205)", () => {
    const { config, environment } = snapshot();
    const identity = config.profiles.a.project_isolation.identity;
    const credentials = {
      version: 1 as const, generation: 1, bindings: {}, opencodeBindings: { [identity]: { "amazon-bedrock": "aws" } },
      entries: { aws: { id: "id", enabled: true, current: 1, aws: { provider: "bedrock" as const, region: "us-east-1" }, revisions: [{ revision: 1, secret: "token", createdAt: 1 }] } },
    };
    expect(() => serviceSnapshot(config, { ...environment, capabilities: ["credentials-opencode-v1"] }, credentials)).toThrow("updated project launcher");
    expect(serviceSnapshot(config, { ...environment, capabilities: ["credentials-opencode-v1", "credentials-opencode-v2"] }, credentials)[0].auth?.opencode?.["amazon-bedrock"]?.mode).toBe("managed");
  });
  it("refuses a Cursor binding on a launcher without credentials-cursor-v1 (OS-2017)", () => {
    const { config, environment } = snapshot();
    const identity = config.profiles.a.project_isolation.identity;
    const credentials = {
      version: 1 as const, generation: 1, bindings: {}, cursorBindings: { [identity]: { mode: "managed" as const, name: "work" } },
      entries: { work: { id: "id", enabled: true, current: 1, provider: "cursor" as const, revisions: [{ revision: 1, secret: "key", createdAt: 1 }] } },
    };
    expect(() => serviceSnapshot(config, { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1"] }, credentials)).toThrow("updated project launcher");
    expect(serviceSnapshot(config, { ...environment, capabilities: ["credentials-cursor-v1"] }, credentials)[0].auth).toEqual({
      mode: "native", cursor: { mode: "managed", name: "work", entryId: "id", revision: 1 },
    });
  });
});

it("reports structured status, omits raw secrets, and stops via control EOF", async () => {
  const p = paths(); const { config, environment } = snapshot();
  const children: ChildProcessWithoutNullStreams[] = [];
  const service = await runService(p, serviceSnapshot(config, environment), () => {
    const child = spawn(process.execPath, ["-e", `
      console.log(JSON.stringify({v:1,event:'status',status:'online',message:'secret-token'}));
      console.error('secret-token');
      console.log(JSON.stringify({v:1,event:'thread',phase:'completed',error:'secret-token'}));
      process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));
    `]);
    children.push(child); return child;
  }); services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "online");
  const logs = await serviceRequest(p.socket, { op: "logs" });
  expect(JSON.stringify(logs)).not.toContain("secret-token");
  expect(logs.entries?.some((entry) => entry.message === "online")).toBe(true);
  await serviceRequest(p.socket, { op: "stop" });
  expect(children.every((child) => child.exitCode === 0)).toBe(true);
});

it("logs and shows service-owned guidance for a known worker failure reason only", async () => {
  const p = paths(); const { config, environment } = snapshot();
  const service = await runService(p, serviceSnapshot(config, environment), () => spawn(process.execPath, ["-e", `
    console.log(JSON.stringify({v:1,event:'status',status:'failed',reason:'runtime-missing',runtimes:['codex','secret-token'],message:'secret-token'}));
    process.exit(2);
  `])); services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "failed");
  const logs = JSON.stringify(await serviceRequest(p.socket, { op: "logs" }));
  const warning = (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].warning;
  expect(logs).toContain("Codex was detected but did not start. Run project check a for details.");
  expect(warning).toMatch(/^Codex was detected but did not start\. Run project check a for details\. Then run service reload --profile a\.$/);
  expect(logs + warning).not.toContain("secret-token");
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].runtimes).toEqual(["codex"]);
  await serviceRequest(p.socket, { op: "stop" });
});

it.each([
  [{ reason: "project-active", holder: "shell" }, /^Project is in use by a private project shell\. Stop it, then run service reload --profile a\.$/],
  [{ reason: "project-active", holder: "secret-token" }, /^Project is in use by another connection or shell\./],
  [{ reason: "sandbox-failed" }, /^The Linux sandbox did not start for this project\. Run project check a for the cause and fix\./],
  [{ reason: "auth-rejected" }, /^Convoy rejected this project's API key\. It may be revoked or expired\. Renew it with project add <folder> --profile-key a\./],
  [{ reason: "backend-unreachable" }, /^Cannot reach the Convoy backend from this host\. Check its network, DNS and proxy\./],
  [{ reason: "runtime-missing", untrusted: ["claude-code"] }, /^Claude Code is installed but not root-owned, or is group\/world-writable, so projects ignore it\. Reinstall it as root with umask 022\./],
  [{ reason: "runtime-missing", runtimes: [] }, /^No supported runtime is installed system-wide\. Install one as root: sudo sh -c 'umask 022 && npm install -g --prefix \/usr\/local @openai\/codex'\./],
])("names the cause and fix for %o", async (event, warning) => {
  const p = paths(); const { config, environment } = snapshot();
  const service = await runService(p, serviceSnapshot(config, environment), () => spawn(process.execPath, ["-e",
    `console.log(JSON.stringify(${JSON.stringify({ v: 1, event: "status", status: "failed", ...event })})); process.exit(2);`])); services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "failed");
  const state = (await serviceRequest(p.socket, { op: "status" })).profiles?.[0];
  expect(state?.warning).toMatch(warning);
  expect(state?.warning).not.toContain("secret-token");
  await serviceRequest(p.socket, { op: "stop" });
});

it("keeps a runtime notice while the project is online", async () => {
  const p = paths(); const { config, environment } = snapshot();
  const service = await runService(p, serviceSnapshot(config, environment), () => spawn(process.execPath, ["-e", `
    console.log(JSON.stringify({v:1,event:'status',status:'connecting',runtimes:['codex'],untrusted:[],loggedOut:['codex']}));
    console.log(JSON.stringify({v:1,event:'status',status:'online'}));
    process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));
  `])); services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "online");
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].warning).toBe("Codex is not logged in for this project. Run project login a --runtime codex.");
  await serviceRequest(p.socket, { op: "stop" });
});

it("keeps Antigravity in a worker's detected runtimes (OS-2474)", async () => {
  const p = paths(); const { config, environment } = snapshot();
  const service = await runService(p, serviceSnapshot(config, environment), () => spawn(process.execPath, ["-e", `
    console.log(JSON.stringify({v:1,event:'status',status:'connecting',runtimes:['codex','claude-code','opencode','cursor','antigravity']}));
    console.log(JSON.stringify({v:1,event:'status',status:'online'}));
    process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));
  `])); services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "online");
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].runtimes).toEqual(["codex", "claude-code", "opencode", "cursor", "antigravity"]);
  await serviceRequest(p.socket, { op: "stop" });
});

it("names the runtime's own login for a shared project's notice (OS-2247)", async () => {
  const p = paths();
  const service = await runService(p, sharedServiceSnapshot({ profiles: { a: sharedProfile() } }), () => spawn(process.execPath, ["-e", `
    console.log(JSON.stringify({v:1,event:'status',status:'connecting',runtimes:['codex'],loggedOut:['codex']}));
    console.log(JSON.stringify({v:1,event:'status',status:'online'}));
    process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));
  `])); services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "online");
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].warning).toBe("Codex is not logged in on this account. Run codex login --device-auth once for all projects.");
  await serviceRequest(p.socket, { op: "stop" });
});

it("warns after the last retry", async () => {
  const p = paths(); const { config, environment } = snapshot();
  const service = await runService(p, serviceSnapshot(config, environment), () => spawn(process.execPath, ["-e", "process.exit(1)"]), 5); services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "failed");
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].warning).toMatch(/^Connection failed after retries\./);
  await serviceRequest(p.socket, { op: "stop" });
});

it("clears a warning once a retry comes online", async () => {
  const p = paths(); const { config, environment } = snapshot();
  let attempts = 0;
  const service = await runService(p, serviceSnapshot(config, environment), () => spawn(process.execPath, ["-e", ++attempts === 1
    ? "console.log(JSON.stringify({v:1,event:'status',status:'failed',reason:'runtime-missing'})); process.exit(1);"
    : "console.log(JSON.stringify({v:1,event:'status',status:'online'})); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"]), 5); services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "online");
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].warning).toBeUndefined();
  await serviceRequest(p.socket, { op: "stop" });
});

it.each([0, 1, 3])("classifies exit %s and bounds retries", async (code) => {
  const p = paths(); const { config, environment } = snapshot();
  let attempts = 0;
  const service = await runService(p, serviceSnapshot(config, environment), () => {
    attempts++; return spawn(process.execPath, ["-e", `process.exit(${code})`]);
  }, 5); services.push(service);
  await until(async () => {
    const state = (await serviceRequest(p.socket, { op: "status" })).profiles?.[0];
    return attempts === (code === 1 ? 4 : 1) && state?.exitCode === code && state.status !== "connecting";
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(attempts).toBe(code === 1 ? 4 : 1);
});

it("rejects malformed/oversized control and keeps empty service alive after viewer loss", async () => {
  const p = paths(); const service = await runService(p, []); services.push(service);
  const request = (data: string) => new Promise<string>((resolve) => {
    const socket = connect(p.socket); let result = "";
    socket.on("connect", () => socket.write(data));
    socket.on("data", (chunk) => { result += chunk; }); socket.on("close", () => resolve(result));
  });
  expect(await request('{"v":2,"id":"x","op":"stop"}\n')).toContain('"ok":false');
  expect(await request("x".repeat(65537))).toBe("");
  expect((await serviceRequest(p.socket, { op: "status" })).profiles).toEqual([]);
});

it("bounds disk/memory retention, reports gaps and reloads retained logs", () => {
  const p = paths(); const logs = new ServiceLogs(p.directory, 300);
  for (let n = 0; n < 1200; n++) logs.add("a", "connecting");
  expect(logs.read(1).gap).toBe(true);
  expect(logs.read(0).entries).toHaveLength(100);
  for (const file of readdirSync(p.directory)) expect(readFileSync(join(p.directory, file)).length).toBeLessThanOrEqual(300);
  expect(new ServiceLogs(p.directory, 300).read(1199).entries[0].seq).toBe(1200);
});

it("keeps two project workers independent and stops pending retries", async () => {
  const p = paths(); const { config, environment } = snapshot();
  const first = serviceSnapshot(config, environment)[0];
  const second = { ...first, key: "b", identity: "b".repeat(64), config: { ...first.config, profileKey: "b", apiKey: "b-secret" } };
  const launches: string[] = [];
  const service = await runService(p, [first, second], (entry) => {
    launches.push(entry.key);
    return spawn(process.execPath, ["-e", entry.key === "a" ? "process.exit(1)" : `
      console.log(JSON.stringify({v:1,event:'status',status:'online'}));
      process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));
    `]);
  }, 1000); services.push(service);
  await until(async () => {
    const profiles = (await serviceRequest(p.socket, { op: "status" })).profiles;
    return profiles?.[0].status === "retrying" && profiles[1].status === "online";
  });
  await serviceRequest(p.socket, { op: "stop" });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(launches).toEqual(["a", "b"]);
});

it("repairs an interrupted log append before writing the next record", async () => {
  const { appendFileSync } = await import("node:fs");
  const p = paths();
  new ServiceLogs(p.directory).add("a", "online");
  appendFileSync(join(p.directory, "operations.ndjson"), '{"seq":2,"ts":');
  new ServiceLogs(p.directory).add("service", "ready");
  expect(new ServiceLogs(p.directory).read().entries.map((entry) => entry.message)).toEqual(["online", "ready"]);
});

it.each(["backoff", "recovery"])("reports retry state correctly: %s", async (phase) => {
  const p = paths(); const { config, environment } = snapshot(); let attempts = 0;
  const service = await runService(p, serviceSnapshot(config, environment), () => spawn(process.execPath, ["-e",
    ++attempts === 1 ? "process.exit(1)" : `console.log(JSON.stringify({v:1,event:'status',status:'online'}));process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`,
  ]), 500); services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].exitCode === 1);
  if (phase === "backoff") expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status).toBe("retrying");
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "online");
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].exitCode).toBeUndefined();
});

it("does not create log files when reading retained logs offline", () => {
  const p = paths();
  // Reader mode must not acquire writer privileges or repair a live owner's tail.
  new ServiceLogs(p.directory, undefined, "reader").read();
  expect(readdirSync(p.directory)).toEqual([]);
});


it("bounds stop when a child ignores EOF", async () => {
  const p = paths(); const { config, environment } = snapshot();
  let child: ChildProcessWithoutNullStreams | undefined;
  const service = await runService(p, serviceSnapshot(config, environment), () => {
    child = spawn(process.execPath, ["-e", "process.stdin.resume();setInterval(()=>{},1000)"]);
    return child;
  }, 1000, 150); services.push(service);
  try {
    const outcome = await Promise.race([
      serviceRequest(p.socket, { op: "stop" }).then(() => "stopped"),
      new Promise((resolve) => setTimeout(() => resolve("unbounded"), 700)),
    ]);
    expect(outcome).toBe("stopped");
    expect(child?.signalCode).not.toBeNull();
  } finally { child?.kill("SIGKILL"); }
});

it("finishes shutdown only after the stop response write completes", async () => {
  const p = paths(); const service = await runService(p, []); services.push(service);
  const original = Socket.prototype.end;
  const originalWrite = Socket.prototype.write;
  const stopSockets = new WeakSet<Socket>();
  const writeSpy = vi.spyOn(Socket.prototype, "write").mockImplementation(function (this: Socket, ...args: unknown[]) {
    if (typeof args[0] === "string" && args[0].includes('"id":"deferred-stop","ok":true')) stopSockets.add(this);
    return Reflect.apply(originalWrite, this, args);
  });
  const spy = vi.spyOn(Socket.prototype, "end").mockImplementation(function (this: Socket, ...args: unknown[]) {
    if (stopSockets.has(this) && typeof args[0] === "function") {
      setTimeout(() => Reflect.apply(original, this, args), 80);
      return this;
    }
    return Reflect.apply(original, this, args);
  });
  const client = await ServiceClient.open(p.socket);
  let finished = false; void service.done.then(() => { finished = true; });
  try {
    const request = client.request({ op: "stop" }, "deferred-stop");
    void request.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(finished).toBe(false);
    await until(async () => finished);
  } finally { spy.mockRestore(); writeSpy.mockRestore(); client.close(); }
});

it("reports a kicked worker as blocked without respawning", async () => {
  const p = paths(); const { config, environment } = snapshot();
  const service = await runService(p, serviceSnapshot(config, environment), () => spawn(process.execPath, ["-e", "process.exit(3)"]));
  services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].exitCode === 3);
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status).toBe("blocked");
});

it("preserves a valid request ID in a protocol error", async () => {
  const p = paths(); const service = await runService(p, []); services.push(service);
  const response = await new Promise<string>((resolve) => {
    const socket = connect(p.socket); let result = "";
    socket.on("connect", () => socket.write('{"v":2,"id":"version-test","op":"status"}\n'));
    socket.on("data", (data) => { result += data; }); socket.on("end", () => resolve(result));
  });
  expect(JSON.parse(response)).toMatchObject({ id: "version-test", ok: false });
});

it("reconciles additions without restarting siblings and retains workers on invalid input", async () => {
  const p = paths(); const { config, environment } = snapshot();
  const a = serviceSnapshot(config, environment)[0];
  const b = { ...a, key: "b", identity: "b".repeat(64), config: { ...a.config, profileKey: "b" } };
  let desired = [a]; let invalid = false;
  const launches: string[] = [];
  const service = await runService(p, desired, (entry) => {
    launches.push(entry.key);
    return spawn(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]);
  }, 1000, 35000, { snapshot: () => { if (invalid) throw new Error("secret invalid config"); return desired; } });
  services.push(service);
  desired = [a, b];
  await serviceRequest(p.socket, { op: "reconcile" });
  expect(launches).toEqual(["a", "b"]);
  invalid = true;
  await expect(serviceRequest(p.socket, { op: "reconcile" })).rejects.toThrow("configuration");
  expect((await serviceRequest(p.socket, { op: "status" })).profiles).toHaveLength(2);
  expect(JSON.stringify(await serviceRequest(p.socket, { op: "logs" }))).not.toContain("secret invalid");
});

it("refuses live removal without interrupt and stops only the selected identity", async () => {
  const p = paths(); const { config, environment } = snapshot();
  const a = serviceSnapshot(config, environment)[0];
  const b = { ...a, key: "b", identity: "b".repeat(64), config: { ...a.config, profileKey: "b" } };
  let desired = [a, b]; const removed: string[] = [];
  const service = await runService(p, desired, () => spawn(process.execPath, ["-e", `
    console.log(JSON.stringify({v:1,event:'thread',phase:'claimed',threadId:'run'}));
    process.stdin.resume();process.stdin.on('end',()=>process.exit(0));
  `]), 1000, 35000, {
    snapshot: () => desired,
    remove: (profile: string) => { removed.push(profile); desired = desired.filter((e) => e.key !== profile); },
    removal: (profile: string) => ({ identity: profile === "a" ? a.identity : b.identity, last: true }),
  });
  services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].activeRuns === 1);
  await expect(serviceRequest(p.socket, { op: "project.remove", profile: "a" })).rejects.toThrow("--interrupt");
  expect(removed).toEqual([]);
  await serviceRequest(p.socket, { op: "project.remove", profile: "a", interrupt: true });
  expect(removed).toEqual(["a"]);
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.map((s) => s.profile)).toEqual(["b"]);
});

it("defers live config changes until targeted interruption and leaves other workers alone", async () => {
  const p = paths(); const { config, environment } = snapshot(); const a = serviceSnapshot(config, environment)[0];
  const b = { ...a, key: "b", identity: "b".repeat(64), config: { ...a.config, profileKey: "b" } };
  let desired = [a, b]; const launches: string[] = [];
  const service = await runService(p, desired, (entry) => {
    launches.push(entry.key);
    return spawn(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]);
  }, 1000, 35000, { snapshot: () => desired }); services.push(service);
  desired = [{ ...a, config: { ...a.config, concurrency: 3 } }, b];
  expect((await serviceRequest(p.socket, { op: "reconcile" })).applied).toBe(false);
  expect(launches).toEqual(["a", "b"]);
  expect((await serviceRequest(p.socket, { op: "reconcile", profile: "a", interrupt: true })).applied).toBe(true);
  expect(launches).toEqual(["a", "b", "a"]);
});

it("keeps status responsive while a registration snapshot is waiting", async () => {
  const p = paths(); let release!: (entries: ReturnType<typeof serviceSnapshot>) => void;
  const pending = new Promise<ReturnType<typeof serviceSnapshot>>((resolve) => { release = resolve; });
  const service = await runService(p, [], undefined, undefined, undefined, { snapshot: () => pending }); services.push(service);
  const reload = serviceRequest(p.socket, { op: "reconcile" });
  const result = await serviceRequest(p.socket, { op: "status" });
  expect(result.profiles).toEqual([]);
  release([]);
  await expect(reload).resolves.toMatchObject({ applied: true });
});

it("keeps live status bounded when removed connections await interruption", async () => {
  const p = paths(); const { config, environment } = snapshot(); const a = serviceSnapshot(config, environment)[0];
  const entries = Array.from({ length: 128 }, (_, i) => ({ ...a, identity: String(i).padStart(64, "0"), key: `p${i}`, config: { ...a.config, profileKey: `p${i}` } }));
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const launch = () => {
    const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
    child.stdin.on("finish", () => child.emit("close", 0));
    return child;
  };
  const next = { ...a, key: "new", identity: "f".repeat(64), config: { ...a.config, profileKey: "new" } };
  const service = await runService(p, entries, launch, 1000, 50, { snapshot: () => [next] }); services.push(service);
  expect((await serviceRequest(p.socket, { op: "reconcile" })).applied).toBe(false);
  expect((await serviceRequest(p.socket, { op: "status" })).profiles).toHaveLength(128);
});

it("restarts a failed registration explicitly without restarting healthy siblings", async () => {
  const p = paths(); const { config, environment } = snapshot(); const a = serviceSnapshot(config, environment)[0];
  let launches = 0;
  const service = await runService(p, [a], () => spawn(process.execPath, ["-e", ++launches === 1 ? "process.exit(3)" : "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]), 1000, 35000, { snapshot: () => [a] });
  services.push(service);
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status === "blocked");
  await serviceRequest(p.socket, { op: "reconcile", profile: "a", interrupt: true });
  expect(launches).toBe(2);
});

it("pauses one project for private runtime login without polling restarting it", async () => {
  const p = paths(); const { config, environment } = snapshot(); const a = serviceSnapshot(config, environment)[0];
  let launches = 0;
  const service = await runService(p, [a], () => { launches++; return spawn(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]); }, 1000, 35000, { snapshot: () => [a] });
  services.push(service);
  await serviceRequest(p.socket, { op: "reconcile", profile: "a", interrupt: true, pause: true });
  await serviceRequest(p.socket, { op: "reconcile" });
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0].status).toBe("stopped");
  expect(launches).toBe(1);
  await serviceRequest(p.socket, { op: "reconcile", profile: "a", interrupt: true });
  expect(launches).toBe(2);
});

it("reports committed removal even when a subsequent snapshot becomes invalid", async () => {
  const p = paths(); let removed = false;
  const service = await runService(p, [], undefined, undefined, undefined, {
    snapshot: () => { throw new Error("private malformed content"); },
    removal: () => ({ identity: "a".repeat(64), last: true }), remove: () => { removed = true; },
  }); services.push(service);
  await expect(serviceRequest(p.socket, { op: "project.remove", profile: "a" }))
    .resolves.toMatchObject({ registered: false, applied: false });
  expect(removed).toBe(true);
});

it("rejects an unknown targeted reload instead of claiming it restarted a project", async () => {
  const p = paths(); const service = await runService(p, [], undefined, undefined, undefined, { snapshot: () => [] }); services.push(service);
  await expect(serviceRequest(p.socket, { op: "reconcile", profile: "missing", interrupt: true })).rejects.toThrow("No isolated");
});

it("polls additions from external configuration and cancels obsolete retries", async () => {
  const p = paths(); const { config, environment } = snapshot(); const a = serviceSnapshot(config, environment)[0];
  let desired: typeof a[] = []; let launches = 0;
  const service = await runService(p, [], () => { launches++; return spawn(process.execPath, ["-e", "process.exit(1)"]); }, 5000, 35000, { snapshot: () => desired }); services.push(service);
  desired = [a];
  await until(async () => (await serviceRequest(p.socket, { op: "status" })).profiles?.[0]?.status === "retrying");
  desired = [];
  await serviceRequest(p.socket, { op: "reconcile" });
  expect((await serviceRequest(p.socket, { op: "status" })).profiles).toEqual([]);
  expect(launches).toBe(1);
});

it("advertises managed credential capability and defers revised live assignments", async () => {
  const p=paths(); const {config,environment}=snapshot();
  let desired=serviceSnapshot(config,environment).map(e=>({...e,auth:{mode:"managed" as const,name:"work",entryId:"id",revision:1}}));
  const service=await runService(p,desired,()=>spawn(process.execPath,["-e","process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]),1000,100,{snapshot:()=>desired}); services.push(service);
  const first=await serviceRequest(p.socket,{op:"status"});
  expect(first.capabilities).toContain("credentials-v1");
  desired=desired.map(e=>({...e,auth:{...e.auth,revision:2}}));
  await serviceRequest(p.socket,{op:"reconcile"});
  const state=(await serviceRequest(p.socket,{op:"status"})).profiles![0];
  expect(state.pending).toBe(true);
  expect(state.auth?.revision).toBe(1);
  expect(state.desiredAuth?.revision).toBe(2);
});

it("retains only typed credential outcomes, not worker-supplied diagnostics", async () => {
  const p=paths(); const {config,environment}=snapshot();
  const service=await runService(p,serviceSnapshot(config,environment),()=>spawn(process.execPath,["-e",`
    console.log(JSON.stringify({v:1,event:'auth',runtime:'codex',result:'request-succeeded',detail:'never-retain-secret'}));
    process.stdin.resume();process.stdin.on('end',()=>process.exit(0));
  `]),1000,100);services.push(service);
  await until(async()=>!!(await serviceRequest(p.socket,{op:"status"})).profiles![0].authResult);
  const status=await serviceRequest(p.socket,{op:"status"});
  expect(status.profiles![0].authResult?.result).toBe("request-succeeded");
  expect(JSON.stringify(status)).not.toContain("never-retain-secret");
});

it.each(["rotate","disable","native"] as const)("reconciles %s after a pending worker exits, preserving its live sibling",async(change)=>{
 const p=paths();const {config,environment}=snapshot();
 const base=serviceSnapshot(config,environment)[0];
 const original={mode:"managed" as const,name:"work",entryId:"id",revision:1};
 let desired=[{...base,auth:original},{...base,key:"b",identity:"b".repeat(64),auth:original}] as ReturnType<typeof serviceSnapshot>;
 const children: ChildProcessWithoutNullStreams[]=[];
 const launched: Array<unknown>=[];
 const service=await runService(p,desired,(entry)=>{
  launched.push(entry.auth);
  const child=spawn(process.execPath,["-e","process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]);
  children.push(child);return child;
 },100,100,{snapshot:()=>desired});services.push(service);
 desired=desired.map(entry=>entry.key==="a"?{...entry,auth:change==="rotate"?{...original,revision:2}:{mode:change==="disable"?"disabled":"native"}}:entry);
 await serviceRequest(p.socket,{op:"reconcile"});
 expect(children).toHaveLength(2);
 expect((await serviceRequest(p.socket,{op:"status"})).profiles!.find(p=>p.profile==="a")?.pending).toBe(true);
 children[0].kill("SIGKILL");
 await until(async()=>children.length===3);
 expect(launched[2]).toEqual(desired[0].auth);
 expect(children[1].exitCode).toBeNull();
 expect((await serviceRequest(p.socket,{op:"status"})).profiles!.find(p=>p.profile==="a")?.pending).not.toBe(true);
});

it("replaces stale backoff credentials and recovers after a failed snapshot",async()=>{
 const p=paths();const {config,environment}=snapshot();
 let desired=serviceSnapshot(config,environment).map(entry=>({...entry,auth:{mode:"managed" as const,name:"work",entryId:"id",revision:1}}));
 let invalid=false;let count=0;const revisions:number[]=[];
 const service=await runService(p,desired,(entry)=>{
  revisions.push(entry.auth!.revision!);
  return spawn(process.execPath,["-e",++count===1?"process.exit(1)":"process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]);
 },5000,100,{snapshot:()=>{if(invalid)throw new Error("invalid");return desired;}});services.push(service);
 await until(async()=>(await serviceRequest(p.socket,{op:"status"})).profiles![0].status==="retrying");
 desired=desired.map(entry=>({...entry,auth:{...entry.auth,revision:2}}));
 invalid=true;
 await expect(serviceRequest(p.socket,{op:"reconcile"})).rejects.toThrow("Invalid configuration");
 expect(revisions).toEqual([1]);
 invalid=false;
 await serviceRequest(p.socket,{op:"reconcile"});
 expect(revisions).toEqual([1,2]);
});

it("reports launch failures without blaming credentials or disclosing raw exceptions",async()=>{
 const p=paths();const {config,environment}=snapshot();
 const service=await runService(p,serviceSnapshot(config,environment),()=>{throw new Error("private-launch-detail");},100,100);
 services.push(service);
 expect((await serviceRequest(p.socket,{op:"status"})).profiles![0].status).toBe("failed");
 const output=JSON.stringify(await serviceRequest(p.socket,{op:"logs",after:0}));
 expect(output).toContain("Project launch failed");
 expect(output).not.toContain("credential revisions");
 expect(output).not.toContain("private-launch-detail");
});

it("rejects new run cancellations once shutdown has started", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const runs = await import("./runs.js");
  const backend = vi.spyOn(runs, "serviceRuns").mockResolvedValue({ cancelled: true });
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
  const p = paths(); const { config, environment } = snapshot();
  const service = await runService(p, serviceSnapshot(config, environment), () => child); services.push(service);
  const client = await ServiceClient.open(p.socket);
  const stopped = client.request({ op: "stop" });
  try {
    await expect(client.request({ op: "runs.cancel", profile: "a", threadId: "thread", runId: "run" })).rejects.toThrow("Service is stopping");
    expect(backend).not.toHaveBeenCalled();
  } finally { child.emit("close", 0); await stopped; client.close(); backend.mockRestore(); }
});

it("discards malformed worker thread identities before publishing client events", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
  child.stdin.on("finish", () => child.emit("close", 0));
  const p = paths(); const { config, environment } = snapshot();
  const service = await runService(p, serviceSnapshot(config, environment), () => child); services.push(service);
  const client = await ServiceClient.open(p.socket); const events: unknown[] = [];
  await client.subscribe({}, event => events.push(event));
  child.stdout.emit("data", Buffer.from(JSON.stringify({ v: 1, event: "thread", phase: "streaming", threadId: { secret: "must-not-relay" } }) + "\n"));
  child.stdout.emit("data", Buffer.from(JSON.stringify({ v: 1, event: "thread", phase: "streaming", threadId: "valid-thread" }) + "\n"));
  await vi.waitFor(() => expect(JSON.stringify(events)).toContain("valid-thread"));
  expect(JSON.stringify(events)).not.toContain("must-not-relay"); client.close();
});

it.each(["remove", "reload"])("resolves queued cancellation after profile %s finishes", async change => {
  const runs = await import("./runs.js");
  const called = vi.spyOn(runs, "serviceRuns").mockResolvedValue({ cancelled: true });
  const { EventEmitter } = await import("node:events"); const { PassThrough } = await import("node:stream");
  const p = paths(); const { config, environment } = snapshot(); const a = serviceSnapshot(config, environment)[0];
  let desired = [a]; let first = true; let held!: ChildProcessWithoutNullStreams;
  const launch = () => {
    const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
    if (first) { first = false; held = child; } else child.stdin.on("finish", () => child.emit("close", 0));
    return child;
  };
  const service = await runService(p, desired, launch, 1000, 35000, {
    snapshot: () => desired, removal: () => ({ identity: a.identity, last: true }), remove: () => { desired = []; },
  }); services.push(service);
  const client = await ServiceClient.open(p.socket);
  try {
    if (change === "reload") desired = [{ ...a, config: { ...a.config, apiKey: "new-key" } }];
    const mutation = serviceRequest(p.socket, { op: change === "remove" ? "project.remove" : "reconcile", profile: "a", interrupt: true });
    await vi.waitFor(() => expect(held.stdin.writableEnded).toBe(true));
    const cancellation = client.request({ op: "runs.cancel", profile: "a", threadId: "thread", runId: "run" }).then(value => value, error => error);
    await client.request({ op: "status" });
    held.emit("close", 0); await mutation;
    const result = await cancellation;
    if (change === "remove") {
      expect(called).not.toHaveBeenCalled(); expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain("Unknown service profile");
    } else {
      expect(called).toHaveBeenCalledOnce(); expect(called.mock.calls[0][0].config.apiKey).toBe("new-key");
    }
  } finally { held.emit("close", 0); client.close(); called.mockRestore(); }
});

it("publishes saved display names and refreshes them without restarting workers", async () => {
  const p = paths(); const { config, environment } = snapshot();
  config.profiles.a.name = "Isolation Project B";
  let launches = 0;
  const service = await runService(p, serviceSnapshot(config, environment), () => {
    launches++;
    return spawn(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]);
  }, 1000, 35000, { snapshot: () => serviceSnapshot(config, environment) });
  services.push(service);
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0]).toMatchObject({ profile: "a", displayName: "Isolation Project B" });
  config.profiles.a.name = "Renamed";
  await serviceRequest(p.socket, { op: "reconcile" });
  expect((await serviceRequest(p.socket, { op: "status" })).profiles?.[0]).toMatchObject({ profile: "a", displayName: "Renamed" });
  expect(launches).toBe(1);
});

it("vouches for running workers that hold no grant of a removed credential", async () => {
  const p=paths(); const {config,environment}=snapshot();
  const desired=serviceSnapshot(config,environment).map(e=>({...e,auth:{mode:"managed" as const,name:"work",entryId:"id",revision:1}}));
  const calls: string[][] = [];
  const service=await runService(p,desired,()=>spawn(process.execPath,["-e","process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]),1000,100,
    {snapshot:()=>desired,credentials:(_request,accounted)=>{calls.push(accounted ?? []);}}); services.push(service);
  await serviceRequest(p.socket,{op:"credentials.mutate",credentials:{action:"remove",name:"work"}});
  await serviceRequest(p.socket,{op:"credentials.mutate",credentials:{action:"remove",name:"other"}});
  expect(calls).toEqual([[], [desired[0].identity]]);
});

it("never vouches for a running worker whose Cursor holds a removed credential (OS-2017)", async () => {
  const p=paths(); const {config,environment}=snapshot();
  const desired=serviceSnapshot(config,environment).map(e=>({...e,auth:{mode:"native" as const,cursor:{mode:"managed" as const,name:"work",entryId:"id",revision:1}}}));
  const calls: string[][] = [];
  const service=await runService(p,desired,()=>spawn(process.execPath,["-e","process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]),1000,100,
    {snapshot:()=>desired,credentials:(_request,accounted)=>{calls.push(accounted ?? []);}}); services.push(service);
  await serviceRequest(p.socket,{op:"credentials.mutate",credentials:{action:"remove",name:"work"}});
  await serviceRequest(p.socket,{op:"credentials.mutate",credentials:{action:"remove",name:"other"}});
  expect(calls).toEqual([[], [desired[0].identity]]);
});

it("never vouches for a running worker whose OpenCode holds a removed credential (OS-2018)", async () => {
  const p=paths(); const {config,environment}=snapshot();
  const desired=serviceSnapshot(config,environment).map(e=>({...e,auth:{mode:"native" as const,opencode:{anthropic:{mode:"managed" as const,name:"work",entryId:"id",revision:1}}}}));
  const calls: string[][] = [];
  const service=await runService(p,desired,()=>spawn(process.execPath,["-e","process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"]),1000,100,
    {snapshot:()=>desired,credentials:(_request,accounted)=>{calls.push(accounted ?? []);}}); services.push(service);
  await serviceRequest(p.socket,{op:"credentials.mutate",credentials:{action:"remove",name:"work"}});
  await serviceRequest(p.socket,{op:"credentials.mutate",credentials:{action:"remove",name:"other"}});
  expect(calls).toEqual([[], [desired[0].identity]]);
});
