/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
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

const PAGE_1 = { commits: [commit("a", "second", [hash("b")]), commit("b", "first")], nextCursor: `${hash("a")}:2` };
const PAGE_2 = { commits: [commit("c", "older")] };
const PATCH = (path: string) => ({ body: "", patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+y\n`, truncated: false });

function done(result: unknown): WorktreeOpState {
  return { resultJson: JSON.stringify(result), error: null, loading: false, refresh: () => {} };
}

const selections = vi.hoisted(() => [] as { hash: string | null; mode: string }[]);

function Harness({
  appVersion = "0.171.0",
  isOnline = true,
  shown = true,
  wordWrap = false,
  initialHash = null,
  layout = "list",
}: {
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
        allCollapsed={false}
        wordWrap={wordWrap}
        selectedHash={selectedHash}
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
    expect(screen.queryByTestId("patch")).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: /^first/ }));
    expect(screen.getByTestId("patch").textContent).toContain("b.txt");

    fireEvent.click(screen.getByRole("button", { name: "Close commit" }));
    expect(screen.queryByTestId("patch")).toBeNull();
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

  test("a row's accessible name is the subject, author and date, not the raw meta line (OS-2534 UX review 2)", () => {
    render(<Harness />);

    expect(screen.getByRole("option", { name: /^second, Ada, / }).getAttribute("aria-label")).not.toContain("·");
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
          : done({ commits: [commit("a", "second", [hash("c")])], nextCursor: `${hash("a")}:1` });
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
