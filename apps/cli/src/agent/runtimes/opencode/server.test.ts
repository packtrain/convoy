import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createOpencodeServerManager,
  managedKeyRefusal,
  parseServerListeningUrl,
} from "./server.js";
import type { OpencodeAuth } from "../../../lib/config/credentials/validators.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killedWith: NodeJS.Signals[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith.push(signal ?? "SIGTERM");
    this.exitAs(null, signal ?? "SIGTERM");
    return true;
  }

  exitAs(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) {
      return;
    }
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

function createFakeSpawn() {
  const children: FakeChild[] = [];
  const spawnImpl = vi.fn(
    (_command: string, _args: readonly string[], _options: unknown): ChildProcess => {
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    },
  );
  return { spawnImpl, children };
}

function createManager(deps?: { readyTimeoutMs?: number; unauthenticatedStatus?: number | Error; refusal?: string }) {
  const { spawnImpl, children } = createFakeSpawn();
  const probe = vi.fn(async (_url: string) => {
    const status = deps?.unauthenticatedStatus ?? 401;
    if (status instanceof Error) throw status;
    return status;
  });
  const managedRefusal = vi.fn(async () => deps?.refusal);
  const manager = createOpencodeServerManager({
    spawnImpl,
    resolveExecutablePath: async () => ({ command: "opencode", source: "path" }),
    findPort: async () => 45_000,
    readyTimeoutMs: deps?.readyTimeoutMs ?? 500,
    probeUnauthenticated: probe,
    managedRefusal,
  });
  return { manager, children, spawnImpl, probe, managedRefusal };
}

const server = (url: string) => ({ url, password: expect.stringMatching(/^[\w-]{43}$/) });

