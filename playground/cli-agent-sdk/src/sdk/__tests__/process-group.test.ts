import { describe, expect, it } from "vitest";

import { killProcessGroup } from "../runtime/process-group.js";
import { createFakeChildProcess } from "./test-helpers.js";

describe("process group", () => {
  it("sends group SIGTERM then SIGKILL on posix", async () => {
    const child = createFakeChildProcess(1234);
    const calls: Array<{ pid: number; signal: NodeJS.Signals }> = [];

    const killImpl = (pid: number, signal: NodeJS.Signals) => {
      calls.push({ pid, signal });
      if (signal === "SIGKILL") {
        queueMicrotask(() => {
          child.emit("exit", 137, "SIGKILL");
        });
      }
    };

    await killProcessGroup(child, {
      platform: "darwin",
      terminateGraceMs: 1,
      forceKillGraceMs: 1,
      killImpl,
    });

    expect(calls[0]?.pid).toBe(-1234);
    expect(calls[0]?.signal).toBe("SIGTERM");
    expect(calls[1]?.signal).toBe("SIGKILL");
  });

  it("uses taskkill flow on win32", async () => {
    const child = createFakeChildProcess(2345);
    const calls: Array<{ pid: number; force: boolean }> = [];

    const taskkillImpl = async (pid: number, force: boolean) => {
      calls.push({ pid, force });
      queueMicrotask(() => {
        child.emit("exit", null, "SIGTERM");
      });
    };

    await killProcessGroup(child, {
      platform: "win32",
      terminateGraceMs: 1,
      forceKillGraceMs: 1,
      taskkillImpl,
    });

    expect(calls[0]?.pid).toBe(2345);
    expect(calls[0]?.force).toBe(false);
  });
});
