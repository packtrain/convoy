import { once } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { spawnSupervisedProcess } from "./spawn-supervised-process.js";
import type { SpawnSpec } from "../types.js";
import { createFakeChildProcess } from "../__tests__/test-helpers.js";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ESRCH"
    ) {
      return false;
    }
    return true;
  }
}

function createLongRunningSpec(script: string): SpawnSpec {
  return {
    command: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    env: process.env,
    transportMode: "line-text",
    detached: true,
  };
}

async function waitForChildExit(child: import("child_process").ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await once(child, "exit");
}

async function waitForProviderPid(
  onLines: (line: string) => void,
  stdout: NodeJS.ReadableStream
): Promise<number> {
  const chunks: string[] = [];

  stdout.on("data", (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    chunks.push(text);
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        onLines(trimmed);
      }
    }
  });

  await vi.waitFor(() => {
    const merged = chunks.join("");
    const line = merged
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find((value) => /^\d+$/.test(value));
    expect(line).toBeDefined();
  });

  const merged = chunks.join("");
  const pidText = merged
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => /^\d+$/.test(value));
  if (!pidText) {
    throw new Error("Provider PID was not emitted");
  }
  return Number(pidText);
}

describe("spawn-supervised-process", () => {
  it("interrupt command forwards SIGINT to the managed provider", async () => {
    const lines: string[] = [];
    const spec = createLongRunningSpec([
      "process.stdout.write(String(process.pid) + '\\n');",
      "process.on('SIGINT', () => {",
      "  process.stdout.write('INTERRUPTED\\n');",
      "  process.exit(0);",
      "});",
      "setInterval(() => {}, 1_000);",
    ].join("\n"));

    const { child, control } = await spawnSupervisedProcess(spec, {
      terminateGraceMs: 250,
      forceKillGraceMs: 250,
    });

    if (!child.stdout) {
      throw new Error("Missing stdout");
    }

    const providerPid = await waitForProviderPid((line) => lines.push(line), child.stdout);
    expect(providerPid).toBeGreaterThan(0);
    expect(isPidAlive(providerPid)).toBe(true);
    expect(control).not.toBeNull();

    await control?.interrupt();
    await waitForChildExit(child);

    expect(lines).toContain("INTERRUPTED");
    await vi.waitFor(() => {
      expect(isPidAlive(providerPid)).toBe(false);
    });
  });

  it("terminate command stops the supervisor and managed provider", async () => {
    const spec = createLongRunningSpec([
      "process.stdout.write(String(process.pid) + '\\n');",
      "setInterval(() => {}, 1_000);",
    ].join("\n"));

    const { child, control } = await spawnSupervisedProcess(spec, {
      terminateGraceMs: 250,
      forceKillGraceMs: 250,
    });

    if (!child.stdout) {
      throw new Error("Missing stdout");
    }

    const providerPid = await waitForProviderPid(() => {}, child.stdout);
    expect(providerPid).toBeGreaterThan(0);
    expect(isPidAlive(providerPid)).toBe(true);

    await control?.terminate("test_terminate");
    await waitForChildExit(child);

    await vi.waitFor(() => {
      expect(isPidAlive(providerPid)).toBe(false);
    });
  });

  it("kills managed provider when parent IPC disconnects", async () => {
    const spec = createLongRunningSpec([
      "process.stdout.write(String(process.pid) + '\\n');",
      "setInterval(() => {}, 1_000);",
    ].join("\n"));

    const { child } = await spawnSupervisedProcess(spec, {
      terminateGraceMs: 250,
      forceKillGraceMs: 250,
    });

    if (!child.stdout) {
      throw new Error("Missing stdout");
    }

    const providerPid = await waitForProviderPid(() => {}, child.stdout);
    expect(providerPid).toBeGreaterThan(0);
    expect(isPidAlive(providerPid)).toBe(true);

    child.disconnect?.();
    await waitForChildExit(child);

    await vi.waitFor(() => {
      expect(isPidAlive(providerPid)).toBe(false);
    });
  });

  it("fails start handshake when supervisor reports spawn_error", async () => {
    const invalidSpec: SpawnSpec = {
      command: "__convoy_missing_binary__",
      args: [],
      cwd: process.cwd(),
      env: process.env,
      transportMode: "line-text",
      detached: true,
    };

    await expect(
      spawnSupervisedProcess(invalidSpec, {
        terminateGraceMs: 250,
        forceKillGraceMs: 250,
      })
    ).rejects.toThrow(/Supervisor spawn failed:/);
  });

  it("fails start handshake on timeout when supervisor does not respond", async () => {
    const fakeChild = createFakeChildProcess(40001);
    const originalKill = fakeChild.kill.bind(fakeChild);
    const killSpy = vi.fn((signal?: NodeJS.Signals | number) => originalKill(signal));
    fakeChild.kill = killSpy as typeof fakeChild.kill;
    fakeChild.send = ((_message: unknown, callback?: (error: Error | null) => void) => {
      callback?.(null);
      return true;
    }) as typeof fakeChild.send;

    await expect(
      spawnSupervisedProcess(createLongRunningSpec("setInterval(() => {}, 1_000);"), {
        terminateGraceMs: 250,
        forceKillGraceMs: 250,
        startTimeoutMs: 25,
        spawnImpl: () => fakeChild,
      })
    ).rejects.toThrow(/timed out/i);

    expect(killSpy).toHaveBeenCalled();
    expect(killSpy).toHaveBeenCalledWith("SIGKILL");
  });

  it("captures an immediate supervisor start reply sent during send callback", async () => {
    const fakeChild = createFakeChildProcess(40002);
    fakeChild.send = ((_message: unknown, callback?: (error: Error | null) => void) => {
      fakeChild.emit("message", { type: "started", pid: 77777 });
      callback?.(null);
      return true;
    }) as typeof fakeChild.send;

    const result = await spawnSupervisedProcess(
      createLongRunningSpec("setInterval(() => {}, 1_000);"),
      {
        terminateGraceMs: 250,
        forceKillGraceMs: 250,
        startTimeoutMs: 500,
        spawnImpl: () => fakeChild,
      }
    );

    expect(result.child).toBe(fakeChild);
  });
});
