/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { appRoute } from "@/lib/navigation";
import { PullRequestBrowser, type BrowserFilters } from "./pull-request-browser";
import type { IntegrationStatus } from "./use-integration-status";

const paginatedArgs = vi.fn();
let results: unknown[] = [];
let compact = false;
let status = "Exhausted";
const setPullRequestCompactLayout = vi.fn();

vi.mock("@/lib/preferences/use-user-preferences", () => ({
  useUserPreferences: () => ({ pullRequestCompactLayout: compact, setPullRequestCompactLayout }),
}));

vi.mock("convex/react", () => ({
  usePaginatedQuery: (_fn: unknown, args: unknown) => {
    paginatedArgs(args);
    return { results, status, loadMore: vi.fn() };
  },
  useMutation: () => loadHistory,
  useAction: () => search,
}));
const loadHistory = vi.fn(async () => null);
const search = vi.fn();

afterEach(() => {
  cleanup();
  paginatedArgs.mockClear();
  results = [];
  compact = false;
  status = "Exhausted";
  connection.repository.history = { started: true, complete: false, loading: false };
  loadHistory.mockClear();
  search.mockReset();
  setPullRequestCompactLayout.mockClear();
  localStorage.clear();
});

const connection = {
  repositoryLinkId: "link_1",
  repositoryId: "repo_1",
  status: "active",
  accountLogin: "acme",
  connectedAt: 1,
  repository: { providerRepositoryId: 1, owner: "acme", name: "web", isPrivate: true, htmlUrl: "", syncStatus: "synced", openCount: 0, closedCount: 0, counting: false, history: { started: true, complete: false, loading: false } },
} as unknown as IntegrationStatus["connections"][number];

const openFilters = () => fireEvent.keyDown(screen.getByRole("button", { name: "Filter pull requests" }), { key: "Enter" });

/** Merges partial changes the way the PR page does. */
function Browser({ initial = {}, you }: { initial?: Partial<BrowserFilters>; you?: number }) {
  const [filters, setFilters] = useState<BrowserFilters>({ sort: "updated", order: "desc", query: "", repositoryId: "repo_1", ...initial });
  return (
    <PullRequestBrowser
      projectId={"project_1" as Id<"projects">}
      active={[connection]}
      you={you}
      filters={filters}
      onFiltersChange={(change) => setFilters((current) => ({ ...current, ...change }))}
      current={{ repositoryId: "repo_1", number: 1 }}
      hrefFor={(repositoryId, number) => appRoute.projectPullRequest("org", "WEB", repositoryId, number)}
      backHref={appRoute.projectPullRequests("org", "WEB")}
    />
  );
}

