import { describe, expect, test } from "vitest";
import { waitForMigrations } from "./waitForMigrations.mjs";

type Status = { name: string; isDone: boolean; state: string; processed: number; error?: string };

const done = (name: string): Status => ({ name, isDone: true, state: "success", processed: 3 });
const running = (name: string, processed = 1): Status => ({ name, isDone: false, state: "inProgress", processed });
const notStarted = (name: string): Status => ({ name, isDone: false, state: "unknown", processed: 0 });

/** Runs the wait against a fixed sequence of polls; the last one repeats. */
async function wait(polls: Status[][]) {
  const lines: string[] = [];
  let i = 0;
  const result = await waitForMigrations(async () => polls[Math.min(i++, polls.length - 1)], {
    pollMs: 0,
    log: (line: string) => lines.push(line),
  });
  return { result, polls: i, lines };
}

describe("waitForMigrations", () => {
  test("returns once every migration is done, through the gap between two of them", async () => {
    const r = await wait([
      [running("m:a"), notStarted("m:b")],
      [done("m:a"), notStarted("m:b")],
      [done("m:a"), running("m:b")],
      [done("m:a"), done("m:b")],
    ]);
    expect(r.result).toBeNull();
    expect(r.polls).toBe(4);
    expect(r.lines).toEqual(["Waiting for data migration m:a (1 documents so far)...", "Waiting for data migration m:b (0 documents so far)...", "Waiting for data migration m:b (1 documents so far)..."]);
  });

  test("names a failed migration", async () => {
    const r = await wait([[done("m:a"), { ...running("m:b"), state: "failed", error: "boom" }, notStarted("m:c")]]);
    expect(r.result).toBe("Data migration m:b failed: boom");
  });

  test("names a canceled migration", async () => {
    const r = await wait([[{ ...running("m:a"), state: "canceled" }]]);
    expect(r.result).toBe("Data migration m:a was canceled.");
  });

  test("gives up when nothing runs and a migration is still pending", async () => {
    const r = await wait([[done("m:a"), notStarted("m:b")]]);
    expect(r.result).toMatch(/^Data migrations stopped before m:b finished/);
    expect(r.polls).toBe(3);
  });
});
