/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { WorktreeOpState } from "@/lib/worktrees/hooks/use-worktree-op";
import { clearHistoryCacheForTests, useWorktreeHistory } from "@/lib/worktrees/hooks/use-worktree-history";
import { HistoryLayoutToggle, WorktreeHistoryView } from "./worktree-history";

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

const paneWidth = vi.hoisted(() => ({ value: null as number | null }));
vi.mock("@/hooks/browser/use-element-width", () => ({ useElementWidth: () => paneWidth.value }));

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

// The CLI decorates HEAD; without it History pages on to find HEAD.
const PAGE_1 = { commits: [{ ...commit("a", "second", [hash("b")]), refs: ["HEAD -> main"] }, commit("b", "first")], nextCursor: `${hash("a")}:2` };
const PAGE_2 = { commits: [commit("c", "older")] };
const PATCH = (path: string) => ({ body: "", patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+y\n`, truncated: false });

function done(result: unknown): WorktreeOpState {
  return { resultJson: JSON.stringify(result), error: null, loading: false, refresh: () => {} };
}

// The history cache is per tab; each test starts with an empty one.
beforeEach(() => clearHistoryCacheForTests());

const selections = vi.hoisted(() => [] as { hash: string | null; mode: string }[]);

function Harness({
  appVersion = "0.171.0",
  isOnline = true,
  shown = true,
  wordWrap = false,
  initialHash = null,
  layout = "list",
  allCollapsed = false,
  toolbar = false,
  onDiffShownChange,
}: {
  toolbar?: boolean;
  allCollapsed?: boolean;
  onDiffShownChange?: (shown: boolean) => void;
  layout?: "list" | "graph";
  appVersion?: string;
  isOnline?: boolean;
  shown?: boolean;
  wordWrap?: boolean;
  initialHash?: string | null;
}) {
  const profileId = "profile_1" as Id<"cliProfiles">;
  const history = useWorktreeHistory(profileId, "path_1", true);
  const [selectedHash, setSelectedHash] = useState<string | null>(initialHash);
  if (!shown) {
    return null;
  }
  return (
    <>
      <button type="button" onClick={history.refresh}>
        Harness refresh
      </button>
      <button type="button" onClick={() => setSelectedHash(null)}>
        Browser back
      </button>
      <button type="button" onClick={() => setSelectedHash(hash("b"))}>
        Browser forward
      </button>
      <WorktreeHistoryView
        profileId={profileId}
        pathId="path_1"
        history={history}
        layout={layout}
        registered
        isOnline={isOnline}
        appVersion={appVersion}
        diffOptions={{} as never}
        allCollapsed={allCollapsed}
        wordWrap={wordWrap}
        selectedHash={selectedHash}
        toolbar={toolbar ? { onLayoutChange: () => {}, actions: <span>Toolbar action</span> } : undefined}
        onDiffShownChange={onDiffShownChange}
        onSelect={(hash, mode) => {
          selections.push({ hash, mode });
          setSelectedHash(hash);
        }}
      />
    </>
  );
}

describe("WorktreeHistoryView, Graph layout (OS-2536)", () => {
  beforeEach(() => {
    mobile.value = false;
    paneWidth.value = null;
    selections.length = 0;
    ops.answer = (args) => (args.kind === "gitLog" ? done(args.cursor ? PAGE_2 : PAGE_1) : done(PATCH(`${args.postRef?.[0]}.txt`)));
  });

  afterEach(() => {
    cleanup();
  });

  test("two panes: a table with a graph cell per row, and no commit open until one is picked", () => {
    const { container } = render(<Harness layout="graph" />);

    expect(screen.getByText("Description")).toBeTruthy();
    expect(container.querySelectorAll("[role=option] svg:not(.lucide) circle")).toHaveLength(2);
    expect(screen.queryByRole("complementary", { name: "Commit" })).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: /^first/ }));
    expect(screen.getByRole("button", { name: /b\.txt/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close commit" }));
    expect(screen.queryByRole("complementary", { name: "Commit" })).toBeNull();
    expect(selections.at(-1)).toEqual({ hash: null, mode: "replace" });
  });

  test("Load more adds the next page's rows to the graph", () => {
    const { container } = render(<Harness layout="graph" />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(container.querySelectorAll("[role=option] svg:not(.lucide) circle")).toHaveLength(3);
  });

  test("an arrow key in the table moves focus only while no commit is open (CR OS-2536 #4)", () => {
    render(<Harness layout="graph" />);
    const [first, second] = screen.getAllByRole("option");
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowDown" });

    expect(document.activeElement).toBe(second);
    expect(screen.queryByTestId("patch")).toBeNull();

    fireEvent.click(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(selections.at(-1)).toEqual({ hash: hash("b"), mode: "replace" });
  });

  test("one pane: two-line rows get a graph column instead of the commit icon", () => {
    paneWidth.value = 560;
    const { container } = render(<Harness layout="graph" />);

    expect(screen.queryByText("Description")).toBeNull();
    expect(container.querySelectorAll("[role=option] svg:not(.lucide) circle")).toHaveLength(2);
  });
});

describe("WorktreeHistoryView", () => {
  beforeEach(() => {
    mobile.value = false;
    paneWidth.value = null;
    selections.length = 0;
    toast.error.mockReset();
    toast.success.mockReset();
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

  test("List opens HEAD's commit when the default branch's newer tip comes first (CR OS-2536 #1)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done({ commits: [{ ...commit("m", "main tip", [hash("h")]), refs: ["origin/main"] }, { ...commit("h", "head"), refs: ["HEAD -> feature"] }] })
        : done(PATCH(`${args.postRef?.[0]}.txt`));
    render(<Harness />);

    expect(screen.getByTestId("patch").textContent).toContain("h.txt");
    expect(screen.getByRole("option", { name: /^head/ }).getAttribute("aria-selected")).toBe("true");
  });

  test("opens the newest commit, and a clicked parent opens that commit", () => {
    render(<Harness />);
    expect(screen.getByTestId("patch").textContent).toContain("a.txt");

    fireEvent.click(screen.getByRole("button", { name: `Open parent ${hash("b").slice(0, 7)}` }));

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

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to copy the hash", { description: "The full hash is selected beside it. Press Ctrl+C." }));
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
    expect(screen.queryByRole("option", { name: /second/ })).toBeNull();
    expect(selections.at(-1)).toEqual({ hash: hash("b"), mode: "push" });

    fireEvent.click(screen.getByRole("button", { name: "All commits" }));
    expect(screen.queryByTestId("patch")).toBeNull();
    expect(screen.getByRole("option", { name: /second/ })).toBeTruthy();
  });

  test("on a phone the list stays mounted behind the commit, and focus moves to the commit and back (OS-2534 UX review)", () => {
    mobile.value = true;
    render(<Harness />);
    const row = screen.getByRole("option", { name: /first/ });
    row.focus();

    fireEvent.click(row);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "first" }));
    // Hidden, not unmounted: the list keeps its scroll position.
    expect(screen.getByText("second", { selector: "span" }).closest("[hidden]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "All commits" }));
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /first/ }));
  });

  test("the phone scrollers clear the floating bottom nav (OS-2534 UX review)", () => {
    mobile.value = true;
    render(<Harness />);
    expect(screen.getByRole("listbox", { name: "Commits" }).closest(".overflow-y-auto")?.className).toContain("pb-(--mobile-nav-clearance)");

    fireEvent.click(screen.getByText("first"));
    expect(screen.getByTestId("patch").closest(".overflow-y-auto")?.className).toContain("pb-(--mobile-nav-clearance)");
  });

  test("a narrow desktop pane shows one pane at a time, like a phone (OS-2534 UX review)", () => {
    paneWidth.value = 560;
    render(<Harness />);
    expect(screen.queryByTestId("patch")).toBeNull();

    fireEvent.click(screen.getByText("first"));

    expect(screen.getByTestId("patch").textContent).toContain("b.txt");
    expect(screen.getByRole("button", { name: "All commits" })).toBeTruthy();
  });

  test("the list is one Tab stop; arrows and j/k move through it and open the commit (OS-2534 UX review)", () => {
    render(<Harness />);
    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1]);
    rows[0].focus();

    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("patch").textContent).toContain("b.txt");
    expect(selections.at(-1)).toEqual({ hash: hash("b"), mode: "replace" });

    fireEvent.keyDown(rows[1], { key: "k" });
    expect(document.activeElement).toBe(rows[0]);
    expect(screen.getByTestId("patch").textContent).toContain("a.txt");
  });

  test("after Load more, focus lands on the first new row (OS-2534 UX review)", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(document.activeElement).toBe(screen.getByRole("option", { name: /older/ }));
  });

  test("a parent click focuses that commit's row (OS-2534 UX review)", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: `Open parent ${hash("b").slice(0, 7)}` }));

    expect(document.activeElement).toBe(screen.getByRole("option", { name: /first/ }));
  });

  test("a parent past the loaded pages loads the next page and opens once it arrives (OS-2534 UX review)", () => {
    ops.answer = (args) => {
      if (args.kind === "gitLog") {
        return done(args.cursor ? PAGE_2 : { commits: [commit("a", "second", [hash("c")])], nextCursor: `${hash("a")}:1` });
      }
      return done(PATCH(`${args.postRef?.[0]}.txt`));
    };
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: `Open parent ${hash("c").slice(0, 7)}` }));

    expect(ops.calls.some((call) => call.kind === "gitLog" && call.cursor !== undefined)).toBe(true);
    expect(screen.getByTestId("patch").textContent).toContain("c.txt");
  });

  test("Refresh keeps the open commit and pages back to its row (OS-2534 UX review 1 and 2)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    fireEvent.click(screen.getByText("older"));

    ops.calls = [];
    fireEvent.click(screen.getByRole("button", { name: "Harness refresh" }));

    expect(ops.calls.some((call) => call.kind === "gitLog" && call.cursor === PAGE_1.nextCursor)).toBe(true);
    expect(screen.getByRole("option", { name: /^older/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("patch").textContent).toContain("c.txt");
  });

  test("Copy hash toasts success, and a failure toast carries the full hash to select (OS-2534 UX review)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness />);
    const button = screen.getByRole("button", { name: `Copy commit hash ${hash("a").slice(0, 7)}` });

    fireEvent.click(button);
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("Commit hash copied"));

    writeText.mockRejectedValue(new Error("denied"));
    fireEvent.click(button);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to copy the hash", { description: "The full hash is selected beside it. Press Ctrl+C." }));
  });

  test("a combined section drops git's header lines and tints added and removed lines (OS-2534 UX review)", () => {
    const combined = "diff --cc a.txt\nindex 1,2..3\n--- a/a.txt\n+++ b/a.txt\n@@@ -1,1 -1,1 +1,1 @@@\n- main\n -feature\n++both\n";
    ops.answer = (args) =>
      args.kind === "gitLog" ? done({ commits: [commit("8", "Merge", [hash("a"), hash("b")])] }) : done({ body: "", patch: combined, truncated: false });
    render(<Harness />);

    expect(screen.queryByText(/^diff --cc/)).toBeNull();
    expect(screen.queryByText(/^index 1,2/)).toBeNull();
    expect(screen.getByText("++both").className).toContain("bg-success/10");
    expect(screen.getByText("- main").className).toContain("bg-destructive/10");
    expect(screen.getByText(/Combined diff/)).toBeTruthy();
  });

  test("an all-binary commit is summarised without +0 -0 (OS-2534 UX review)", () => {
    const binary = "diff --git a/logo.bin b/logo.bin\nnew file mode 100644\nindex 0000000..1111111\nBinary files /dev/null and b/logo.bin differ\n";
    ops.answer = (args) =>
      args.kind === "gitLog" ? done({ commits: [commit("7", "Add binary logo")] }) : done({ body: "", patch: binary, truncated: false });
    render(<Harness />);

    expect(screen.getByText("1 file")).toBeTruthy();
    expect(screen.queryByText("+0")).toBeNull();
  });

  test("a tag ref shows its name without git's tag: prefix (OS-2534 UX review)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog" ? done({ commits: [{ ...commit("6", "Release"), refs: ["tag: v1.0"] }] }) : done(PATCH("r.txt"));
    render(<Harness />);

    expect(screen.getByTitle("tag: v1.0").textContent).toBe("v1.0");
  });

  test("a combined section follows the word-wrap toggle (OS-2534 review #12)", () => {
    const combined = "diff --cc a.txt\nindex 1,2..3\n--- a/a.txt\n+++ b/a.txt\n@@@ -1,1 -1,1 +1,1 @@@\n++both\n";
    ops.answer = (args) =>
      args.kind === "gitLog" ? done({ commits: [commit("9", "Merge", [hash("a"), hash("b")])] }) : done({ body: "", patch: combined, truncated: false });
    render(<Harness wordWrap />);

    expect(screen.getByText("++both").closest("pre")?.className).toContain("whitespace-pre-wrap");
  });

  test("an empty repository says so", () => {
    ops.answer = () => done({ commits: [] });
    render(<Harness />);

    expect(screen.getByText("No commits on this branch yet.")).toBeTruthy();
  });

  test("a linked commit past the first page is paged to and opened (OS-2534 UX review 2)", () => {
    render(<Harness initialHash={hash("c")} />);

    expect(ops.calls.some((call) => call.kind === "gitLog" && call.cursor === PAGE_1.nextCursor)).toBe(true);
    expect(screen.getByTestId("patch").textContent).toContain("c.txt");
  });

  test("a commit found by paging scrolls its row into view (OS-2534 UX review 2)", () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("data-hash") ?? "");
    };
    render(<Harness initialHash={hash("c")} />);

    expect(scrolled).toContain(hash("c"));
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  test("a short hash in the link opens the commit it starts (OS-2534 UX review 2)", () => {
    render(<Harness initialHash={hash("b").slice(0, 7)} />);

    expect(screen.getByTestId("patch").textContent).toContain("b.txt");
  });

  test("a linked commit not in the history says so and opens the newest (OS-2534 UX review 2)", () => {
    render(<Harness initialHash={hash("9")} />);

    expect(screen.getByText("Commit 9999999 isn't in this checkout's history.")).toBeTruthy();
    expect(selections.at(-1)).toEqual({ hash: null, mode: "replace" });
    expect(screen.getByTestId("patch").textContent).toContain("a.txt");
  });

  test("while a linked commit is being found, the list keeps a Tab stop and the detail says so (OS-2534 UX review 2)", () => {
    ops.answer = (args) => (args.kind === "gitLog" ? (args.cursor ? { ...done(PAGE_2), resultJson: undefined, loading: true } : done(PAGE_1)) : done(PATCH("x.txt")));
    render(<Harness initialHash={hash("c")} />);

    expect(screen.getAllByRole("option").filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(screen.getAllByText(/Finding commit ccccccc…/).length).toBeGreaterThan(0);
  });

  test("in one-pane mode, All commits after an opened commit goes back in browser history (OS-2534 UX review 2)", () => {
    mobile.value = true;
    render(<Harness />);
    fireEvent.click(screen.getByText("first"));

    fireEvent.click(screen.getByRole("button", { name: "All commits" }));

    expect(selections.at(-1)).toEqual({ hash: null, mode: "back" });
  });

  test("in one-pane mode, browser Back to the list focuses and marks the commit you came from (OS-2534 UX review 2)", () => {
    mobile.value = true;
    render(<Harness />);
    fireEvent.click(screen.getByText("first"));

    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));

    const row = screen.getByRole("option", { name: /^first/ });
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("aria-selected")).toBe("true");
  });

  test("in one-pane mode, a parent that needs the next page gets focus once it opens (OS-2534 UX review 2)", () => {
    mobile.value = true;
    ops.answer = (args) => {
      if (args.kind === "gitLog") {
        return done(args.cursor ? PAGE_2 : { commits: [commit("a", "second", [hash("c")])], nextCursor: `${hash("a")}:1` });
      }
      return done(PATCH(`${args.postRef?.[0]}.txt`));
    };
    render(<Harness />);
    fireEvent.click(screen.getByText("second"));

    fireEvent.click(screen.getByRole("button", { name: `Open parent ${hash("c").slice(0, 7)}` }));

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "older" }));
  });

  test("Home and End jump to the first and last loaded commit (OS-2534 UX review 2)", () => {
    render(<Harness />);
    const rows = screen.getAllByRole("option");
    rows[0].focus();

    fireEvent.keyDown(rows[0], { key: "End" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: "Home" });
    expect(document.activeElement).toBe(rows[0]);
  });

  test("a failed copy leaves the full hash in a selectable field (OS-2534 UX review 2)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: `Copy commit hash ${hash("a").slice(0, 7)}` }));

    const field = await screen.findByRole("textbox", { name: "Full commit hash" });
    expect((field as HTMLInputElement).value).toBe(hash("a"));
    expect((field as HTMLInputElement).readOnly).toBe(true);
  });

  test("a body's hard-wrapped lines join into paragraphs; lists and indented lines keep their breaks (OS-2534 UX review 2)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done({ commits: [commit("5", "Body")] })
        : done({ ...PATCH("b.txt"), body: "Wrapped at seventy\ntwo columns.\n\n- one\n- two\n    code line" });
    render(<Harness />);

    expect(screen.getByText(/Wrapped at seventy two columns\./)).toBeTruthy();
    expect(screen.getByText(/- one\n- two\n {4}code line/, { normalizer: (text) => text })).toBeTruthy();
  });

  test("a list item's two-space continuation lines join it; nested items and code keep their breaks (OS-2536 feedback)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done({ commits: [commit("2", "Body")] })
        : done({ ...PATCH("b.txt"), body: "- one wraps\n  onto two\n  - nested\n- two\n    code line" });
    render(<Harness />);

    expect(screen.getByText(/- one wraps onto two\n {2}- nested\n- two\n {4}code line/, { normalizer: (text) => text })).toBeTruthy();
  });

  test("only a list item's continuation at its marker's width joins; indented code and nested numbered items keep their breaks (CR round 1 #4)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done({ commits: [commit("1", "Body")] })
        : done({ ...PATCH("b.txt"), body: "Example:\n  foo()\n  bar()\n\n- outer\n  1. first\n  2. second\n\n1. numbered wraps\n   onto two" });
    render(<Harness />);

    const keep = { normalizer: (text: string) => text };
    expect(screen.getByText(/Example:\n {2}foo\(\)\n {2}bar\(\)/, keep)).toBeTruthy();
    expect(screen.getByText(/- outer\n {2}1\. first\n {2}2\. second/, keep)).toBeTruthy();
    expect(screen.getByText(/1\. numbered wraps onto two/, keep)).toBeTruthy();
  });

  test("a row's accessible name is the subject, author and date, not the raw meta line (OS-2534 UX review 2)", () => {
    render(<Harness />);

    expect(screen.getByRole("option", { name: /^second, HEAD, branch main, Ada, / }).getAttribute("aria-label")).not.toContain("·");
  });

  test("combined diff lines get the diff viewer's row tints (OS-2534 UX review 2)", () => {
    const combined = "diff --cc a.txt\n--- a/a.txt\n+++ b/a.txt\n@@@ -1,1 -1,1 +1,1 @@@\n- main\n++both\n";
    ops.answer = (args) =>
      args.kind === "gitLog" ? done({ commits: [commit("4", "Merge", [hash("a"), hash("b")])] }) : done({ body: "", patch: combined, truncated: false });
    render(<Harness />);

    expect(screen.getByText("++both").className).toContain("bg-success/10");
    expect(screen.getByText("- main").className).toContain("bg-destructive/10");
    // Tinted rows keep the foreground text: green or red text on a tint falls under 4.5:1 in light mode.
    expect(screen.getByText("++both").className).not.toContain("text-success");
    expect(screen.getByText("- main").className).not.toContain("text-destructive");
  });

  test("a 650px pane still shows the list and the commit side by side (OS-2534 UX review 3)", () => {
    paneWidth.value = 650;
    render(<Harness />);

    expect(screen.getByTestId("patch").textContent).toContain("a.txt");
    expect(screen.queryByRole("button", { name: "All commits" })).toBeNull();
  });

  test("a failed copy swaps the hash button for the selected field, in place (OS-2534 UX review 3)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: `Copy commit hash ${hash("a").slice(0, 7)}` }));

    await screen.findByRole("textbox", { name: "Full commit hash" });
    expect(screen.queryByRole("button", { name: `Copy commit hash ${hash("a").slice(0, 7)}` })).toBeNull();
  });

  test("finding a linked commit is a live status with how far it has searched (OS-2534 UX review 3)", () => {
    ops.answer = (args) => (args.kind === "gitLog" ? (args.cursor ? { ...done(PAGE_2), resultJson: undefined, loading: true } : done(PAGE_1)) : done(PATCH("x.txt")));
    render(<Harness initialHash={hash("c")} />);

    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("Finding commit ccccccc… 2 commits searched"))).toBe(true);
  });

  test("a linked commit that is missing leaves a note above the list, not only a toast (OS-2534 UX review 3)", () => {
    mobile.value = true;
    render(<Harness initialHash={hash("9")} />);

    expect(screen.getByText("Commit 9999999 isn't in this checkout's history.")).toBeTruthy();
    expect(screen.getByRole("option", { name: /^second/ })).toBeTruthy();
  });

  test("browser Forward to a commit in one-pane mode focuses its heading (OS-2534 UX review 3)", () => {
    mobile.value = true;
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Browser forward" }));

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "first" }));
  });

  test("a row's accessible name caps a long subject (OS-2534 UX review 3)", () => {
    ops.answer = (args) => (args.kind === "gitLog" ? done({ commits: [commit("3", "word ".repeat(100).trim())] }) : done(PATCH("w.txt")));
    render(<Harness />);

    const label = screen.getByRole("option").getAttribute("aria-label") ?? "";
    expect(label.length).toBeLessThan(180);
    expect(label).toContain("…, Ada, ");
  });

  test("in one-pane mode, a failed page while finding a parent shows the error and Retry in the visible pane (CR OS-2534 UX #1)", () => {
    mobile.value = true;
    const retry = vi.fn();
    ops.answer = (args) => {
      if (args.kind === "gitLog") {
        return args.cursor
          ? { resultJson: undefined, error: "fatal: bad object", loading: false, refresh: retry }
          : done({ commits: [{ ...commit("a", "second", [hash("c")]), refs: ["HEAD -> main"] }], nextCursor: `${hash("a")}:1` });
      }
      return done(PATCH(`${args.postRef?.[0]}.txt`));
    };
    render(<Harness />);
    fireEvent.click(screen.getByText("second"));

    fireEvent.click(screen.getByRole("button", { name: `Open parent ${hash("c").slice(0, 7)}` }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getAllByText("fatal: bad object").some((element) => !element.closest("[hidden]"))).toBe(true);
    expect(retry).toHaveBeenCalled();
  });

  test("an open commit that left the history (rebase, reset) falls back to the newest after Refresh (CR OS-2534 UX #2)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    fireEvent.click(screen.getByText("older"));
    ops.answer = (args) => (args.kind === "gitLog" ? done({ commits: PAGE_1.commits }) : done(PATCH(`${args.postRef?.[0]}.txt`)));

    fireEvent.click(screen.getByRole("button", { name: "Harness refresh" }));

    expect(selections.at(-1)).toEqual({ hash: null, mode: "replace" });
    expect(screen.getByText("Commit ccccccc isn't in this checkout's history.")).toBeTruthy();
    expect(screen.getByTestId("patch").textContent).toContain("a.txt");
  });
});

describe("WorktreeHistoryView, UX review OS-2535 OS-2536 round 1", () => {
  const headPages = (args: OpArgs) =>
    args.kind === "gitLog"
      ? done(
          args.cursor
            ? { commits: [{ ...commit("h", "my branch", [hash("b")]), refs: ["HEAD -> feature"] }, commit("b", "first")] }
            : { commits: [{ ...commit("m", "main tip", [hash("b")]), refs: ["origin/main", "origin/HEAD"] }], nextCursor: `${hash("m")}:1` }
        )
      : done(PATCH(`${args.postRef?.[0]}.txt`));

  beforeEach(() => {
    mobile.value = false;
    paneWidth.value = null;
    selections.length = 0;
    ops.calls = [];
    ops.answer = (args) => (args.kind === "gitLog" ? done(args.cursor ? PAGE_2 : PAGE_1) : done(PATCH(`${args.postRef?.[0]}.txt`)));
  });

  afterEach(() => {
    cleanup();
  });

  test("List pages to HEAD when the default branch fills the first page, and opens it (#1)", () => {
    ops.answer = headPages;
    render(<Harness />);

    expect(ops.calls.some((call) => call.kind === "gitLog" && call.cursor === `${hash("m")}:1`)).toBe(true);
    expect(screen.getByTestId("patch").textContent).toContain("h.txt");
  });

  test("Graph pages to HEAD too and scrolls its row into view (#1)", () => {
    ops.answer = headPages;
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("data-hash") ?? "");
    };
    render(<Harness layout="graph" />);

    expect(screen.getByRole("option", { name: /^my branch/ })).toBeTruthy();
    expect(scrolled).toContain(hash("h"));
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  test("origin/HEAD gets no badge; it repeats the default branch (#2)", () => {
    ops.answer = headPages;
    render(<Harness />);

    expect(screen.getByText("origin/main")).toBeTruthy();
    expect(screen.queryByText("origin/HEAD")).toBeNull();
  });

  test("Escape closes the commit's sidebar beside the table and focuses its row (#3)", () => {
    render(<Harness layout="graph" />);
    fireEvent.click(screen.getByRole("option", { name: /^first/ }));

    fireEvent.keyDown(screen.getByRole("button", { name: "Message" }), { key: "Escape" });

    expect(screen.queryByRole("complementary", { name: "Commit" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /^first/ }));
  });

  test("Escape in one pane goes back to the list (#3)", () => {
    mobile.value = true;
    render(<Harness />);
    fireEvent.click(screen.getByText("first"));

    fireEvent.keyDown(screen.getByRole("heading", { name: "first" }), { key: "Escape" });

    expect(screen.queryByTestId("patch")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /^first/ }));
  });

  test("a row's accessible name carries HEAD, refs, merge and the short hash (#5, #10)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done({ commits: [{ ...commit("f", "Merge main", [hash("a"), hash("b")]), refs: ["HEAD -> feature", "tag: v1"] }] })
        : done({ body: "", patch: "", truncated: false });
    render(<Harness layout="graph" />);

    const label = screen.getByRole("option").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/^Merge main, HEAD, branch feature, tag v1, merge, Ada, .+, fffffff$/);
  });

  test("Refresh after Load more keeps the rows on screen until the first page is back (#3, Sol)", () => {
    let refreshed = false;
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? refreshed && !args.cursor
          ? { resultJson: undefined, error: null, loading: true, refresh: () => {} }
          : done(args.cursor ? PAGE_2 : PAGE_1)
        : done(PATCH(`${args.postRef?.[0]}.txt`));
    const { result } = renderHook(() => useWorktreeHistory("profile_1" as Id<"cliProfiles">, "path_1", true));
    act(() => result.current.loadMore());
    refreshed = true;

    act(() => result.current.refresh());

    expect(result.current.commits).toHaveLength(3);
    expect(result.current.initialLoading).toBe(false);
    expect(result.current.refreshing).toBe(true);
  });

  test("the graph column keeps its widest width after Refresh drops the later pages (#6)", () => {
    paneWidth.value = 560;
    // Page 1 is one lane; page 2's merge opens a second.
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done(
            args.cursor
              ? { commits: [commit("c", "merge", [hash("d"), hash("e")]), commit("d", "left"), commit("e", "right")] }
              : { commits: [{ ...commit("a", "second", [hash("b")]), refs: ["HEAD -> main"] }, commit("b", "first", [hash("c")])], nextCursor: "x:2" }
          )
        : done(PATCH(`${args.postRef?.[0]}.txt`));
    const { container } = render(<Harness layout="graph" />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    const wide = container.querySelector("[role=option] svg:not(.lucide)")?.getAttribute("width");
    expect(wide).toBe("30");

    fireEvent.click(screen.getByRole("button", { name: "Harness refresh" }));

    expect(container.querySelector("[role=option] svg:not(.lucide)")?.getAttribute("width")).toBe(wide);
  });

  test("one-pane Graph rows inset the lane like List's icon column (#7)", () => {
    paneWidth.value = 560;
    render(<Harness layout="graph" />);

    expect(screen.getByRole("option", { name: /^first/ }).className).toContain("pl-1");
  });

  test("a linked commit centers its row in the table (#8)", () => {
    const blocks: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      if (this.getAttribute("data-hash") === hash("b") && typeof options === "object") {
        blocks.push(options.block ?? "");
      }
    };
    render(<Harness layout="graph" initialHash={hash("b")} />);

    expect(blocks[0]).toBe("center");
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  test("the one-pane Graph skeleton has Graph rows: no borders, a lane stub (#9)", () => {
    paneWidth.value = 560;
    ops.answer = () => ({ resultJson: undefined, error: null, loading: true, refresh: () => {} });
    render(<Harness layout="graph" />);

    const rows = screen.getByLabelText("Loading commits").children;
    expect(rows[0].className).not.toContain("border-b");
    expect(rows[0].querySelector("[data-lane-stub]")).toBeTruthy();
  });

  test("with a toolbar, one pane puts All commits in that row instead of the layout toggle (OS-2535 #4, #5)", () => {
    paneWidth.value = 560;
    render(<Harness toolbar />);
    expect(screen.getByRole("group", { name: "History layout" })).toBeTruthy();

    fireEvent.click(screen.getByText("first"));

    expect(screen.queryByRole("group", { name: "History layout" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "All commits" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "All commits" }).parentElement?.textContent).toContain("Toolbar action");
  });

  test("with nothing open, the table's Tab stop is HEAD's row, not the default branch tip (round 2 Sol #1)", () => {
    ops.answer = headPages;
    render(<Harness layout="graph" />);

    expect(screen.getByRole("option", { name: /^my branch/ }).tabIndex).toBe(0);
    expect(screen.getByRole("option", { name: /^main tip/ }).tabIndex).toBe(-1);
  });

  test("a Refresh that drops later pages scrolls the list back to the top (round 2 Opus #3)", () => {
    paneWidth.value = 560;
    render(<Harness layout="graph" />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    const scroller = screen.getByRole("listbox", { name: "Commits" }).closest(".overflow-y-auto") as HTMLElement;
    scroller.scrollTop = 400;

    fireEvent.click(screen.getByRole("button", { name: "Harness refresh" }));

    expect(scroller.scrollTop).toBe(0);
  });

  test("the table's date leaves out the current year (round 2 Opus #4)", () => {
    render(<Harness layout="graph" />);

    const date = screen.getAllByRole("option")[0].children[2].textContent ?? "";
    expect(date).not.toContain(String(new Date().getFullYear()));
  });

  test("All commits in the toolbar row has the weight of Refresh beside it (round 2 Opus #5)", () => {
    paneWidth.value = 560;
    render(<Harness toolbar />);
    fireEvent.click(screen.getByText("first"));

    expect(screen.getByRole("button", { name: "All commits" }).className).not.toContain("text-muted-foreground");
  });

  test("a remote ref reads as a remote branch, a local one as a branch (round 2 Opus #6)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done({ commits: [{ ...commit("f", "tip"), refs: ["HEAD -> feature", "origin/main", "main"] }] })
        : done(PATCH("f.txt"));
    render(<Harness />);

    expect(screen.getByRole("option").getAttribute("aria-label")).toMatch(/^tip, HEAD, branch feature, remote branch origin\/main, branch main, /);
  });

  test("a remount with a commit open leaves focus where it is outside the view (round 3 Sol #1)", () => {
    paneWidth.value = 560;
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    render(<Harness initialHash={hash("b")} />);

    expect(screen.getByRole("heading", { name: "first" })).toBeTruthy();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  test("only origin/HEAD is dropped; a branch or tag named .../HEAD keeps its badge (CR UX fixes #3)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done({ commits: [{ ...commit("f", "tip"), refs: ["HEAD -> feature/HEAD", "tag: release/HEAD", "origin/HEAD"] }] })
        : done(PATCH("f.txt"));
    render(<Harness />);

    expect(screen.getByText("feature/HEAD")).toBeTruthy();
    expect(screen.getByText("release/HEAD")).toBeTruthy();
    expect(screen.queryByText("origin/HEAD")).toBeNull();
  });

  test("the table's Refs column comes before Graph: the first ref, then +N naming the rest (OS-2536 feedback)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done({ commits: [{ ...commit("f", "tip"), refs: ["HEAD -> feature", "origin/main", "origin/HEAD", "tag: v1"] }] })
        : done(PATCH("f.txt"));
    render(<Harness layout="graph" />);

    expect([...document.querySelectorAll("[data-table-header] > span")].map((cell) => cell.textContent)).toEqual([
      "Refs",
      "Graph",
      "Description",
      "Date",
      "Author",
      "Commit",
    ]);
    const cell = screen.getByText("feature").closest("[data-refs]");
    expect(cell?.textContent).toBe("feature+2");
    expect(screen.getByText("+2").getAttribute("title")).toBe("origin/main, tag: v1");
    // Badge and count sit together at the column's right edge, next to the graph node.
    expect(cell?.classList.contains("justify-end")).toBe(true);
  });

  test("the view reports whether a diff is on screen, for the host's diff toggles (CR UX fixes #1)", () => {
    const reports: boolean[] = [];
    render(<Harness onDiffShownChange={(shown) => reports.push(shown)} />);
    // Two panes in List: HEAD's diff opens with nothing picked.
    expect(reports.at(-1)).toBe(true);

    cleanup();
    paneWidth.value = 560;
    render(<Harness onDiffShownChange={(shown) => reports.push(shown)} />);
    expect(reports.at(-1)).toBe(false);
    fireEvent.click(screen.getByText("first"));
    expect(reports.at(-1)).toBe(true);

    cleanup();
    paneWidth.value = null;
    render(<Harness layout="graph" onDiffShownChange={(shown) => reports.push(shown)} />);
    expect(reports.at(-1)).toBe(false);
  });
});

describe("WorktreeHistoryView, Graph sidebar (OS-2536 feedback)", () => {
  const TWO_FILES = {
    body: "Why it changed.",
    patch: `${PATCH("src/one.ts").patch}${PATCH("src/two.ts").patch}`,
    truncated: false,
  };

  beforeEach(() => {
    mobile.value = false;
    paneWidth.value = null;
    selections.length = 0;
    ops.answer = (args) => (args.kind === "gitLog" ? done(args.cursor ? PAGE_2 : PAGE_1) : done(TWO_FILES));
  });

  afterEach(() => {
    cleanup();
  });

  test("a picked row opens a sidebar with the commit's meta, message and file tree; the table keeps the pane", () => {
    render(<Harness layout="graph" />);
    fireEvent.click(screen.getByRole("option", { name: /^first/ }));

    const sidebar = screen.getByRole("complementary", { name: "Commit" });
    expect(sidebar.textContent).toContain("Ada");
    expect(sidebar.textContent).toContain("ada@example.com");
    expect(sidebar.textContent).toContain(hash("b"));
    expect(sidebar.textContent).toContain("Why it changed.");
    expect(sidebar.textContent).toContain("2 Changed Files");
    expect(screen.getByRole("button", { name: /one\.ts/ })).toBeTruthy();
    // No diff under the table: it still fills the pane.
    expect(screen.queryByTestId("patch")).toBeNull();
    expect(screen.getByText("Description")).toBeTruthy();
  });

  test("the message collapses", () => {
    render(<Harness layout="graph" initialHash={hash("b")} />);
    const toggle = screen.getByRole("button", { name: "Message" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Why it changed.")).toBeNull();
  });

  test("a file opens the commit's full diff in place of the table, scrolled to it; Back returns to the row", () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.querySelector("[title]")?.getAttribute("title") ?? this.getAttribute("data-hash") ?? "");
    };
    const reports: boolean[] = [];
    render(<Harness layout="graph" onDiffShownChange={(shown) => reports.push(shown)} />);
    fireEvent.click(screen.getByRole("option", { name: /^first/ }));
    expect(reports.at(-1)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /two\.ts/ }));

    // Both files stay, so the user can scroll on to the other one.
    expect(screen.getAllByTestId("patch")).toHaveLength(2);
    expect(scrolled).toContain("src/two.ts");
    // Hidden, not unmounted, so it keeps its scroll position.
    expect(screen.queryByRole("listbox", { name: "Commits" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Commit" })).toBeTruthy();
    expect(reports.at(-1)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Back to graph" }));

    expect(screen.queryByTestId("patch")).toBeNull();
    expect(screen.getByRole("listbox", { name: "Commits" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^first/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /^first/ }));
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  test("the diff header's X closes the diff like Back to graph", () => {
    render(<Harness layout="graph" />);
    fireEvent.click(screen.getByRole("option", { name: /^first/ }));
    fireEvent.click(screen.getByRole("button", { name: /one\.ts/ }));

    fireEvent.click(screen.getByRole("button", { name: "Close diff" }));

    expect(screen.queryByTestId("patch")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Commit" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^first/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /^first/ }));
  });

  test("Escape leaves the diff for the graph first, then closes the sidebar", () => {
    render(<Harness layout="graph" />);
    fireEvent.click(screen.getByRole("option", { name: /^first/ }));
    fireEvent.click(screen.getByRole("button", { name: /one\.ts/ }));

    fireEvent.keyDown(screen.getByRole("button", { name: "Back to graph" }), { key: "Escape" });
    expect(screen.queryByTestId("patch")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Commit" })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("option", { name: /^first/ }), { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Commit" })).toBeNull();
    expect(selections.at(-1)).toEqual({ hash: null, mode: "replace" });
  });

  test("a pane under 900px keeps Graph's two-line rows, so the open sidebar never squeezes the table (CR round 1 #1)", () => {
    paneWidth.value = 800;
    render(<Harness layout="graph" />);

    expect(screen.queryByText("Description")).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /^first/ }));
    expect(screen.queryByRole("complementary", { name: "Commit" })).toBeNull();
    expect(screen.getAllByTestId("patch")).toHaveLength(2);
  });

  test("after a linked commit is centered once, a click on another row scrolls only as far as needed (CR round 1 #2)", () => {
    const blocks: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      if (this.getAttribute("role") === "option" && typeof options === "object") {
        blocks.push(options.block ?? "");
      }
    };
    render(<Harness layout="graph" initialHash={hash("b")} />);
    expect(blocks[0]).toBe("center");

    fireEvent.click(screen.getByRole("button", { name: "Close commit" }));
    blocks.length = 0;
    fireEvent.click(screen.getByRole("option", { name: /^second/ }));

    expect(blocks).not.toContain("center");
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  test("after Collapse all, a picked file expands before the diff scrolls to it (CR round 1 #3)", () => {
    const expandedAtScroll: (string | null | undefined)[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      if (this.querySelector("[title='src/two.ts']")) {
        expandedAtScroll.push(this.querySelector("[aria-expanded]")?.getAttribute("aria-expanded"));
      }
    };
    render(<Harness layout="graph" allCollapsed initialHash={hash("b")} />);

    fireEvent.click(screen.getByRole("button", { name: /two\.ts/ }));

    expect(expandedAtScroll).toEqual(["true"]);
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  test("Escape returns to the graph after a click into the diff's text (CR round 1 #7)", () => {
    render(<Harness layout="graph" initialHash={hash("b")} />);
    fireEvent.click(screen.getByRole("button", { name: /one\.ts/ }));

    const scroller = screen.getAllByTestId("patch")[0].closest<HTMLElement>("[tabindex='-1']");
    expect(scroller).toBeTruthy();
    fireEvent.keyDown(scroller!, { key: "Escape" });

    expect(screen.queryByTestId("patch")).toBeNull();
  });

  test("a diff left open does not come back after a switch to List and back (CR round 1 #8)", () => {
    const { rerender } = render(<Harness layout="graph" initialHash={hash("b")} />);
    fireEvent.click(screen.getByRole("button", { name: /one\.ts/ }));

    rerender(<Harness layout="list" initialHash={hash("b")} />);
    rerender(<Harness layout="graph" initialHash={hash("b")} />);

    expect(screen.queryByRole("button", { name: "Back to graph" })).toBeNull();
  });

  test("the sidebar shows the commit's refs, and no mail row without an email (CR round 1 #12)", () => {
    ops.answer = (args) =>
      args.kind === "gitLog"
        ? done({ commits: [{ ...commit("9", "tip"), authorEmail: "", refs: ["HEAD -> feature", "origin/main"] }] })
        : done(TWO_FILES);
    render(<Harness layout="graph" initialHash={hash("9")} />);

    const sidebar = screen.getByRole("complementary", { name: "Commit" });
    expect(sidebar.textContent).toContain("feature");
    expect(sidebar.textContent).toContain("origin/main");
    expect(sidebar.querySelector(".lucide-mail")).toBeNull();
  });

  test("the layout toggle is two icon buttons named by aria-label", () => {
    render(<HistoryLayoutToggle value="graph" onChange={() => {}} />);

    const list = screen.getByRole("button", { name: "List" });
    expect(list.textContent).toBe("");
    expect(list.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Graph" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("useWorktreeHistory, cache across a remount (OS-2534 review)", () => {
  const IDLE: WorktreeOpState = { resultJson: undefined, error: null, loading: false, refresh: () => {} };
  const PENDING: WorktreeOpState = { ...IDLE, loading: true };
  const NEWER = { commits: [commit("d", "newest", [hash("a")]), ...PAGE_1.commits] };

  function mount() {
    const firstRender: number[] = [];
    const hook = renderHook(() => {
      const history = useWorktreeHistory("profile_1" as Id<"cliProfiles">, "path_1", true);
      firstRender.push(history.commits.length);
      return history;
    });
    return { ...hook, firstRows: () => firstRender[0] };
  }

  beforeEach(() => {
    ops.calls = [];
    // Like the real op: a disabled op sends nothing and has no result.
    ops.answer = (args) => (args.enabled ? done(args.cursor ? PAGE_2 : PAGE_1) : IDLE);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("a remount within 60 s shows the rows at once and sends no gitLog", () => {
    mount().unmount();
    ops.calls = [];

    const { result, firstRows } = mount();

    expect(firstRows()).toBe(2);
    expect(result.current.initialLoading).toBe(false);
    expect(ops.calls.filter((call) => call.kind === "gitLog" && call.enabled)).toEqual([]);

    act(() => result.current.loadMore());
    expect(ops.calls.at(-1)).toMatchObject({ kind: "gitLog", cursor: PAGE_1.nextCursor, enabled: true });
    expect(result.current.commits).toHaveLength(3);
  });

  test("a remount after 60 s shows the rows, fetches the first page behind them, and caches the result", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    mount().unmount();
    vi.setSystemTime(Date.now() + 61_000);
    ops.calls = [];
    ops.answer = (args) => (args.enabled ? PENDING : IDLE);

    const second = mount();

    expect(second.firstRows()).toBe(2);
    expect(second.result.current.refreshing).toBe(true);
    expect(ops.calls.every((call) => call.kind === "gitLog" && call.cursor === undefined && call.enabled)).toBe(true);

    ops.answer = (args) => (args.enabled ? done(NEWER) : IDLE);
    second.rerender();
    expect(second.result.current.commits.map((row) => row.subject)).toEqual(["newest", "second", "first"]);
    second.unmount();
    ops.calls = [];

    const third = mount();
    expect(third.firstRows()).toBe(3);
    expect(ops.calls.filter((call) => call.enabled)).toEqual([]);
  });

  test("a failed Refresh keeps the cache's age, so the next remount fetches (CR round 1 #2)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const first = mount();
    vi.setSystemTime(Date.now() + 61_000);
    // useWorktreeOp keeps the last good result across a failed refresh.
    ops.answer = (args) => (args.enabled ? { ...done(PAGE_1), error: "fatal: bad revision" } : IDLE);
    act(() => first.result.current.refresh());
    first.unmount();
    ops.calls = [];
    ops.answer = (args) => (args.enabled ? PENDING : IDLE);

    mount();

    expect(ops.calls.some((call) => call.kind === "gitLog" && call.enabled)).toBe(true);
  });

  test("a new run key while mounted renews nothing until its fetch succeeds (CR round 2 #1)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = (refreshKey: string) =>
      renderHook((props: { refreshKey: string }) => useWorktreeHistory("profile_1" as Id<"cliProfiles">, "path_1", true, props.refreshKey), {
        initialProps: { refreshKey },
      });
    const first = at("run-a");
    vi.setSystemTime(Date.now() + 61_000);
    first.rerender({ refreshKey: "run-b" });
    ops.answer = (args) => (args.enabled ? { ...done(PAGE_1), error: "fatal: bad revision" } : IDLE);
    act(() => first.result.current.refresh());
    first.unmount();
    ops.calls = [];
    ops.answer = (args) => (args.enabled ? PENDING : IDLE);

    at("run-b");

    expect(ops.calls.some((call) => call.kind === "gitLog" && call.enabled)).toBe(true);
  });

  test("freshness counts from when History is enabled, not from the mount (CR round 1 #3)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    mount().unmount();
    let enabled = false;
    const hook = renderHook(() => useWorktreeHistory("profile_1" as Id<"cliProfiles">, "path_1", enabled));
    vi.setSystemTime(Date.now() + 61_000);
    ops.calls = [];
    ops.answer = (args) => (args.enabled ? PENDING : IDLE);

    enabled = true;
    hook.rerender();

    expect(hook.result.current.commits).toHaveLength(2);
    expect(ops.calls.some((call) => call.kind === "gitLog" && call.enabled)).toBe(true);
  });
});
