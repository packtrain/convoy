import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  type CliRuntimeRunner,
  type ContentChunk,
} from "../contracts.js";
import { createFileStreamRunner } from "./runner.js";

async function collectChunks(
  gen: AsyncGenerator<ContentChunk, unknown, unknown>
): Promise<ContentChunk[]> {
  const chunks: ContentChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

const SESSION_FIXTURE = [
  '{"type":"system","subtype":"init","session_id":"fixture-session"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}',
  '{"type":"result","subtype":"success"}',
].join("\n") + "\n";

describe("claude-code (session fixture)", () => {
  let runner: CliRuntimeRunner;
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "claude-code-session-"));
    const fixture = join(fixtureDir, "session.jsonl");
    writeFileSync(fixture, SESSION_FIXTURE);
    runner = createFileStreamRunner(fixture, { delayMs: 0 });
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("creates a runner with execute and abort methods", () => {
    expect(runner.execute).toBeDefined();
    expect(typeof runner.execute).toBe("function");
    expect(runner.abort).toBeDefined();
    expect(typeof runner.abort).toBe("function");
  });

  describe("execute", () => {
    it("yields content chunks", async () => {
      const chunks = await collectChunks(
        runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" })
      );

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("each chunk has a type matching its data", async () => {
      const chunks = await collectChunks(
        runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" })
      );

      for (const chunk of chunks) {
        expect(chunk.data).toContain(`"type":"${chunk.type}"`);
      }
    });

    it("includes system, assistant, user, and result types", async () => {
      const chunks = await collectChunks(
        runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" })
      );

      const types = chunks.map((c) => c.type);
      expect(types).toContain("system");
      expect(types).toContain("assistant");
      expect(types).toContain("user");
      expect(types).toContain("result");
    });

    it("system chunk contains init subtype", async () => {
      const chunks = await collectChunks(
        runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" })
      );

      const systemChunk = chunks.find((c) => c.type === "system")!;
      expect(systemChunk.data).toContain('"subtype":"init"');
    });
  });

  describe("abort", () => {
    it("stops yielding chunks when aborted", async () => {
      const gen = runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" });

      const first = await gen.next();
      expect(first.done).toBe(false);

      runner.abort();

      const remaining = await collectChunks(gen);
      expect(remaining.length).toBe(0);
    });
  });
});

describe("createFileStreamRunner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "claude-code-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("streams lines from a JSONL file", async () => {
    const fixture = join(tmpDir, "test.jsonl");
    writeFileSync(
      fixture,
      [
        '{"type":"system","subtype":"init"}',
        '{"type":"assistant","message":"hello"}',
        '{"type":"result","subtype":"success"}',
      ].join("\n") + "\n"
    );

    const runner = createFileStreamRunner(fixture, { delayMs: 0 });
    const chunks = await collectChunks(
      runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" })
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe("system");
    expect(chunks[1].type).toBe("assistant");
    expect(chunks[2].type).toBe("result");
  });

  it("extracts continuationId from fixture stream output", async () => {
    const fixture = join(tmpDir, "test.jsonl");
    writeFileSync(
      fixture,
      [
        '{"type":"system","subtype":"init","session_id":"fixture-session-1"}',
        '{"type":"assistant","message":"hello"}',
      ].join("\n") + "\n"
    );

    const runner = createFileStreamRunner(fixture, { delayMs: 0 });
    const gen = runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" });

    while (true) {
      const next = await gen.next();
      if (next.done) {
        expect(next.value).toEqual({ continuationId: "fixture-session-1" });
        break;
      }
    }
  });

  it("throws when continuation is required but fixture has no session id", async () => {
    const fixture = join(tmpDir, "test.jsonl");
    writeFileSync(
      fixture,
      [
        '{"type":"assistant","message":"hello"}',
        '{"type":"result","subtype":"success"}',
      ].join("\n") + "\n"
    );

    const runner = createFileStreamRunner(fixture, { delayMs: 0 });
    const gen = runner.execute("/test/repo", "hello", {
      threadId: "thread_test",
      cliType: "claude-code",
      continuationId: "session-prev",
      requireContinuation: true,
    });

    await expect(async () => {
      while (true) {
        const next = await gen.next();
        if (next.done) return;
      }
    }).rejects.toThrow(
      "Claude run completed without session_id/sessionId in stream-json output"
    );
  });

  it("skips empty lines", async () => {
    const fixture = join(tmpDir, "test.jsonl");
    writeFileSync(
      fixture,
      '{"type":"system"}\n\n\n{"type":"result"}\n'
    );

    const runner = createFileStreamRunner(fixture, { delayMs: 0 });
    const chunks = await collectChunks(
      runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" })
    );

    expect(chunks).toHaveLength(2);
  });

  it("abort stops iteration", async () => {
    const fixture = join(tmpDir, "test.jsonl");
    writeFileSync(
      fixture,
      [
        '{"type":"system"}',
        '{"type":"assistant"}',
        '{"type":"result"}',
      ].join("\n") + "\n"
    );

    const runner = createFileStreamRunner(fixture, { delayMs: 0 });
    const gen = runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" });

    const first = await gen.next();
    expect(first.done).toBe(false);
    if (first.done) {
      throw new Error("Expected first chunk to be yielded");
    }
    expect(first.value.type).toBe("system");

    runner.abort();

    const remaining = await collectChunks(gen);
    expect(remaining.length).toBe(0);
  });

  it("throws when file does not exist", async () => {
    const runner = createFileStreamRunner(join(tmpDir, "nonexistent.jsonl"), {
      delayMs: 0,
    });
    const gen = runner.execute("/test/repo", "hello", { threadId: "thread_test", cliType: "claude-code" });

    await expect(gen.next()).rejects.toThrow();
  });

  it("accepts plan cliMode in fixture simulation mode", async () => {
    const fixture = join(tmpDir, "test.jsonl");
    writeFileSync(
      fixture,
      '{"type":"system","subtype":"init","session_id":"fixture-session-1"}\n'
    );

    const runner = createFileStreamRunner(fixture, { delayMs: 0 });
    const chunks = await collectChunks(
      runner.execute("/test/repo", "hello", {
        threadId: "thread_test",
        cliType: "claude-code",
        cliMode: "plan",
      })
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe("system");
  });
});