async function start(auth?: OpencodeAuth) {
  const created = createManager();
  const started = created.manager.getServer(auth);
  await vi.waitFor(() => expect(created.children).toHaveLength(1));
  created.children[0].stdout.write("opencode server listening on http://127.0.0.1:45000\n");
  const handle = await started;
  const env = (created.spawnImpl.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env;
  return { ...created, handle, env };
}

describe("parseServerListeningUrl", () => {
  it("extracts the URL from the readiness line", () => {
    expect(
      parseServerListeningUrl("opencode server listening on http://127.0.0.1:45000"),
    ).toBe("http://127.0.0.1:45000");
  });

  it("ignores unrelated lines", () => {
    expect(parseServerListeningUrl("some other log line")).toBeNull();
    expect(parseServerListeningUrl("listening on http://127.0.0.1:1")).toBeNull();
  });
});

describe("createOpencodeServerManager", () => {
  // The shared server outlives every thread, so a leaked key is readable by
  // every agent it serves (OS-1735).
  it("strips the API key from the server env", async () => {
    const { manager, children, spawnImpl } = createManager();

    process.env.CONVOY_API_KEY = "sk_user_secret";
    try {
      const started = manager.getServer();
      await vi.waitFor(() => expect(children).toHaveLength(1));
      children[0].stdout.write("opencode server listening on http://127.0.0.1:45000\n");
      await started;

      const options = spawnImpl.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
      expect(options.env.CONVOY_API_KEY).toBeUndefined();

      await manager.shutdown();
    } finally {
      delete process.env.CONVOY_API_KEY;
    }
  });

  it("starts the server lazily and reuses it while alive", async () => {
    const { manager, children, spawnImpl } = createManager();

    const first = manager.getServer();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0].stdout.write("opencode server listening on http://127.0.0.1:45000\n");

    await expect(first).resolves.toEqual(server("http://127.0.0.1:45000"));
    await expect(manager.getServer()).resolves.toEqual(server("http://127.0.0.1:45000"));
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(await manager.getServer()).toBe(await first);
  });

  it("shares one start across concurrent callers", async () => {
    const { manager, children, spawnImpl } = createManager();

    const [a, b] = [manager.getServer(), manager.getServer()];
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0].stdout.write("opencode server listening on http://127.0.0.1:45000\n");

    await expect(Promise.all([a, b])).resolves.toEqual([
      server("http://127.0.0.1:45000"),
      server("http://127.0.0.1:45000"),
    ]);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("restarts the server after it dies", async () => {
    const { manager, children } = createManager();

    const first = manager.getServer();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0].stdout.write("opencode server listening on http://127.0.0.1:45000\n");
    await first;

    children[0].exitAs(1, null);

    const second = manager.getServer();
    await vi.waitFor(() => expect(children).toHaveLength(2));
    children[1].stdout.write("opencode server listening on http://127.0.0.1:45001\n");

    await expect(second).resolves.toEqual(server("http://127.0.0.1:45001"));
  });

  // Projects share loopback, so only the password keeps a sibling off this server (OS-2018).
  it("starts every server behind its own password, in its env only", async () => {
    process.env.OPENCODE_SERVER_USERNAME = "someone";
    try {
      const first = await start();
      expect(first.env.OPENCODE_SERVER_PASSWORD).toBe(first.handle.password);
      expect(first.env.OPENCODE_SERVER_USERNAME).toBeUndefined();
      expect(first.spawnImpl.mock.calls[0][1].join(" ")).not.toContain(first.handle.password);
      expect(first.probe).toHaveBeenCalledWith("http://127.0.0.1:45000");
      const second = await start();
      expect(second.handle.password).not.toBe(first.handle.password);
      await Promise.all([first.manager.shutdown(), second.manager.shutdown()]);
    } finally {
      delete process.env.OPENCODE_SERVER_USERNAME;
    }
  });

  it("kills a server that answers without the password", async () => {
    const { manager, children } = createManager({ unauthenticatedStatus: 200 });
    const expectation = expect(manager.getServer()).rejects.toThrow(/answered without its password/);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0].stdout.write("opencode server listening on http://127.0.0.1:45000\n");
    await expectation;
    expect(children[0].killedWith).toContain("SIGKILL");
  });

  it("kills a server that does not answer its health probe", async () => {
    const { manager, children } = createManager({ unauthenticatedStatus: new Error("ECONNREFUSED") });
    const expectation = expect(manager.getServer()).rejects.toThrow("opencode serve did not answer its health probe. Check the OpenCode install, then reload.");
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0].stdout.write("opencode server listening on http://127.0.0.1:45000\n");
    await expectation;
    expect(children[0].killedWith).toContain("SIGKILL");
  });

  // Detection and runs share this start, so one guard keeps keys off an untested binary (OS-2018 #2).
  it("refuses a managed start before any process gets the keys", async () => {
    const { manager, spawnImpl, managedRefusal } = createManager({ refusal: "OpenCode 1.14.19 is not tested with managed keys." });
    await expect(manager.getServer({ mode: "managed", keys: { openai: "sk-openai-sentinel" } })).rejects.toThrow("OpenCode 1.14.19 is not tested with managed keys.");
    expect(managedRefusal).toHaveBeenCalledTimes(1);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("skips the managed check for native and disabled servers", async () => {
    for (const auth of [undefined, { mode: "disabled" } as const]) {
      const { manager, managedRefusal } = await start(auth);
      expect(managedRefusal).not.toHaveBeenCalled();
      await manager.shutdown();
    }
  });

  it("leaves a native server's own auth and config alone", async () => {
    process.env.OPENCODE_CONFIG = "/home/convoy/custom.json";
    try {
      const { env, manager } = await start();
      expect(env.OPENCODE_CONFIG).toBe("/home/convoy/custom.json");
      expect(env.OPENCODE_AUTH_CONTENT).toBeUndefined();
      expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
      await manager.shutdown();
    } finally {
      delete process.env.OPENCODE_CONFIG;
    }
  });

  // Inline config outranks project config; empty auth hides cached logins and OAuth (OS-2018).
  it("gives a managed server only the assigned keys, pinned to the providers' own endpoints", async () => {
    process.env.OPENCODE_CONFIG = "/home/convoy/custom.json";
    process.env.OPENCODE_AUTH_CONTENT = '{"openai":{"type":"oauth"}}';
    process.env.OPENAI_API_KEY = "sk-inherited";
    process.env.ANTHROPIC_BASE_URL = "https://proxy.example";
    try {
      const { env, manager, spawnImpl } = await start({ mode: "managed", keys: { openai: "sk-openai-sentinel", anthropic: "sk-ant-sentinel" } });
      expect(env.OPENCODE_CONFIG).toBeUndefined();
      expect(env.OPENCODE_AUTH_CONTENT).toBe("{}");
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!)).toEqual({
        enabled_providers: ["openai", "anthropic"],
        provider: {
          openai: { options: { apiKey: "sk-openai-sentinel", baseURL: "https://api.openai.com/v1" } },
          anthropic: { options: { apiKey: "sk-ant-sentinel", baseURL: "https://api.anthropic.com/v1" } },
        },
      });
      expect(spawnImpl.mock.calls[0][1].join(" ")).not.toContain("sentinel");
      await manager.shutdown();
    } finally {
      delete process.env.OPENCODE_CONFIG;
      delete process.env.OPENCODE_AUTH_CONTENT;
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });

  it("enables no provider on a disabled server", async () => {
    const { env, manager } = await start({ mode: "disabled" });
    expect(env.OPENCODE_AUTH_CONTENT).toBe("{}");
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!)).toEqual({ enabled_providers: [], provider: {} });
    await manager.shutdown();
  });

  it("fails with captured output when the server exits before readiness", async () => {
    const { manager, children } = createManager();

    // Attach the rejection handler before triggering the failure so the
    // rejection is never momentarily unhandled.
    const expectation = expect(manager.getServer()).rejects.toThrow(
      /exit code 2.*broken config/s,
    );
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0].stderr.write("FATAL: broken config\n");
    children[0].exitAs(2, null);

    await expectation;
  });

  it("fails when the server never reports readiness within the timeout", async () => {
    const { manager, children } = createManager({ readyTimeoutMs: 30 });

    const expectation = expect(manager.getServer()).rejects.toThrow(
      /did not report readiness/,
    );
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0].stdout.write("still booting...\n");

    await expectation;
  });

  it("shutdown terminates the running server", async () => {
    const { manager, children } = createManager();

    const started = manager.getServer();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0].stdout.write("opencode server listening on http://127.0.0.1:45000\n");
    await started;

    await manager.shutdown();
    expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true);
  });

  it("shutdown is a no-op when nothing is running", async () => {
    const { manager } = createManager();
    await expect(manager.shutdown()).resolves.toBeUndefined();
  });
});

