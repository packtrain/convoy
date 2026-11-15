import { afterEach, expect, test, vi } from "vitest";
import { Logs } from "./workflow.js";
import { streamLogs, exportLogs } from "./export.js";
import { displayLines, terminalJson } from "./formatters.js";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WINDOW_BYTES, WINDOW_EVENTS, type LogEvent, type ReadLogs } from "./validators.js";

const event = (order: number, text = `event-${order}`): LogEvent => {
  const eventJson = JSON.stringify({ nested: { text } });
  return { order, eventJson, truncated: false, bytes: Buffer.byteLength(eventJson), length: eventJson.length, fidelity: "stored" };
};
const response = (page: LogEvent[], latest = page.at(-1)?.order ?? -1, hasMore = false) => ({ v: 1 as const, id: "read", ok: true,
  result: { raw: true, run: { status: "streaming" }, page, latest, hasMore, cursor: page.at(-1)?.order ?? -1 } });
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); });
function logs(read: ReadLogs) { const value = new Logs(read); cleanups.push(() => value.dispose()); value.start(); return value; }

test("preserves nested JSON, bounds bytes and count through sustained follow, and reloads evicted history", async () => {
  vi.useFakeTimers();
  let latest = 9;
  const read = vi.fn<ReadLogs>(async args => {
    const start = args.chunkBefore !== undefined ? Math.max(0, Math.min(latest + 1, args.chunkBefore) - 10) : (args.chunkAfter ?? -1) + 1;
    const end = Math.min(start + 10, latest + 1);
    return response(Array.from({ length: Math.max(0, end - start) }, (_, i) => event(start + i, "€".repeat(1000))), latest, end <= latest);
  });
  const view = logs(read);
  await vi.advanceTimersByTimeAsync(1);
  expect(JSON.parse(view.getSnapshot().events[0].eventJson).nested.text).toBe("€".repeat(1000));
  for (let i = 0; i < 60; i++) { latest += 10; await vi.advanceTimersByTimeAsync(3000); }
  expect(view.getSnapshot().events.length).toBeLessThanOrEqual(WINDOW_EVENTS);
  expect(view.getSnapshot().bytes).toBeLessThanOrEqual(WINDOW_BYTES);
  const first = view.getSnapshot().events[0].order;
  expect(first).toBeGreaterThan(0);
  view.older(); await vi.advanceTimersByTimeAsync(1);
  expect(view.getSnapshot().events[0].order).toBeLessThan(first);
});

test("discards late old-view reads and releases buffers on dispose", async () => {
  let release!: (result: ReturnType<typeof response>) => void;
  const view = logs(() => new Promise(resolve => { release = resolve; }));
  view.dispose(); release(response([event(0)]));
  await Promise.resolve(); await Promise.resolve();
  expect(view.getSnapshot().events).toEqual([]);
  expect(view.getSnapshot().bytes).toBe(0);
});

test("pausing prevents an in-flight response from replacing the displayed window", async () => {
  vi.useFakeTimers();
  let release!: (result: ReturnType<typeof response>) => void;
  const read = vi.fn<ReadLogs>().mockResolvedValueOnce(response([event(0)])).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const view = logs(read); await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(3000);
  view.pause(); release(response([event(1)])); await vi.advanceTimersByTimeAsync(1);
  expect(view.getSnapshot().events.map(row => row.order)).toEqual([0]);
});

test("deduplicates overlapping pages and reconnect replay", async () => {
  vi.useFakeTimers();
  const read = vi.fn<ReadLogs>().mockResolvedValueOnce(response([event(0), event(1)])).mockResolvedValue(response([event(1), event(2)]));
  const view = logs(read); await vi.advanceTimersByTimeAsync(6001);
  expect(view.getSnapshot().events.map(row => row.order)).toEqual([0, 1, 2]);
});

test("retrieves large events in chunks and keeps oversized events as explicit descriptors", async () => {
  vi.useFakeTimers();
  const stored = event(0, "x".repeat(10000));
  const oversized = event(1, "x".repeat(70000));
  const read = vi.fn<ReadLogs>(async args => args.eventOrder !== undefined
    ? response([{ ...stored, eventJson: stored.eventJson.slice(args.eventOffset ?? 0, (args.eventOffset ?? 0) + 5000), nextOffset: (args.eventOffset ?? 0) + 5000 < stored.length ? (args.eventOffset ?? 0) + 5000 : undefined }])
    : response([{ ...stored, eventJson: "", nextOffset: 0 }, { ...oversized, eventJson: "", nextOffset: 0 }]));
  const view = logs(read); await vi.advanceTimersByTimeAsync(1);
  expect(view.getSnapshot().events[0].eventJson).toBe(stored.eventJson);
  expect(view.getSnapshot().events[1].eventJson).toBe("");
  expect(displayLines(view.getSnapshot().events, 80).join("\n")).toContain("export retrieves");
});

