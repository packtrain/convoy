import { afterEach, describe, expect, it, vi } from "vitest";

import { CliExecutionSessionManager } from "../session-manager.js";
import { ProviderRegistry } from "../adapters/provider-registry.js";
import type {
  BuildSpawnSpecContext,
  DetectCapabilitiesContext,
  DetectVersionContext,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderVersionInfo,
  ResolveExecutableContext,
  ResolvedExecutable,
} from "../types.js";
import { createFakeChildProcess } from "./test-helpers.js";

class FakeAdapter implements ProviderAdapter {
  readonly id = "generic" as const;
  readonly defaultTransportMode = "json-stream" as const;

  async resolveExecutable(_ctx: ResolveExecutableContext): Promise<ResolvedExecutable> {
    return { command: "fake-cli", source: "path" };
  }

  async detectVersion(_ctx: DetectVersionContext): Promise<ProviderVersionInfo> {
    return { raw: "1.0.0", normalized: "1.0.0" };
  }

  async detectCapabilities(
    _ctx: DetectCapabilitiesContext
  ): Promise<ProviderCapabilities> {
    return {
      supportsJsonStream: true,
      supportsResume: false,
      supportsInterrupt: true,
      supportsPty: false,
    };
  }

  async buildSpawnSpec(ctx: BuildSpawnSpecContext) {
    return {
      command: "fake-cli",
      args: [],
      cwd: ctx.cwd,
      env: ctx.env,
      transportMode: ctx.transportMode,
      detached: true,
      bootstrapInput: [],
    };
  }
}

class CloseStdinAdapter extends FakeAdapter {
  override async buildSpawnSpec(ctx: BuildSpawnSpecContext) {
    const base = await super.buildSpawnSpec(ctx);
    return {
      ...base,
      closeStdinAfterSpawn: true,
    };
  }
}

function createRegistry(adapter: ProviderAdapter): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(adapter);
  return registry;
}

