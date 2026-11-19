/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { appRoute } from "@/lib/navigation";
import { PullRequestReader } from "./pull-request-reader";

let stored: unknown;
let tasks: unknown[] = [];
let layers: unknown[] = [];
let taskChecks: unknown = null;
let pullRequestChecks: unknown = null;
let prThreads: unknown[] = [];
let linkedAccounts: unknown = { configured: true, organizations: [] };
const readDiff = vi.fn();
const readPermission = vi.fn();
const createComment = vi.fn();
const updateComment = vi.fn();
const removeComment = vi.fn();
const updateState = vi.fn();
const listAssignable = vi.fn();
const updateAssignee = vi.fn();
const mergePullRequest = vi.fn();
const updateBranch = vi.fn();
const submitReview = vi.fn();
const requestReviewer = vi.fn();
const beginLink = vi.fn();
const readOverview = vi.fn();
const readFile = vi.fn();
const push = vi.fn();

const name = (fn: Parameters<typeof getFunctionName>[0]) => getFunctionName(fn);

// cmdk, behind the Assignees picker, measures its list.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("convex/react", () => ({
  useQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    return {
      [name(api.integrations.github.pullRequests.get)]: stored,
      [name(api.integrations.github.pullRequests.referencedTasks)]: tasks,
      [name(api.integrations.github.pullRequests.stack)]: layers,
      [name(api.checks.checklists.getForTask)]: taskChecks,
      [name(api.checks.checklists.getForPullRequest)]: pullRequestChecks,
      [name(api.cli.threads.lists.listByAttachedPullRequest)]: prThreads,
      [name(api.integrations.github.accounts.listMine)]: linkedAccounts,
    }[name(fn)];
  },
  useMutation: (fn: Parameters<typeof getFunctionName>[0]) => (name(fn) === name(api.integrations.github.accounts.beginLink) ? beginLink : vi.fn()),
  useAction: (fn: Parameters<typeof getFunctionName>[0]) =>
    ({
      [name(api.integrations.github.pullRequests.readDiff)]: readDiff,
      [name(api.integrations.github.pullRequests.readOverview)]: readOverview,
      [name(api.integrations.github.pullRequests.readFile)]: readFile,
      [name(api.integrations.github.accounts.readRepositoryPermission)]: readPermission,
      [name(api.integrations.github.accounts.disconnect)]: vi.fn(),
      [name(api.integrations.github.comments.create)]: createComment,
      [name(api.integrations.github.comments.update)]: updateComment,
      [name(api.integrations.github.comments.remove)]: removeComment,
      [name(api.integrations.github.states.update)]: updateState,
      [name(api.integrations.github.assignees.list)]: listAssignable,
      [name(api.integrations.github.assignees.update)]: updateAssignee,
      [name(api.integrations.github.assignees.clear)]: vi.fn(),
      [name(api.integrations.github.merges.merge)]: mergePullRequest,
      [name(api.integrations.github.merges.updateBranch)]: updateBranch,
      [name(api.integrations.github.reviews.submit)]: submitReview,
      [name(api.integrations.github.reviews.requestReviewer)]: requestReviewer,
    })[name(fn)],
  useConvex: () => ({}),
}));
vi.mock("@/lib/navigation", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ location: { pathname: "/", search: "", hash: "" }, push }),
  useRouteParams: () => ({}),
}));
type GutterClick = (range: { start: number; end: number; side: string }) => void;
type LineSelection = (range: { start: number; end: number; side: string } | null) => void;
type Annotation = { side: string; lineNumber: number };
// The gutter "+" comments on line 1 of the new side, or drags up from line 3 to 1; annotations render under the patch.
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({
    patch,
    options,
    lineAnnotations,
    renderAnnotation,
    selectedLines,
  }: {
    patch: string;
    options?: { onGutterUtilityClick?: GutterClick; onLineSelectionEnd?: LineSelection };
    lineAnnotations?: Annotation[];
    renderAnnotation?: (annotation: Annotation) => React.ReactNode;
    selectedLines?: { start: number; end: number } | null;
  }) => (
    <div>
      <pre>{patch}</pre>
      {options?.onGutterUtilityClick ? (
        <button type="button" onClick={() => options.onGutterUtilityClick?.({ start: 1, end: 1, side: "additions" })}>
          Comment on line 1
        </button>
      ) : null}
      {options?.onGutterUtilityClick ? (
        <button type="button" onClick={() => options.onGutterUtilityClick?.({ start: 3, end: 1, side: "additions" })}>
          Comment on lines 1–3
        </button>
      ) : null}
      {options?.onLineSelectionEnd ? (
        <>
          <button type="button" onClick={() => options.onLineSelectionEnd?.({ start: 3, end: 3, side: "additions" })}>
            Select line 3
          </button>
          <button type="button" onClick={() => options.onLineSelectionEnd?.(null)}>
            Unselect lines
          </button>
        </>
      ) : null}
      {selectedLines ? <output aria-label="Selected lines">{`${selectedLines.start}-${selectedLines.end}`}</output> : null}
      {lineAnnotations?.map((annotation) => (
        <div key={`${annotation.side}:${annotation.lineNumber}`} data-testid={`annotation-${annotation.lineNumber}`}>
          {renderAnnotation?.(annotation)}
        </div>
      ))}
    </div>
  ),
  File: ({ file }: { file: { contents: string } }) => <pre>whole: {file.contents}</pre>,
}));
vi.mock("@/lib/auth/hooks", () => ({ useAppUser: () => ({ user: null }) }));
vi.mock("@/lib/threads/hooks/use-diff-theme", () => ({ useDiffTheme: () => ({}) }));
// Radix shows the image only after it loads, which jsdom never does.
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, "aria-hidden": hidden }: { children: React.ReactNode; "aria-hidden"?: boolean }) => <span aria-hidden={hidden}>{children}</span>,
  // eslint-disable-next-line @next/next/no-img-element -- stands in for Radix's own <img>
  AvatarImage: ({ src }: { src?: string }) => (src ? <img alt="" src={src} /> : null),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
const seeded: string[] = [];
vi.mock("@/components/blocks/tasks/task-thread-composer", async () => {
  const { useEffect } = await import("react");
  // Mirrors the real composer: a seed is applied once when it arrives, then reported back.
  function TaskThreadComposer({ pullRequest, seed, onSeeded }: { pullRequest: { ref: string }; seed?: unknown; onSeeded?: () => void }) {
    useEffect(() => {
      if (seed === undefined) return;
      seeded.push(typeof seed === "string" ? seed : (seed as { text: string }).text);
      onSeeded?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seed]);
    return <div aria-label="Thread composer">{pullRequest.ref}</div>;
  }
  return { TaskThreadComposer };
});
vi.mock("@/components/blocks/thread/thread-list-item", () => ({
  ThreadListItem: ({ chat }: { chat: { title: string } }) => <span>{chat.title}</span>,
}));
type ImgOverride = (props: { src: string; alt: string }) => React.ReactNode;
// Calls a caller's `img` override for a markdown image, so tests see what GitHub bodies render.
vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children, components }: { children: string; components?: { img?: ImgOverride } }) => (
    <div>
      {children}
      {children.includes("![") ? components?.img?.({ src: "https://vercel.com/static/status/ready.svg", alt: "Ready" }) : null}
    </div>
  ),
}));