test("export waits for sink backpressure, streams fragments, and uses an initial upper bound", async () => {
  const stored = event(0, "😀".repeat(6000));
  let release!: () => void;
  const read = vi.fn<ReadLogs>(async args => {
    if (args.eventOrder !== undefined) {
      const offset = args.eventOffset ?? 0, end = Math.min(offset + 4000, stored.length);
      return response([{ ...stored, eventJson: stored.eventJson.slice(offset, end), nextOffset: end < stored.length ? end : undefined }], 1);
    }
    return response([{ ...stored, eventJson: "", nextOffset: 0 }, event(1)], 0, true);
  });
  const writes: string[] = [];
  const write = vi.fn(async (text: string) => { writes.push(text); if (writes.length === 1) await new Promise<void>(resolve => { release = resolve; }); });
  const exporting = streamLogs(read, write, new AbortController().signal);
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  expect(read).toHaveBeenCalledTimes(2);
  release(); expect(await exporting).toBe(1);
  expect(writes.join("")).toBe(stored.eventJson + "\n");
});

test("cancellation stops further page reads after the pending write", async () => {
  const read = vi.fn<ReadLogs>(async () => response([event(0)], 20, true));
  const abort = new AbortController();
  await expect(streamLogs(read, async () => { abort.abort(); }, abort.signal)).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1);
});

test("export keeps the destination intact on failure, reports a partial file and requires overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "convoy-export-")); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const destination = join(dir, "run.jsonl"); await writeFile(destination, "old");
  const read = vi.fn<ReadLogs>(async () => response([event(0)]));
  let partial = "";
  await expect(exportLogs(read, destination, false, new AbortController().signal, path => { partial = path; })).rejects.toThrow();
  expect(await readFile(destination, "utf8")).toBe("old");
  expect(await readFile(partial, "utf8")).toBe(event(0).eventJson + "\n");
  expect(await exportLogs(read, destination, true, new AbortController().signal, () => {})).toBe(1);
  expect(await readFile(destination, "utf8")).toBe(event(0).eventJson + "\n");
  expect((await readdir(dir)).filter(name => name.endsWith(".partial"))).toHaveLength(1);
});

test("terminal escaping preserves JSON values and Unicode wrapping", () => {
  const json = JSON.stringify({ text: "hello\u202e🌎你好" });
  expect(JSON.parse(terminalJson(json))).toEqual(JSON.parse(json));
  expect(terminalJson(json)).not.toContain("\u202e");
  const value = event(0, "🌎你好");
  expect(displayLines([value], 8).join("")).toBe(value.eventJson);
});

test("paused probes do not fetch payload pages and detect unread events", async () => {
  vi.useFakeTimers();
  const read = vi.fn<ReadLogs>().mockResolvedValueOnce(response([event(0)])).mockResolvedValue(response([], 10));
  const view = logs(read); await vi.advanceTimersByTimeAsync(1);
  view.pause(); await vi.advanceTimersByTimeAsync(3000);
  expect(read.mock.calls[1][0]).toEqual({ chunkAfter: Number.MAX_SAFE_INTEGER });
  expect(view.getSnapshot()).toMatchObject({ latest: 10, seen: 0 });
  expect(view.getSnapshot().events).toHaveLength(1);
});

test("following catch-up does not mark unseen history read", async () => {
  vi.useFakeTimers();
  const read = vi.fn<ReadLogs>().mockResolvedValueOnce(response([event(0)], 0)).mockResolvedValueOnce(response([event(1)], 10, true))
    .mockImplementation(() => new Promise(() => {}));
  const view = logs(read); await vi.advanceTimersByTimeAsync(3001);
  expect(view.getSnapshot().seen).toBe(1);
});

test("settled runs stop background polling after reaching the tail", async () => {
  vi.useFakeTimers();
  const result = response([event(0)]); result.result.run.status = "completed";
  const read = vi.fn<ReadLogs>(async () => result);
  logs(read); await vi.advanceTimersByTimeAsync(30001);
  expect(read).toHaveBeenCalledTimes(1);
});

