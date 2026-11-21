/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useUserPreferences } from "./use-user-preferences";

const mocks = vi.hoisted(() => ({
  // Mirrors Convex: `useMutation` is memoized per function reference, while
  // `withOptimisticUpdate` builds a new mutation on every call.
  baseMutation: undefined as ((args: unknown) => Promise<void>) | undefined,
  preferences: {} as Record<string, unknown> | undefined,
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.preferences,
  useMutation: () => {
    mocks.baseMutation ??= Object.assign(vi.fn(async () => {}), {
      withOptimisticUpdate: () => Object.assign(vi.fn(async () => {}), { withOptimisticUpdate: () => {} }),
    });
    return mocks.baseMutation;
  },
}));

/**
 * These setters are props of the memoized thread sidebar (its sort, density and
 * grouping controls), so a setter rebuilt on every render defeats the memo for
 * every row underneath it — OS-1581.
 */
describe("useUserPreferences setter identity (OS-1581)", () => {
  afterEach(() => {
    cleanup();
  });

  test.each([
    "setThreadSortBy",
    "setThreadCompactLayout",
    "setThreadGroupDone",
    "setCliFavoriteCombos",
  ] as const)("keeps %s stable across a re-render", (key) => {
    const { result, rerender } = renderHook(() => useUserPreferences());
    const before = result.current[key];

    rerender();

    expect(result.current[key]).toBe(before);
  });
});

describe("useUserPreferences loading fallback", () => {
  afterEach(() => {
    mocks.preferences = {};
    cleanup();
  });

  test("sorts threads by last activity while preferences load", () => {
    mocks.preferences = undefined;
    const { result } = renderHook(() => useUserPreferences());

    expect(result.current.threadSortBy).toBe("lastActivity");
  });
});
