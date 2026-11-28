/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { clearHistoryCacheForTests } from "@/lib/worktrees/hooks/use-worktree-history";
import { WorktreeChangesPanel } from "./worktree-changes-panel";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  kinds: [] as string[],
  opened: [] as (string | null)[],
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

function Panel({
  refreshKey,
  onMentionFile,
  view,
  initialCommit = null,
}: {
  refreshKey: string | undefined;
  onMentionFile?: (path: string) => void;
  view: "worktree" | "history";
  initialCommit?: string | null;
}) {
  // The thread host owns the open commit, so it outlives a remount (UX OS-2535 round 1 #2).
  const [openCommit, setOpenCommit] = useState(initialCommit);
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
      openCommit={openCommit}
      onHistoryDiffShownChange={() => {}}
      onOpenCommit={(hash) => {
        state.opened.push(hash);
        setOpenCommit(hash);
      }}
    />
  );
}

function panel(refreshKey: string | undefined, onMentionFile?: (path: string) => void, view: "worktree" | "history" = "worktree") {
  return <Panel refreshKey={refreshKey} onMentionFile={onMentionFile} view={view} />;
}

// The history cache is per tab; each test starts with an empty one.
beforeEach(() => clearHistoryCacheForTests());

describe("WorktreeChangesPanel", () => {
  afterEach(() => {
    cleanup();
    state.refresh.mockReset();
    state.kinds = [];
    state.opened = [];
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

  test("a repo of a multi-repo folder names that repo in both revert dialogs (UX OS-2522 round 1)", () => {
    state.paths = [{ id: "path_1", path: "/tmp/acme/new-app", kind: "repo", label: "new-app", parentPathId: "folder" } as never];
    render(panel(undefined));

    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByText("Revert all uncommitted changes in new-app?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Revert a.txt" }));
    expect(screen.getByText("Revert new-app/a.txt?")).toBeTruthy();
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

  test("History remounted after a new run fetches despite a fresh cache (OS-2534 CR round 1 #1)", () => {
    render(panel("refs/run-1/post", undefined, "history")).unmount();
    state.kinds = [];
    render(panel("refs/run-1/post", undefined, "history")).unmount();
    expect(state.kinds).not.toContain("gitLog");

    render(panel("refs/run-2/post", undefined, "history"));

    expect(state.kinds).toContain("gitLog");
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

  test("History opens the host's open commit, so a full-view switch keeps it (UX OS-2535 round 1 #2)", () => {
    render(<Panel refreshKey={undefined} view="history" initialCommit={"a".repeat(40)} />);
    expect(screen.getByRole("heading", { name: "first" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "All commits" }));

    expect(state.opened.at(-1)).toBeNull();
  });

  test("History's open commit shares one row with Refresh: All commits replaces the layout toggle (UX OS-2535 round 1 #4)", () => {
    render(panel(undefined, undefined, "history"));
    fireEvent.click(screen.getByRole("option", { name: /first/ }));

    const back = screen.getByRole("button", { name: "All commits" });
    expect(back.parentElement?.contains(screen.getByRole("button", { name: "Refresh history" }))).toBe(true);
    expect(screen.queryByRole("group", { name: "History layout" })).toBeNull();
  });
});
