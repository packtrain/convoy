/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { useConvexAuth, type ConvexReactClient } from "convex/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ConvexClerkProvider } from "./convex-clerk-provider";

const getTokenMock = vi.fn();

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    getToken: getTokenMock,
    sessionClaims: null,
  }),
}));

function Probe() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  return <p>{isLoading ? "loading" : isAuthenticated ? "authenticated" : "unauthenticated"}</p>;
}

type OnAuthChange = (isAuthenticated: boolean) => void;

function reportFromLatestSetAuth(setAuth: ReturnType<typeof vi.fn>, isAuthenticated: boolean) {
  const onChange = setAuth.mock.calls.at(-1)?.[1] as OnAuthChange;
  act(() => onChange(isAuthenticated));
}

describe("ConvexClerkProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getTokenMock.mockResolvedValue("jwt");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("re-runs setAuth with backoff after Convex reports a failed token fetch", async () => {
    const setAuth = vi.fn();
    const client = { setAuth, clearAuth: vi.fn() } as unknown as ConvexReactClient;

    render(
      <ConvexClerkProvider client={client}>
        <Probe />
      </ConvexClerkProvider>
    );
    expect(setAuth).toHaveBeenCalledTimes(1);

    // Clerk stalled: Convex gives up and reports unauthenticated.
    reportFromLatestSetAuth(setAuth, false);
    expect(screen.getByText("unauthenticated")).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(setAuth).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(setAuth).toHaveBeenCalledTimes(2);

    // Second failure waits twice as long.
    reportFromLatestSetAuth(setAuth, false);
    await act(() => vi.advanceTimersByTimeAsync(1_999));
    expect(setAuth).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(setAuth).toHaveBeenCalledTimes(3);

    // Recovery: no further retries are scheduled.
    reportFromLatestSetAuth(setAuth, true);
    expect(screen.getByText("authenticated")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(setAuth).toHaveBeenCalledTimes(3);
  });
});
