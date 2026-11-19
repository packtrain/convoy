/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import { appRoute } from "@/lib/navigation";
import { PullRequestsPage } from "./pull-requests-page";
import { DEV_SETTINGS, DEV_SETTING_ENABLED_VALUE } from "@/lib/dev-mode/constants";

let status: unknown;
let project: unknown = { _id: "project_1" };
let results: unknown[] = [];
let pageStatus = "Exhausted";
let locationSearch = "";
let listChecks: unknown[] = [];
let accounts: unknown = { configured: true, organizations: [] };
const paginatedArgs = vi.fn();
const listChecksArgs = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (getFunctionName(fn) === getFunctionName(api.projects.core.getByAlias)) return project;
    if (getFunctionName(fn) === getFunctionName(api.integrations.github.accounts.listMine)) return accounts;
    return args === "skip" ? undefined : status;
  },
  // Only the list's status icons read through useQueries: one entry per batch of rows.
  useQueries: (queries: Record<string, { args: { refs: string[] } }>) => {
    const batches = Object.values(queries).map((query) => query.args);
    listChecksArgs(batches);
    return Object.fromEntries(Object.keys(queries).map((key, index) => [key, index === 0 ? listChecks : []]));
  },
  usePaginatedQuery: (_fn: unknown, args: unknown) => {
    paginatedArgs(args);
    return { results, status: pageStatus, loadMore: vi.fn() };
  },
  useMutation: () => loadHistory,
  useAction: (fn: Parameters<typeof getFunctionName>[0]) =>
    ({
      [getFunctionName(api.integrations.github.states.update)]: updateState,
      [getFunctionName(api.integrations.github.accounts.readRepositoryPermission)]: readPermission,
      [getFunctionName(api.integrations.github.assignees.list)]: listAssignable,
      [getFunctionName(api.integrations.github.assignees.update)]: updateAssignee,
      [getFunctionName(api.integrations.github.assignees.clear)]: clearAssignees,
    })[getFunctionName(fn)] ?? search,
}));
const loadHistory = vi.fn(async () => null);
const search = vi.fn();
const updateState = vi.fn();
const readPermission = vi.fn();
const listAssignable = vi.fn();
const updateAssignee = vi.fn();
const clearAssignees = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: (...args: unknown[]) => toastError(...args) } }));
// cmdk, behind the Assign picker, measures its list and scrolls the active item; jsdom has neither.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
const replace = vi.fn();
// The reader has its own tests; this file checks only what the page hands it.
vi.mock("./pull-request-reader", async (importActual) => ({
  ...(await importActual<typeof import("./pull-request-reader")>()),
  PullRequestReader: ({ defaultTab, onTabChange }: { defaultTab?: string; onTabChange?: (tab: string) => void }) => (
    <div aria-label="Reader" data-tab={defaultTab}>
      <button onClick={() => onTabChange?.("guide")}>Guide</button>
      <button onClick={() => onTabChange?.("overview")}>Overview</button>
    </div>
  ),
}));
vi.mock("@/lib/preferences/use-user-preferences", () => ({ useUserPreferences: () => ({ pullRequestCompactLayout: false }) }));
vi.mock("@/lib/auth/hooks", () => ({
  useAppConvexAuth: () => ({ isAuthenticated: true }),
  useAppSignOut: () => vi.fn(),
  supportsSignOut: false,
}));
vi.mock("@/lib/routing/current-org-project-context", () => ({ useCurrentOrgProject: () => ({ organizationId: "org_1" }) }));
vi.mock("@/lib/navigation", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/navigation")>()),
  useRouteParams: () => ({ organizationSlug: "org", projectAlias: "WEB" }),
  useNavigation: () => ({ location: { pathname: "/o/org/WEB/pull-requests", search: locationSearch, hash: "" }, replace }),
}));

afterEach(() => {
  cleanup();
  project = { _id: "project_1" };
  results = [];
  pageStatus = "Exhausted";
  locationSearch = "";
  listChecks = [];
  accounts = { configured: true, organizations: [] };
  vi.clearAllMocks();
  paginatedArgs.mockClear();
  listChecksArgs.mockClear();
  search.mockReset();
  replace.mockReset();
});

