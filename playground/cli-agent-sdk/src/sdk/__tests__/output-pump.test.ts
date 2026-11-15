import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";

import { startOutputPump } from "../runtime/output-pump.js";

describe("output pump", () => {
  it("drains stdout/stderr lines", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const lines: Array<{ stream: string; line: string; truncated: boolean }> = [];

    const pump = startOutputPump({
      stdout,
      stderr,
      maxLineBytesStdout: 128,
      maxLineBytesStderr: 128,
      maxEventQueueDepth: 32,
      onLine: async (event) => {
        lines.push(event);
      },
    });

    stdout.write("one\ntwo\n");
    stderr.write("err\n");
    stdout.end();
    stderr.end();

    await pump.done;

    expect(lines.map((line) => `${line.stream}:${line.line}`)).toEqual([
      "stdout:one",
      "stdout:two",
      "stderr:err",
    ]);
  });

  it("truncates oversized lines", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const lines: Array<{ stream: string; line: string; truncated: boolean }> = [];

    const pump = startOutputPump({
      stdout,
      stderr,
      maxLineBytesStdout: 4,
      maxLineBytesStderr: 4,
      maxEventQueueDepth: 32,
      onLine: async (event) => {
        lines.push(event);
      },
    });

    stdout.write("123456\n");
    stdout.end();
    stderr.end();

    await pump.done;

    expect(lines[0]?.truncated).toBe(true);
    expect(lines[0]?.line).toBe("1234");
  });

  it("drops lines when queue is full", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let dropped = 0;
    let release: () => void = () => undefined;

    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const seen: string[] = [];

    const pump = startOutputPump({
      stdout,
      stderr,
      maxLineBytesStdout: 128,
      maxLineBytesStderr: 128,
      maxEventQueueDepth: 1,
      onDrop: () => {
        dropped += 1;
      },
      onLine: async (event) => {
        seen.push(event.line);
        await hold;
      },
    });

    stdout.write("a\n");
    stdout.write("b\n");
    stdout.write("c\n");
    stdout.end();
    stderr.end();

    await Promise.resolve();
    release();
    await pump.done;

    expect(dropped > 0).toBe(true);
    expect(seen.includes("a")).toBe(true);
  });
});
