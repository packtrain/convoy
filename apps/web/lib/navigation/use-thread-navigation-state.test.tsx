/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useThreadNavigationState } from "./use-thread-navigation-state";

const navigationMocks = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();

  return {
    pathname: "/o/acme/WEB/threads/thread_1",
    push,
    replace,
    // The App Router memoizes its router instance; a fresh object per render
    // would invalidate every callback derived from it.
    router: { push, replace },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
  useRouter: () => navigationMocks.router,
}));

describe("useThreadNavigationState", () => {
  beforeEach(() => {
    navigationMocks.pathname = "/o/acme/WEB/threads/thread_1";
    navigationMocks.push.mockReset();
    navigationMocks.replace.mockReset();
    window.history.replaceState({}, "", "/o/acme/WEB/threads/thread_1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("adds and clears the archived query parameter for task navigation", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const { result, rerender } = renderHook(() => useThreadNavigationState());

    act(() => {
      result.current.openTask("WEB-1", "archived");
    });

    expect(pushStateSpy).toHaveBeenLastCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-1&archived=true"
    );

    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-1&archived=true"
    );
    rerender();

    act(() => {
      result.current.openTask("WEB-1", "active");
    });

    expect(pushStateSpy).toHaveBeenLastCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-1"
    );
  });

  // Consumers put these in effect dependency arrays, and some of those effects
  // write back to the URL; fresh identities per render would re-run them after
  // every commit and turn a URL write that doesn't land into an update loop.
  test("keeps the returned state and callbacks stable while the URL is unchanged", () => {
    const { result, rerender } = renderHook(() => useThreadNavigationState());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);

    act(() => {
      result.current.openTask("WEB-1", "active");
    });

    expect(result.current.openTask).not.toBe(first.openTask);
  });

  test("clears artifact and archive state when changing tasks", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-1&artifact=artifact-1&archived=true"
    );
    const { result } = renderHook(() => useThreadNavigationState());

    act(() => {
      result.current.openTask("WEB-2", "active");
    });

    expect(pushStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-2"
    );
  });

  // `threadArtifact` is a host tab, not a task-scoped selection: it must survive
  // a task change, and changing it must leave the task selection alone.
  test("opens and closes threadArtifact without touching the other params", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-1&archived=true&attachedTask=WEB-9"
    );
    const { result, rerender } = renderHook(() => useThreadNavigationState());

    act(() => {
      result.current.selectThreadArtifact("artifact-1");
    });

    expect(pushStateSpy).toHaveBeenLastCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-1&archived=true&attachedTask=WEB-9&threadArtifact=artifact-1"
    );

    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-1&archived=true&threadArtifact=artifact-1"
    );
    rerender();

    expect(result.current.threadArtifactId).toBe("artifact-1");

    act(() => {
      result.current.closeThreadArtifact();
    });

    expect(pushStateSpy).toHaveBeenLastCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-1&archived=true"
    );
  });

  test("keeps threadArtifact across a task change", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-1&threadArtifact=artifact-1"
    );
    const { result } = renderHook(() => useThreadNavigationState());

    act(() => {
      result.current.openTask("WEB-2", "active");
    });

    expect(pushStateSpy).toHaveBeenLastCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/threads/thread_1?task=WEB-2&threadArtifact=artifact-1"
    );
  });

  test("replaces history when asked", () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useThreadNavigationState());

    act(() => {
      result.current.selectThreadArtifact("artifact-1", { history: "replace" });
    });

    expect(replaceStateSpy).toHaveBeenLastCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/threads/thread_1?threadArtifact=artifact-1"
    );
  });

  // Next writes the URL in its commit and emits nothing, so a consumer that
  // hasn't re-rendered since still holds the old one (OS-2067: a container's
  // redirect to its child, then the child's task write).
  test("builds from the live URL, not the one from the last render", () => {
    const { result } = renderHook(() => useThreadNavigationState());
    window.history.replaceState({}, "", "/o/acme/WEB/threads/thread_2?threadArtifact=artifact-1");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    act(() => {
      result.current.openTask("WEB-2", "active", { history: "replace" });
    });

    expect(navigationMocks.replace).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenLastCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/threads/thread_2?threadArtifact=artifact-1&task=WEB-2"
    );
  });
});
