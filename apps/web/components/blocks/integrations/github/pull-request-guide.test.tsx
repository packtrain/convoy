/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { GuideDetail, GuideSummary } from "@/convex/integrations/github/lib/validators";
import { appRoute } from "@/lib/navigation";
import { GuideMenu, PullRequestGuideTab, usePullRequestGuides } from "./pull-request-guide";
import type { DiffState, PullRequestDiff } from "./github-patch";

let guides: GuideSummary[] | undefined;
const convex = vi.hoisted(() => ({ query: vi.fn(), remove: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: (_fn: unknown, args: unknown) => (args === "skip" ? undefined : guides),
  useConvex: () => convex,
  useMutation: () => convex.remove,
}));
vi.mock("@pierre/diffs/react", () => ({ PatchDiff: ({ patch }: { patch: string }) => <pre>{patch}</pre> }));
vi.mock("@/lib/threads/hooks/use-diff-theme", () => ({ useDiffTheme: () => ({}) }));

afterEach(() => {
  cleanup();
  convex.query.mockReset();
  convex.remove.mockReset();
});

const summary = (overrides: Partial<GuideSummary> = {}): GuideSummary => ({
  _id: "guide_1" as Id<"integrationPullRequestGuides">,
  status: "ready",
  baseSha: "base",
  headSha: "8a3e7d1c",
  cliType: "codex",
  cliModel: "gpt-5",
  createdAt: Date.now(),
  requester: { name: "Maya Singh", avatarUrl: null, isViewer: false },
  canDelete: false,
  ...overrides,
});

const diff = {
  htmlUrl: "https://github.com/acme/repo/pull/1",
  files: [{ path: "src/reader.tsx", status: "modified", additions: 2, deletions: 1, sha: "blob-1", patch: "@@ -1 +1 @@\n-a\n+b" }],
} as unknown as PullRequestDiff;

const detail: GuideDetail = {
  ...summary(),
  steps: [{ title: "Render the guide", explanation: "Adds the tab.", files: [{ path: "src/reader.tsx", note: "The tab", sha: "blob-1" }], questions: ["Why sticky?"] }],
};

/** The hook and the tab in one component, as the reader mounts them. */
function Harness({ start, marks, diffState, onRetryDiff }: { start: () => void; marks: { isReviewed: () => boolean; setReviewed: () => void }; diffState: DiffState; onRetryDiff: () => void }) {
  const state = usePullRequestGuides({ projectId: "p" as Id<"projects">, repositoryId: "r", number: 1 });
  const launch = { allowed: true, disabled: false, reason: null, start, dialog: null };
  return <PullRequestGuideTab state={state} launch={launch} diffState={diffState} onRetryDiff={onRetryDiff} marks={marks} organizationSlug="acme" projectAlias="OS" />;
}

function renderTab({ diffState = { kind: "loaded", diff } as DiffState, onRetryDiff = vi.fn() } = {}) {
  const start = vi.fn();
  const marks = { isReviewed: () => false, setReviewed: vi.fn() };
  render(<Harness start={start} marks={marks} diffState={diffState} onRetryDiff={onRetryDiff} />);
  return { start, marks, onRetryDiff };
}

