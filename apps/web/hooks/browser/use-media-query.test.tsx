// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { useMediaQuery } from "./use-media-query";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockMediaQuery(initial: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = {
    matches: initial,
    addEventListener: vi.fn((_event: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener)),
  };
  return {
    media,
    change(matches: boolean) {
      media.matches = matches;
      act(() => { listeners.forEach(listener => listener({ matches })); });
    },
  };
}

test("the first client render uses the current viewport", () => {
  const { media } = mockMediaQuery(true);
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  const snapshots: boolean[] = [];
  renderHook(() => { snapshots.push(useMediaQuery("(min-width: 640px)")); });
  expect(snapshots).toEqual([true]);
});

test("tracks viewport changes and unsubscribes on unmount", () => {
  const { media, change } = mockMediaQuery(false);
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  const { result, unmount } = renderHook(() => useMediaQuery("(min-width: 640px)"));
  expect(result.current).toBe(false);
  change(true);
  expect(result.current).toBe(true);
  change(false);
  expect(result.current).toBe(false);
  unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
});

test("changing the query reads and subscribes to the new query", () => {
  const first = mockMediaQuery(false);
  const second = mockMediaQuery(true);
  vi.stubGlobal("matchMedia", vi.fn(query => query === "first" ? first.media : second.media));
  const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), { initialProps: { query: "first" } });
  rerender({ query: "second" });
  expect(result.current).toBe(true);
  expect(first.media.removeEventListener).toHaveBeenCalled();
  second.change(false);
  expect(result.current).toBe(false);
});

test("server markup hydrates before switching to the client viewport", async () => {
  const { media } = mockMediaQuery(true);
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  function Viewport() {
    return <span>{useMediaQuery("(min-width: 640px)") ? "desktop" : "mobile"}</span>;
  }
  const container = document.createElement("div");
  container.innerHTML = renderToString(<Viewport />);
  expect(container.textContent).toBe("mobile");
  document.body.append(container);
  const onRecoverableError = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <Viewport />, { onRecoverableError });
    });
    expect(container.textContent).toBe("desktop");
    expect(onRecoverableError).not.toHaveBeenCalled();
  } finally {
    act(() => root?.unmount());
    container.remove();
  }
});
