/**
 * @vitest-environment jsdom
 */
import { useEffect } from "react";
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
  steps: [
    {
      title: "Render the guide",
      explanation: "Adds the tab.",
      files: [{ path: "src/reader.tsx", note: "The tab", sha: "blob-1" }],
      questions: ["Why sticky?"],
    },
  ],
  removedStepTitles: [],
};

type PullRequestHead = { state: "open" | "closed" | "merged"; headSha: string } | null;

/** The hook and the tab in one component, as the reader mounts them; `initial` is the Guide the member picked. */
function Harness({
  start,
  update,
  marks,
  diffState,
  onRetryDiff,
  pullRequest,
  initial,
}: {
  start: () => void;
  update: () => void;
  marks: { isReviewed: () => boolean; setReviewed: () => void };
  diffState: DiffState;
  onRetryDiff: () => void;
  pullRequest: PullRequestHead;
  initial?: Id<"integrationPullRequestGuides">;
}) {
  const state = usePullRequestGuides({ projectId: "p" as Id<"projects">, repositoryId: "r", number: 1 });
  const { select } = state;
  useEffect(() => {
    if (initial) select(initial);
  }, [initial, select]);
  const launch = { allowed: true, disabled: false, reason: null, start, update, dialog: null };
  return (
    <PullRequestGuideTab
      state={state}
      launch={launch}
      pullRequest={pullRequest}
      diffState={diffState}
      onRetryDiff={onRetryDiff}
      marks={marks}
      organizationSlug="acme"
      projectAlias="OS"
    />
  );
}

