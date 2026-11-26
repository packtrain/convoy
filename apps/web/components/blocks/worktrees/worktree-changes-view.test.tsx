/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { appRoute } from "@/lib/navigation/routes";
import { clearHistoryCacheForTests } from "@/lib/worktrees/hooks/use-worktree-history";
import { expectEmptyState } from "@/test-utils/empty-state";
import { WorktreeChangesView } from "./worktree-changes-view";

const state = vi.hoisted(() => ({
  profile: { paths: [{ id: "path_1", path: "/tmp/x" }], isOnline: false } as Record<string, unknown>,
  op: undefined as unknown,
  enqueue: vi.fn(),
  changes: { resultJson: null as string | null, loading: false, error: null as string | null, refresh: vi.fn() },
  toast: { error: vi.fn(), success: vi.fn() },
  opCalls: [] as { kind: string; scope?: string; enabled: boolean }[],
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

const navigate = vi.hoisted(() => vi.fn());
// The URL as a tiny store: replace and push rewrite it and re-render readers.
const url = vi.hoisted(() => ({ search: "", listeners: new Set<() => void>() }));

vi.mock("@/lib/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const routes = await vi.importActual<typeof import("@/lib/navigation/routes")>("@/lib/navigation/routes");
  const { href } = await vi.importActual<typeof import("@/lib/navigation/target")>("@/lib/navigation/target");
  const go = (target: Parameters<typeof href>[0]) => {
    url.search = `?${href(target).split("?")[1] ?? ""}`;
    url.listeners.forEach((listener) => listener());
  };
  const subscribe = (listener: () => void) => {
    url.listeners.add(listener);
    return () => url.listeners.delete(listener);
  };
  return {
    appRoute: routes.appRoute,
    parseWorktreeChangesTarget: routes.parseWorktreeChangesTarget,
    useRouteParams: () => ({ organizationSlug: "org", projectAlias: "ABC" }),
    useNavigation: () => {
      const search = useSyncExternalStore(subscribe, () => url.search);
      return {
        location: { pathname: "/o/org/ABC/threads", search, hash: "" },
        push: (target: Parameters<typeof href>[0]) => {
          navigate(target);
          go(target);
        },
        replace: go,
      };
    },
  };
});

vi.mock("@/lib/worktrees/hooks/use-worktree-op", () => ({
  useWorktreeOp: (args: { kind: string; scope?: string; enabled: boolean }) => {
    state.opCalls.push(args);
    return state.changes;
  },
}));

vi.mock("@/lib/threads/hooks/use-diff-theme", () => ({
  useDiffTheme: () => ({}),
}));

const mobile = vi.hoisted(() => ({ value: true }));
vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: () => mobile.value,
}));

vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: () => null,
  File: () => null,
}));

vi.mock("@/components/blocks/thread/thread-header", () => ({
  ThreadHeader: ({ actions }: { actions?: React.ReactNode }) => <header>Header{actions}</header>,
}));

vi.mock("@/components/blocks/thread/thread-mobile-back-button", () => ({
  ThreadMobileBackButton: () => null,
}));

vi.mock("@/components/blocks/thread/thread-workspace-split-pane", () => ({
  ThreadWorkspaceSplitPane: ({ children, sidebarHeader }: { children: React.ReactNode; sidebarHeader?: React.ReactNode }) => (
    <div data-testid="split-pane">
      {sidebarHeader}
      {children}
    </div>
  ),
}));

const ONE_FILE_PATCH = JSON.stringify({
  patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n",
  truncated: false,
});

const WORKTREE_PATHS = [
  { id: "repo", path: "/tmp/repo", label: "repo" },
  { id: "path_1", path: "/tmp/x", label: "x", kind: "worktree", parentPathId: "repo", branch: "feat/x" },
];

function onlineWorktree(patch: string) {
  state.profile = { paths: WORKTREE_PATHS, isOnline: true, appVersion: "0.83.0" };
  state.changes = { resultJson: JSON.stringify({ patch, truncated: false }), loading: false, error: null, refresh: vi.fn() };
}

function onlineWithOneFile() {
  state.profile = { paths: [{ id: "path_1", path: "/tmp/x" }], isOnline: true, appVersion: "0.83.0" };
  state.changes = { resultJson: ONE_FILE_PATCH, loading: false, error: null, refresh: vi.fn() };
}

// The history cache is per tab; each test starts with an empty one.
beforeEach(() => clearHistoryCacheForTests());

