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
  toastInfo.mockClear();
});

describe("PullRequestWatchButton (OS-2541)", () => {
  test("the owner starts the watch", () => {
    render(<PullRequestWatchButton threadId={threadId} />);
    fireEvent.click(screen.getByRole("button", { name: /^Watch pull request/ }));
    expect(watch).toHaveBeenCalledWith({ threadId });
  });

  test("the owner stops a running watch", () => {
    state.watch = { startedAt: 1 };
    render(<PullRequestWatchButton threadId={threadId} />);
    const button = screen.getByRole("button", { name: /^Watching pull request/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(unwatch).toHaveBeenCalledWith({ threadId });
  });

  test("says which checks already fail, since the watch reports only new failures", async () => {
    watch.mockResolvedValueOnce({ failingChecks: [{ name: "lint", url: null }, { name: "test", url: null }] });
    render(<PullRequestWatchButton threadId={threadId} />);
    fireEvent.click(screen.getByRole("button", { name: /^Watch pull request/ }));
    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith("Watching. 2 checks already fail, and Convoy reports only new failures: lint, test")
    );
  });

  test("names everything the watch reports, not only failed checks", () => {
    render(<PullRequestWatchButton threadId={threadId} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Watch pull request: message this thread about checks, conflicts, reviews, and merges"
    );
  });

  test("keeps focus while busy: aria-disabled, not disabled, and a second press is ignored", () => {
    watch.mockReturnValueOnce(new Promise(() => {}));
    render(<PullRequestWatchButton threadId={threadId} />);
    const button = screen.getByRole("button");
    button.focus();
    fireEvent.click(button);
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(watch).toHaveBeenCalledTimes(1);
  });

  test("a Done thread can't start a watch: the button keeps its name, and a tap says why", () => {
    const reason = "Mark this thread not done to watch its pull request";
    render(<PullRequestWatchButton threadId={threadId} disabledReason={reason} />);
    const button = screen.getByRole("button", { name: /^Watch pull request/ });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-description")).toBe(reason);
    expect(button.getAttribute("title")).toBe(reason);
    fireEvent.click(button);
    expect(watch).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith(reason);
  });

  test("stays busy until the watch query reflects the toggle, so the old state doesn't flash back", async () => {
    const { rerender } = render(<PullRequestWatchButton threadId={threadId} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    await waitFor(() => expect(watch).toHaveBeenCalled());
    await Promise.resolve();
    rerender(<PullRequestWatchButton threadId={threadId} />);
    expect(button.getAttribute("aria-busy")).toBe("true");
    state.watch = { startedAt: 1 };
    rerender(<PullRequestWatchButton threadId={threadId} />);
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  test("a pending toggle on one thread doesn't leave another thread's eye busy (two threads, one PR)", async () => {
    watch.mockReturnValueOnce(new Promise(() => {}));
    const { rerender } = render(<PullRequestWatchButton threadId={threadId} />);
    fireEvent.click(screen.getByRole("button"));
    rerender(<PullRequestWatchButton threadId={"thread_2" as Id<"cliThreads">} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-busy")).toBe("false");
    fireEvent.click(button);
    expect(watch).toHaveBeenLastCalledWith({ threadId: "thread_2" });
  });
});
