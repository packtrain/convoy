/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import { errors } from "@/convex/integrations/github/errors";
import { ProjectIntegrationsPage } from "./project-integrations-page";
import { DEV_SETTINGS, DEV_SETTING_ENABLED_VALUE } from "@/lib/dev-mode/constants";

const queryMock = vi.fn();
const listRepositoriesMock = vi.fn();
let search = "";
const replaceMock = vi.fn();
const toastErrorMock = vi.fn();
const deleteRetainedMock = vi.fn(() => Promise.resolve(null));
const disconnectMock = vi.fn(() => Promise.resolve(null));

vi.mock("convex/react", () => ({
  useQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) =>
    getFunctionName(fn) === getFunctionName(api.projects.core.getByAlias)
      ? { _id: "project_1" }
      : queryMock(getFunctionName(fn), args),
  useMutation: (fn: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(fn) === getFunctionName(api.integrations.github.core.deleteRetained)
      ? deleteRetainedMock
      : getFunctionName(fn) === getFunctionName(api.integrations.github.core.disconnect)
        ? disconnectMock
        : vi.fn(),
  useAction: (fn: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(fn) === getFunctionName(api.integrations.github.setup.listSetupRepositories) ? listRepositoriesMock : vi.fn(),
}));

vi.mock("@/lib/navigation", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ location: { pathname: "/", search, hash: "" }, replace: replaceMock, push: vi.fn() }),
}));
// The Guide prompt section has its own tests.
vi.mock("./github/guide-prompt-section", () => ({ GuidePromptSection: () => <p>Guide prompt section</p> }));
vi.mock("@/lib/auth/hooks", () => ({ useAppConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/lib/routing/current-org-project-context", () => ({ useCurrentOrgProject: () => ({ organizationId: "org_1" }) }));
vi.mock("sonner", () => ({ toast: { error: (message: string) => toastErrorMock(message) } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  search = "";
});

const repository = {
  providerRepositoryId: 1,
  owner: "acme",
  name: "web",
  isPrivate: true,
  htmlUrl: "https://github.com/acme/web",
  syncStatus: "synced" as const,
  importedCount: 3,
  lastSuccessAt: Date.now() - 60_000,
  openCount: 3,
  closedCount: 0,
};

function status(overrides: Record<string, unknown> = {}) {
  return { configured: true, installUrl: "https://github.com/apps/convoy/installations/new", canManage: true, connections: [], setup: null, ...overrides };
}

function renderPage(value: unknown, { index = false } = {}) {
  queryMock.mockReturnValue(value);
  render(<ProjectIntegrationsPage organizationSlug="org" projectAlias="WEB" provider={index ? undefined : "github"} />);
}

const activeConnection = { repositoryLinkId: "link_1", repositoryId: "repo_1", status: "active", accountLogin: "acme", connectedAt: 1, repository };

beforeEach(() => {
  window.localStorage.setItem(DEV_SETTINGS.githubIntegration.storageKey, DEV_SETTING_ENABLED_VALUE);
});

describe("ProjectIntegrationsPage", () => {
  test("with the GitHub integration toggle off, the GitHub page says so and reads nothing", () => {
    window.localStorage.removeItem(DEV_SETTINGS.githubIntegration.storageKey);
    renderPage(status());
    expect(screen.getByText("GitHub integration is off")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("the index lists GitHub with its connection state and opens its page", () => {
    renderPage(status({ connections: [activeConnection] }), { index: true });
    const github = screen.getByRole("link", { name: /GitHub/ });
    expect(github.getAttribute("href")).toBe("/o/org/WEB/settings/integrations/github");
    expect(github.textContent).toContain("1 repository connected");
    cleanup();

    renderPage(status(), { index: true });
    expect(screen.getByRole("link", { name: /GitHub/ }).textContent).toContain("Not connected");
    cleanup();

    renderPage(status({ configured: false, canManage: false, installUrl: null }), { index: true });
    expect(screen.getByRole("link", { name: /GitHub/ }).textContent).toContain("Not set up");
  });

  test("the GitHub page groups repositories into one card per organization", () => {
    const docs = { ...activeConnection, repositoryLinkId: "link_2", repositoryId: "repo_2", repository: { ...repository, name: "docs" } };
    const other = { ...activeConnection, repositoryLinkId: "link_3", repositoryId: "repo_3", accountLogin: "globex", repository: { ...repository, owner: "globex" } };
    renderPage(status({ connections: [activeConnection, docs, other] }));
    expect(screen.getAllByText("GitHub")).toHaveLength(1);
    const acme = screen.getByRole("region", { name: "acme organization" });
    expect(acme.textContent).toContain("Pull requests synced· 2 repositories");
    expect(acme.textContent).toContain("PR metadata last synced 1 minute ago");
    expect(screen.getAllByRole("img", { name: "Connected" })).toHaveLength(3);
    expect(screen.getByRole("region", { name: "globex organization" }).textContent).toContain("1 repository");
  });

  test("an organization card is a header, an edge-to-edge list split by separators, and a footer", () => {
    renderPage(status({ connections: [activeConnection] }));
    const list = screen.getByRole("region", { name: "acme organization" }).querySelector("ul")!;
    const classes = list.className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["divide-y", "border-y"]));
    expect(classes.filter((name) => name.startsWith("rounded") || name.startsWith("mx-"))).toEqual([]);
  });

  test("a failed sync shows on its repository with Sync again", () => {
    const failed = { ...activeConnection, repository: { ...repository, syncStatus: "error", error: "GitHub sync failed: GitHub returned 500" } };
    renderPage(status({ connections: [failed] }));
    expect(screen.getByRole("region", { name: "acme organization" }).textContent).toContain("Sync failed");
    expect(screen.getByText("GitHub sync failed: GitHub returned 500. Showing the last synced pull requests.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync again" })).toBeTruthy();
  });

  test("with nothing connected, an admin connects from the card", () => {
    renderPage(status());
    expect(screen.getByText("No repository connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeTruthy();
  });

  test("the GitHub page leads back to the index", () => {
    renderPage(status());
    expect(screen.getByRole("heading", { name: "GitHub" })).toBeTruthy();
    const back = screen.getByRole("link", { name: "Back to integrations" });
    expect(back.getAttribute("href")).toBe("/o/org/WEB/settings/integrations");
    expect(back.querySelector(".lucide-chevron-left")).not.toBeNull();
  });

  test("the Guide prompt lives in Settings → Pull requests, not on the GitHub page", () => {
    renderPage(status());
    expect(screen.queryByText("Guide prompt section")).toBeNull();
  });

  test("explains that the deployment has no GitHub App", () => {
    renderPage(status({ configured: false, canManage: false, installUrl: null }));
    expect(screen.getByText("GitHub isn't set up on this deployment")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
  });

  test("a viewer sees the connection but no way to manage it", () => {
    renderPage(
      status({
        canManage: false,
        connections: [activeConnection],
      })
    );
    expect(screen.getByRole("link", { name: "acme/web" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "acme actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add organization" })).toBeNull();
    expect(screen.getByText(/Ask a project admin to manage this connection/)).toBeTruthy();
  });

  test("a private repository shows only the lock, and the organization menu manages or disconnects", async () => {
    renderPage(status({ connections: [activeConnection] }));
    expect(screen.getByRole("img", { name: "Private repository" })).toBeTruthy();
    expect(screen.queryByText("Private")).toBeNull();

    fireEvent.keyDown(screen.getByRole("button", { name: "acme actions" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(menu.className).toContain("w-max");
    expect(screen.getByRole("menuitem", { name: "Manage repositories" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Disconnect acme" })).toBeTruthy();
  });

  test("an admin disconnects one repository from its row, without going through GitHub", async () => {
    const docs = { ...activeConnection, repositoryLinkId: "link_2", repository: { ...repository, name: "docs", htmlUrl: "https://github.com/acme/docs" } };
    renderPage(status({ connections: [activeConnection, docs] }));
    fireEvent.keyDown(screen.getByRole("button", { name: "acme/web actions" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect repository" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Disconnect acme/web?");
    expect(dialog.textContent).toContain("30 days");
    expect(disconnectMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledWith({ projectId: "project_1", repositoryLinkId: "link_1" });
  });

  test("the connected check explains itself on hover", async () => {
    // Radix measures the tooltip's arrow.
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    renderPage(status({ connections: [activeConnection] }));
    fireEvent.focus(screen.getByRole("img", { name: "Connected" }));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Connected. Pull request changes on GitHub show up here automatically.");
  });

  test("a viewer gets no repository menu", () => {
    renderPage(status({ canManage: false, connections: [activeConnection] }));
    expect(screen.queryByRole("button", { name: "acme/web actions" })).toBeNull();
  });

  const deleteAfter = Date.parse("2026-12-12T00:00:00Z");
  const retainedConnection = { ...activeConnection, status: "disconnected", deleteAfter };

  test("a retained disconnect offers Reconnect and says the PRs are hidden now and deleted on a date", () => {
    renderPage(status({ connections: [retainedConnection] }));
    expect(screen.getByRole("button", { name: "Reconnect GitHub" })).toBeTruthy();
    const date = new Date(deleteAfter).toLocaleDateString();
    expect(screen.getByText(`Pull requests are hidden. They'll be deleted on ${date} unless you reconnect.`)).toBeTruthy();
  });

  test("a retained repository is one row: name, a Disconnected badge, then the deletion date and a small Delete now on the right", () => {
    const revoked = { ...retainedConnection, error: errors.ACCESS_REMOVED };
    renderPage(status({ connections: [revoked] }));
    const row = screen.getByRole("link", { name: "acme/web" }).closest("li")!;
    expect(row.querySelectorAll("p")).toHaveLength(0);
    expect(row.querySelector('[data-slot="badge"]')?.textContent).toBe("Disconnected");
    const date = new Date(deleteAfter).toLocaleDateString();
    expect(row.textContent).toContain(`Will be deleted on ${date}`);
    expect(row.textContent).not.toContain(errors.ACCESS_REMOVED);
    expect(screen.getByRole("button", { name: "Delete acme/web now" }).getAttribute("data-size")).toBe("xs");
  });

  test("a revoked repository's (?) gives the reason", async () => {
    renderPage(status({ connections: [{ ...retainedConnection, error: errors.ACCESS_REMOVED }] }));
    fireEvent.click(screen.getByRole("button", { name: "About deleting acme/web" }));
    expect((await screen.findByRole("dialog")).textContent).toMatch(new RegExp(`^${errors.ACCESS_REMOVED}\\.`));
  });

  test("a retained repository's (?) explains the deletion date", async () => {
    renderPage(status({ connections: [retainedConnection] }));
    fireEvent.click(screen.getByRole("button", { name: "About deleting acme/web" }));
    const date = new Date(deleteAfter).toLocaleDateString();
    expect(await screen.findByText(new RegExp(`keeps them for 30 days.*On ${date} they are deleted`))).toBeTruthy();
  });

  test("Delete now asks first, then deletes the retained repository", async () => {
    renderPage(status({ connections: [retainedConnection] }));
    fireEvent.click(screen.getByRole("button", { name: "Delete acme/web now" }));
    expect(deleteRetainedMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Delete now" }));
    expect(deleteRetainedMock).toHaveBeenCalledWith({ projectId: "project_1", repositoryLinkId: "link_1" });
  });

  test("a viewer gets no Delete now", () => {
    renderPage(status({ canManage: false, connections: [retainedConnection] }));
    expect(screen.queryByRole("button", { name: "Delete acme/web now" })).toBeNull();
  });

  test("an authorized setup opens the picker with non-admin repositories disabled", async () => {
    search = "?setup=setup_1";
    listRepositoriesMock.mockResolvedValue({
      repositories: [
        { providerRepositoryId: 1, fullName: "acme/web", isPrivate: true, isAdmin: true },
        { providerRepositoryId: 2, fullName: "acme/docs", isPrivate: false, isAdmin: false },
      ],
      nextCursor: null,
    });
    renderPage(status({ setup: { setupId: "setup_1", status: "authorized", expiresAt: 1 } }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /acme\/web/ })).toBeTruthy());
    expect(screen.getByRole("checkbox", { name: /acme\/docs/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Save repositories" }).hasAttribute("disabled")).toBe(true);
  });

  test("a setup link that expired says so and clears itself", async () => {
    search = "?setup=setup_1";
    renderPage(status({ setup: null }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(errors.SETUP_EXPIRED));
    expect(replaceMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/o/org/WEB/settings/integrations/github" }));
  });
});
