/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { WorktreeChangesPanel } from "./worktree-changes-panel";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) =>
    args === "skip" ? undefined : { paths: [{ id: "path_1", path: "/tmp/x" }], isOnline: true, appVersion: "0.125.0" },
  useMutation: () => vi.fn(),
}));

vi.mock("@/lib/worktrees/hooks/use-worktree-op", () => ({
  useWorktreeOp: () => ({
    resultJson: JSON.stringify({
      patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n",
      truncated: false,
    }),
    loading: false,
    error: null,
    refresh: state.refresh,
  }),
}));

vi.mock("@/lib/threads/hooks/use-diff-theme", () => ({ useDiffTheme: () => ({}) }));
vi.mock("@pierre/diffs/react", () => ({ PatchDiff: () => null, File: () => null }));

function panel(refreshKey: string | undefined, onMentionFile?: (path: string) => void) {
  return (
    <WorktreeChangesPanel
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
});
