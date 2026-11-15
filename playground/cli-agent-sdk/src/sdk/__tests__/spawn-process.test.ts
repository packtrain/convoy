import type { SpawnOptionsWithStdioTuple } from "child_process";
import { describe, expect, it } from "vitest";

import { spawnProcess } from "../runtime/spawn-process.js";
import { createFakeChildProcess } from "./test-helpers.js";

describe("spawn process", () => {
  it("passes shell false and pipe stdio", () => {
    let captured: {
      command?: string;
      args?: readonly string[];
      options?: SpawnOptionsWithStdioTuple<"pipe", "pipe", "pipe">;
    } = {};

    const child = createFakeChildProcess();

    const spawned = spawnProcess(
      {
        command: "echo",
        args: ["hello"],
        cwd: process.cwd(),
        env: process.env,
        transportMode: "line-text",
      },
      {
        spawnImpl: (command, args, options) => {
          captured = { command, args, options };
          return child;
        },
      }
    );

    expect(spawned).toBe(child);
    expect(captured.command).toBe("echo");
    expect(captured.args).toEqual(["hello"]);
    expect(captured.options?.shell).toBe(false);
    expect(captured.options?.stdio).toEqual(["pipe", "pipe", "pipe"]);
  });
});