describe("WorktreeChangesView", () => {
  beforeEach(() => {
    state.profile = { paths: [{ id: "path_1", path: "/tmp/x" }], isOnline: false };
    state.op = undefined;
    state.changes = { resultJson: null, loading: false, error: null, refresh: vi.fn() };
    state.enqueue.mockReset();
    state.toast.error.mockReset();
    state.toast.success.mockReset();
    navigate.mockReset();
    mobile.value = true;
    url.search = "?profileId=profile_1&pathId=path_1&view=changes";
  });

  afterEach(() => {
    cleanup();
  });

  test("the file tree toggle stays in the toolbar and flips the tree on and off", () => {
    onlineWithOneFile();
    mobile.value = false;
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    const hide = screen.getByRole("button", { name: "Hide file tree" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hide);
    const show = screen.getByRole("button", { name: "Show file tree" });
    expect(show.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(show);
    expect(screen.getByRole("button", { name: "Hide file tree" })).toBeTruthy();
  });

  test("the History tab replaces the changes body and hides the file actions (OS-2534)", () => {
    onlineWithOneFile();
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);
    expect(screen.getByRole("button", { name: "Download a.txt" })).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "History" }), { button: 0 });

    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("button", { name: "Download a.txt" })).toBeNull();
    expect(screen.getByText(/to view history \(connected: v0\.83\.0\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh history" })).toBeTruthy();
  });

  test("the History tab is in the URL, so a reload reopens it (OS-2534 UX review)", () => {
    state.profile = { paths: WORKTREE_PATHS, isOnline: true, appVersion: "0.83.0" };
    const { unmount } = render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "History" }), { button: 0 });
    expect(url.search).toBe("?profileId=profile_1&pathId=path_1&view=history");

    unmount();
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
  });

  test("on a phone, All commits pops the entry its commit pushed (OS-2534 UX review 2)", () => {
    state.profile = { paths: WORKTREE_PATHS, isOnline: true, appVersion: "0.171.0" };
    const commit = { hash: "a".repeat(40), parents: [], authorName: "Ada", authorEmail: "a@x", committedAt: 1, refs: [], subject: "first" };
    state.changes = { resultJson: JSON.stringify({ commits: [commit] }), loading: false, error: null, refresh: vi.fn() };
    url.search = "?profileId=profile_1&pathId=path_1&view=history";
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    fireEvent.click(screen.getByRole("option", { name: /^first/ }));
    expect(url.search).toBe(`?profileId=profile_1&pathId=path_1&view=history&commit=${"a".repeat(40)}`);
    fireEvent.click(screen.getByRole("button", { name: "All commits" }));

    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  test("on a phone the History toolbar fits: icon-only layout buttons, diff toggles only over a commit (UX OS-2536 round 1 #4)", () => {
    state.profile = { paths: WORKTREE_PATHS, isOnline: true, appVersion: "0.171.0" };
    const commit = { hash: "a".repeat(40), parents: [], authorName: "Ada", authorEmail: "a@x", committedAt: 1, refs: [], subject: "first" };
    state.changes = { resultJson: JSON.stringify({ commits: [commit] }), loading: false, error: null, refresh: vi.fn() };
    url.search = "?profileId=profile_1&pathId=path_1&view=history";
    const { rerender } = render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expect(screen.getByRole("button", { name: "Graph" }).textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Enable word wrap" })).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: /^first/ }));
    rerender(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expect(screen.getByRole("button", { name: "Enable word wrap" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "History layout" })).toBeNull();
  });

  test("List | Graph is last in the toolbar; the diff toggles come and go on its left (OS-2536 toolbar gap)", () => {
    mobile.value = false;
    window.localStorage.setItem("convoy.history-layout", "graph");
    state.profile = { paths: WORKTREE_PATHS, isOnline: true, appVersion: "0.171.0" };
    const commit = { hash: "a".repeat(40), parents: [], authorName: "Ada", authorEmail: "a@x", committedAt: 1, refs: ["HEAD -> feat/x"], subject: "first" };
    state.changes = { resultJson: JSON.stringify({ commits: [commit] }), loading: false, error: null, refresh: vi.fn() };
    url.search = "?profileId=profile_1&pathId=path_1&view=history";
    const { rerender } = render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);
    const isLast = () => {
      const group = screen.getByRole("group", { name: "History layout" });
      return group.parentElement?.lastElementChild === group;
    };

    // Graph with nothing open: no diff toggles, and no hidden placeholder for them.
    expect(screen.queryByRole("button", { name: "Enable word wrap" })).toBeNull();
    expect(isLast()).toBe(true);

    // List with a commit open shows its diff, so the toggles show, left of List | Graph.
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(screen.getByRole("option", { name: /^first/ }));
    rerender(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    const wrap = screen.getByRole("button", { name: "Enable word wrap" });
    const group = screen.getByRole("group", { name: "History layout" });
    expect(wrap.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(isLast()).toBe(true);
    mobile.value = true;
    window.localStorage.clear();
  });

  test("Refresh keeps keyboard focus while it runs: busy, not disabled (OS-2534 UX review 3)", () => {
    state.profile = { paths: WORKTREE_PATHS, isOnline: true, appVersion: "0.171.0" };
    state.changes = { resultJson: ONE_FILE_PATCH, loading: true, error: null, refresh: vi.fn() };
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    const refresh = screen.getByRole("button", { name: "Refresh changes" }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(false);
    expect(refresh.getAttribute("aria-disabled")).toBe("true");
  });

  test("on a phone the toolbar leaves out the path; the header names the checkout (OS-2534 UX review 3)", () => {
    onlineWithOneFile();
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expect(screen.queryByTitle("/tmp/x")).toBeNull();
  });

  test("opening another checkout starts from a fresh view, not the previous one's state (OS-2534 review #1)", () => {
    state.profile = { paths: [...WORKTREE_PATHS, { id: "path_2", path: "/tmp/y", label: "y" }], isOnline: true, appVersion: "0.171.0" };
    const { rerender } = render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "History" }), { button: 0 });
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");

    rerender(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_2" />);

    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("false");
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

  test("the header and tabs row span the full width; the file tree sits below the tabs", () => {
    onlineWithOneFile();
    mobile.value = false;
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    const split = screen.getByTestId("split-pane");
    expect(split.contains(screen.getByRole("banner"))).toBe(false);
    expect(split.contains(screen.getByRole("tablist", { name: "Worktree view" }))).toBe(false);
    expect(split.contains(screen.getByRole("button", { name: "Close files" }))).toBe(true);
  });

  test("the Files row matches the first file header's height and has no background under the tabs row", () => {
    onlineWithOneFile();
    mobile.value = false;
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    const close = screen.getByRole("button", { name: "Close files" });
    const revert = screen.getByRole("button", { name: "Revert a.txt" });
    const row = close.parentElement!;
    const fileHeader = revert.parentElement!;
    expect(row.className).not.toContain("bg-card");
    expect(row.className).not.toContain("h-[41px]");
    expect(row.className).toContain("h-[37px]");
    expect(fileHeader.className).toContain("py-1.5");
    expect(close.className).toContain("size-6");
    expect(revert.className).toContain("size-6");
  });

  test("the header menu removes a clean worktree, then leaves its view (OS-2459)", async () => {
    onlineWorktree("");
    state.enqueue.mockResolvedValue("op_1");
    const view = render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove worktree" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove worktree" }));

    await waitFor(() => expect(state.enqueue).toHaveBeenCalledWith({ profileId: "profile_1", kind: "remove", pathId: "path_1" }));
    state.op = { _id: "op_1", status: "done" };
    await act(async () => {
      view.rerender(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);
    });

    expect(state.toast.success).toHaveBeenCalledWith("Worktree removed");
    expect(navigate).toHaveBeenCalledWith(appRoute.projectThreads("org", "ABC"));
  });

  test("uncommitted changes disable Remove worktree in the header menu (OS-2459)", () => {
    onlineWorktree(JSON.parse(ONE_FILE_PATCH).patch);
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), { button: 0, ctrlKey: false });

    const item = screen.getByRole("menuitem", { name: /Remove worktree/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("Commit or revert changes first");
  });

  test("a worktree's History opens on This branch, a main checkout's on All, and the switch changes the walk (OS-2595)", () => {
    onlineWorktree("");
    state.profile = { ...state.profile, appVersion: "0.176.0" };
    url.search = "?profileId=profile_1&pathId=path_1&view=history";
    const lastLog = () => state.opCalls.filter((call) => call.kind === "gitLog" && call.enabled).at(-1);
    state.opCalls = [];
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expect(screen.getByRole("button", { name: "This branch" }).getAttribute("aria-pressed")).toBe("true");
    expect(lastLog()?.scope).toBe("branch");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(lastLog()?.scope).toBeUndefined();
    cleanup();

    url.search = "?profileId=profile_1&pathId=repo&view=history";
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="repo" />);
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("This branch | All sits left of the diff toggles, first in the toolbar's right group (OS-2595)", () => {
    mobile.value = false;
    window.localStorage.setItem("convoy.history-layout", "list");
    state.profile = { paths: WORKTREE_PATHS, isOnline: true, appVersion: "0.176.0" };
    const commit = { hash: "a".repeat(40), parents: [], authorName: "Ada", authorEmail: "a@x", committedAt: 1, refs: ["HEAD -> feat/x"], subject: "first" };
    state.changes = { resultJson: JSON.stringify({ commits: [commit] }), loading: false, error: null, refresh: vi.fn() };
    url.search = "?profileId=profile_1&pathId=path_1&view=history";
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    const scopeGroup = screen.getByRole("group", { name: "History scope" });
    const wrap = screen.getByRole("button", { name: "Enable word wrap" });
    expect(scopeGroup.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scopeGroup.parentElement?.firstElementChild).toBe(scopeGroup);
    mobile.value = true;
  });

  test("a CLI without the branch walk gets no scope switch and the full history (OS-2595)", () => {
    onlineWorktree("");
    state.profile = { ...state.profile, appVersion: "0.175.0" };
    url.search = "?profileId=profile_1&pathId=path_1&view=history";
    state.opCalls = [];
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expect(screen.queryByRole("group", { name: "History scope" })).toBeNull();
    expect(state.opCalls.filter((call) => call.kind === "gitLog" && call.enabled).every((call) => call.scope === undefined)).toBe(true);
  });

  test("vs main asks for the branch diff and hides every revert action; Remove worktree no longer reads it as dirty (OS-2596)", () => {
    onlineWorktree(JSON.parse(ONE_FILE_PATCH).patch);
    state.profile = { ...state.profile, appVersion: "0.177.0" };
    mobile.value = false;
    state.opCalls = [];
    const lastChanges = () => state.opCalls.filter((call) => call.kind === "worktreeChanges" && call.enabled).at(-1);
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expect(screen.getByRole("button", { name: "Uncommitted" }).getAttribute("aria-pressed")).toBe("true");
    expect(lastChanges()?.scope).toBeUndefined();
    expect(screen.getByRole("button", { name: "Revert a.txt" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "vs main" }));

    expect(screen.getByRole("button", { name: "vs main" }).getAttribute("aria-pressed")).toBe("true");
    expect(lastChanges()?.scope).toBe("branch");
    expect(screen.queryByRole("button", { name: "Revert a.txt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert all" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download a.txt" })).toBeTruthy();
    fireEvent.contextMenu(screen.getByRole("button", { name: /^a\.txt/ }));
    expect(screen.queryByRole("menuitem", { name: "Revert" })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("menuitem", { name: /Remove worktree/ }).getAttribute("aria-disabled")).toBeNull();
    mobile.value = true;
  });

  test("a clean tree offers vs main from its empty state (OS-2596)", () => {
    onlineWorktree("");
    state.profile = { ...state.profile, appVersion: "0.177.0" };
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);
    expectEmptyState("No uncommitted changes", { action: { role: "button", name: "Show changes vs main" } });

    fireEvent.click(screen.getByRole("button", { name: "Show changes vs main" }));

    expect(screen.getByRole("button", { name: "vs main" }).getAttribute("aria-pressed")).toBe("true");
    expectEmptyState("No changes against main");
    expect(screen.queryByRole("button", { name: "Show changes vs main" })).toBeNull();
  });

  test("a clean tree on a CLI without the branch diff offers no switch (OS-2596)", () => {
    onlineWorktree("");
    state.profile = { ...state.profile, appVersion: "0.176.0" };
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expectEmptyState("No uncommitted changes");
    expect(screen.queryByRole("button", { name: "Show changes vs main" })).toBeNull();
  });

  test("a CLI without the branch diff gets no Changes scope switch (OS-2596)", () => {
    onlineWorktree(JSON.parse(ONE_FILE_PATCH).patch);
    state.profile = { ...state.profile, appVersion: "0.176.0" };
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expect(screen.queryByRole("group", { name: "Changes scope" })).toBeNull();
  });

  test("a main checkout has no header menu (OS-2459)", () => {
    onlineWithOneFile();
    render(<WorktreeChangesView profileId={"profile_1" as Id<"cliProfiles">} pathId="path_1" />);

    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });
});