function link(id: number, repository: Record<string, unknown>) {
  return {
    repositoryLinkId: `link_${id}`,
    repositoryId: `repo_${id}`,
    status: "active",
    accountLogin: "acme",
    connectedAt: 1,
    repository: {
      providerRepositoryId: id,
      owner: "acme",
      name: "web",
      isPrivate: true,
      htmlUrl: "https://github.com/acme/web",
      openCount: 0,
      closedCount: 0,
      history: { started: true, complete: false, loading: false },
      ...repository,
    },
  };
}

function connected(repository: Record<string, unknown>, more: ReturnType<typeof link>[] = [], canManage = false) {
  return { configured: true, installUrl: null, canManage, setup: null, connections: [link(1, repository), ...more] };
}

const pr = {
  _id: "pr_1",
  repositoryId: "repo_2",
  number: 12,
  title: "Fix the login flow",
  author: "octocat",
  state: "open",
  draft: false,
  labels: ["bug"],
  assignees: [],
  headRef: "fix",
  baseRef: "main",
  providerUpdatedAt: Date.now() - 60_000,
};

beforeEach(() => {
  window.localStorage.setItem(DEV_SETTINGS.githubIntegration.storageKey, DEV_SETTING_ENABLED_VALUE);
});

describe("PullRequestsPage", () => {
  test("with the GitHub integration toggle off, says so and reads nothing", () => {
    window.localStorage.removeItem(DEV_SETTINGS.githubIntegration.storageKey);
    status = connected({ syncStatus: "synced" });
    render(<PullRequestsPage />);
    expect(screen.getByText("GitHub integration is off")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Pull requests" })).toBeNull();
  });

  test("a failed first import says so instead of showing an empty repository", () => {
    status = connected({ syncStatus: "error", error: "GitHub sync failed: GitHub returned 502" });
    render(<PullRequestsPage />);
    expect(screen.getByText("Couldn't import pull requests")).toBeTruthy();
    expect(screen.getByText(/GitHub returned 502/)).toBeTruthy();
    expect(screen.queryByText("No open pull requests")).toBeNull();
  });

  test("a finished import with no open PRs shows the empty state", () => {
    status = connected({ syncStatus: "synced" });
    render(<PullRequestsPage />);
    expect(screen.getByText("No open pull requests")).toBeTruthy();
  });

  test("an empty tab says so at the top, under the toolbar, instead of mid-page", () => {
    status = connected({ syncStatus: "synced" });
    render(<PullRequestsPage />);
    const empty = screen.getByText("No open pull requests").closest('[data-slot="empty"]')!;
    expect(empty.className.split(" ")).not.toContain("flex-1");
  });

  test("a project the user cannot read shows no access instead of loading forever", () => {
    project = null;
    render(<PullRequestsPage />);
    expect(screen.getByText("You don't have access to this project.")).toBeTruthy();
  });

  test("an admin without a connection gets a link to Integrations settings, even before the App is set up", () => {
    status = { configured: false, installUrl: null, canManage: true, setup: null, connections: [] };
    render(<PullRequestsPage />);
    const open = screen.getByRole("link", { name: "Open Integrations" });
    expect(open.getAttribute("href")).toBe("/o/org/WEB/settings/integrations/github");
  });

  test("the empty state centers in the page: every ancestor up to the page grows as a flex column", () => {
    status = { configured: true, installUrl: null, canManage: true, setup: null, connections: [] };
    render(<PullRequestsPage />);
    let node = screen.getByText("No connected repositories").closest('[data-slot="empty"]')!.parentElement!;
    while (node.tagName !== "MAIN") {
      expect(node.className.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-1", "flex-col"]));
      node = node.parentElement!;
    }
  });

  test("a sync error that ends in a period is not followed by a second one", () => {
    status = connected({ syncStatus: "error", error: "GitHub sync failed: GitHub could not be reached. Try again in a moment." });
    render(<PullRequestsPage />);
    expect(screen.getByText(/Try again in a moment\. A project admin/)).toBeTruthy();
  });

  test("lists rows from every repository with their repository, tab counts, and Manage repositories", () => {
    const complete = { started: true, complete: true, loading: false };
    status = connected({ syncStatus: "synced", openCount: 2, closedCount: 1, history: complete }, [link(2, { name: "api", syncStatus: "synced", openCount: 1, history: complete })], true);
    results = [pr];
    render(<PullRequestsPage />);
    expect(screen.getByRole("heading", { name: "Pull requests" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage repositories" }).getAttribute("href")).toBe("/o/org/WEB/settings/integrations/github");
    expect(screen.getByRole("button", { name: /^Open/ }).textContent).toBe("Open3");
    expect(screen.getByRole("button", { name: /^Closed/ }).textContent).toBe("Closed1");
    const row = screen.getByRole("link", { name: /Fix the login flow/ });
    expect(row.getAttribute("href")).toBe("/o/org/WEB/pull-requests?repo=repo_2&pr=12");
    expect(screen.getByText("acme/api #12 · octocat · updated 1 minute ago")).toBeTruthy();
    expect(paginatedArgs).toHaveBeenLastCalledWith({ projectId: "project_1", tab: "open", sort: "updated", order: "desc", repositoryId: undefined });
  });

  test("rows mark conflicts, archives, and stack positions", () => {
    status = connected({ syncStatus: "synced", openCount: 1 });
    results = [{ ...pr, repositoryId: "repo_1", conflicts: true, archived: true, stack: { id: 9, number: 12, size: 3, position: 2 } }];
    render(<PullRequestsPage />);
    expect(screen.getByText("Conflicts")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stack 2/3" })).toBeTruthy();
  });

  test("a row shows the current results of the Checks shown in the list (OS-2400)", () => {
    status = connected({ syncStatus: "synced", openCount: 1 });
    results = [{ ...pr, repositoryId: "repo_1" }];
    listChecks = [{ ref: "acme/web#12", checks: [{ key: "risk", label: "Merge risk", status: "failed", value: "High", note: "Touches auth" }] }];
    render(<PullRequestsPage />);
    expect(listChecksArgs).toHaveBeenLastCalledWith([{ projectId: "project_1", refs: ["acme/web#12"] }]);
    const icons = screen.getByLabelText("Pull request checks");
    expect(icons.querySelector('[aria-label="Failed"]')).toBeTruthy();
  });

  test("the status icons read loaded rows in batches the server accepts", () => {
    status = connected({ syncStatus: "synced", openCount: 120 });
    results = Array.from({ length: 120 }, (_, index) => ({ ...pr, _id: `pr_${index}`, repositoryId: "repo_1", number: index + 1 }));
    render(<PullRequestsPage />);
    expect(listChecksArgs.mock.lastCall?.[0].map((batch: { refs: string[] }) => batch.refs.length)).toEqual([100, 20]);
  });

  test("the list has no footnote about automatic updates", () => {
    status = connected({ syncStatus: "synced" });
    results = [pr];
    render(<PullRequestsPage />);
    expect(screen.queryByText(/update automatically/)).toBeNull();
  });

  test("the Closed tab queries closed PRs", () => {
    status = connected({ syncStatus: "synced" });
    render(<PullRequestsPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Closed/ }));
    expect(paginatedArgs).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "closed" }));
    expect(screen.getByText("No closed pull requests")).toBeTruthy();
  });

  test("a failed repository shows a stale banner above the rows it still has", () => {
    status = connected({ syncStatus: "error", error: "GitHub sync failed: GitHub returned 502" }, [link(2, { name: "api", syncStatus: "synced" })]);
    results = [pr];
    render(<PullRequestsPage />);
    expect(screen.getByRole("status").textContent).toBe("acme/web: GitHub sync failed: GitHub returned 502. Showing the last successful update.");
    expect(screen.getByRole("link", { name: /Fix the login flow/ })).toBeTruthy();
  });

  test("tab counts are plain muted text, like other counts, so a selected tab cannot hide them", () => {
    status = connected({ syncStatus: "synced", openCount: 1 });
    render(<PullRequestsPage />);
    const tab = screen.getByRole("button", { name: /^Open/ });
    expect(tab.querySelector('[data-slot="badge"]')).toBeNull();
    expect(screen.getByText("1").className).toContain("text-muted-foreground");
  });

  test("the loading skeleton has the page's shape: a toolbar, then one framed list of two-line rows", () => {
    status = undefined;
    render(<PullRequestsPage />);
    const skeleton = screen.getByLabelText("Loading pull requests");
    expect(skeleton.querySelector('[data-testid="pull-request-toolbar-skeleton"]')).toBeTruthy();
    const frame = skeleton.querySelector(".divide-y");
    expect(frame?.className).toContain("rounded-lg border");
    for (const row of Array.from(frame!.children)) {
      expect(row.className).toContain("p-4");
      expect(row.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    }
  });

  test("a PR link loads into the reader's layout, not the list's", () => {
    locationSearch = "?repo=repo_1&pr=2";
    status = undefined;
    render(<PullRequestsPage />);
    expect(screen.queryByTestId("pull-request-toolbar-skeleton")).toBeNull();
    expect(screen.getByLabelText("Pull request browser")).toBeTruthy();
    expect(screen.getByLabelText("Loading pull request")).toBeTruthy();
  });

  test("a PR link's tab loads with that tab's skeleton, not the Overview's", () => {
    status = undefined;
    locationSearch = "?repo=repo_1&pr=2&tab=guide";
    render(<PullRequestsPage />);
    expect(screen.getByLabelText("Loading guide")).toBeTruthy();
    cleanup();
    locationSearch = "?repo=repo_1&pr=2&tab=diff";
    render(<PullRequestsPage />);
    expect(screen.queryByLabelText("Loading guide")).toBeNull();
    // The Diff tab's shape: summary toolbar, file sections of header plus lines, and the Files pane.
    const changes = screen.getByLabelText("Loading changes");
    expect(changes.querySelector('[data-slot="changes-toolbar"]')).toBeTruthy();
    const sections = changes.querySelectorAll("section");
    expect(sections.length).toBeGreaterThan(1);
    for (const section of Array.from(sections)) {
      expect(section.firstElementChild?.className).toContain("border-b");
      expect(section.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(4);
    }
    expect(screen.getByLabelText("Loading files").querySelectorAll("li").length).toBe(sections.length);
  });

  test("a PR link's tab opens that tab, and picking a tab puts it in the URL", () => {
    locationSearch = "?repo=repo_1&pr=2&tab=diff";
    status = connected({ syncStatus: "synced" });
    render(<PullRequestsPage />);
    expect(screen.getByLabelText("Reader").dataset.tab).toBe("diff");
    fireEvent.click(screen.getByRole("button", { name: "Guide" }));
    expect(replace).toHaveBeenCalledWith(appRoute.projectPullRequest("org", "WEB", "repo_1", 2, "guide"));
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(replace).toHaveBeenLastCalledWith(appRoute.projectPullRequest("org", "WEB", "repo_1", 2));
  });

  test("a PR link's unknown tab falls back to the reader's default", () => {
    locationSearch = "?repo=repo_1&pr=2&tab=nope";
    status = connected({ syncStatus: "synced" });
    render(<PullRequestsPage />);
    expect(screen.getByLabelText("Reader").dataset.tab).toBeUndefined();
  });

  test("once the toolbar is real, the first page's skeleton is the framed list alone", () => {
    status = connected({ syncStatus: "synced" });
    pageStatus = "LoadingFirstPage";
    render(<PullRequestsPage />);
    const skeleton = screen.getByLabelText("Loading pull requests");
    expect(skeleton.querySelector('[data-testid="pull-request-toolbar-skeleton"]')).toBeNull();
    expect(skeleton.querySelector(".divide-y")).toBeTruthy();
  });

  test("while a repository's counts are backfilling, the tabs show no counts instead of partial ones", () => {
    status = connected({ syncStatus: "synced", openCount: 0, counting: true }, [link(2, { name: "api", syncStatus: "synced", openCount: 4 })]);
    render(<PullRequestsPage />);
    expect(screen.getByRole("button", { name: /^Open/ }).textContent).toBe("Open");
    expect(screen.getByRole("button", { name: /^Closed/ }).textContent).toBe("Closed");
  });

  test("the Closed count waits for every history page, since stored closed PRs are not GitHub's total yet", () => {
    status = connected({ syncStatus: "synced", openCount: 2, closedCount: 30 });
    render(<PullRequestsPage />);
    expect(screen.getByRole("button", { name: /^Closed/ }).textContent).toBe("Closed");
  });

  test("searching shows GitHub's hits across states and deselects the tabs; picking a tab clears it", async () => {
    status = connected({ syncStatus: "synced", openCount: 1 });
    results = [{ ...pr, repositoryId: "repo_1" }];
    search.mockResolvedValue({
      pullRequests: [{ repositoryId: "repo_1", number: 40, title: "Old fix", author: "sam", state: "closed", draft: false, labels: [], providerCreatedAt: 1, providerUpdatedAt: Date.now() }],
      hasMore: false,
      incomplete: false,
      omittedRepositories: 0,
      failures: [{ repositories: ["acme/api"], message: "GitHub is limiting requests from Convoy. Try again in a few minutes." }],
    });
    render(<PullRequestsPage />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search pull requests" }), { target: { value: "old" } });
    expect(await screen.findByRole("link", { name: "Old fix" })).toBeTruthy();
    expect(screen.queryByText("Fix the login flow")).toBeNull();
    expect(screen.getByText("acme/api: GitHub is limiting requests from Convoy. Try again in a few minutes.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Open/ }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /^Open/ }));
    expect((screen.getByRole("searchbox", { name: "Search pull requests" }) as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Fix the login flow")).toBeTruthy();
  });

  test("a search hit keeps the status icons of its Checks (OS-2400)", async () => {
    status = connected({ syncStatus: "synced", openCount: 1 });
    results = [{ ...pr, repositoryId: "repo_1" }];
    listChecks = [{ ref: "acme/web#40", checks: [{ key: "risk", label: "Merge risk", status: "failed", note: "Touches auth" }] }];
    search.mockResolvedValue({
      pullRequests: [{ repositoryId: "repo_1", number: 40, title: "Old fix", author: "sam", state: "closed", draft: false, labels: [], providerCreatedAt: 1, providerUpdatedAt: Date.now() }],
      hasMore: false,
      incomplete: false,
      omittedRepositories: 0,
      failures: [],
    });
    render(<PullRequestsPage />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search pull requests" }), { target: { value: "old" } });
    expect(await screen.findByRole("link", { name: "Old fix" })).toBeTruthy();
    expect(listChecksArgs).toHaveBeenLastCalledWith([{ projectId: "project_1", refs: ["acme/web#40"] }]);
    expect(screen.getByLabelText("Pull request checks").querySelector('[aria-label="Failed"]')).toBeTruthy();
  });
  describe("bulk actions (OS-2184)", () => {
    const linked = (status: "active" | "reconnect" = "active", githubUserId = 42) => {
      accounts = {
        configured: true,
        organizations: [{ organizationId: "org_1", organizationSlug: "org", organizationName: "Org", account: { githubUserId, login: "maya", avatarUrl: null, status } }],
      };
    };
    const rows = () => {
      status = connected({ syncStatus: "synced", openCount: 2 });
      results = [
        { ...pr, repositoryId: "repo_1" },
        { ...pr, _id: "pr_2", repositoryId: "repo_1", number: 13, title: "Add search", assignees: ["sam"] },
      ];
    };
    const target = (number: number) => ({ projectId: "project_1", repositoryId: "repo_1", number });

    test("Mark as Closed writes each selected PR in turn as the member and reports the ones GitHub refused", async () => {
      linked();
      rows();
      readPermission.mockResolvedValue("triage");
      updateState.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("GitHub refused this."));
      render(<PullRequestsPage />);

      fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible pull requests" }));
      expect(screen.getByText("2 of 2 selected")).toBeTruthy();
      await waitFor(() => expect(readPermission).toHaveBeenCalledTimes(1));
      fireEvent.pointerDown(screen.getByRole("button", { name: "Mark as" }), { button: 0, pointerType: "mouse" });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Closed" }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith("1 of 2 pull requests failed", { description: "#13: GitHub refused this." }));
      expect(updateState.mock.calls).toEqual([[{ ...target(12), change: "close" }], [{ ...target(13), change: "close" }]]);
      expect(screen.getByText("2 pull requests")).toBeTruthy();
    });

    test("a read-only GitHub account sees the actions disabled with the reason", async () => {
      linked();
      rows();
      readPermission.mockResolvedValue("read");
      render(<PullRequestsPage />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Select pull request #12" }));
      expect(await screen.findByText("Needs triage access")).toBeTruthy();
      expect((screen.getByRole("button", { name: "Mark as" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Assign selected pull requests" }) as HTMLButtonElement).disabled).toBe(true);
    });

    test("Assign shows GitHub's answers before the rows resync, and Assign to nobody clears every selected PR", async () => {
      linked();
      rows();
      readPermission.mockResolvedValue("write");
      listAssignable.mockResolvedValue([{ login: "sam", avatarUrl: null }]);
      updateAssignee.mockResolvedValue([{ login: "sam", avatarUrl: null }]);
      clearAssignees.mockResolvedValue([]);
      render(<PullRequestsPage />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible pull requests" }));
      fireEvent.click(screen.getByRole("button", { name: "Assign selected pull requests" }));
      fireEvent.click(await screen.findByRole("button", { name: "sam, assigned to some selected" }));
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));

      // The stored rows haven't synced yet; GitHub's answer says sam is on both.
      fireEvent.click(screen.getByRole("button", { name: "Assign selected pull requests" }));
      expect(await screen.findByRole("button", { name: "sam, assigned" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Assign to nobody" }));
      await waitFor(() => expect(clearAssignees.mock.calls).toEqual([[target(12)], [target(13)]]));
    });

    test("linking another GitHub account, or reconnecting, reads the role again", async () => {
      linked();
      rows();
      readPermission.mockResolvedValue("read");
      const { rerender } = render(<PullRequestsPage />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Select pull request #12" }));
      expect(await screen.findByText("Needs triage access")).toBeTruthy();

      readPermission.mockResolvedValue("write");
      linked("active", 7);
      rerender(<PullRequestsPage />);
      await waitFor(() => expect((screen.getByRole("button", { name: "Mark as" }) as HTMLButtonElement).disabled).toBe(false));

      readPermission.mockResolvedValue("read");
      linked("reconnect", 7);
      rerender(<PullRequestsPage />);
      expect(screen.getByText("Reconnect GitHub first")).toBeTruthy();
      linked("active", 7);
      rerender(<PullRequestsPage />);
      expect(await screen.findByText("Needs triage access")).toBeTruthy();
      expect(readPermission).toHaveBeenCalledTimes(3);
    });

    test("without a Linked GitHub account the actions ask to connect first, and reading the role waits for one", () => {
      rows();
      render(<PullRequestsPage />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Select pull request #12" }));
      expect(screen.getByText("Connect GitHub first")).toBeTruthy();
      expect(readPermission).not.toHaveBeenCalled();
    });

    test("Assign on a mixed selection assigns the person to the PRs that lack them", async () => {
      linked();
      rows();
      readPermission.mockResolvedValue("write");
      listAssignable.mockResolvedValue([{ login: "sam", avatarUrl: null }]);
      updateAssignee.mockResolvedValue([]);
      render(<PullRequestsPage />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible pull requests" }));
      fireEvent.click(screen.getByRole("button", { name: "Assign selected pull requests" }));
      fireEvent.click(await screen.findByRole("button", { name: "sam, assigned to some selected" }));
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Assigned sam to 1 pull request"));
      expect(updateAssignee.mock.calls).toEqual([[{ ...target(12), login: "sam", assigned: true }]]);
    });
  });
});