function renderTab({
  diffState = { kind: "loaded", diff } as DiffState,
  onRetryDiff = vi.fn(),
  pullRequest = { state: "open", headSha: "8a3e7d1c" } as PullRequestHead,
  initial = undefined as Id<"integrationPullRequestGuides"> | undefined,
  reviewed = false,
} = {}) {
  const start = vi.fn();
  const update = vi.fn();
  const marks = { isReviewed: () => reviewed, setReviewed: vi.fn() };
  render(
    <Harness
      start={start}
      update={update}
      marks={marks}
      diffState={diffState}
      onRetryDiff={onRetryDiff}
      pullRequest={pullRequest}
      initial={initial}
    />
  );
  return { start, update, marks, onRetryDiff };
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

    guides = [
      summary({ status: "writing", requester: { name: "Me", avatarUrl: null, isViewer: true }, threadId: "thread_1" as Id<"cliThreads"> }),
    ];
    renderTab();
    expect(screen.getByRole("link", { name: "Open thread" }).getAttribute("href")).toBe(
      appRoute.projectThreadDetail("acme", "OS", "thread_1").pathname
    );
  });

  test("a failed guide shows its reason; only the requester gets Retry, for that guide", () => {
    guides = [summary({ status: "failed", failureReason: "/repo is not a clone of acme/repo" })];
    renderTab();
    expect(screen.getByText("/repo is not a clone of acme/repo")).toBeTruthy();
    expect(screen.getByText(/Requested by Maya Singh/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    cleanup();

    guides = [
      summary({
        status: "failed",
        failureReason: "Stopped",
        requester: { name: "Me", avatarUrl: null, isViewer: true },
        threadId: "thread_1" as Id<"cliThreads">,
      }),
    ];
    const { start } = renderTab();
    expect(screen.getByRole("link", { name: "Open thread" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(start).toHaveBeenCalledWith("guide_1");
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

describe("Outdated guides and Follow-up guides (OS-2417)", () => {
  const newer = summary({ _id: "guide_2" as Id<"integrationPullRequestGuides">, headSha: "c91f02a9" });

  test("an open PR past the guide's head gets the amber banner with Update guide and New guide", async () => {
    guides = [summary()];
    convex.query.mockResolvedValue(detail);
    const { start, update } = renderTab({ pullRequest: { state: "open", headSha: "c91f02a9" } });
    await screen.findByRole("heading", { name: "Render the guide" });
    expect(screen.getByRole("status", { name: "Outdated guide" }).textContent).toContain(
      "This guide was written for 8a3e7d1. The commits since then aren't covered."
    );
    fireEvent.click(screen.getByRole("button", { name: "Update guide" }));
    expect(update).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New guide" }));
    expect(start).toHaveBeenCalled();
  });

  test("an older guide points to the newer one that covers the head", async () => {
    guides = [newer, summary()];
    convex.query.mockImplementation((_fn, { guideId }) => Promise.resolve({ ...detail, _id: guideId }));
    renderTab({ pullRequest: { state: "open", headSha: "c91f02a9" }, initial: "guide_1" as Id<"integrationPullRequestGuides"> });
    expect((await screen.findByRole("status", { name: "Outdated guide" })).textContent).toContain("A newer guide covers c91f02a.");
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Outdated guide" })).toBeNull());
  });

  test("closed PRs, guides at the head, and failed guides get no banner", async () => {
    guides = [summary()];
    convex.query.mockResolvedValue(detail);
    renderTab({ pullRequest: { state: "closed", headSha: "c91f02a9" } });
    await screen.findByRole("heading", { name: "Render the guide" });
    expect(screen.queryByRole("status", { name: "Outdated guide" })).toBeNull();
    cleanup();
    renderTab();
    await screen.findByRole("heading", { name: "Render the guide" });
    expect(screen.queryByRole("status", { name: "Outdated guide" })).toBeNull();
    cleanup();
    guides = [summary({ status: "failed", failureReason: "Stopped" })];
    renderTab({ pullRequest: { state: "open", headSha: "c91f02a9" } });
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Outdated guide" })).toBeNull();
  });

  const followUp: GuideDetail = {
    ...summary({
      base: {
        guideId: "guide_0" as Id<"integrationPullRequestGuides">,
        headSha: "1111111f",
        requester: { name: "Maya Singh", isViewer: false },
      },
      changes: { unchanged: 1, updated: 1, added: 0, removed: 1 },
    }),
    steps: [
      {
        title: "Add the schema",
        explanation: "Adds a table.",
        change: "unchanged",
        files: [{ path: "src/reader.tsx", sha: "blob-1" }],
        questions: [],
      },
      {
        title: "Render the guide",
        explanation: "Adds the tab.",
        change: "updated",
        whatChanged: "Reads the new flag.",
        files: [],
        questions: [],
      },
    ],
    removedStepTitles: ["Write the docs"],
  };

  test("a follow-up names its base and counts, badges each step, says what changed, and lists the Removed steps", async () => {
    guides = [summary({ base: followUp.base, changes: followUp.changes })];
    convex.query.mockResolvedValue(followUp);
    renderTab();
    await screen.findByRole("heading", { name: "Render the guide" });
    expect(screen.getByText("Unchanged")).toBeTruthy();
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(screen.getByText("What changed since 1111111: Reads the new flag.")).toBeTruthy();
    expect(screen.getByText("Removed since 1111111")).toBeTruthy();
    expect(screen.getByText("Write the docs")).toBeTruthy();
  });

  test("an Unchanged step whose files are all Reviewed starts collapsed", async () => {
    guides = [summary({ base: followUp.base, changes: followUp.changes })];
    convex.query.mockResolvedValue(followUp);
    renderTab({ reviewed: true });
    await screen.findByRole("heading", { name: "Add the schema" });
    expect(screen.queryByText("Adds a table.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show step 1" }));
    expect(screen.getByText("Adds a table.")).toBeTruthy();
  });
});

test("a step opened on one follow-up stays collapsed on another, even once both are loaded (OS-2417)", async () => {
  const base = {
    guideId: "guide_0" as Id<"integrationPullRequestGuides">,
    headSha: "1111111f",
    requester: { name: "Maya Singh", isViewer: false },
  };
  const changes = { unchanged: 1, updated: 0, added: 0, removed: 0 };
  const step = (title: string, explanation: string) => ({
    title,
    explanation,
    change: "unchanged" as const,
    files: [{ path: "src/reader.tsx", sha: "blob-1" }],
    questions: [],
  });
  const first = summary({ base, changes });
  const second = summary({ _id: "guide_2" as Id<"integrationPullRequestGuides">, base, changes });
  guides = [second, first];
  convex.query.mockImplementation((_fn, { guideId }) =>
    Promise.resolve({
      ...(guideId === first._id ? first : second),
      steps: [guideId === first._id ? step("First", "First explained.") : step("Second", "Second explained.")],
      removedStepTitles: [],
    })
  );
  const props = {
    start: vi.fn(),
    update: vi.fn(),
    marks: { isReviewed: () => true, setReviewed: vi.fn() },
    diffState: { kind: "loaded", diff } as DiffState,
    onRetryDiff: vi.fn(),
    pullRequest: null,
  };
  const view = render(<Harness {...props} />);
  await screen.findByRole("heading", { name: "Second" });
  view.rerender(<Harness {...props} initial={first._id} />);
  await screen.findByRole("heading", { name: "First" });
  fireEvent.click(screen.getByRole("button", { name: "Show step 1" }));
  expect(screen.getByText("First explained.")).toBeTruthy();
  view.rerender(<Harness {...props} initial={second._id} />);
  await screen.findByRole("heading", { name: "Second" });
  expect(screen.queryByText("Second explained.")).toBeNull();
});

describe("GuideMenu", () => {
  const launch = () => ({ allowed: true, disabled: false, reason: null, start: vi.fn(), update: vi.fn(), dialog: null });
  const open = () => fireEvent.pointerDown(screen.getByRole("button", { name: /c91f02a/ }));
  const older = summary();
  const newer = summary({
    _id: "guide_2" as Id<"integrationPullRequestGuides">,
    headSha: "c91f02a9",
    status: "writing",
    createdAt: Date.now() - 30 * 60_000,
  });

  /** The menu and the tab on one hook, as the reader mounts them. */
  function MenuHarness({ start }: { start: () => void }) {
    const state = usePullRequestGuides({ projectId: "p" as Id<"projects">, repositoryId: "r", number: 1 });
    const menuLaunch = { allowed: true, disabled: false, reason: null, start, update: vi.fn(), dialog: null };
    return (
      <>
        {state.shown ? <GuideMenu state={state} launch={menuLaunch} /> : null}
        <PullRequestGuideTab
          state={state}
          launch={menuLaunch}
          pullRequest={null}
          diffState={{ kind: "loaded", diff }}
          onRetryDiff={vi.fn()}
          marks={{ isReviewed: () => false, setReviewed: vi.fn() }}
          organizationSlug="acme"
          projectAlias="OS"
        />
      </>
    );
  }

  test("lists one row per guide, newest first, and picking an older one shows its steps", async () => {
    guides = [newer, older];
    convex.query.mockResolvedValue(detail);
    render(<MenuHarness start={vi.fn()} />);
    expect(screen.getByText(/Writing the guide/)).toBeTruthy();
    open();
    const rows = screen.getAllByRole("menuitem", { name: /gpt-5/ });
    expect(rows.map((row) => row.textContent)).toEqual(["gpt-5c91f02a30mM", "gpt-58a3e7d1nowM"]);
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
    fireEvent.click(screen.getAllByRole("menuitem", { name: /gpt-5/ })[1]);
    await screen.findByRole("heading", { name: "Render the guide" });
    fireEvent.pointerDown(screen.getByRole("button", { name: /8a3e7d1/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New guide" }));
    expect(start).toHaveBeenCalled();
    expect(screen.getByText(/Writing the guide/)).toBeTruthy();
  });

  test("Delete removes the Guide the member confirmed, even if the list changes meanwhile", () => {
    convex.remove.mockResolvedValue(null);
    const state = (list: GuideSummary[]) => ({
      guides: list,
      shown: list[0],
      steps: undefined,
      retry: vi.fn(),
      select: vi.fn(),
      onlyChanged: false,
      setOnlyChanged: vi.fn(),
    });
    const first = summary({ headSha: "c91f02a9", canDelete: true });
    const props = { launch: launch() };
    const view = render(<GuideMenu state={state([first])} {...props} />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete guide for c91f02a" }));
    view.rerender(
      <GuideMenu
        state={state([summary({ _id: "guide_2" as Id<"integrationPullRequestGuides">, headSha: "c91f02a9", canDelete: true })])}
        {...props}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(convex.remove).toHaveBeenCalledWith({ guideId: "guide_1" });
  });

  test("a disabled New guide says why, since a disabled item shows no tooltip (OS-2415)", () => {
    const guide = summary({ headSha: "c91f02a9" });
    const disabled = { ...launch(), disabled: true, reason: "No CLI profile is online" };
    render(
      <GuideMenu
        state={{
          guides: [guide],
          shown: guide,
          steps: undefined,
          retry: vi.fn(),
          select: vi.fn(),
          onlyChanged: false,
          setOnlyChanged: vi.fn(),
        }}
        launch={disabled}
      />
    );
    open();
    expect(screen.getByRole("menuitem", { name: /New guide/ }).textContent).toContain("No CLI profile is online");
  });

  test("a failed guide's row says Failed in place of its age", () => {
    const failed = summary({ status: "failed", headSha: "c91f02a9" });
    render(
      <GuideMenu
        state={{
          guides: [failed],
          shown: failed,
          steps: undefined,
          retry: vi.fn(),
          select: vi.fn(),
          onlyChanged: false,
          setOnlyChanged: vi.fn(),
        }}
        launch={launch()}
      />
    );
    open();
    expect(screen.getByRole("menuitem", { name: /^gpt-5/ }).textContent).toBe("gpt-5c91f02aFailedM");
  });

  test("names the model the way the composer does", () => {
    const guide = summary({ cliType: "claude-code", cliModel: "sonnet-5-5" });
    render(
      <GuideMenu
        state={{
          guides: [guide],
          shown: guide,
          steps: undefined,
          retry: vi.fn(),
          select: vi.fn(),
          onlyChanged: false,
          setOnlyChanged: vi.fn(),
        }}
        launch={launch()}
      />
    );
    expect(screen.getByRole("button", { name: /Sonnet 5\.5/ })).toBeTruthy();
  });

  test("the tab row names a follow-up's base and counts, and Only what changed hides its Unchanged steps (OS-2417)", async () => {
    const base = {
      guideId: "guide_0" as Id<"integrationPullRequestGuides">,
      headSha: "1111111f",
      requester: { name: "Maya Singh", isViewer: false },
    };
    const changes = { unchanged: 1, updated: 1, added: 0, removed: 1 };
    guides = [summary({ base, changes })];
    convex.query.mockResolvedValue({
      ...detail,
      base,
      changes,
      steps: [
        { ...detail.steps[0], title: "Add the schema", change: "unchanged" },
        { ...detail.steps[0], files: [], change: "updated", whatChanged: "Reads the flag." },
      ],
    });
    render(<MenuHarness start={vi.fn()} />);
    await screen.findByRole("heading", { name: "Add the schema" });
    const summaryLine = screen.getByText("Since 1111111: 1 updated, 1 unchanged, 1 removed");
    expect(summaryLine.getAttribute("title")).toBe("Follow-up of Maya Singh's guide for 1111111");
    fireEvent.click(screen.getByRole("switch", { name: "Only what changed" }));
    expect(screen.queryByRole("heading", { name: "Add the schema" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Render the guide" })).toBeTruthy();
  });

  test("a guide still being written shows a spinner in place of its runtime icon (OS-2417)", () => {
    render(
      <GuideMenu
        state={{
          guides: [newer, older],
          shown: newer,
          steps: undefined,
          retry: vi.fn(),
          select: vi.fn(),
          onlyChanged: false,
          setOnlyChanged: vi.fn(),
        }}
        launch={launch()}
      />
    );
    expect(within(screen.getByRole("button", { name: /c91f02a/ })).getByTitle("Writing the guide")).toBeTruthy();
    open();
    const [writing, ready] = screen.getAllByRole("menuitem", { name: /gpt-5/ });
    expect(within(writing).getByTitle("Writing the guide")).toBeTruthy();
    expect(within(ready).queryByTitle("Writing the guide")).toBeNull();
  });

  test("a follow-up's row says whose guide it follows up (OS-2417)", () => {
    const guide = summary({
      base: {
        guideId: "guide_0" as Id<"integrationPullRequestGuides">,
        headSha: "1111111f",
        requester: { name: "Maya Singh", isViewer: false },
      },
    });
    render(
      <GuideMenu
        state={{
          guides: [guide],
          shown: guide,
          steps: undefined,
          retry: vi.fn(),
          select: vi.fn(),
          onlyChanged: false,
          setOnlyChanged: vi.fn(),
        }}
        launch={launch()}
      />
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: /8a3e7d1/ }));
    expect(within(screen.getByRole("menuitem", { name: /^gpt-5/ })).getByTitle("Follow-up of Maya Singh's guide")).toBeTruthy();
  });

  test("only guides the member may delete offer Delete", () => {
    render(
      <GuideMenu
        state={{
          guides: [newer],
          shown: newer,
          steps: undefined,
          retry: vi.fn(),
          select: vi.fn(),
          onlyChanged: false,
          setOnlyChanged: vi.fn(),
        }}
        launch={launch()}
      />
    );
    open();
    expect(screen.queryByRole("menuitem", { name: /Delete guide/ })).toBeNull();
  });
});
