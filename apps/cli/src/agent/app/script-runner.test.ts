import { describe, expect, it } from "vitest";
import { appendTail, createScriptRunner, SCRIPT_OUTPUT_CHUNK_TYPE } from "./script-runner.js";
import type { ContentChunk, RunnerExecutionResult } from "../runtimes/contracts.js";
import { createFakeChildProcess } from "../sdk/__tests__/test-helpers.js";

async function run(script: string, timeoutMs = 10_000, env?: Record<string, string>): Promise<{ chunks: ContentChunk[]; result: RunnerExecutionResult }> {
  const runner = createScriptRunner();
  const execution = runner.execute(process.cwd(), script, { cliType: "claude-code", threadId: "t", scriptRequest: { script, timeoutMs, env } });
  const chunks: ContentChunk[] = [];
  while (true) {
    const next = await execution.next();
    if (next.done) {
      return { chunks, result: next.value };
    }
    chunks.push(next.value);
  }
}

describe("script runner (OS-1886)", () => {
  it("streams stdout and stderr as script-output chunks and reports the exit code", async () => {
    const { chunks, result } = await run("echo out; echo err 1>&2; exit 3");
    const output = chunks.filter((chunk) => chunk.type === SCRIPT_OUTPUT_CHUNK_TYPE).map((chunk) => chunk.data).join("");
    expect(output).toContain("out\n");
    expect(output).toContain("err\n");
    expect(chunks.at(-1)).toMatchObject({ type: "convoy_notice" });
    expect(JSON.parse(chunks.at(-1)!.data)).toMatchObject({ code: "script-exit", message: "Exited with code 3" });
    expect(result.scriptResult).toMatchObject({ exitCode: 3, timedOut: false });
    expect(result.scriptResult?.outputTail).toContain("out\n");
    expect(result.continuationId).toBeUndefined();
  });

  it("adds the request's env vars to the CLI's own environment", async () => {
    const { result } = await run('echo "$CONVOY_BRANCH:${PATH:+has-path}"', 10_000, { CONVOY_BRANCH: "feat/x" });
    expect(result.scriptResult?.outputTail).toContain("feat/x:has-path\n");
  });

  it("kills the script at its timeout and says so", async () => {
    const { chunks, result } = await run("echo start; sleep 30; echo never", 300);
    expect(result.scriptResult?.timedOut).toBe(true);
    expect(result.scriptResult?.outputTail).toContain("start\n");
    expect(result.scriptResult?.outputTail).not.toContain("never");
    expect(JSON.parse(chunks.at(-1)!.data).message).toBe("Timed out after 0.3s");
  });

  it("abort ends the run", async () => {
    const runner = createScriptRunner();
    const script = "sleep 30";
    const execution = runner.execute(process.cwd(), script, { cliType: "claude-code", threadId: "t", scriptRequest: { script, timeoutMs: 60_000 } });
    setTimeout(() => runner.abort(), 100);
    let done = await execution.next();
    while (!done.done) {
      done = await execution.next();
    }
    // Ended by signal, not by exit code 0, and well before the 30s sleep.
    const result = done.value as RunnerExecutionResult;
    expect(result.scriptResult?.exitCode).not.toBe(0);
    expect(result.scriptResult?.timedOut).toBe(false);
  });

  it("keeps output that arrives between exit and close", async () => {
    const child = createFakeChildProcess(4321);
    const runner = createScriptRunner({ spawnImpl: () => child });
    const script = "late";
    const execution = runner.execute(process.cwd(), script, { cliType: "claude-code", threadId: "t", scriptRequest: { script, timeoutMs: 60_000 } });
    const first = execution.next();
    child.emit("exit", 0, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    child.stdout.write("late line\n");
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
    const chunks: ContentChunk[] = [];
    let next = await first;
    while (!next.done) {
      chunks.push(next.value);
      next = await execution.next();
    }
    expect(chunks.map((chunk) => chunk.data).join("")).toContain("late line\n");
    expect(next.value.scriptResult?.outputTail).toBe("late line\n");
  });

  it("a TERM-resistant descendant does not outlive the timeout", async () => {
    const { chunks, result } = await run("(trap '' TERM; sleep 30) & echo $!; wait", 300);
    expect(result.scriptResult?.timedOut).toBe(true);
    const output = chunks.filter((chunk) => chunk.type === SCRIPT_OUTPUT_CHUNK_TYPE).map((chunk) => chunk.data).join("");
    const descendantPid = Number(output.match(/^\d+$/m)?.[0]);
    expect(descendantPid).toBeGreaterThan(0);
    // Signal delivery is asynchronous; give the kernel a moment.
    const deadline = Date.now() + 2_000;
    const isAlive = () => {
      try {
        process.kill(descendantPid, 0);
        return true;
      } catch {
        return false;
      }
    };
    while (isAlive() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(isAlive()).toBe(false);
  }, 15_000);

  it("appendTail keeps the last chars without splitting a surrogate pair", () => {
    expect(appendTail("abc", "def", 4)).toBe("cdef");
    // "a😀b" is 4 UTF-16 units; a cut landing on the low half moves past it.
    expect(appendTail("", "a😀b", 3)).toBe("😀b");
    expect(appendTail("", "a😀b", 2)).toBe("b");
  });
});
