import { describe, expect, test } from "vitest";
import { scrubOversizedChunk } from "./chunk-scrub.js";

describe("scrubOversizedChunk (OS-1521)", () => {
  test("chunks under the budget pass through untouched", () => {
    const chunk = { type: "user", data: JSON.stringify({ ok: true }) };
    expect(scrubOversizedChunk(chunk)).toBe(chunk);
  });

  test("huge strings are clamped with a truncation notice", () => {
    const scrubbed = scrubOversizedChunk({
      type: "user",
      data: JSON.stringify({ output: "x".repeat(300_000), keep: "small" }),
    });
    expect(scrubbed.data.length).toBeLessThanOrEqual(100_000);
    const parsed = JSON.parse(scrubbed.data) as { output: string; keep: string };
    expect(parsed.output.startsWith("xxx")).toBe(true);
    expect(parsed.output).toContain("[truncated");
    expect(parsed.keep).toBe("small");
  });

  test("a barely-over chunk keeps most of a large string (widest rung wins)", () => {
    const scrubbed = scrubOversizedChunk({
      type: "user",
      data: JSON.stringify({ output: "y".repeat(99_000), extra: "z".repeat(2_000) }),
    });
    expect(scrubbed.data.length).toBeLessThanOrEqual(100_000);
    const parsed = JSON.parse(scrubbed.data) as { output: string; extra: string };
    // The widest cap rung that fits wins; a flat /4 cap would leave 25k.
    expect(parsed.output.length).toBeGreaterThan(80_000);
    expect(parsed.extra).toBe("z".repeat(2_000));
  });

  test("base64 payloads are dropped, wrapper kept", () => {
    const scrubbed = scrubOversizedChunk({
      type: "user",
      data: JSON.stringify({
        source: {
          type: "base64",
          media_type: "image/png",
          data: "a".repeat(300_000),
        },
        tool_use_result: {
          type: "image",
          file: { base64: "b".repeat(300_000), filePath: "/tmp/shot.png" },
        },
      }),
    });
    const parsed = JSON.parse(scrubbed.data) as {
      source: { media_type: string; data: string };
      tool_use_result: { file: { base64: string; filePath: string } };
    };
    expect(parsed.source.data).toBe("");
    expect(parsed.source.media_type).toBe("image/png");
    // The tool_use_result copy has no type:"base64" block; the key-based rule
    // must catch it (review #3).
    expect(parsed.tool_use_result.file.base64).toBe("");
    expect(parsed.tool_use_result.file.filePath).toBe("/tmp/shot.png");
  });

  test("many medium strings that cannot be scrubbed are raw-truncated", () => {
    const scrubbed = scrubOversizedChunk({
      type: "user",
      data: JSON.stringify({
        blocks: Array.from({ length: 10 }, () => "m".repeat(20_000)),
      }),
    });
    // Nothing shippable above the budget, ever (review #1).
    expect(scrubbed.data.length).toBe(100_000);
  });

  test("oversized non-JSON data is raw-truncated to the budget", () => {
    const scrubbed = scrubOversizedChunk({ type: "user", data: "x".repeat(200_000) });
    expect(scrubbed.data.length).toBe(100_000);
    expect(scrubbed.data).toBe("x".repeat(100_000));
  });
});

test.each(["claude", "codex"])("bounds %s snapshots structurally before transport truncation", provider => {
  const tasks = Array.from({ length: 240 }, (_, i) => ({ task_id: `job-${i}`, task_type: "local_agent", description: "\\\"😀".repeat(1000) }));
  const chunk = { type: provider === "claude" ? "system" : "convoy/background_tasks", data: JSON.stringify({
    ...(provider === "claude" ? { type: "system", subtype: "background_tasks_changed" } : {}), session_id: "session", tasks,
  }) };
  const result = scrubOversizedChunk(chunk);
  expect(result.data.length).toBeLessThanOrEqual(60_000);
  const parsed = JSON.parse(result.data);
  expect(parsed.total_count).toBe(240);
  expect(parsed.tasks.length).toBeGreaterThan(0);
  expect(parsed.tasks.length).toBeLessThanOrEqual(200);
  expect(parsed.tasks.every((t: { description: string }) => t.description.length <= 2000)).toBe(true);
});