beforeEach(() => {
  localStorage.clear();
  stored = { pullRequest };
  tasks = [];
  layers = [];
  taskChecks = null;
  pullRequestChecks = null;
  readDiff.mockResolvedValue(diff);
  readOverview.mockResolvedValue(overview);
  readPermission.mockResolvedValue("read");
  linkedAccounts = { configured: true, organizations: [] };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pullRequest = {
  _id: "pr_1",
  repositoryId: "repo_1",
  number: 7,
  title: "Add search",
  author: "octocat",
  state: "open",
  draft: false,
  labels: [],
  headRef: "search",
  baseRef: "main",
  providerUpdatedAt: Date.now(),
  archived: false,
  conflicts: false,
  description: "Adds search.",
  headSha: "head-1",
  baseSha: "base",
  providerCreatedAt: Date.now(),
  syncedAt: Date.now(),
};

const diff = {
  pullRequest: { ...pullRequest, _id: undefined, syncedAt: undefined },
  baseSha: "base",
  headSha: "head-1",
  htmlUrl: "https://github.com/acme/web/pull/7",
  changedFiles: 2,
  partial: false,
  files: [
    { path: "src/search.ts", status: "added", additions: 1, deletions: 0, sha: "blob-1", patch: "@@ -0,0 +1 @@\n+search()" },
    { path: "logo.png", status: "added", additions: 0, deletions: 0, sha: "blob-2" },
  ],
};

const overview = {
  headSha: "head-1",
  baseRef: "main",
  htmlUrl: "https://github.com/acme/web/pull/7",
  mergeable: "clean",
  behindBy: 0,
  mergeBlock: null,
  mergeSettings: { methods: ["merge", "squash", "rebase"], deleteBranchOnMerge: false },
  commitCount: 1,
  commits: [{ sha: "c0ffee1234", message: "Add search box", author: "octocat", committedAt: Date.now(), url: "https://github.com/c" }],
  checks: [
    { id: "run:1", name: "test", state: "success", summary: "Passed", url: null },
    { id: "run:2", name: "lint", state: "failure", summary: "2 errors", url: "https://github.com/runs/2" },
  ],
  reviews: [{ id: 1, author: "maya", authorAvatarUrl: null, state: "approved", submittedAt: Date.now(), body: "" }],
  requestedReviewers: [],
  requestedTeams: [],
  comments: [{ id: 2, author: "alex", authorId: 2, authorAvatarUrl: "https://avatars.githubusercontent.com/u/2", body: "Nice work", createdAt: Date.now(), url: "https://github.com/c/2" }],
  reviewComments: [],
  assignees: [],
  milestone: null,
};

function reader(props: Partial<React.ComponentProps<typeof PullRequestReader>> = {}) {
  return (
    <PullRequestReader
      {...props}
      projectId={"project_1" as Id<"projects">}
      repositoryId="repo_1"
      number={7}
      status={null}
      hrefFor={(repositoryId, number) => appRoute.projectPullRequest("org", "WEB", repositoryId, number)}
      organizationSlug="org"
      projectAlias="WEB"
    />
  );
}

/** Radix tabs activate on mouse down. */
function openTab(label: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name: label }), { button: 0 });
}

async function openDiff() {
  const view = render(reader());
  openTab("Diff");
  await waitFor(() => expect(screen.getByText(/\+search\(\)/)).toBeTruthy());
  return view;
}