function createManager() {
  const adapter = new FakeAdapter();
  return new CliExecutionSessionManager({
    providerRegistry: createRegistry(adapter),
    disableSupervisor: true,
    limits: {
      maxConcurrentRuns: 3,
      maxRunsPerWorkingDir: 1,
      startupTimeoutMs: 100,
      idleTimeoutMs: 100,
      maxRunTimeoutMs: 1000,
      terminateGraceMs: 1,
      forceKillGraceMs: 1,
      terminateAfterResultMs: 10,
    },
    spawnOptions: {
      spawnImpl: () => {
        const child = createFakeChildProcess(Math.floor(Math.random() * 10000));
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
    },
  });
}

describe("session manager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The API key must never reach a spawned agent. Guards the default
  // denyEnvKeys value, which no other test pins (OS-1735).
  it("strips the API key from the spawned agent env by default", async () => {
    const spawnedEnvs: Array<NodeJS.ProcessEnv | undefined> = [];
    const manager = new CliExecutionSessionManager({
      providerRegistry: createRegistry(new FakeAdapter()),
      disableSupervisor: true,
      spawnOptions: {
        spawnImpl: (_command, _args, options) => {
          spawnedEnvs.push(options.env);
          const child = createFakeChildProcess(4242);
          queueMicrotask(() => child.emit("spawn"));
          return child;
        },
      },
    });

    process.env.CONVOY_API_KEY = "sk_user_secret";
    try {
      const run = await manager.startRun({
        providerId: "generic",
        cwd: "/tmp/deny-env",
        prompt: "hello",
        isolationMode: "inherit",
      });

      expect(spawnedEnvs[0]?.CONVOY_API_KEY).toBeUndefined();

      await run.terminate("cancelled_by_test");
      await run.wait();
    } finally {
      delete process.env.CONVOY_API_KEY;
    }
  });

  it("enforces max concurrent runs", async () => {
    const adapter = new FakeAdapter();
    const manager = new CliExecutionSessionManager({
      providerRegistry: createRegistry(adapter),
      disableSupervisor: true,
      limits: {
        maxConcurrentRuns: 1,
        maxRunsPerWorkingDir: 1,
        startupTimeoutMs: 100,
        idleTimeoutMs: 100,
        maxRunTimeoutMs: 1000,
        terminateGraceMs: 1,
        forceKillGraceMs: 1,
        terminateAfterResultMs: 10,
      },
      spawnOptions: {
        spawnImpl: () => {
          const child = createFakeChildProcess(Math.floor(Math.random() * 10000));
          queueMicrotask(() => child.emit("spawn"));
          return child;
        },
      },
    });

    const run1 = await manager.startRun({
      providerId: "generic",
      cwd: "/tmp/a",
      prompt: "hello",
    });

    await expect(
      manager.startRun({
        providerId: "generic",
        cwd: "/tmp/b",
        prompt: "two",
      })
    ).rejects.toThrow(/Max concurrent runs reached/);

    await run1.terminate("cancelled_by_test");
    await run1.wait();
  });

  it("enforces per-working-directory limit", async () => {
    const manager = createManager();

    const run1 = await manager.startRun({
      providerId: "generic",
      cwd: "/tmp/one",
      prompt: "one",
    });

    await expect(
      manager.startRun({
        providerId: "generic",
        cwd: "/tmp/one",
        prompt: "two",
      })
    ).rejects.toThrow(/Max runs reached for working directory/);

    const run2 = await manager.startRun({
      providerId: "generic",
      cwd: "/tmp/two",
      prompt: "ok",
    });

    await Promise.all([
      run1.terminate("cancelled_by_test"),
      run2.terminate("cancelled_by_test"),
    ]);
    await Promise.all([run1.wait(), run2.wait()]);
  });

  it("shutdown terminates active runs", async () => {
    const manager = createManager();

    const run1 = await manager.startRun({ providerId: "generic", cwd: "/tmp/x" });
    const run2 = await manager.startRun({ providerId: "generic", cwd: "/tmp/y" });

    await manager.shutdown();

    const [final1, final2] = await Promise.all([run1.wait(), run2.wait()]);
    expect(final1.status === "failed" || final1.status === "cancelled").toBe(true);
    expect(final2.status === "failed" || final2.status === "cancelled").toBe(true);
    expect(manager.listRunning().length).toBe(0);
  });

  it("regression: run completes cleanly without race-loop spin", async () => {
    const adapter = new FakeAdapter();
    let eventCount = 0;

    const manager = new CliExecutionSessionManager({
      providerRegistry: createRegistry(adapter),
      disableSupervisor: true,
      limits: {
        maxConcurrentRuns: 1,
        maxRunsPerWorkingDir: 1,
        startupTimeoutMs: 100,
        idleTimeoutMs: 100,
        maxRunTimeoutMs: 1000,
        terminateGraceMs: 1,
        forceKillGraceMs: 1,
        terminateAfterResultMs: 10,
      },
      hostCallbacks: {
        onTransportEvent: () => {
          eventCount += 1;
        },
      },
      spawnOptions: {
        spawnImpl: () => {
          const child = createFakeChildProcess(7777);
          queueMicrotask(() => child.emit("spawn"));
          queueMicrotask(() => {
            child.stdout.write('{"text":"hello"}\n');
            child.stdout.end();
            child.stderr.end();
            child.emit("exit", 0, null);
          });
          return child;
        },
      },
    });

    const run = await manager.startRun({
      providerId: "generic",
      cwd: "/tmp/race",
      prompt: "hello",
    });

    const finalState = await run.wait();
    expect(finalState.status).toBe("completed");
    expect(eventCount < 20).toBe(true);
  });

  it("regression: non-exiting child after result is terminated", async () => {
    vi.useFakeTimers();

    const adapter = new FakeAdapter();
    const manager = new CliExecutionSessionManager({
      providerRegistry: createRegistry(adapter),
      disableSupervisor: true,
      limits: {
        maxConcurrentRuns: 1,
        maxRunsPerWorkingDir: 1,
        startupTimeoutMs: 100,
        idleTimeoutMs: 100,
        maxRunTimeoutMs: 1000,
        terminateGraceMs: 1,
        forceKillGraceMs: 1,
        terminateAfterResultMs: 5,
      },
      spawnOptions: {
        spawnImpl: () => {
          const child = createFakeChildProcess(8888);
          queueMicrotask(() => child.emit("spawn"));
          queueMicrotask(() => {
            child.stdout.write('{"type":"result","result":"ok"}\n');
          });
          return child;
        },
      },
    });

    const run = await manager.startRun({
      providerId: "generic",
      cwd: "/tmp/non-exit",
      prompt: "hello",
    });

    await vi.advanceTimersByTimeAsync(10);

    const finalState = await run.wait();
    expect(finalState.status === "failed" || finalState.status === "cancelled").toBe(
      true
    );
  });

  it("closes stdin after spawn when requested by adapter", async () => {
    const adapter = new CloseStdinAdapter();
    const manager = new CliExecutionSessionManager({
      providerRegistry: createRegistry(adapter),
      disableSupervisor: true,
      limits: {
        maxConcurrentRuns: 1,
        maxRunsPerWorkingDir: 1,
        startupTimeoutMs: 100,
        idleTimeoutMs: 100,
        maxRunTimeoutMs: 1_000,
        terminateGraceMs: 1,
        forceKillGraceMs: 1,
        terminateAfterResultMs: 10,
      },
      spawnOptions: {
        spawnImpl: () => {
          const child = createFakeChildProcess(9991);
          queueMicrotask(() => child.emit("spawn"));
          child.stdin.once("finish", () => {
            child.stdout.write('{"type":"result","result":"ok"}\n');
            child.stdout.end();
            child.stderr.end();
            child.emit("exit", 0, null);
          });
          return child;
        },
      },
    });

    const run = await manager.startRun({
      providerId: "generic",
      cwd: "/tmp/close-stdin",
      prompt: "hello",
    });

    const finalState = await run.wait();
    expect(finalState.status).toBe("completed");
  });

});
