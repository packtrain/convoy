/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useNavigation } from "./core";
import { routeTarget } from "./target";

const navigationMocks = vi.hoisted(() => ({
  pathname: "/o/acme/WEB",
  search: "?task=WEB-1",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
  useSearchParams: () => new URLSearchParams(navigationMocks.search),
  useRouter: () => ({
    push: navigationMocks.push,
    replace: navigationMocks.replace,
  }),
}));

describe("useNavigation", () => {
  beforeEach(() => {
    navigationMocks.pathname = "/o/acme/WEB";
    navigationMocks.search = "?task=WEB-1";
    navigationMocks.push.mockReset();
    navigationMocks.replace.mockReset();
    window.history.replaceState({ marker: "state" }, "", "/o/acme/WEB?task=WEB-1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("uses native history for same-path push", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useNavigation());

    act(() => {
      result.current.push(
        routeTarget("/o/acme/WEB", {
          query: new URLSearchParams([["task", "WEB-2"]]),
        })
      );
    });

    expect(pushStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB?task=WEB-2"
    );
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });

  test("uses native history for same-path replace", () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useNavigation());

    act(() => {
      result.current.replace(
        routeTarget("/o/acme/WEB", {
          query: new URLSearchParams([["artifact", "artifact-1"]]),
        })
      );
    });

    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB?artifact=artifact-1"
    );
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  test("uses Next router for pathname transitions", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useNavigation());

    act(() => {
      result.current.push(
        routeTarget("/o/acme/WEB/kanban", {
          query: new URLSearchParams([["task", "WEB-2"]]),
        })
      );
    });

    expect(navigationMocks.push).toHaveBeenCalledWith(
      "/o/acme/WEB/kanban?task=WEB-2",
      { scroll: false }
    );
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  test("does nothing for an unchanged target", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useNavigation());

    act(() => {
      result.current.push(
        routeTarget("/o/acme/WEB", {
          query: new URLSearchParams([["task", "WEB-1"]]),
        })
      );
    });

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });
});
