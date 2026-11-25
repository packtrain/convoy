/** @vitest-environment jsdom */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { PullRequestWatchButton } from "./pull-request-watch";

const state = vi.hoisted(() => ({ watch: null as { startedAt: number } | null }));
const watch = vi.fn(async (): Promise<unknown> => ({ failingChecks: [] }));
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { info: toastInfo, error: vi.fn() } }));
const unwatch = vi.fn(async () => null);
vi.mock("convex/react", () => ({
  useQuery: () => state.watch,
  useAction: () => watch,
  useMutation: () => unwatch,
}));

const threadId = "thread_1" as Id<"cliThreads">;

afterEach(() => {
  cleanup();
  state.watch = null;
  watch.mockClear();
  unwatch.mockClear();
});

describe("PullRequestWatchButton (OS-2541)", () => {
  test("the owner starts the watch", () => {
    render(<PullRequestWatchButton threadId={threadId} />);
    fireEvent.click(screen.getByRole("button", { name: /^Watch:/ }));
    expect(watch).toHaveBeenCalledWith({ threadId });
  });

  test("the owner stops a running watch", () => {
    state.watch = { startedAt: 1 };
    render(<PullRequestWatchButton threadId={threadId} />);
    const button = screen.getByRole("button", { name: /^Watching:/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(unwatch).toHaveBeenCalledWith({ threadId });
  });

  test("says which checks already fail, since the watch reports only new failures", async () => {
    watch.mockResolvedValueOnce({ failingChecks: [{ name: "lint", url: null }, { name: "test", url: null }] });
    render(<PullRequestWatchButton threadId={threadId} />);
    fireEvent.click(screen.getByRole("button", { name: /^Watch:/ }));
    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith("Watching. 2 checks already fail, and Convoy reports only new failures: lint, test")
    );
  });
});