describe("PullRequestReader tabs", () => {
  test("opens on the tab it is given and reports each tab picked", async () => {
    const onTabChange = vi.fn();
    render(reader({ defaultTab: "diff", onTabChange }));
    expect(screen.getByRole("tab", { name: "Diff" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(screen.getByText(/\+search\(\)/)).toBeTruthy());
    openTab("Overview");
    expect(onTabChange).toHaveBeenCalledWith("overview");
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("PullRequestReader diff", () => {
  test("renders GitHub's files, labels a missing patch, and keeps the diff when new commits land", async () => {
    const view = await openDiff();
    expect(screen.getByText(/GitHub sent no text diff for this file/)).toBeTruthy();
    expect(screen.getByLabelText("Displayed revision").textContent).toBe("main → head-1");

    stored = { pullRequest: { ...pullRequest, headSha: "head-2" } };
    view.rerender(reader());
    expect(screen.getByText(/New changes available/)).toBeTruthy();
    expect(screen.getByText(/\+search\(\)/)).toBeTruthy();
    expect(readDiff).toHaveBeenCalledTimes(1);
  });

  test("a PR Convoy never stored reads from GitHub: header, overview, and diff", async () => {
    stored = { pullRequest: null };
    readDiff.mockResolvedValue({ ...diff, pullRequest: { ...diff.pullRequest, title: "Old merged fix", state: "merged" } });
    render(reader());
    expect(await screen.findByRole("heading", { name: "Old merged fix" })).toBeTruthy();
    expect(screen.getByRole("banner").querySelector('[aria-label="Merged"]')).toBeTruthy();
    expect(await screen.findByText("Nice work")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Diff" }));
    expect(screen.getByText(/\+search\(\)/)).toBeTruthy();
  });

  test("a PR GitHub doesn't have says why, with Retry", async () => {
    stored = { pullRequest: null };
    readDiff.mockRejectedValue(new Error("GitHub has no pull request with this number in the connected repository"));
    render(reader());
    expect(await screen.findByText("This pull request isn't available")).toBeTruthy();
    expect(screen.getByText("GitHub has no pull request with this number in the connected repository")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("losing access drops the held diff", async () => {
    const view = await openDiff();
    stored = null;
    view.rerender(reader());
    expect(screen.getByText("This pull request isn't available")).toBeTruthy();
    expect(screen.queryByText(/\+search\(\)/)).toBeNull();
  });

  test("a base-only change offers Refresh, and Refresh reloads the diff and the overview", async () => {
    const view = await openDiff();
    stored = { pullRequest: { ...pullRequest, baseSha: "base-2", baseRef: "release" } };
    view.rerender(reader());
    expect(screen.getByText(/New changes available/)).toBeTruthy();

    readDiff.mockResolvedValue({ ...diff, baseSha: "base-2" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.queryByText(/New changes available/)).toBeNull());
    expect(readDiff).toHaveBeenCalledTimes(2);
    expect(readOverview).toHaveBeenCalledTimes(2);
  });

  test("a stored row behind the live diff is not reported as new changes", async () => {
    stored = { pullRequest: { ...pullRequest, headSha: "head-0" } };
    const view = await openDiff();
    expect(screen.queryByText(/New changes available/)).toBeNull();
    stored = { pullRequest };
    view.rerender(reader());
    expect(screen.queryByText(/New changes available/)).toBeNull();
  });

  test("Reviewed marks count, persist, and clear when a new revision changes the file", async () => {
    const view = await openDiff();
    expect(screen.getByText(/0 \/ 2 reviewed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed src/search.ts" }));
    expect(screen.getByText(/1 \/ 2 reviewed/)).toBeTruthy();
    view.unmount();

    // Same contents after a reload: still reviewed.
    await openDiff();
    expect(screen.getByText(/1 \/ 2 reviewed/)).toBeTruthy();
    cleanup();

    readDiff.mockResolvedValue({ ...diff, headSha: "head-2", files: [{ ...diff.files[0], sha: "blob-1b" }, diff.files[1]] });
    await openDiff();
    expect(screen.getByText(/0 \/ 2 reviewed/)).toBeTruthy();
  });

  test("a file opens in its own tab with its whole contents at the diff's head", async () => {
    readFile.mockResolvedValue({ kind: "text", contents: "export function search() {}" });
    await openDiff();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open src/search.ts" })));
    expect(readFile).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, path: "src/search.ts", ref: "head-1" });
    expect(await screen.findByText("whole: export function search() {}")).toBeTruthy();
  });
});

describe("PullRequestReader review round 1", () => {
  test("an overview that lands after the stored row moved keeps New changes available", async () => {
    let resolveOverview: (value: unknown) => void = () => {};
    readOverview.mockReturnValue(new Promise((resolve) => (resolveOverview = resolve)));
    const view = await openDiff();
    stored = { pullRequest: { ...pullRequest, headSha: "head-2" } };
    view.rerender(reader());
    expect(screen.getByText(/New changes available/)).toBeTruthy();
    await act(async () => resolveOverview(overview));
    expect(screen.getByText(/New changes available/)).toBeTruthy();
  });

  test("the overview is read for the displayed diff's head", async () => {
    readDiff.mockResolvedValue({ ...diff, baseSha: "base-9", headSha: "head-9" });
    render(reader());
    await screen.findByText("Commits: 1");
    expect(readOverview).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, baseSha: "base-9", headSha: "head-9" });
  });

  test("a submitted review's body shows in Activity", async () => {
    readOverview.mockResolvedValue({
      ...overview,
      reviews: [{ id: 3, author: "sam", state: "changes_requested", submittedAt: Date.now(), body: "Please split this file", url: "https://github.com/r/3" }],
    });
    render(reader());
    const body = await screen.findByText("Please split this file");
    expect(body.closest("article")?.querySelector("p")?.textContent).toMatch(/^sam requested changes ·/);
  });

  test("a base GitHub can't compare is not reported as up to date", async () => {
    readOverview.mockResolvedValue({ ...overview, behindBy: null });
    render(reader());
    await screen.findByText("Commits: 1");
    expect(screen.queryByText(/Up to date with/)).toBeNull();
    expect(within(screen.getByLabelText("Pull request properties")).getByText("Couldn't compare with main")).toBeTruthy();
  });
});

describe("PullRequestReader review round 2", () => {
  test("evidence for a task in another project links its threads in that project", async () => {
    tasks = [{ _id: "task_2", refId: "API-12", name: "Search API", taskType: { key: "task", name: "Task", icon: "circle", color: "gray" }, isArchived: false }];
    taskChecks = {
      checklists: [],
      checklistId: null,
      checks: [
        {
          key: "tests",
          label: "All tests pass",
          added: false,
          results: [
            {
              _id: "result_1",
              status: "failed",
              note: "2 failing",
              files: [],
              threadId: "thread_api",
              threadTitle: "Run API tests",
              reportedByViewer: true,
              reporterName: "Me",
              reportedAt: Date.now(),
              messageId: "message_1",
            },
          ],
        },
      ],
    };
    render(reader());
    fireEvent.click(await screen.findByText("All tests pass"));
    expect(screen.getByRole("link", { name: "Run API tests" }).getAttribute("href")).toBe("/o/org/API/threads/thread_api");
  });
});

describe("PullRequestReader overview layout", () => {
  test("empty properties show the table's dash, and an up-to-date branch gets a tick, not the PR icon", async () => {
    readOverview.mockResolvedValue({ ...overview, reviews: [], requestedReviewers: [] });
    render(reader());
    await screen.findByText("Commits: 1");
    const properties = screen.getByRole("complementary", { name: "Pull request properties" });
    expect([...properties.querySelectorAll("h3")].map((heading) => [heading.textContent, heading.nextElementSibling?.textContent])).toEqual([
      ["Status", "Open"],
      ["Tasks", "—"],
      ["Reviewers", "—"],
      ["Assignees", "—"],
      ["Branch", "Up to date with main"],
    ]);
    expect(within(properties).getByText("Up to date with main").querySelector(".lucide-circle-check")).toBeTruthy();
  });

  test("the author's own review shows in Activity but never as a reviewer, as on GitHub", async () => {
    readOverview.mockResolvedValue({
      ...overview,
      reviews: [{ id: 4, author: "octocat", authorAvatarUrl: null, state: "commented", submittedAt: Date.now(), body: "", url: "https://github.com/r/4" }],
      requestedReviewers: [],
    });
    render(reader());
    expect(await screen.findByText(/octocat reviewed/)).toBeTruthy();
    const reviewers = screen.getAllByRole("heading", { level: 3 }).find((heading) => heading.textContent === "Reviewers");
    expect(reviewers?.nextElementSibling?.textContent).toBe("—");
    fireEvent.click(screen.getByRole("button", { name: "Merge status" }));
    expect(screen.getByText("No reviews yet")).toBeTruthy();
  });

  test("a narrow pane carries the properties in the header, without Threads", async () => {
    tasks = [{ _id: "task_1", refId: "WEB-12", name: "Search", taskType: { key: "task", name: "Task", icon: "circle", color: "gray" }, isArchived: false }];
    render(reader());
    await screen.findByText("Commits: 1");
    const header = screen.getByRole("region", { name: "Pull request summary" });
    expect(header.className).toContain("@4xl:hidden");
    // Status ends the title row; the branch state ends the author · base ← head row.
    const titleRow = screen.getByRole("heading", { level: 2 }).parentElement!;
    expect(titleRow.lastElementChild?.textContent).toBe("Open");
    expect(titleRow.lastElementChild?.className.split(" ")).toEqual(expect.arrayContaining(["@4xl:hidden", "h-7", "text-sm"]));
    const metaRow = screen.getByText("search").parentElement!;
    expect(metaRow.lastElementChild?.textContent).toContain("Up to date with main");
    expect(metaRow.lastElementChild?.className).toContain("@4xl:hidden");
    expect(header.textContent).not.toContain("Up to date with main");
    expect(within(header).getByRole("link", { name: /WEB-12/ }).getAttribute("title")).toBe("WEB-12 Search");
    expect(header.textContent).toContain("maya");
    expect(header.textContent).not.toContain("Threads");
    expect(screen.getByRole("complementary", { name: "Pull request properties" }).className.split(" ")).toEqual(expect.arrayContaining(["hidden", "@4xl:block"]));
  });

  test("Assignees, Labels, and Milestone show only when GitHub has them", async () => {
    stored = { pullRequest: { ...pullRequest, labels: ["bug", "ui"] } };
    readOverview.mockResolvedValue({
      ...overview,
      assignees: [{ login: "robin", avatarUrl: null }],
      milestone: { title: "v1", url: "https://github.com/acme/web/milestone/3" },
    });
    render(reader());
    await screen.findByText("Commits: 1");
    const properties = screen.getByRole("complementary", { name: "Pull request properties" });
    expect([...properties.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual([
      "Status",
      "Tasks",
      "Reviewers",
      "Assignees",
      "Labels",
      "Milestone",
      "Branch",
    ]);
    expect(properties.textContent).toContain("robin");
    expect(properties.textContent).toContain("bugui");
    expect(within(properties).getByRole("link", { name: "v1" }).getAttribute("href")).toBe("https://github.com/acme/web/milestone/3");
  });

  test("an inline review comment shows in Activity under its file, lines, and quoted code, as on GitHub", async () => {
    readOverview.mockResolvedValue({
      ...overview,
      comments: [],
      reviewComments: [
        {
          id: 6,
          author: "sam",
          authorAvatarUrl: null,
          body: "Rename this",
          createdAt: Date.now(),
          url: "https://github.com/rc/6",
          path: "src/a.ts",
          line: 3,
          quote: [
            { kind: "add", number: 2, text: "const a = 1;" },
            { kind: "add", number: 3, text: "const b = 2;" },
          ],
        },
      ],
    });
    render(reader());
    const body = await screen.findByText("Rename this");
    const article = body.closest("article")!;
    expect(article.querySelector("header")?.textContent).toBe("src/a.tsLines 2–3");
    expect([...article.querySelectorAll("tr")].map((row) => row.textContent)).toEqual(["2+const a = 1;", "3+const b = 2;"]);
    expect(article.querySelector("p")?.textContent).toMatch(/^sam commented ·/);
    // Laid out like any comment: author line, then the quoted code card, then the body.
    expect(article.className).not.toMatch(/\bborder\b/);
    const [header, quote] = [article.querySelector("p")!, article.querySelector("header")!];
    expect(header.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4);
    expect(quote.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4);
  });

  test("Commits come after GitHub checks and task evidence", async () => {
    tasks = [{ _id: "task_1", refId: "WEB-12", name: "Search", taskType: { key: "task", name: "Task", icon: "circle", color: "gray" }, isArchived: false }];
    taskChecks = { checklists: [], checklistId: null, checks: [{ key: "tests", label: "All tests pass", added: false, results: [] }] };
    render(reader());
    await screen.findByText("Commits: 1");
    const order = ["GitHub checks", "WEB-12 evidence", "Commits"].map((name) => screen.getByRole("region", { name }));
    expect(order.map((region) => region.compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING)).toEqual([4, 4, 0]);
  });

  test("comments show the author's GitHub avatar", async () => {
    render(reader());
    const body = await screen.findByText("Nice work");
    expect(body.closest("article")?.querySelector("img")?.getAttribute("src")).toBe("https://avatars.githubusercontent.com/u/2");
  });

  test("images in comments and the description sit inline with their text, as on GitHub (OS-2403)", async () => {
    stored = { pullRequest: { ...pullRequest, description: "![Ready](ready.svg) Ready" } };
    readOverview.mockResolvedValue({
      ...overview,
      comments: [{ ...overview.comments[0], body: "![Ready](ready.svg) Deployed" }],
    });
    render(reader());
    await screen.findByText(/Deployed/);
    const images = screen.getAllByAltText("Ready");
    expect(images).toHaveLength(2);
    for (const image of images) expect(image.className).toContain("inline");
  });

  test("while the PR loads, the skeleton keeps the reader's header, tab row, and overview cards", () => {
    stored = { pullRequest: null };
    readDiff.mockReturnValue(new Promise(() => {}));
    render(reader());
    const skeleton = screen.getByLabelText("Loading pull request");
    expect(skeleton.querySelector("header.h-14.border-b")).toBeTruthy();
    expect(skeleton.querySelector(".h-\\[41px\\].border-b")).toBeTruthy();
    expect(skeleton.contains(screen.getByLabelText("Loading checks"))).toBe(true);
    expect(skeleton.contains(screen.getByLabelText("Loading commits"))).toBe(true);
    expect(skeleton.contains(screen.getByLabelText("Loading activity"))).toBe(true);
  });

  test("while the overview loads, Activity keeps its header, a comment row, and an activity rail", () => {
    readOverview.mockReturnValue(new Promise(() => {}));
    render(reader());
    const activity = screen.getByLabelText("Loading activity");
    expect(within(activity).getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(activity.querySelector(".size-8.rounded-full")).toBeTruthy();
    // The rail is a skeleton too, running only between the pulsing circles, never behind them.
    const rail = activity.querySelector('[data-slot="skeleton"].w-px');
    expect(rail).toBeTruthy();
    expect(rail?.className).not.toContain("absolute");
    expect(rail?.previousElementSibling?.querySelector(".size-5.rounded-full")).toBeTruthy();
    expect(rail?.nextElementSibling?.querySelector(".size-5.rounded-full")).toBeTruthy();
  });

  test("loading placeholders are shaped like the cards they stand for", () => {
    readOverview.mockReturnValue(new Promise(() => {}));
    render(reader());
    const placeholders = ["Loading checks", "Loading commits"].map((label) => screen.getByLabelText(label));
    expect(placeholders.every((placeholder) => placeholder.className.includes("border"))).toBe(true);
  });
});

describe("PullRequestReader overview", () => {
  test("shows commits, failing checks with passed ones folded, reviewers, comments, and referenced tasks", async () => {
    tasks = [{ _id: "task_1", refId: "WEB-12", name: "Search", taskType: { key: "task", name: "Task", icon: "circle", color: "gray" }, isArchived: false }];
    render(reader());
    expect(await screen.findByText("Commits: 1")).toBeTruthy();
    expect(screen.getByText("GitHub checks: 1/2")).toBeTruthy();
    expect(screen.getByLabelText("lint failed")).toBeTruthy();
    expect(screen.queryByLabelText("test passed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 passed checks" }));
    expect(screen.getByLabelText("test passed")).toBeTruthy();
    expect(within(screen.getByLabelText("Pull request properties")).getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Nice work")).toBeTruthy();
    expect(screen.getByRole("link", { name: /WEB-12.*Search/ }).getAttribute("href")).toBe("/o/org/WEB?task=WEB-12");
    expect(screen.queryByRole("region", { name: "Conflicts" })).toBeNull();
  });

  test("Convoy's own check runs stay out of the GitHub checks card but count in Merge status, as on GitHub (OS-2401)", async () => {
    readOverview.mockResolvedValue({
      ...overview,
      checks: [
        { id: "run:1", name: "test", state: "success", summary: "Passed", url: null, fromConvoy: false },
        { id: "run:3", name: "Merge risk", state: "failure", summary: "High", url: null, fromConvoy: true },
      ],
    });
    render(reader());
    const card = await screen.findByRole("region", { name: "GitHub checks" });
    expect(within(card).getByText("GitHub checks: 1/1")).toBeTruthy();
    expect(within(card).queryByLabelText("Merge risk failed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Merge status" }));
    expect(screen.getByLabelText("Merge risk failed")).toBeTruthy();
  });

  test("a conflicting PR gets the Conflicts card with Resolve on GitHub", async () => {
    readOverview.mockResolvedValue({ ...overview, mergeable: "conflicting" });
    render(reader());
    const card = await screen.findByRole("region", { name: "Conflicts" });
    expect(card.textContent).toContain("Conflicts with main");
    expect(screen.getByRole("link", { name: "Resolve on GitHub" }).getAttribute("href")).toBe("https://github.com/acme/web/pull/7/conflicts");
  });

  test("Shift+J and Shift+K open the Layer below and above", async () => {
    const layer = (number: number, position: number) => ({ ...pullRequest, _id: `pr_${number}`, number, stack: { id: 9, number: 12, size: 3, position } });
    stored = { pullRequest: layer(7, 2) };
    layers = [layer(6, 1), layer(7, 2), layer(8, 3)];
    render(reader());
    await screen.findByText("Commits: 1");
    expect(screen.getByRole("button", { name: /Stack 2\/3/ })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "K", code: "KeyK", shiftKey: true });
    fireEvent.keyDown(document.body, { key: "J", code: "KeyJ", shiftKey: true });
    expect(push.mock.calls.map(([target]) => target.href ?? target)).toEqual([
      appRoute.projectPullRequest("org", "WEB", "repo_1", 8),
      appRoute.projectPullRequest("org", "WEB", "repo_1", 6),
    ]);
  });
});

describe("PullRequestReader threads (OS-2193)", () => {
  const status = {
    configured: true,
    installUrl: null,
    canManage: false,
    setup: null,
    connections: [{ repositoryId: "repo_1", status: "active", repository: { owner: "acme", name: "web", htmlUrl: "https://github.com/acme/web" } }],
  };
  const connected = () => (
    <PullRequestReader
      projectId={"project_1" as Id<"projects">}
      repositoryId="repo_1"
      number={7}
      status={status as never}
      hrefFor={(repositoryId, number) => appRoute.projectPullRequest("org", "WEB", repositoryId, number)}
      organizationSlug="org"
      projectAlias="WEB"
    />
  );

  test("the loading placeholders sit below Pull request checks, where their cards render", () => {
    pullRequestChecks = {
      checklists: [{ _id: "pr", name: "PR", isDefault: false, checkKeys: ["risk"], taskTypeKeys: [] }],
      checklistId: "pr",
      followsTypeDefault: false,
      catalog: [],
      checks: [{ key: "risk", label: "Merge risk", instruction: "", added: false, results: [] }],
      pullRequest: { headSha: "head-1" },
    };
    readOverview.mockReturnValue(new Promise(() => {}));
    render(connected());
    const card = screen.getByText("Pull request checks: 0/1");
    expect(card.compareDocumentPosition(screen.getByLabelText("Loading checks")) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4);
  });

  beforeEach(() => {
    seeded.length = 0;
    Element.prototype.scrollIntoView = vi.fn();
    prThreads = [
      { _id: "thread_1", title: "Review #7", status: "completed", cliType: "codex", createdAt: Date.now(), lastActivityAt: Date.now(), hasUnread: false, isDone: false },
    ];
  });

  test("lists attached threads, starts threads with the PR, and Fix drafts the failed checks", async () => {
    render(connected());
    expect(await screen.findByText("GitHub checks: 1/2")).toBeTruthy();

    // The Threads property row and the Activity card.
    expect(screen.getByLabelText("Pull request properties").textContent).toContain("Review #7");
    expect(screen.getByText("Open thread Review #7")).toBeTruthy();
    expect(screen.getByLabelText("Thread composer").textContent).toContain("acme/web#7");
    // The header refreshes from GitHub instead of starting a thread; Activity's composer does that.
    expect(screen.queryByRole("link", { name: "Start thread" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh from GitHub" }));
    await waitFor(() => expect(readDiff).toHaveBeenCalledTimes(2));
    // "+" sits on the Threads label, so the first row keeps its full width.
    expect(screen.getByRole("button", { name: "Start a thread" }).closest("h3")?.textContent).toBe("Threads");

    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(seeded).toEqual(["Fix the failing GitHub checks:\n- lint: 2 errors"]);
  });

  test("Fix on an Evidence card works while the GitHub overview failed", async () => {
    readOverview.mockRejectedValue(new Error("GitHub is down"));
    tasks = [{ _id: "task_1", refId: "WEB-12", name: "Search", taskType: { key: "task", name: "Task", icon: "circle", color: "gray" }, isArchived: false }];
    taskChecks = {
      checklists: [],
      checklistId: null,
      checks: [{ key: "tests", label: "All tests pass", added: false, results: [{ _id: "r1", status: "failed", note: "2 failing", files: [], createdAt: Date.now() }] }],
    };
    render(connected());
    expect(await screen.findByText("GitHub is down")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fix" }));

    expect(screen.getByLabelText("Thread composer")).toBeTruthy();
    expect(seeded).toEqual(["Fix the failed WEB-12 task checks:\n- All tests pass: 2 failing"]);
  });

  test("Fix seeds the draft once: switching the sort does not re-apply it", async () => {
    render(connected());
    fireEvent.click(await screen.findByRole("button", { name: "Fix" }));

    fireEvent.pointerDown(screen.getByRole("button", { name: /^Filter timeline/ }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Oldest first" }));

    expect(screen.getByLabelText("Thread composer")).toBeTruthy();
    expect(seeded).toHaveLength(1);
  });
});

describe("PullRequestReader GitHub comments (OS-2183)", () => {
  const status = {
    configured: true,
    installUrl: null,
    canManage: false,
    setup: null,
    connections: [{ repositoryId: "repo_1", status: "active", repository: { owner: "acme", name: "web", htmlUrl: "https://github.com/acme/web" } }],
  };
  const connected = () => (
    <PullRequestReader
      projectId={"project_1" as Id<"projects">}
      repositoryId="repo_1"
      number={7}
      status={status as never}
      hrefFor={(repositoryId, number) => appRoute.projectPullRequest("org", "WEB", repositoryId, number)}
      organizationSlug="org"
      projectAlias="WEB"
    />
  );
  const linkedAs = (account: { login: string; githubUserId: number; status: "active" | "reconnect" } | null) => {
    linkedAccounts = {
      configured: true,
      organizations: [{ organizationId: "org_1", organizationSlug: "org", organizationName: "Org", account: account && { avatarUrl: null, ...account } }],
    };
  };

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    prThreads = [];
  });

  test("without a Linked GitHub account, the trigger connects one and comes back to this PR", async () => {
    linkedAs(null);
    beginLink.mockResolvedValue({ authorizeUrl: "https://github.com/login/oauth/authorize?state=x" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(connected());
    await screen.findByText("Nice work");

    expect(screen.getByLabelText("Thread composer")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Leave a comment on GitHub...")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub to comment..." }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?state=x"));
    expect(beginLink).toHaveBeenCalledWith({ organizationId: "org_1", returnTo: "/o/org/WEB/pull-requests?repo=repo_1&pr=7" });
    expect(readPermission).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("a revoked account asks to reconnect", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "reconnect" });
    render(connected());
    expect(await screen.findByRole("button", { name: "Reconnect GitHub to comment..." })).toBeTruthy();
  });

  test("a linked member comments, and the comment joins Activity from GitHub's answer", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    createComment.mockResolvedValue({ id: 9, author: "maya", authorId: 42, authorAvatarUrl: null, body: "Ship it", createdAt: Date.now(), url: "https://github.com/c/9" });
    render(connected());
    await screen.findByText("Nice work");

    // The comment side is a trigger away.
    fireEvent.click(screen.getByRole("button", { name: "Add comment..." }));
    const input = screen.getByPlaceholderText("Leave a comment on GitHub...");
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));

    expect(await screen.findByText("Ship it")).toBeTruthy();
    expect(createComment).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, body: "Ship it" });
    expect(readPermission).toHaveBeenCalledTimes(1);
    // Only the viewer's own comment can be edited or deleted.
    expect(screen.getAllByRole("button", { name: "Comment actions" })).toHaveLength(1);
  });

  test("@ offers the PR's people, and there's no attach button until Convoy can host the file", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readOverview.mockResolvedValue({
      ...overview,
      requestedReviewers: ["sam"],
      assignees: [{ login: "jo", avatarUrl: null }],
      comments: [...overview.comments, { ...overview.comments[0], id: 3, author: "vercel[bot]", authorId: 5, body: "Deployed" }],
    });
    const { container } = render(connected());
    await screen.findByText("Nice work");
    fireEvent.click(screen.getByRole("button", { name: "Add comment..." }));
    const input = screen.getByPlaceholderText("Leave a comment on GitHub...") as HTMLTextAreaElement;

    input.focus();
    fireEvent.change(input, { target: { value: "@", selectionStart: 1, selectionEnd: 1 } });
    // The author, reviewers, assignees, then commenters, the viewer (maya) among them; never a bot.
    expect(within(screen.getByRole("listbox", { name: "Mention" })).getAllByRole("option").map((option) => option.lastChild?.textContent)).toEqual([
      "octocat",
      "maya",
      "sam",
      "jo",
      "alex",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "alex" }));
    expect(input.value).toBe("@alex ");

    expect(screen.queryByRole("button", { name: "Attach file" })).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  test("@ offers someone whose review was dismissed, and a requested team's name never hides a user", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readOverview.mockResolvedValue({ ...overview, reviews: [{ ...overview.reviews[0], author: "dana", state: "dismissed" }], requestedTeams: ["alex"] });
    render(connected());
    await screen.findByText("Nice work");
    fireEvent.click(screen.getByRole("button", { name: "Add comment..." }));
    const input = screen.getByPlaceholderText("Leave a comment on GitHub...") as HTMLTextAreaElement;
    input.focus();
    fireEvent.change(input, { target: { value: "@", selectionStart: 1, selectionEnd: 1 } });
    expect(screen.getAllByRole("option").map((option) => option.lastChild?.textContent)).toEqual(["octocat", "dana", "alex"]);
  });

  test("the author edits and deletes their own comment on GitHub", async () => {
    linkedAs({ login: "alex", githubUserId: 2, status: "active" });
    updateComment.mockResolvedValue({ ...overview.comments[0], body: "Nicer work" });
    removeComment.mockResolvedValue(null);
    render(connected());
    await screen.findByText("Nice work");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Comment actions" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit comment"), { target: { value: "Nicer work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Nicer work")).toBeTruthy();
    expect(updateComment).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, commentId: 2, body: "Nicer work" });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Comment actions" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Nicer work")).toBeNull());
    expect(removeComment).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, commentId: 2 });
  });

  test("an account GitHub gives no access to the repository can't comment", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("none");
    render(connected());
    const trigger = await screen.findByRole("button", { name: "@maya has no access to this repository on GitHub" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByPlaceholderText("Leave a comment on GitHub...")).toBeNull();
  });

  const openMenu = async (label: string) => {
    fireEvent.pointerDown(await screen.findByRole("button", { name: label }), { button: 0, pointerType: "mouse" });
    return screen.findByRole("menu");
  };

  test("an open PR's More actions run on GitHub as the member", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("write");
    updateState.mockResolvedValue(null);
    render(connected());
    await screen.findByText("Nice work");

    const menu = await openMenu("More actions");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Convert to draft", "Close pull request", "Archive"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close pull request" }));
    await waitFor(() => expect(updateState).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, change: "close" }));
  });

  test("actions GitHub's role doesn't allow stay visible, disabled with the reason", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("triage");
    stored = { pullRequest: { ...pullRequest, draft: true } };
    render(connected());
    await screen.findByText("Nice work");

    await waitFor(() => expect((screen.getByRole("button", { name: "Ready for review" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole("button", { name: "Ready for review" }).parentElement?.title).toBe("Needs write access");
    const menu = await openMenu("More actions");
    expect(within(menu).getByRole("menuitem", { name: "Close pull request" }).getAttribute("aria-disabled")).toBeNull();

    readPermission.mockResolvedValue("read");
    cleanup();
    render(connected());
    const closeItem = within(await openMenu("More actions")).getByRole("menuitem", { name: /Close pull request/ });
    await waitFor(() => expect(closeItem.textContent).toBe("Close pull requestNeeds triage access"));
    expect(closeItem.getAttribute("aria-disabled")).toBe("true");
  });

  test("without a Linked GitHub account the actions and Submit review open the connect popup", async () => {
    linkedAs(null);
    stored = { pullRequest: { ...pullRequest, state: "closed" } };
    const view = render(connected());
    const connectDialog = () => screen.findByRole("dialog", { name: "Connect your GitHub account" });
    const closeDialog = async () => {
      fireEvent.click(within(await connectDialog()).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Connect your GitHub account" })).toBeNull());
    };
    const reopen = (await screen.findByRole("button", { name: "Reopen" })) as HTMLButtonElement;
    expect(reopen.disabled).toBe(false);
    fireEvent.click(reopen);
    await closeDialog();

    const item = within(await openMenu("More actions")).getByRole("menuitem", { name: "Archive" });
    expect(item.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(item);
    await closeDialog();

    const submit = screen.getAllByRole("button", { name: /^Submit review/ })[0] as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await closeDialog();
    expect(updateState).not.toHaveBeenCalled();
    void view;
  });

  test("an Archived PR offers only Unarchive and locks its conversation", async () => {
    linkedAs({ login: "alex", githubUserId: 2, status: "active" });
    stored = { pullRequest: { ...pullRequest, state: "closed", archived: true } };
    render(connected());
    await screen.findByText("Nice work");

    expect(screen.getByRole("button", { name: "Unarchive" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect((screen.getByRole("button", { name: "This pull request is archived. Unarchive it to comment." }) as HTMLButtonElement).disabled).toBe(true);
    // alex wrote the comment, but an archived conversation can't be edited.
    expect(screen.queryByRole("button", { name: "Comment actions" })).toBeNull();
  });

  test("Status is a select of the states GitHub can move the PR to", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("triage");
    updateState.mockResolvedValue(null);
    stored = { pullRequest: { ...pullRequest, draft: true } };
    render(connected());
    await screen.findByText("Nice work");

    const properties = screen.getByRole("complementary", { name: "Pull request properties" });
    fireEvent.pointerDown(within(properties).getByRole("button", { name: "Status: Draft" }), { button: 0, pointerType: "mouse" });
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["Draft", "OpenNeeds write access", "Closed", "Archived"]);
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(items[1].getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Closed" }));
    await waitFor(() => expect(updateState).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, change: "close" }));
  });

  test("an Archived PR's Status offers its state back, which unarchives it", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("triage");
    updateState.mockResolvedValue(null);
    stored = { pullRequest: { ...pullRequest, state: "closed", archived: true } };
    render(connected());
    await screen.findByText("Nice work");

    const properties = screen.getByRole("complementary", { name: "Pull request properties" });
    fireEvent.pointerDown(within(properties).getByRole("button", { name: "Status: Archived" }), { button: 0, pointerType: "mouse" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["Archived", "Closed"]);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Closed" }));
    await waitFor(() => expect(updateState).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, change: "unarchive" }));
  });

  test("Assignees picks from GitHub's assignable people and shows GitHub's answer", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("triage");
    // GitHub searches; "sam" is past the first page.
    listAssignable.mockImplementation(({ query }: { query?: string }) =>
      Promise.resolve(query === "sa" ? [{ login: "sam", avatarUrl: null }] : [{ login: "maya", avatarUrl: null }])
    );
    updateAssignee.mockResolvedValue([{ login: "sam", avatarUrl: null }]);
    render(connected());
    await screen.findByText("Nice work");

    await waitFor(() => expect((screen.getByRole("button", { name: "Edit assignees" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Edit assignees" }));
    // The task Status dropdown's search input.
    const search = await screen.findByPlaceholderText("Search people...");
    await screen.findByRole("button", { name: "maya, not assigned" });
    fireEvent.change(search, { target: { value: "sa" } });
    fireEvent.click(await screen.findByRole("button", { name: "sam, not assigned" }));
    expect(listAssignable).toHaveBeenLastCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, query: "sa" });
    expect(screen.queryByRole("button", { name: "maya, not assigned" })).toBeNull();
    expect(updateAssignee).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, login: "sam", assigned: true });
    const properties = screen.getByRole("complementary", { name: "Pull request properties" });
    expect(await within(properties).findByText("sam")).toBeTruthy();
  });

  test("Assignees waits for GitHub's answer before taking another edit", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("triage");
    listAssignable.mockResolvedValue([{ login: "sam", avatarUrl: null }]);
    let answer!: (assignees: unknown[]) => void;
    updateAssignee.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(connected());
    await screen.findByText("Nice work");

    const edit = () => screen.getByRole("button", { name: "Edit assignees" }) as HTMLButtonElement;
    await waitFor(() => expect(edit().disabled).toBe(false));
    fireEvent.click(edit());
    fireEvent.click(await screen.findByRole("button", { name: "sam, not assigned" }));
    await waitFor(() => expect(edit().disabled).toBe(true));
    await act(async () => answer([{ login: "sam", avatarUrl: null }]));
    expect(edit().disabled).toBe(false);
  });

  test("a comment draft survives Reconnect and the round trip to GitHub", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    const { rerender } = render(connected());
    await screen.findByText("Nice work");
    fireEvent.change(screen.getByPlaceholderText("Leave a comment on GitHub..."), { target: { value: "Half a thought" } });

    linkedAs({ login: "maya", githubUserId: 42, status: "reconnect" });
    rerender(connected());
    expect(await screen.findByRole("button", { name: "Reconnect GitHub to comment..." })).toBeTruthy();
    cleanup();

    // Back from GitHub: a fresh page load.
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    render(connected());
    expect(((await screen.findByPlaceholderText("Leave a comment on GitHub...")) as HTMLTextAreaElement).value).toBe("Half a thought");
  });

  test("a comment draft belongs to its member: another member on the same browser starts empty", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    render(connected());
    await screen.findByText("Nice work");
    fireEvent.change(screen.getByPlaceholderText("Leave a comment on GitHub..."), { target: { value: "Maya's draft" } });
    cleanup();

    linkedAs({ login: "sam", githubUserId: 7, status: "active" });
    render(connected());
    await screen.findByText("Nice work");
    expect((screen.getByPlaceholderText("Leave a comment on GitHub...") as HTMLTextAreaElement).value).toBe("");
    cleanup();

    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    render(connected());
    await screen.findByText("Nice work");
    expect((screen.getByPlaceholderText("Leave a comment on GitHub...") as HTMLTextAreaElement).value).toBe("Maya's draft");
  });

  test("a posted comment clears its draft", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    createComment.mockResolvedValue({ id: 9, author: "maya", authorId: 42, authorAvatarUrl: null, body: "Done", createdAt: Date.now(), url: "https://github.com/c/9" });
    render(connected());
    await screen.findByText("Nice work");
    fireEvent.change(screen.getByPlaceholderText("Leave a comment on GitHub..."), { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));
    await screen.findByText("Done");
    cleanup();
    render(connected());
    expect(((await screen.findByPlaceholderText("Leave a comment on GitHub...")) as HTMLTextAreaElement).value).toBe("");
  });

  test("Activity opens on the thread side, as in the task sidebar, with Add comment... as the trigger", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    render(connected());
    await screen.findByText("Nice work");
    expect(screen.getByLabelText("Thread composer").parentElement?.className).toContain("block");
    expect(screen.getByPlaceholderText("Leave a comment on GitHub...").closest(".hidden")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add comment..." }));
    expect(screen.getByPlaceholderText("Leave a comment on GitHub...").closest(".hidden")).toBeNull();
    expect(screen.getByRole("button", { name: "Start a thread..." })).toBeTruthy();
  });

  test("Fix switches Activity to the thread side", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    render(connected());
    fireEvent.click(await screen.findByRole("button", { name: "Fix" }));
    expect(screen.getByLabelText("Thread composer").parentElement?.className).toContain("block");
    expect(screen.getByRole("button", { name: "Add comment..." })).toBeTruthy();
  });

  const openMergeStatus = async () => {
    await screen.findByText("Nice work");
    fireEvent.click(screen.getByRole("button", { name: "Merge status" }));
    return screen.findByRole("dialog", { name: "Merge status" });
  };
  const mergeButton = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

  test("Merge confirms with warnings and the commit message, reads Merging… until GitHub answers, and sends only an edited title", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("write");
    let answer!: (result: unknown) => void;
    mergePullRequest.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(connected());
    await openMergeStatus();
    await waitFor(() => expect(mergeButton("Squash and merge").disabled).toBe(false));
    fireEvent.click(mergeButton("Squash and merge"));

    const confirm = await screen.findByRole("dialog", { name: "Squash and merge #7" });
    expect(within(confirm).getByText("1 check failed.")).toBeTruthy();
    const message = within(confirm).getByLabelText("Commit message") as HTMLTextAreaElement;
    expect(message.tagName).toBe("TEXTAREA");
    expect(message.value).toBe("Add search (#7)");
    // The first line is the commit title, the rest its body.
    fireEvent.change(message, { target: { value: "Add the search box\n\nWith keyboard support.\nAnd tests." } });
    fireEvent.click(within(confirm).getByRole("checkbox", { name: "Delete the branch after merging" }));
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirm squash and merge" }));
    expect(mergePullRequest).toHaveBeenCalledWith({
      projectId: "project_1",
      repositoryId: "repo_1",
      number: 7,
      method: "squash",
      headSha: "head-1",
      commitTitle: "Add the search box",
      commitMessage: "With keyboard support.\nAnd tests.",
      layersBelow: undefined,
      deleteBranch: true,
    });
    expect(within(confirm).getByRole("button", { name: /Merging…/ })).toBeTruthy();
    expect(within(confirm).queryByRole("button", { name: "Cancel" })).toBeNull();
    await act(async () => answer({ status: "merged", branchesKept: [] }));
    expect(screen.queryByRole("dialog", { name: "Squash and merge #7" })).toBeNull();
  });

  test("the merge menu offers only the repository's allowed methods; rebase has no commit message", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("write");
    readOverview.mockResolvedValue({ ...overview, mergeSettings: { methods: ["merge", "rebase"], deleteBranchOnMerge: true } });
    mergePullRequest.mockResolvedValue({ status: "merged", branchesKept: [] });
    render(connected());
    await openMergeStatus();
    // Squash isn't allowed, so the first allowed method leads.
    await waitFor(() => expect(mergeButton("Merge pull request").disabled).toBe(false));
    fireEvent.pointerDown(mergeButton("Merge method"), { button: 0, pointerType: "mouse" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
      "Create a merge commitAdds the commit to main with a merge commit.",
      "Rebase and mergeAdds the commit on top of main, without a merge commit.",
    ]);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Rebase and merge/ }));
    fireEvent.click(mergeButton("Rebase and merge"));

    const confirm = await screen.findByRole("dialog", { name: "Rebase and merge #7" });
    expect(within(confirm).queryByLabelText("Commit message")).toBeNull();
    // The repository deletes merged branches itself.
    expect((within(confirm).getByRole("checkbox", { name: "Delete the branch after merging" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirm rebase and merge" }));
    expect(mergePullRequest).toHaveBeenCalledWith(expect.objectContaining({ method: "rebase", commitTitle: undefined, deleteBranch: false }));
  });

  test("the picked merge method is remembered for the member's GitHub account", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("write");
    render(connected());
    await openMergeStatus();
    await waitFor(() => expect(mergeButton("Squash and merge").disabled).toBe(false));
    fireEvent.pointerDown(mergeButton("Merge method"), { button: 0, pointerType: "mouse" });
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitemradio", { name: /Rebase and merge/ }));
    expect(mergeButton("Rebase and merge")).toBeTruthy();
    cleanup();

    render(connected());
    await openMergeStatus();
    expect(await screen.findByRole("button", { name: "Rebase and merge" })).toBeTruthy();
    cleanup();

    linkedAs({ login: "sam", githubUserId: 7, status: "active" });
    render(connected());
    await openMergeStatus();
    expect(await screen.findByRole("button", { name: "Squash and merge" })).toBeTruthy();
  });

  test("a mid-stack Layer merges the open Layers below it, and a draft below blocks it", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("write");
    mergePullRequest.mockResolvedValue({ status: "merged", branchesKept: [] });
    const stack = (position: number) => ({ id: 70, number: 12, size: 3, position });
    stored = { pullRequest: { ...pullRequest, stack: stack(2) } };
    const below = { ...pullRequest, _id: "pr_1", number: 6, title: "Add index", stack: stack(1) };
    layers = [below, { ...pullRequest, stack: stack(2) }, { ...pullRequest, _id: "pr_3", number: 8, title: "Add filters", stack: stack(3) }];
    const view = render(connected());
    const popover = await openMergeStatus();
    expect(within(popover).getByText("Merges #6 first")).toBeTruthy();
    await waitFor(() => expect(mergeButton("Squash and merge 2 pull requests").disabled).toBe(false));
    fireEvent.click(mergeButton("Squash and merge 2 pull requests"));

    const confirm = await screen.findByRole("dialog", { name: "Squash and merge 2 pull requests" });
    expect(within(within(confirm).getByRole("list", { name: "Pull requests to merge" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "#6Add index",
      "#7Add search",
    ]);
    expect(within(confirm).queryByLabelText("Commit message")).toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirm squash and merge" }));
    expect(mergePullRequest).toHaveBeenCalledWith(expect.objectContaining({ layersBelow: [6], commitTitle: undefined }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Squash and merge 2 pull requests" })).toBeNull());

    layers = [{ ...below, draft: true }, ...layers.slice(1)];
    view.rerender(connected());
    fireEvent.click(screen.getByRole("button", { name: "Merge status" }));
    const blocked = await screen.findByRole("dialog", { name: "Merge status" });
    expect(within(blocked).getAllByText("#6 is a draft")).toHaveLength(2);
    expect(mergeButton("Squash and merge 2 pull requests").disabled).toBe(true);
  });

  test("without a Linked GitHub account, Merge explains why and connects one, coming back to this PR", async () => {
    linkedAs(null);
    beginLink.mockResolvedValue({ authorizeUrl: "https://github.com/login/oauth/authorize?state=x" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(connected());
    const popover = await openMergeStatus();
    expect(within(popover).queryByText("Connect GitHub first")).toBeNull();
    expect(mergeButton("Squash and merge").disabled).toBe(false);
    fireEvent.click(mergeButton("Squash and merge"));

    const dialog = await screen.findByRole("dialog", { name: "Connect your GitHub account" });
    expect(within(dialog).getByText(/personal GitHub account/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?state=x"));
    expect(beginLink).toHaveBeenCalledWith({ organizationId: "org_1", returnTo: "/o/org/WEB/pull-requests?repo=repo_1&pr=7" });
    expect(mergePullRequest).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("Merge needs write access; Update branch runs as the member and clears the behind row", async () => {
    linkedAs({ login: "maya", githubUserId: 42, status: "active" });
    readPermission.mockResolvedValue("triage");
    readOverview.mockResolvedValue({ ...overview, behindBy: 2 });
    const view = render(connected());
    let popover = await openMergeStatus();
    await waitFor(() => expect(within(popover).getByText("Needs write access")).toBeTruthy());
    expect(mergeButton("Squash and merge").disabled).toBe(true);
    expect((within(popover).getByRole("button", { name: "Update branch" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    void view;

    readPermission.mockResolvedValue("write");
    updateBranch.mockResolvedValue(null);
    render(connected());
    popover = await openMergeStatus();
    await waitFor(() => expect((within(popover).getByRole("button", { name: "Update branch" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(popover).getByRole("button", { name: "Update branch" }));
    await waitFor(() => expect(within(popover).queryByText("This branch is out-of-date with the base branch")).toBeNull());
    expect(updateBranch).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", number: 7, headSha: "head-1" });
    // GitHub rewrote the head, so mergeability is unknown until Refresh.
    expect(within(popover).getByText("Checking mergeability…")).toBeTruthy();
    expect(mergeButton("Squash and merge").disabled).toBe(true);
  });
});

describe("PullRequestReader reviews (OS-2186)", () => {
  const status = {
    configured: true,
    installUrl: null,
    canManage: false,
    setup: null,
    connections: [{ repositoryId: "repo_1", status: "active", repository: { owner: "acme", name: "web", htmlUrl: "https://github.com/acme/web" } }],
  };
  const connected = () => (
    <PullRequestReader
      projectId={"project_1" as Id<"projects">}
      repositoryId="repo_1"
      number={7}
      status={status as never}
      hrefFor={(repositoryId, number) => appRoute.projectPullRequest("org", "WEB", repositoryId, number)}
      organizationSlug="org"
      projectAlias="WEB"
    />
  );
  const linkedAs = (login: string) => {
    linkedAccounts = {
      configured: true,
      organizations: [{ organizationId: "org_1", organizationSlug: "org", organizationName: "Org", account: { avatarUrl: null, login, githubUserId: 42, status: "active" } }],
    };
  };
  const target = { projectId: "project_1", repositoryId: "repo_1", number: 7 };
  const posted = (id: number, body: string) => ({
    id,
    author: "maya",
    authorAvatarUrl: null,
    body,
    createdAt: Date.now(),
    url: `https://github.com/rc/${id}`,
    path: "src/search.ts",
    line: 1,
    side: "RIGHT",
    outdated: false,
    quote: [{ kind: "add", number: 1, text: "search()" }],
  });
  const review = (state: string, body = "") => ({ id: 70, author: "maya", authorAvatarUrl: null, state, submittedAt: Date.now(), body, url: "https://github.com/r/70" });

  async function openDiffConnected() {
    render(connected());
    openTab("Diff");
    return screen.findByRole("button", { name: "Comment on line 1" });
  }

  /** The header's button, which opens the review popover. */
  const reviewButton = () => screen.getAllByRole("button", { name: /^Submit review/ })[0] as HTMLButtonElement;
  const popover = () => screen.getByRole("dialog", { name: "Finish your review" });

  function writeLineComment(text: string) {
    fireEvent.change(screen.getByRole("textbox", { name: "Line comment" }), { target: { value: text } });
  }

  test("a line comment starts a review, which the Review popover submits with its verdict at the displayed head", async () => {
    linkedAs("maya");
    submitReview.mockResolvedValue({ review: review("approved", "Ship it"), comments: [posted(80, "Rename this")] });
    fireEvent.click(await openDiffConnected());
    writeLineComment("Rename this");
    fireEvent.click(screen.getByRole("button", { name: "Start a review" }));
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Rename this")).toBeTruthy();
    // The draft outlives a reload, under the member's GitHub account.
    expect(localStorage.getItem("convoy:github:review-draft:org:WEB:repo_1:7:42")).toContain("Rename this");

    // The header names what its count counts.
    expect(screen.getByRole("button", { name: "Submit review, 1 pending comment" })).toBeTruthy();
    fireEvent.click(reviewButton());
    fireEvent.change(await screen.findByRole("textbox", { name: "Review comment" }), { target: { value: "Ship it" } });
    fireEvent.click(screen.getByRole("radio", { name: "Approve" }));
    fireEvent.click(within(popover()).getByRole("button", { name: "Submit review" }));
    await waitFor(() =>
      expect(submitReview).toHaveBeenCalledWith({
        ...target,
        headSha: "head-1",
        event: "approve",
        body: "Ship it",
        comments: [{ path: "src/search.ts", line: 1, side: "RIGHT", body: "Rename this" }],
      })
    );
    // GitHub's comment replaces the pending one on its line, and the draft is gone.
    await waitFor(() => expect(screen.queryByText("Pending")).toBeNull());
    expect(screen.getByText("Rename this")).toBeTruthy();
    expect(localStorage.getItem("convoy:github:review-draft:org:WEB:repo_1:7:42")).toBeNull();
  });

  test("Add single comment posts at once as a comment review", async () => {
    linkedAs("maya");
    submitReview.mockResolvedValue({ review: review("commented"), comments: [posted(81, "Typo")] });
    fireEvent.click(await openDiffConnected());
    writeLineComment("Typo");
    fireEvent.click(screen.getByRole("button", { name: "Add single comment" }));
    await waitFor(() =>
      expect(submitReview).toHaveBeenCalledWith({ ...target, headSha: "head-1", event: "comment", body: "", comments: [{ path: "src/search.ts", line: 1, side: "RIGHT", body: "Typo" }] })
    );
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Line comment" })).toBeNull());
    expect(screen.getByText("Typo")).toBeTruthy();
    expect(screen.queryByText("Pending")).toBeNull();
  });

  test("the author can only comment: Approve and Request changes say why", async () => {
    linkedAs("octocat");
    render(connected());
    await screen.findByText("Nice work");
    fireEvent.click(reviewButton());
    expect(((await screen.findByRole("radio", { name: "Approve" })) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("You can't approve your own pull request.")).toBeTruthy();
    expect(screen.getByText("You can't request changes on your own pull request.")).toBeTruthy();
    // A comment review needs a body or a pending comment.
    expect((within(popover()).getByRole("button", { name: "Submit review" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("without a Linked GitHub account, Submit review says to connect and lines take no comments", async () => {
    render(connected());
    openTab("Diff");
    await waitFor(() => expect(screen.getByText(/\+search\(\)/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Comment on line 1" })).toBeNull();
    const button = reviewButton();
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Connect GitHub first");
  });

  test("Review waits for the displayed revision: disabled while the changes load or after they fail", async () => {
    linkedAs("maya");
    readDiff.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(connected());
    const button = reviewButton;
    await waitFor(() => expect(button().title).toBe("The changes haven't loaded yet"));
    expect(button().disabled).toBe(true);
    unmount();

    readDiff.mockRejectedValue(new Error("GitHub down"));
    render(connected());
    await waitFor(() => expect(button().title).toBe("The changes haven't loaded yet"));
    expect(button().disabled).toBe(true);
  });

  test("text typed while a review submits stays in the draft", async () => {
    linkedAs("maya");
    let answer!: (value: unknown) => void;
    submitReview.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(connected());
    await screen.findByText("Nice work");
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    fireEvent.click(reviewButton());
    const body = await screen.findByRole("textbox", { name: "Review comment" });
    fireEvent.change(body, { target: { value: "Ship it" } });
    fireEvent.click(within(popover()).getByRole("button", { name: "Submit review" }));
    fireEvent.change(body, { target: { value: "Ship it, and one more thing" } });
    await act(async () => answer({ review: review("commented", "Ship it"), comments: [] }));
    expect(localStorage.getItem("convoy:github:review-draft:org:WEB:repo_1:7:42")).toContain("Ship it, and one more thing");
  });

  test("the line editor takes no edits while its single comment posts, so nothing typed is lost", async () => {
    linkedAs("maya");
    let answer!: (value: unknown) => void;
    submitReview.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    fireEvent.click(await openDiffConnected());
    writeLineComment("First version");
    fireEvent.click(screen.getByRole("button", { name: "Add single comment" }));
    expect((screen.getByRole("textbox", { name: "Line comment" }) as HTMLTextAreaElement).disabled).toBe(true);
    await act(async () => answer({ review: review("commented"), comments: [posted(82, "First version")] }));
  });

  test("selecting lines by their numbers moves the editor there, so the highlight and the editor stay together", async () => {
    linkedAs("maya");
    fireEvent.click(await openDiffConnected());
    expect(screen.getByRole("status", { name: "Selected lines" }).textContent).toBe("1-1");
    fireEvent.click(screen.getByRole("button", { name: "Select line 3" }));
    expect(screen.getByRole("status", { name: "Selected lines" }).textContent).toBe("3-3");
    expect(within(screen.getByTestId("annotation-3")).getByRole("textbox", { name: "Line comment" })).toBeTruthy();
    expect(screen.queryByTestId("annotation-1")).toBeNull();
    // Unselecting closes the editor rather than leaving it without its line.
    fireEvent.click(screen.getByRole("button", { name: "Unselect lines" }));
    expect(screen.queryByRole("textbox", { name: "Line comment" })).toBeNull();
  });

  test("dragging the gutter + comments on a range, which posts with its first line", async () => {
    linkedAs("maya");
    submitReview.mockResolvedValue({ review: review("commented"), comments: [] });
    await openDiffConnected();
    fireEvent.click(screen.getByRole("button", { name: "Comment on lines 1–3" }));
    expect(screen.getByText("Commenting on lines 1–3")).toBeTruthy();
    writeLineComment("This loop reads twice");
    fireEvent.click(screen.getByRole("button", { name: "Start a review" }));
    fireEvent.click(reviewButton());
    fireEvent.click(within(popover()).getByRole("button", { name: /^Pending comments/ }));
    expect(within(popover()).getByText("Lines 1–3")).toBeTruthy();
    fireEvent.click(within(popover()).getByRole("button", { name: "Submit review" }));
    await waitFor(() =>
      expect(submitReview).toHaveBeenCalledWith({
        ...target,
        headSha: "head-1",
        event: "comment",
        body: "",
        comments: [{ path: "src/search.ts", startLine: 1, startSide: "RIGHT", line: 3, side: "RIGHT", body: "This loop reads twice" }],
      })
    );
  });

  test("the popover lists pending comments: each opens to its text and jumps to its line, and Discard review drops the draft", async () => {
    linkedAs("maya");
    Element.prototype.scrollIntoView = vi.fn();
    fireEvent.click(await openDiffConnected());
    writeLineComment("Rename this");
    fireEvent.click(screen.getByRole("button", { name: "Start a review" }));
    openTab("Overview");
    fireEvent.click(reviewButton());
    const list = within(popover()).getByRole("region", { name: "Pending comments" });
    // The list starts folded, as on GitHub.
    expect(within(list).queryByText("src/search.ts")).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: /^Pending comments/ }));
    expect(within(list).getByText("src/search.ts")).toBeTruthy();
    expect(within(list).getByText("Line 1")).toBeTruthy();
    expect(within(list).queryByText("Rename this")).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: "Show comment on src/search.ts" }));
    expect(within(list).getByText("Rename this")).toBeTruthy();

    fireEvent.click(within(list).getByRole("button", { name: "Go to comment on src/search.ts" }));
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Diff" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("dialog", { name: "Finish your review" })).toBeNull();

    fireEvent.click(reviewButton());
    fireEvent.change(within(popover()).getByRole("textbox", { name: "Review comment" }), { target: { value: "Overall fine" } });
    fireEvent.click(within(popover()).getByRole("button", { name: "Discard review" }));
    expect(screen.queryByText("Pending")).toBeNull();
    expect(localStorage.getItem("convoy:github:review-draft:org:WEB:repo_1:7:42")).toBeNull();
  });

  test("Mod+Enter in the review comment submits, as the button's hint says", async () => {
    linkedAs("maya");
    submitReview.mockResolvedValue({ review: review("commented", "Ship it"), comments: [] });
    render(connected());
    await screen.findByText("Nice work");
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    fireEvent.click(reviewButton());
    const body = await screen.findByRole("textbox", { name: "Review comment" });
    fireEvent.change(body, { target: { value: "Ship it" } });
    fireEvent.keyDown(body, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(submitReview).toHaveBeenCalledWith({ ...target, headSha: "head-1", event: "comment", body: "Ship it", comments: [] }));
  });

  test("submitting a review fulfills the reviewer's request, as on GitHub", async () => {
    linkedAs("maya");
    readOverview.mockResolvedValue({ ...overview, reviews: [], requestedReviewers: ["maya"] });
    submitReview.mockResolvedValue({ review: review("approved"), comments: [] });
    render(connected());
    const properties = await screen.findByRole("complementary", { name: "Pull request properties" });
    expect(await within(properties).findByText("Requested")).toBeTruthy();
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole("radio", { name: "Approve" }));
    fireEvent.click(within(popover()).getByRole("button", { name: "Submit review" }));
    expect(await within(properties).findByText("Approved")).toBeTruthy();
    expect(within(properties).queryByText("Requested")).toBeNull();
  });

  test("a requested team shows as a reviewer but is no row in the picker", async () => {
    linkedAs("maya");
    readPermission.mockResolvedValue("triage");
    readOverview.mockResolvedValue({ ...overview, requestedTeams: ["core"] });
    listAssignable.mockResolvedValue([{ login: "sam", avatarUrl: null }]);
    render(connected());
    const properties = await screen.findByRole("complementary", { name: "Pull request properties" });
    expect(await within(properties).findByText("core")).toBeTruthy();
    const button = () => screen.getByRole("button", { name: "Request reviewers" }) as HTMLButtonElement;
    await waitFor(() => expect(button().disabled).toBe(false));
    fireEvent.click(button());
    await screen.findByRole("button", { name: "sam, not requested" });
    expect(screen.queryByRole("button", { name: /^core/ })).toBeNull();
  });

  test("Reviewers requests a review from GitHub's assignable people, leaving the author out", async () => {
    linkedAs("maya");
    readPermission.mockResolvedValue("triage");
    listAssignable.mockResolvedValue([
      { login: "octocat", avatarUrl: null },
      { login: "sam", avatarUrl: null },
    ]);
    requestReviewer.mockResolvedValue(["sam"]);
    render(connected());
    await screen.findByText("Nice work");
    const button = () => screen.getByRole("button", { name: "Request reviewers" }) as HTMLButtonElement;
    await waitFor(() => expect(button().disabled).toBe(false));
    fireEvent.click(button());
    fireEvent.click(await screen.findByRole("button", { name: "sam, not requested" }));
    expect(screen.queryByRole("button", { name: /^octocat/ })).toBeNull();
    expect(requestReviewer).toHaveBeenCalledWith({ ...target, login: "sam", requested: true });
    const properties = screen.getByRole("complementary", { name: "Pull request properties" });
    expect(await within(properties).findByText("sam")).toBeTruthy();
  });
});
