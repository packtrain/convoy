/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AppVersionWatcher } from "./app-version-watcher";

describe("AppVersionWatcher", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  test("renders the refresh banner when a newer build is detected", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_APP_BUILD_ID", "current-build");
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION_POLL_INTERVAL_MS", "1000");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ frontend: { buildId: "next-build" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AppVersionWatcher />);

    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/app-version", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    expect(screen.getByRole("alert").textContent).toContain("Refresh required");
    expect(screen.getByText("You are using an older version of Convoy. Refresh to avoid errors.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDefined();
  });

  test("does not render the refresh banner when the build id matches", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_APP_BUILD_ID", "current-build");
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION_POLL_INTERVAL_MS", "1000");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ frontend: { buildId: "current-build" } }),
      })
    );

    render(<AppVersionWatcher />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("fails soft when the app-version request is unavailable", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_APP_BUILD_ID", "current-build");
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION_POLL_INTERVAL_MS", "1000");
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    render(<AppVersionWatcher />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/app-version", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
