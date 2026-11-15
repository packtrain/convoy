import { afterEach, describe, expect, it, vi } from "vitest";

import { RunTimeoutController } from "../runtime/timeouts.js";

describe("run timeout controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("startup timeout fires when startup is not satisfied", () => {
    vi.useFakeTimers();
    const hits: string[] = [];
    const controller = new RunTimeoutController(
      {
        startupTimeoutMs: 1,
        idleTimeoutMs: 0,
        maxRunTimeoutMs: 0,
      },
      {
        onTimeout: (kind) => hits.push(kind),
      }
    );

    controller.start();
    vi.advanceTimersByTime(2);
    controller.stop();

    expect(hits.includes("startup")).toBe(true);
  });

  it("idle timeout is reset by activity", () => {
    vi.useFakeTimers();
    const hits: string[] = [];
    const controller = new RunTimeoutController(
      {
        startupTimeoutMs: 0,
        idleTimeoutMs: 2,
        maxRunTimeoutMs: 0,
      },
      { onTimeout: (kind) => hits.push(kind) }
    );

    controller.start();
    controller.touchActivity();
    vi.advanceTimersByTime(1);
    controller.touchActivity();
    vi.advanceTimersByTime(4);
    controller.stop();

    expect(hits.includes("idle")).toBe(true);
  });
});