describe("PullRequestBrowser", () => {
  test("the filter menu has no Reset filters, and its Compact layout switch saves the preference", () => {
    render(<Browser />);
    openFilters();
    expect(screen.queryByRole("menuitem", { name: "Reset filters" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Compact layout" }));
    expect(setPullRequestCompactLayout).toHaveBeenCalledWith(true);
  });

  test("compact layout draws each PR on one line, like a compact thread row", () => {
    compact = true;
    results = [
      { _id: "pr_1", repositoryId: "repo_1", number: 1, title: "Open one", author: "sam", state: "open", draft: false, labels: [], headRef: "feat/search", baseRef: "main", providerUpdatedAt: Date.now() - 4 * 86_400_000, archived: false, conflicts: false },
    ];
    render(<Browser />);
    const row = screen.getByRole("link", { name: /Open one/ }).closest("[data-pr-row]") as HTMLElement;
    expect(row.textContent).toBe("#1Open one4d");
  });

  test.each([
    [false, "card"],
    [true, "compact"],
  ])("with compact %s, the first page's skeleton rows are %s rows", (layout, shape) => {
    compact = layout;
    status = "LoadingFirstPage";
    render(<Browser />);
    const rows = [...screen.getByLabelText("Loading pull requests").querySelectorAll("[data-pr-row-skeleton]")];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.getAttribute("data-pr-row-skeleton") === shape)).toBe(true);
  });

  test("Closed's skeleton rows are compact, like its rows, whatever the layout", () => {
    status = "LoadingFirstPage";
    render(<Browser />);
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    const skeletons = screen.getAllByLabelText("Loading pull requests");
    const closed = [...skeletons.at(-1)!.querySelectorAll("[data-pr-row-skeleton]")];
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((row) => row.getAttribute("data-pr-row-skeleton") === "compact")).toBe(true);
  });

  test("rows drop the state icon, since the Open and Drafts sections already say it", () => {
    results = [
      { _id: "pr_1", repositoryId: "repo_1", number: 1, title: "Open one", author: "sam", state: "open", draft: false, labels: [], headRef: "a", baseRef: "main", providerUpdatedAt: Date.now(), archived: false, conflicts: false },
      { _id: "pr_2", repositoryId: "repo_1", number: 2, title: "Draft one", author: "sam", state: "open", draft: true, labels: [], headRef: "b", baseRef: "main", providerUpdatedAt: Date.now(), archived: false, conflicts: false },
    ];
    render(<Browser />);
    expect(screen.getByText("Open one")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /^(Open|Draft)$/ })).toBeNull();
  });

  test("the list is resizable and remembers its width", () => {
    render(<Browser />);
    const handle = screen.getByRole("separator", { name: "Resize pull request list" });
    const width = Number(handle.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(Number(handle.getAttribute("aria-valuenow"))).toBe(width + 16);
    expect(localStorage.getItem("github:pr-browser-width")).toBe(String(width + 16));
    expect(screen.getByRole("complementary", { name: "Pull request browser" }).style.getPropertyValue("--browser-width")).toBe(`${width + 16}px`);
  });

  test("rows are laid out like thread cards: number, title, and time, then the branch", () => {
    results = [
      { _id: "pr_1", repositoryId: "repo_1", number: 1, title: "Open one", author: "sam", state: "open", draft: false, labels: [], headRef: "feat/search", baseRef: "main", providerUpdatedAt: Date.now() - 4 * 86_400_000, archived: false, conflicts: false },
    ];
    render(<Browser />);
    const link = screen.getByRole("link", { name: /Open one/ });
    const row = link.closest("[data-pr-row]") as HTMLElement;
    const [top, bottom] = [...row.querySelectorAll(":scope > div > div")].map((line) => line.textContent);
    expect(top).toBe("#1Open one4d ago");
    expect(bottom).toBe("feat/search");
    // The open PR gets the thread list's active ring.
    expect(row.className).toMatch(/ring-primary\/20/);
  });

  test("the filter menu is the thread list's dropdown: checked Sort by and Order radio items", () => {
    render(<Browser />);
    openFilters();
    const item = (name: string) => screen.getByRole("menuitemradio", { name });
    expect(item("Last updated").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(item("Created on"));
    expect(paginatedArgs.mock.lastCall?.[0].sort).toBe("created");
    openFilters();
    fireEvent.click(item("Oldest"));
    expect(paginatedArgs.mock.lastCall?.[0].order).toBe("asc");
    // One connected repository leaves nothing to pick.
    expect(screen.queryByText("All repositories")).toBeNull();
  });

  test("with a Linked GitHub account, Author and Assignee offer You to the lists and search (OS-2435)", () => {
    const { unmount } = render(<Browser />);
    openFilters();
    expect(screen.queryByText("All authors")).toBeNull();
    unmount();

    render(<Browser you={42} />);
    openFilters();
    const [authorYou, assigneeYou] = screen.getAllByRole("menuitemradio", { name: "You" });
    fireEvent.click(authorYou);
    expect(paginatedArgs.mock.lastCall?.[0]).toMatchObject({ author: "me", assignee: undefined });
    openFilters();
    fireEvent.click(screen.getAllByRole("menuitemradio", { name: "You" })[1] ?? assigneeYou);
    expect(paginatedArgs.mock.lastCall?.[0]).toMatchObject({ author: "me", assignee: "me" });
    expect(screen.getByText("Filters active")).toBeTruthy();
  });

  test("search is a bar under the header whose border lines up with the reader's tab row, and searches GitHub across states", async () => {
    results = [
      { _id: "pr_1", repositoryId: "repo_1", number: 1, title: "Open one", author: "sam", state: "open", draft: false, labels: [], headRef: "a", baseRef: "main", providerUpdatedAt: Date.now(), archived: false, conflicts: false },
    ];
    search.mockResolvedValue({
      pullRequests: [{ repositoryId: "repo_1", number: 40, title: "Old fix", author: "sam", state: "merged", draft: false, labels: [], providerCreatedAt: 1, providerUpdatedAt: Date.now() }],
      hasMore: false,
      incomplete: true,
      omittedRepositories: 0,
      failures: [],
    });
    render(<Browser />);
    const input = screen.getByRole("searchbox", { name: "Search pull requests" });
    const bar = input.closest("[data-search-bar]") as HTMLElement;
    // The reader's tab row is h-[41px] with a bottom border under the h-14 header.
    expect(bar.className).toMatch(/h-\[41px\].*border-b|border-b.*h-\[41px\]/);
    expect(bar.compareDocumentPosition(screen.getByText("Open")) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4);
    fireEvent.change(input, { target: { value: "old fix" } });
    const hit = await screen.findByRole("link", { name: "Old fix" });
    expect(hit.getAttribute("href")).toBe("/o/org/WEB/pull-requests?repo=repo_1&pr=40");
    expect(screen.getByRole("img", { name: "Merged" })).toBeTruthy();
    expect(screen.queryByText("Open one")).toBeNull();
    expect(screen.getByText(/GitHub returned partial results/)).toBeTruthy();
    expect(search).toHaveBeenCalledWith({ projectId: "project_1", query: "old fix", repositoryId: "repo_1", sort: "updated", order: "desc", page: 1 });
  });

  test("Closed is a collapsed section that reads and imports nothing until opened", () => {
    render(<Browser />);
    expect(paginatedArgs.mock.calls.map(([args]) => args.tab)).not.toContain("closed");
    expect(loadHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(paginatedArgs).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "closed" }));
    expect(loadHistory).toHaveBeenCalledWith({ projectId: "project_1", repositoryId: "repo_1", more: false });
    // Every stored row is in, but GitHub has older pages, so Load more imports the next.
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadHistory).toHaveBeenLastCalledWith({ projectId: "project_1", repositoryId: "repo_1", more: true });
  });

  test("Closed sorted any other way than newest updated says how far back the imported history reaches", () => {
    connection.repository.history = { started: true, complete: false, loading: false, coveredThrough: Date.parse("2026-10-03T12:00:00Z") };
    render(<Browser initial={{ order: "asc" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(screen.getByText("Showing closed pull requests updated since Oct 3, 2026. Load more to go further back.")).toBeTruthy();
  });

  test("a failed search offers Retry, which asks for the same page again", async () => {
    search.mockRejectedValueOnce(new Error("GitHub could not be reached. Try again in a moment.")).mockResolvedValueOnce({
      pullRequests: [],
      hasMore: false,
      incomplete: false,
      omittedRepositories: 0,
      failures: [],
    });
    render(<Browser />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search pull requests" }), { target: { value: "fix" } });
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No matching pull requests")).toBeTruthy();
    expect(search.mock.calls.map(([args]) => args.page)).toEqual([1, 1]);
  });

  test("closed rows are compact with their state icon, and finished history has no Load more", () => {
    connection.repository.history = { started: true, complete: true, loading: false };
    results = [
      { _id: "pr_3", repositoryId: "repo_1", number: 3, title: "Shipped", author: "sam", state: "merged", draft: false, labels: [], headRef: "s", baseRef: "main", providerUpdatedAt: Date.now() - 86_400_000, archived: false, conflicts: false },
    ];
    render(<Browser />);
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    const row = screen.getAllByRole("link", { name: "Shipped" }).at(-1)!.closest("[data-pr-row]") as HTMLElement;
    expect(row.querySelector('[aria-label="Merged"]')).toBeTruthy();
    expect(row.textContent).toBe("#3Shipped1d");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
