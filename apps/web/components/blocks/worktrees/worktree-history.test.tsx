/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { WorktreeOpState } from "@/lib/worktrees/hooks/use-worktree-op";
import { useWorktreeHistory } from "@/lib/worktrees/hooks/use-worktree-history";
import { WorktreeHistoryView } from "./worktree-history";

interface OpArgs {
  kind: string;
  postRef?: string;
  cursor?: string;
  enabled: boolean;
}

const ops = vi.hoisted(() => ({
  calls: [] as OpArgs[],
  answer: (() => ({ resultJson: undefined, error: null, loading: true, refresh: () => {} })) as (args: OpArgs) => WorktreeOpState,
}));

vi.mock("@/lib/worktrees/hooks/use-worktree-op", () => ({
  useWorktreeOp: (args: OpArgs) => {
    ops.calls.push(args);
    return ops.answer(args);
  },
}));

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/browser/use-mobile", () => ({ useIsMobile: () => mobile.value }));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({ patch }: { patch: string }) => <pre data-testid="patch">{patch}</pre>,
}));

const hash = (char: string) => char.repeat(40);
const commit = (char: string, subject: string, parents: string[] = []) => ({
  hash: hash(char),
  parents,
  authorName: "Ada",
  authorEmail: "ada@example.com",
  committedAt: Date.now() - 60_000,
  refs: [],
  subject,
});

