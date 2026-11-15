import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_APP_VERSION_POLL_INTERVAL_MS,
  getAppVersionPollIntervalMs,
  isAppVersionResponse,
} from "./app-version";

describe("app-version", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses the default two-minute poll interval", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION_POLL_INTERVAL_MS", "");

    expect(getAppVersionPollIntervalMs()).toBe(
      DEFAULT_APP_VERSION_POLL_INTERVAL_MS
    );
  });

  test("uses a positive env poll interval override", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION_POLL_INTERVAL_MS", "30000");

    expect(getAppVersionPollIntervalMs()).toBe(30000);
  });

  test("validates app version endpoint responses", () => {
    expect(
      isAppVersionResponse({ frontend: { buildId: "build-123" } })
    ).toBe(true);
    expect(isAppVersionResponse({ frontend: {} })).toBe(false);
    expect(isAppVersionResponse(null)).toBe(false);
  });
});