describe("PullRequestGuideTab", () => {
  test("no guide yet: Generate guide starts the composer", () => {
    guides = [];
    const { start } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Generate guide/ }));
    expect(start).toHaveBeenCalled();
  });

  test("while writing, only the requester gets Open thread", () => {
    guides = [summary({ status: "writing" })];
    renderTab();
    expect(screen.getByText(/Requested by Maya Singh/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open thread" })).toBeNull();
    cleanup();

    guides = [summary({ status: "writing", requester: { name: "Me", avatarUrl: null, isViewer: true }, threadId: "thread_1" as Id<"cliThreads"> })];
    renderTab();
    expect(screen.getByRole("link", { name: "Open thread" }).getAttribute("href")).toBe(appRoute.projectThreadDetail("acme", "OS", "thread_1").pathname);
  });

  test("a ready guide reads its steps once and shows each step's files with Reviewed marks", async () => {
    guides = [summary()];
    convex.query.mockResolvedValue(detail);
    const { marks } = renderTab();
    await screen.findByRole("heading", { name: "Render the guide" });
    expect(screen.getByText("The tab")).toBeTruthy();
    expect(screen.getByText("Question: Why sticky?")).toBeTruthy();
    expect(screen.getByText(/\+b/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed src/reader.tsx" }));
    expect(marks.setReviewed).toHaveBeenCalledWith(diff.files[0], true);
    await waitFor(() => expect(convex.query).toHaveBeenCalledTimes(1));
  });

  test("a file at the repository root shows its name without a folder", async () => {
    guides = [summary()];
    convex.query.mockResolvedValue({ ...detail, steps: [{ ...detail.steps[0], files: [{ path: "README.md" }] }] });
    renderTab();
    const row = await screen.findByTitle("README.md");
    expect(row.textContent).toBe("README.md");
  });

  test("an attention note reads as its kind, a colon, and the note", async () => {
    guides = [summary()];
    convex.query.mockResolvedValue({ ...detail, steps: [{ ...detail.steps[0], attention: { kind: "product", note: "Decide." } }] });
    renderTab();
    expect((await screen.findByText("Decide.")).closest("p")?.textContent).toBe("Product: Decide.");
  });

  test("when the diff fails, the steps show the reason and Retry instead of loading forever", async () => {
    guides = [summary()];
    convex.query.mockResolvedValue(detail);
    const { onRetryDiff } = renderTab({ diffState: { kind: "error", message: "GitHub could not be reached." } });
    await screen.findByRole("heading", { name: "Render the guide" });
    expect(screen.queryByLabelText("Loading src/reader.tsx")).toBeNull();
    expect(screen.getByText("GitHub could not be reached.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetryDiff).toHaveBeenCalled();
  });
});

describe("GuideMenu", () => {
  const launch = () => ({ allowed: true, disabled: false, reason: null, start: vi.fn(), dialog: null });
  const open = () => fireEvent.pointerDown(screen.getByRole("button", { name: /c91f02a/ }));
  const older = summary();
  const newer = summary({ _id: "guide_2" as Id<"integrationPullRequestGuides">, headSha: "c91f02a9", status: "writing", createdAt: Date.now() - 30 * 60_000 });

  /** The menu and the tab on one hook, as the reader mounts them. */
  function MenuHarness({ start }: { start: () => void }) {
    const state = usePullRequestGuides({ projectId: "p" as Id<"projects">, repositoryId: "r", number: 1 });
    const menuLaunch = { allowed: true, disabled: false, reason: null, start, dialog: null };
    return (
      <>
        {state.shown ? <GuideMenu state={state} launch={menuLaunch} /> : null}
        <PullRequestGuideTab state={state} launch={menuLaunch} diffState={{ kind: "loaded", diff }} onRetryDiff={vi.fn()} marks={{ isReviewed: () => false, setReviewed: vi.fn() }} organizationSlug="acme" projectAlias="OS" />
      </>
    );
  }

  test("lists one row per guide, newest first, and picking an older one shows its steps", async () => {
    guides = [newer, older];
    convex.query.mockResolvedValue(detail);
    render(<MenuHarness start={vi.fn()} />);
    expect(screen.getByText(/Writing the guide/)).toBeTruthy();
    open();
    const rows = screen.getAllByRole("menuitem", { name: /^gpt-5/ });
    expect(rows.map((row) => row.textContent)).toEqual(["gpt-5c91f02aM30m", "gpt-58a3e7d1Mnow"]);
    // The avatar names the requester on hover.
    expect(within(rows[0]).getByTitle("Maya Singh")).toBeTruthy();
    fireEvent.click(rows[1]);
    await screen.findByRole("heading", { name: "Render the guide" });
    expect(screen.getByRole("button", { name: /8a3e7d1/ })).toBeTruthy();
  });

  test("New guide starts the composer and shows the newest guide again", async () => {
    guides = [newer, older];
    convex.query.mockResolvedValue(detail);
    const start = vi.fn();
    render(<MenuHarness start={start} />);
    open();
    fireEvent.click(screen.getAllByRole("menuitem", { name: /^gpt-5/ })[1]);
    await screen.findByRole("heading", { name: "Render the guide" });
    fireEvent.pointerDown(screen.getByRole("button", { name: /8a3e7d1/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New guide" }));
    expect(start).toHaveBeenCalled();
    expect(screen.getByText(/Writing the guide/)).toBeTruthy();
  });

  test("Delete removes the Guide the member confirmed, even if the list changes meanwhile", () => {
    convex.remove.mockResolvedValue(null);
    const state = (list: GuideSummary[]) => ({ guides: list, shown: list[0], steps: undefined, retry: vi.fn(), select: vi.fn() });
    const first = summary({ headSha: "c91f02a9", canDelete: true });
    const props = { launch: launch() };
    const view = render(<GuideMenu state={state([first])} {...props} />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete guide for c91f02a" }));
    view.rerender(<GuideMenu state={state([summary({ _id: "guide_2" as Id<"integrationPullRequestGuides">, headSha: "c91f02a9", canDelete: true })])} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(convex.remove).toHaveBeenCalledWith({ guideId: "guide_1" });
  });

  test("names the model the way the composer does", () => {
    const guide = summary({ cliType: "claude-code", cliModel: "sonnet-5-5" });
    render(<GuideMenu state={{ guides: [guide], shown: guide, steps: undefined, retry: vi.fn(), select: vi.fn() }} launch={launch()} />);
    expect(screen.getByRole("button", { name: /Sonnet 5\.5/ })).toBeTruthy();
  });

  test("only guides the member may delete offer Delete", () => {
    render(<GuideMenu state={{ guides: [newer], shown: newer, steps: undefined, retry: vi.fn(), select: vi.fn() }} launch={launch()} />);
    open();
    expect(screen.queryByRole("menuitem", { name: /Delete guide/ })).toBeNull();
  });
});
