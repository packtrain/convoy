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
const readDiff = vi.fn();
const readOverview = vi.fn();
const readFile = vi.fn();
const push = vi.fn();

const name = (fn: Parameters<typeof getFunctionName>[0]) => getFunctionName(fn);

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
    }[name(fn)];
  },
  useAction: (fn: Parameters<typeof getFunctionName>[0]) =>
    ({
      [name(api.integrations.github.pullRequests.readDiff)]: readDiff,
      [name(api.integrations.github.pullRequests.readOverview)]: readOverview,
      [name(api.integrations.github.pullRequests.readFile)]: readFile,
    })[name(fn)],
  useConvex: () => ({}),
}));
vi.mock("@/lib/navigation", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ location: { pathname: "/", search: "", hash: "" }, push }),
  useRouteParams: () => ({}),
}));
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({ patch }: { patch: string }) => <pre>{patch}</pre>,
  File: ({ file }: { file: { contents: string } }) => <pre>whole: {file.contents}</pre>,
}));
vi.mock("@/lib/threads/hooks/use-diff-theme", () => ({ useDiffTheme: () => ({}) }));
// Radix shows the image only after it loads, which jsdom never does.
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
  commitCount: 1,
  commits: [{ sha: "c0ffee1234", message: "Add search box", author: "octocat", committedAt: Date.now(), url: "https://github.com/c" }],
  checks: [
    { id: "run:1", name: "test", state: "success", summary: "Passed", url: null },
    { id: "run:2", name: "lint", state: "failure", summary: "2 errors", url: "https://github.com/runs/2" },
  ],
  reviews: [{ id: 1, author: "maya", authorAvatarUrl: null, state: "approved", submittedAt: Date.now(), body: "" }],
  requestedReviewers: [],
  comments: [{ id: 2, author: "alex", authorAvatarUrl: "https://avatars.githubusercontent.com/u/2", body: "Nice work", createdAt: Date.now(), url: "https://github.com/c/2" }],
  reviewComments: [],
  assignees: [],
  milestone: null,
};

function reader() {
  return (
    <PullRequestReader
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
    expect(activity.querySelector(".w-px.bg-border")).toBeTruthy();
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