test("caps small-event windows by count even below the byte budget", async () => {
  vi.useFakeTimers();
  let latest = 9;
  const read = vi.fn<ReadLogs>(async args => {
    const first = args.chunkBefore !== undefined ? 0 : (args.chunkAfter ?? -1) + 1;
    const end = Math.min(first + 10, latest + 1);
    return response(Array.from({ length: end - first }, (_, i) => event(first + i)), latest);
  });
  const view = logs(read); await vi.advanceTimersByTimeAsync(1);
  for (let i = 0; i < 20; i++) { latest += 10; await vi.advanceTimersByTimeAsync(3000); }
  expect(view.getSnapshot().events).toHaveLength(WINDOW_EVENTS);
  expect(view.getSnapshot().events.at(-1)?.order).toBe(latest);
  expect(view.getSnapshot().bytes).toBeLessThan(WINDOW_BYTES);
});

test("every large event remains reachable in both paging directions", async () => {
  vi.useFakeTimers();
  const stored = Array.from({ length: 100 }, (_, i) => event(i, "x".repeat(60000)));
  const read = vi.fn<ReadLogs>(async args => {
    if (args.eventOrder !== undefined) {
      const row = stored[args.eventOrder], offset = args.eventOffset ?? 0, end = Math.min(offset + 16384, row.length);
      return response([{ ...row, eventJson: row.eventJson.slice(offset, end), nextOffset: end < row.length ? end : undefined }], 99);
    }
    const page = args.chunkBefore !== undefined ? stored.filter(row => row.order < args.chunkBefore!).slice(-10) : stored.filter(row => row.order > (args.chunkAfter ?? -1)).slice(0, 10);
    return response(page.map(row => ({ ...row, eventJson: "", nextOffset: 0 })), 99);
  });
  const view = logs(read); await vi.advanceTimersByTimeAsync(1);
  const backwards = new Set(view.getSnapshot().events.map(row => row.order));
  for (let i = 0; i < 60 && view.getSnapshot().events[0].order > 0; i++) {
    view.older(); await vi.advanceTimersByTimeAsync(1);
    view.getSnapshot().events.forEach(row => backwards.add(row.order));
    expect(view.getSnapshot().bytes).toBeLessThanOrEqual(WINDOW_BYTES);
  }
  expect([...backwards].sort((a, b) => a - b)).toEqual(stored.map(row => row.order));
  const forwards = new Set(view.getSnapshot().events.map(row => row.order));
  for (let i = 0; i < 60 && view.getSnapshot().events.at(-1)!.order < 99; i++) {
    view.newer(); await vi.advanceTimersByTimeAsync(1);
    view.getSnapshot().events.forEach(row => forwards.add(row.order));
  }
  expect([...forwards].sort((a, b) => a - b)).toEqual(stored.map(row => row.order));
});

test("failed reads stop until explicit retry", async () => {
  vi.useFakeTimers();
  const read = vi.fn<ReadLogs>().mockRejectedValue(new Error("private backend detail"));
  const view = logs(read); await vi.advanceTimersByTimeAsync(30001);
  expect(read).toHaveBeenCalledTimes(1);
  expect(view.getSnapshot().error).not.toContain("private");
  view.retry(); await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
});

test("invalid responses have a safe specific diagnostic", async () => {
  vi.useFakeTimers();
  const view = logs(async () => ({ ...response([]), result: { secret: "credential" } }));
  await vi.advanceTimersByTimeAsync(1);
  expect(view.getSnapshot().error).toContain("Invalid log response");
  expect(view.getSnapshot().error).not.toContain("credential");
});

test("explicit newer paging marks displayed events read", async () => {
  vi.useFakeTimers();
  const read = vi.fn<ReadLogs>().mockResolvedValueOnce(response([event(0)])).mockResolvedValue(response([event(1)], 1));
  const view = logs(read); await vi.advanceTimersByTimeAsync(1);
  view.newer(); await vi.advanceTimersByTimeAsync(1);
  expect(view.getSnapshot()).toMatchObject({ seen: 1, following: false });
});

test("fidelity warnings identify flagged events separately from JSON and oversized descriptors", () => {
  const flagged = { ...event(2), fidelity: "possibly shortened before storage" };
  const oversized = { ...event(3), eventJson: "", nextOffset: 0, fidelity: "stored non-JSON data; original completeness unknown" };
  const lines = displayLines([event(1), flagged, oversized], 120);
  expect(lines).toContain("[Event 2: possibly shortened before storage]");
  expect(lines).toContain(flagged.eventJson);
  expect(lines).toContain("[Event 3: stored non-JSON data; original completeness unknown]");
  expect(lines.some(line => line.startsWith("[Event 1:"))).toBe(false);
});