describe("managedKeyRefusal (OS-2018)", () => {
  const probe = (version: string | Error, existing: string[] = []) => ({
    version: async () => { if (version instanceof Error) throw version; return version; },
    exists: (file: string) => existing.includes(file),
  });

  it("accepts the checked version and newer without an administrator config", async () => {
    await expect(managedKeyRefusal(probe("1.18.18"))).resolves.toBeUndefined();
    await expect(managedKeyRefusal(probe("1.19.5"))).resolves.toBeUndefined();
  });

  it("refuses older or unreadable versions", async () => {
    await expect(managedKeyRefusal(probe("1.18.17"))).resolves.toMatch(/^OpenCode 1\.18\.17 is not tested with managed keys\. Install opencode-ai@1\.19\.5/);
    await expect(managedKeyRefusal(probe(new Error("ENOENT")))).resolves.toMatch(/^OpenCode unknown is not tested/);
  });

  // /etc/opencode outranks Convoy's inline config, so it could swap keys or endpoints.
  it("refuses an administrator OpenCode config", async () => {
    await expect(managedKeyRefusal(probe("1.19.5", ["/etc/opencode/opencode.jsonc"]))).resolves
      .toBe("/etc/opencode/opencode.jsonc overrides Convoy's OpenCode keys. Remove it, or unassign the keys and restore native login.");
  });
});
