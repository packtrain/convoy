/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { WorktreeChangesView } from "./worktree-changes-view";

const state = vi.hoisted(() => ({
  profile: { paths: [{ id: "path_1", path: "/tmp/x" }], isOnline: false } as Record<string, unknown>,
  op: undefined as unknown,
  enqueue: vi.fn(),
  changes: { resultJson: null as string | null, loading: false, error: null as string | null, refresh: vi.fn() },
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    if (args === "skip") {
      return undefined;
    }
    return typeof args === "object" && args !== null && "opId" in args ? state.op : state.profile;
  },
  useMutation: () => state.enqueue,
}));

vi.mock("sonner", () => ({ toast: state.toast }));

vi.mock("@/lib/navigation", () => ({
  useRouteParams: () => ({ organizationSlug: "org", projectAlias: "ABC" }),
}));

vi.mock("@/lib/worktrees/hooks/use-worktree-op", () => ({
  useWorktreeOp: () => state.changes,
}));

vi.mock("@/lib/threads/hooks/use-diff-theme", () => ({
  useDiffTheme: () => ({}),
}));

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: () => true,
}));

vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: () => null,
  File: () => null,
}));

vi.mock("@/components/blocks/thread/thread-header", () => ({
  ThreadHeader: () => <header>Header</header>,
}));

vi.mock("@/components/blocks/thread/thread-mobile-back-button", () => ({
  ThreadMobileBackButton: () => null,
}));

vi.mock("@/components/blocks/thread/thread-workspace-split-pane", () => ({
  ThreadWorkspaceSplitPane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const ONE_FILE_PATCH = JSON.stringify({
  patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n",
  truncated: false,
});

function onlineWithOneFile() {
  state.profile = { paths: [{ id: "path_1", path: "/tmp/x" }], isOnline: true, appVersion: "0.83.0" };
  state.changes = { resultJson: ONE_FILE_PATCH, loading: false, error: null, refresh: vi.fn() };
}

describe("WorktreeChangesView", () => {
  beforeEach(() => {
    state.profile = { paths: [{ id: "path_1", path: "/tmp/x" }], isOnline: false };
    state.op = undefined;
    state.changes = { resultJson: null, loading: false, error: null, refresh: vi.fn() };
    state.enqueue.mockReset();
    state.toast.error.mockReset();
    state.toast.success.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("a failed changes fetch offers Retry, which refreshes the changes", () => {
    onlineWithOneFile();
    const refresh = vi.fn();
    state.changes = { resultJson: null, loading: false, error: "git status failed", refresh };
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expect(screen.getByText("git status failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalled();
  });

  test("a second click during the enqueue round trip does not start a second op (OS-2050 review #4)", async () => {
    onlineWithOneFile();
    state.enqueue.mockReturnValue(new Promise(() => {}));
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    const download = screen.getByRole("button", { name: "Download a.txt" });
    fireEvent.click(download);
    fireEvent.click(download);
    fireEvent.click(screen.getByRole("button", { name: "Revert a.txt" }));

    expect(state.enqueue).toHaveBeenCalledTimes(1);
    expect(download.hasAttribute("disabled")).toBe(true);
  });

  test("a download op that settles done without a URL reports an error (OS-2050 review #11)", async () => {
    onlineWithOneFile();
    state.enqueue.mockResolvedValue("op_1");
    const view = render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    fireEvent.click(screen.getByRole("button", { name: "Download a.txt" }));
    await waitFor(() => expect(state.enqueue).toHaveBeenCalledTimes(1));
    state.op = { _id: "op_1", kind: "downloadFile", status: "done" };
    await act(async () => {
      view.rerender(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);
    });

    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("Download failed"));
  });

  test("Revert all unlocks only after typing revert, then sends the files on screen (OS-2234)", async () => {
    onlineWithOneFile();
    state.profile = { ...state.profile, appVersion: "0.125.0" };
    state.enqueue.mockReturnValue(new Promise(() => {}));
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("1 file: 1 modified.");
    const dialogConfirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Revert all")!;
    expect(dialogConfirm.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Type revert to confirm"), { target: { value: "rever" } });
    expect(dialogConfirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Type revert to confirm"), { target: { value: "revert" } });
    expect(dialogConfirm.hasAttribute("disabled")).toBe(false);

    fireEvent.click(dialogConfirm);
    expect(state.enqueue).toHaveBeenCalledWith({
      profileId: "profile_1",
      kind: "revertWorkingTree",
      pathId: "path_1",
      filePaths: ["a.txt"],
    });
  });

  test("Revert all is hidden on a CLI without revertWorkingTree and disabled on a truncated patch", () => {
    onlineWithOneFile();
    const view = render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);
    expect(screen.queryByRole("button", { name: "Revert all" })).toBeNull();

    state.profile = { ...state.profile, appVersion: "0.125.0" };
    state.changes = {
      ...state.changes,
      resultJson: JSON.stringify({ ...JSON.parse(ONE_FILE_PATCH), truncated: true }),
    };
    view.rerender(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);
    expect(screen.getByRole("button", { name: "Revert all" }).hasAttribute("disabled")).toBe(true);
  });

  test("sizes the main grid column to the pane so wide diff lines can't push rows past the viewport", () => {
    const { container } = render(
      <WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />
    );

    // An implicit grid column is auto-sized: the longest diff line would set the width
    // of every row, header included, and the phone viewport clips them.
    expect(container.querySelector("main")?.className).toContain("grid-cols-[minmax(0,1fr)]");
  });
});
