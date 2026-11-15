import { afterEach, describe, expect, it } from "vitest";
import {
  disableConnectEvents,
  emitConnectEvent,
  enableConnectEvents,
  EXIT_CLEAN,
  EXIT_FATAL,
  EXIT_SESSION_REPLACED,
} from "./connect-events.js";

function captureEvents(): { lines: string[]; parsed: () => Array<Record<string, unknown>> } {
  const lines: string[] = [];
  enableConnectEvents((line) => lines.push(line));
  return { lines, parsed: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

afterEach(() => {
  disableConnectEvents();
});

describe("connect events", () => {
  it("is a no-op when not enabled", () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      emitConnectEvent({ event: "status", status: "online" });
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(writes).toEqual([]);
  });

  it("emits versioned, timestamped NDJSON lines", () => {
    const capture = captureEvents();

    emitConnectEvent({ event: "status", status: "connecting" });
    emitConnectEvent({ event: "thread", phase: "claimed", threadId: "t1" });

    const [status, thread] = capture.parsed();
    expect(status).toMatchObject({ v: 1, event: "status", status: "connecting" });
    expect(typeof status.ts).toBe("number");
    expect(thread).toMatchObject({ v: 1, event: "thread", phase: "claimed", threadId: "t1" });
  });

  it("dedupes consecutive identical statuses but emits transitions", () => {
    const capture = captureEvents();

    emitConnectEvent({ event: "status", status: "online", sessionId: "s1" });
    emitConnectEvent({ event: "status", status: "online", sessionId: "s1" });
    emitConnectEvent({ event: "status", status: "retrying" });
    emitConnectEvent({ event: "status", status: "online", sessionId: "s1" });

    expect(capture.parsed().map((event) => event.status)).toEqual(["online", "retrying", "online"]);
  });

  it("does not dedupe thread events", () => {
    const capture = captureEvents();

    emitConnectEvent({ event: "thread", phase: "streaming", threadId: "t1" });
    emitConnectEvent({ event: "thread", phase: "streaming", threadId: "t1" });

    expect(capture.lines).toHaveLength(2);
  });

  it("redirects console.log/info/debug to stderr while enabled and restores on disable", () => {
    const original = { log: console.log, info: console.info, debug: console.debug };
    enableConnectEvents(() => {});
    expect(console.log).not.toBe(original.log);
    expect(console.info).not.toBe(original.info);
    expect(console.debug).not.toBe(original.debug);
    disableConnectEvents();
    expect(console.log).toBe(original.log);
    expect(console.info).toBe(original.info);
    expect(console.debug).toBe(original.debug);
  });

  it("exposes the supervisor exit-code contract", () => {
    expect(EXIT_CLEAN).toBe(0);
    expect(EXIT_FATAL).toBe(1);
    expect(EXIT_SESSION_REPLACED).toBe(3);
  });
});
