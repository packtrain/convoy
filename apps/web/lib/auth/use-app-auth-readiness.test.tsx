/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { APP_AUTH_READINESS_TIMEOUT_MS, useAppAuthReadiness } from "./use-app-auth-readiness";

let authState = {
  isLoaded: false,
  isSignedIn: false,
  userId: null as string | null,
};
let convexAuthState = {
  isLoading: false,
  isAuthenticated: false,
};

vi.mock("./hooks", () => ({
  useAppAuth: () => authState,
  useAppConvexAuth: () => convexAuthState,
}));

describe("useAppAuthReadiness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    authState = {
      isLoaded: false,
      isSignedIn: false,
      userId: null,
    };
    convexAuthState = {
      isLoading: false,
      isAuthenticated: false,
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("reports the Clerk and Convex readiness state matrix", () => {
    const view = renderHook(() => useAppAuthReadiness());

    expect(view.result.current).toEqual({
      status: "loading",
      reason: "clerk",
      userId: null,
    });

    authState = {
      isLoaded: true,
      isSignedIn: false,
      userId: null,
    };
    view.rerender();
    expect(view.result.current).toEqual({
      status: "signed-out",
      reason: null,
      userId: null,
    });

    authState = {
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
    };
    convexAuthState = {
      isLoading: true,
      isAuthenticated: false,
    };
    view.rerender();
    expect(view.result.current).toEqual({
      status: "loading",
      reason: "convex",
      userId: "user_1",
    });

    convexAuthState = {
      isLoading: false,
      isAuthenticated: true,
    };
    view.rerender();
    expect(view.result.current).toEqual({
      status: "authenticated",
      reason: null,
      userId: "user_1",
    });
  });

  test("gives a recovered session a fresh timeout window", async () => {
    authState = {
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
    };
    convexAuthState = {
      isLoading: true,
      isAuthenticated: false,
    };
    const view = renderHook(() => useAppAuthReadiness());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APP_AUTH_READINESS_TIMEOUT_MS);
    });
    expect(view.result.current).toEqual({
      status: "timed-out",
      reason: "convex",
      userId: "user_1",
    });

    convexAuthState = {
      isLoading: false,
      isAuthenticated: true,
    };
    view.rerender();
    expect(view.result.current).toEqual({
      status: "authenticated",
      reason: null,
      userId: "user_1",
    });

    convexAuthState = {
      isLoading: false,
      isAuthenticated: false,
    };
    view.rerender();
    expect(view.result.current).toEqual({
      status: "loading",
      reason: "convex",
      userId: "user_1",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APP_AUTH_READINESS_TIMEOUT_MS - 1);
    });
    expect(view.result.current.status).toBe("loading");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(view.result.current).toEqual({
      status: "timed-out",
      reason: "convex",
      userId: "user_1",
    });
  });

  test("cleans up the pending timeout on unmount", () => {
    const view = renderHook(() => useAppAuthReadiness());

    expect(vi.getTimerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