const PAGE_1 = { commits: [commit("a", "second", [hash("b")]), commit("b", "first")], nextCursor: `${hash("a")}:2` };
const PAGE_2 = { commits: [commit("c", "older")] };
const PATCH = (path: string) => ({ body: "", patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+y\n`, truncated: false });

function done(result: unknown): WorktreeOpState {
  return { resultJson: JSON.stringify(result), error: null, loading: false, refresh: () => {} };
}

function Harness({ appVersion = "0.171.0", isOnline = true, shown = true, wordWrap = false }: { appVersion?: string; isOnline?: boolean; shown?: boolean; wordWrap?: boolean }) {
  const profileId = "profile_1" as Id<"cliProfiles">;
  const history = useWorktreeHistory(profileId, "path_1", true);
  if (!shown) {
    return null;
  }
  return <WorktreeHistoryView profileId={profileId} pathId="path_1" history={history} isOnline={isOnline} appVersion={appVersion} diffOptions={{} as never} allCollapsed={false} wordWrap={wordWrap} />;
}

describe("WorktreeHistoryView", () => {
  beforeEach(() => {
    mobile.value = false;
    ops.calls = [];
    ops.answer = (args) => {
      if (args.kind === "gitLog") {
        return done(args.cursor ? PAGE_2 : PAGE_1);
      }
      return done(PATCH(`${args.postRef?.[0]}.txt`));
    };
  });

  afterEach(() => {
    cleanup();
  });

  test("Load more fetches the next page by cursor and keeps the earlier commits", () => {
    render(<Harness />);
    expect(screen.getAllByText("second").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(ops.calls.some((call) => call.kind === "gitLog" && call.cursor === PAGE_1.nextCursor)).toBe(true);
    expect(screen.getAllByText("second").length).toBeGreaterThan(0);
    expect(screen.getByText("older")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  test("opens the newest commit, and a clicked parent opens that commit", () => {
    render(<Harness />);
    expect(screen.getByTestId("patch").textContent).toContain("a.txt");

    fireEvent.click(screen.getByRole("button", { name: hash("b").slice(0, 7) }));

    expect(screen.getByTestId("patch").textContent).toContain("b.txt");
  });

  test("a commit's patch is fetched once, then served from the cache", () => {
    // Fresh hashes: the cache is module-level and outlives each test.
    ops.answer = (args) => {
      if (args.kind === "gitLog") {
        return done({ commits: [commit("d", "fourth"), commit("e", "fifth")] });
      }
      return done(PATCH(`${args.postRef?.[0]}.txt`));
    };
    render(<Harness />);
    fireEvent.click(screen.getByText("fifth"));
    ops.calls = [];

    fireEvent.click(screen.getByText("fourth"));

    expect(screen.getByTestId("patch").textContent).toContain("d.txt");
    const patchCalls = ops.calls.filter((call) => call.kind === "commitPatch" && call.postRef === hash("d"));
    expect(patchCalls.length).toBeGreaterThan(0);
    expect(patchCalls.every((call) => !call.enabled)).toBe(true);
  });

  test("a clean merge says there is nothing to show", () => {
    ops.answer = (args) =>
      args.kind === "gitLog" ? done({ commits: [commit("f", "Merge branch", [hash("a"), hash("b")])] }) : done({ body: "", patch: "", truncated: false });
    render(<Harness />);

    expect(screen.getByText("Merge commit with no conflict resolutions to show.")).toBeTruthy();
  });

  test("an old CLI gets an update prompt instead of a request", () => {
    render(<Harness appVersion="0.170.0" />);

    expect(screen.getByText(/Update @useconvoy\/cli to 0\.171\.0 or newer to view history \(connected: v0\.170\.0\)/)).toBeTruthy();
  });

  test("a failed list offers Retry, which re-sends the request", () => {
    const refresh = vi.fn();
    ops.answer = () => ({ resultJson: undefined, error: "fatal: bad revision", loading: false, refresh });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(refresh).toHaveBeenCalled();
  });

  test("a Refresh of the first page reports refreshing while the old rows stay (OS-2534 review #4)", () => {
    ops.answer = () => ({ ...done(PAGE_1), loading: true });
    const { result } = renderHook(() => useWorktreeHistory("profile_1" as Id<"cliProfiles">, "path_1", true));

    expect(result.current.commits).toHaveLength(2);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.loadingMore).toBe(false);
  });

  test("a page with a malformed row is an error, not a crash (OS-2534 review #7)", () => {
    for (const commits of [[null], [{ ...commit("a", "x"), parents: undefined }], [{ ...commit("a", "x"), committedAt: "soon" }]]) {
      ops.answer = () => done({ commits });
      const { result, unmount } = renderHook(() => useWorktreeHistory("profile_1" as Id<"cliProfiles">, "path_1", true));
      expect(result.current.commits).toEqual([]);
      expect(result.current.error).toMatch(/cannot read/);
      unmount();
    }
  });

  test("Copy hash reports a failure where the clipboard is unavailable (OS-2534 review #3)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: `Copy commit hash ${hash("a").slice(0, 7)}` }));

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to copy the hash"));
  });

  test("the open commit survives the History view unmounting for a tab switch (OS-2534 review #8)", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByText("first"));

    rerender(<Harness shown={false} />);
    rerender(<Harness />);

    expect(screen.getByTestId("patch").textContent).toContain("b.txt");
  });

  test("on a phone the list comes first, a commit opens full width, and Back returns (OS-2534 review #5)", () => {
    mobile.value = true;
    render(<Harness />);
    expect(screen.queryByTestId("patch")).toBeNull();

    fireEvent.click(screen.getByText("first"));
    expect(screen.getByTestId("patch").textContent).toContain("b.txt");
    expect(screen.queryByText("second")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.queryByTestId("patch")).toBeNull();
    expect(screen.getByText("second")).toBeTruthy();
  });

  test("a combined section follows the word-wrap toggle (OS-2534 review #12)", () => {
    const combined = "diff --cc a.txt\nindex 1,2..3\n--- a/a.txt\n+++ b/a.txt\n@@@ -1,1 -1,1 +1,1 @@@\n++both\n";
    ops.answer = (args) =>
      args.kind === "gitLog" ? done({ commits: [commit("9", "Merge", [hash("a"), hash("b")])] }) : done({ body: "", patch: combined, truncated: false });
    render(<Harness wordWrap />);

    expect(screen.getByText(/\+\+both/).className).toContain("whitespace-pre-wrap");
  });

  test("an empty repository says so", () => {
    ops.answer = () => done({ commits: [] });
    render(<Harness />);

    expect(screen.getByText("No commits on this branch yet.")).toBeTruthy();
  });
});
