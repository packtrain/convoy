/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { WorktreeChangesPanel } from "./worktree-changes-panel";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  kinds: [] as string[],
  paths: [{ id: "path_1", path: "/tmp/x" }],
}));

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) =>
    args === "skip" ? undefined : { paths: state.paths, isOnline: true, appVersion: "0.171.0" },
  useMutation: () => vi.fn(),
}));

vi.mock("@/lib/worktrees/hooks/use-worktree-op", () => ({
  useWorktreeOp: ({ kind, enabled }: { kind: string; enabled: boolean }) => {
    if (enabled) {
      state.kinds.push(kind);
    }
    const result =
      kind === "gitLog"
        ? { commits: [{ hash: "a".repeat(40), parents: [], authorName: "Ada", authorEmail: "ada@example.com", committedAt: 0, refs: [], subject: "first" }] }
        : { patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n", truncated: false, body: "" };
    return { resultJson: JSON.stringify(result), loading: false, error: null, refresh: state.refresh };
  },
}));

// The thread panel's 560px: History takes its one-pane layout.
vi.mock("@/hooks/browser/use-element-width", () => ({ useElementWidth: () => 560 }));
vi.mock("@/lib/threads/hooks/use-diff-theme", () => ({ useDiffTheme: () => ({}) }));
vi.mock("@pierre/diffs/react", () => ({ PatchDiff: () => null, File: () => null }));

function panel(refreshKey: string | undefined, onMentionFile?: (path: string) => void, view: "worktree" | "history" = "worktree") {
  return (
    <WorktreeChangesPanel
      view={view}
      profileId={"profile_1" as Id<"cliProfiles">}
      pathId="path_1"
      allCollapsed={false}
      diffStyle="unified"
      wordWrap={false}
      fileTreeOpen={false}
      refreshKey={refreshKey}
      onMentionFile={onMentionFile}
    />
  );
}

describe("WorktreeChangesPanel", () => {
  afterEach(() => {
    cleanup();
    state.refresh.mockReset();
    state.kinds = [];
    state.paths = [{ id: "path_1", path: "/tmp/x" }];
  });

  test("refetches when a new run lands, not on mount (OS-2234)", () => {
    const view = render(panel("refs/run-1/post"));
    expect(state.refresh).not.toHaveBeenCalled();

    view.rerender(panel("refs/run-1/post"));
    expect(state.refresh).not.toHaveBeenCalled();

    view.rerender(panel("refs/run-2/post"));
    // `refresh` refetches the patch and the open file tab, one op hook each.
    expect(state.refresh).toHaveBeenCalled();
  });

  test("shows the summary row with Revert all and the mention action", () => {
    const onMentionFile = vi.fn();
    render(panel(undefined, onMentionFile));

    expect(screen.getByText("1 file")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revert all" })).toBeTruthy();
    screen.getByRole("button", { name: "Mention a.txt in reply" }).click();
    expect(onMentionFile).toHaveBeenCalledWith("a.txt");
  });

  test("History lists the checkout's commits and refetches when a new run lands (OS-2535)", () => {
    const view = render(panel("refs/run-1/post", undefined, "history"));
    expect(state.kinds).toContain("gitLog");
    expect(state.kinds).not.toContain("worktreeChanges");
    expect(screen.getByRole("option", { name: /first/ })).toBeTruthy();
    expect(state.refresh).not.toHaveBeenCalled();

    view.rerender(panel("refs/run-2/post", undefined, "history"));
    expect(state.refresh).toHaveBeenCalled();
  });

  test("History opens a commit in place and goes back to the list (OS-2535)", () => {
    render(panel(undefined, undefined, "history"));
    fireEvent.click(screen.getByRole("option", { name: /first/ }));
    expect(screen.getByRole("heading", { name: "first" })).toBeTruthy();
    expect(state.kinds).toContain("commitPatch");

    fireEvent.click(screen.getByRole("button", { name: "All commits" }));
    expect(screen.queryByRole("heading", { name: "first" })).toBeNull();
    expect(screen.getByRole("option", { name: /first/ })).toBeTruthy();
  });

  test("History's List | Graph toggle starts on List and keeps Graph across mounts (OS-2536)", () => {
    const view = render(panel(undefined, undefined, "history"));
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
    expect(view.container.querySelector("[role=option] svg:not(.lucide)")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    view.unmount();
    const again = render(panel(undefined, undefined, "history"));

    expect(screen.getByRole("button", { name: "Graph" }).getAttribute("aria-pressed")).toBe("true");
    expect(again.container.querySelector("[role=option] svg:not(.lucide) circle")).toBeTruthy();
    window.localStorage.clear();
  });

  test("History refreshes on demand and keeps the open commit (OS-2535)", () => {
    render(panel(undefined, undefined, "history"));
    fireEvent.click(screen.getByRole("option", { name: /first/ }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    expect(state.refresh).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "first" })).toBeTruthy();
  });

  test("History says when the checkout is no longer registered, without fetching (OS-2535)", () => {
    state.paths = [];
    render(panel(undefined, undefined, "history"));
    expect(screen.getByText("This checkout is no longer registered on the CLI.")).toBeTruthy();
    expect(state.kinds).not.toContain("gitLog");
    expect(screen.queryByRole("button", { name: "Refresh history" })).toBeNull();
  });
});
