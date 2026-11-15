import { afterEach, beforeEach, vi } from "vitest";

/** Freeze time for every test in the calling file (restored after each test). */
export function setupFakeTimers() {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
