import { describe, expect, test } from "vitest";
import { THREAD_STATUS_META } from "./status-meta";

describe("THREAD_STATUS_META colors", () => {
  test("live states use the semantic status tokens", () => {
    expect(THREAD_STATUS_META.streaming.className).toBe("text-info");
    expect(THREAD_STATUS_META.waiting_input.className).toBe("text-warning");
    expect(THREAD_STATUS_META.failed.className).toBe("text-destructive");
  });

  test("resting states stay muted", () => {
    expect(THREAD_STATUS_META.pending.className).toBe("text-muted-foreground");
    expect(THREAD_STATUS_META.completed.className).toBe("text-muted-foreground/70");
  });
});
