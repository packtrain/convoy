/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RepositoryPickerDialog } from "./repository-picker-dialog";

const listRepositoriesMock = vi.fn();
const saveRepositoriesMock = vi.fn();
const cancelSetupMock = vi.fn();
const disconnectMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: (fn: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(fn) === getFunctionName(api.integrations.github.setup.listSetupRepositories)
      ? listRepositoriesMock
      : saveRepositoriesMock,
  useMutation: (fn: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(fn) === getFunctionName(api.integrations.github.core.disconnect) ? disconnectMock : cancelSetupMock,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const repo = (id: number, isAdmin = true) => ({ providerRepositoryId: id, fullName: `acme/repo-${id}`, isPrivate: false, isAdmin });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const INSTALL_URL = "https://github.com/apps/convoy/installations/new";

/** An active link to repository `id`, as `core.get` lists it. */
const connection = (id: number) => ({
  repositoryLinkId: `link_${id}` as Id<"integrationRepositoryLinks">,
  repositoryId: `repo_${id}` as Id<"integrationRepositories">,
  status: "active" as const,
  accountLogin: "acme",
  connectedAt: 1,
  repository: {
    providerRepositoryId: id,
    owner: "acme",
    name: `repo-${id}`,
    isPrivate: false,
    htmlUrl: "",
    syncStatus: "synced" as const,
    openCount: 0,
    closedCount: 0,
    counting: false,
    history: { started: false, complete: false, loading: false },
  },
});

function renderPicker(connections: ReturnType<typeof connection>[] = [], onClose = vi.fn()) {
  return render(
    <RepositoryPickerDialog
      setupId={"setup_1" as Id<"integrationSetups">}
      installUrl={INSTALL_URL}
      connections={connections}
      onClose={onClose}
    />
  );
}

const consent = () => screen.getByRole("checkbox", { name: /Every member of this project/ });

describe("RepositoryPickerDialog", () => {
  test("loads every page before listing, with no Load more, even if the tab regains focus", async () => {
    const second = deferred<{ repositories: ReturnType<typeof repo>[]; nextCursor: null }>();
    listRepositoriesMock
      .mockResolvedValueOnce({ repositories: [repo(1)], nextCursor: "1:1" })
      .mockReturnValueOnce(second.promise);
    renderPicker();
    await waitFor(() => expect(listRepositoriesMock).toHaveBeenCalledTimes(2));
    fireEvent.focus(window);
    second.resolve({ repositories: [repo(2)], nextCursor: null });
    await screen.findByRole("checkbox", { name: /acme\/repo-2/ });
    expect(listRepositoriesMock).toHaveBeenLastCalledWith({ setupId: "setup_1", cursor: "1:1" });
    expect(listRepositoriesMock).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("checkbox", { name: /acme\/repo/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  test("no repositories yet: one Manage access on GitHub action that opens the App install page", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [], nextCursor: null });
    renderPicker();
    const add = await screen.findByRole("link", { name: "Manage access on GitHub" });
    expect(add.getAttribute("href")).toBe(INSTALL_URL);
    expect(add.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  test("returning to the tab reloads the list", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [], nextCursor: null });
    renderPicker();
    await screen.findByRole("link", { name: "Manage access on GitHub" });
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(3)], nextCursor: null });
    fireEvent.focus(window);
    await screen.findByRole("checkbox", { name: /acme\/repo-3/ });
    expect(screen.getByRole("link", { name: "Manage access on GitHub" })).toBeTruthy();
  });

  test("with repositories listed, a Refresh icon reloads them next to an outlined Manage access on GitHub", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(1)], nextCursor: null });
    renderPicker();
    await screen.findByRole("checkbox", { name: /acme\/repo-1/ });
    expect(screen.getByRole("link", { name: "Manage access on GitHub" }).getAttribute("data-variant")).toBe("outline");

    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(1), repo(4)], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("checkbox", { name: /acme\/repo-4/ });
    expect(listRepositoriesMock).toHaveBeenCalledTimes(2);
  });

  test("a repository without admin access says why it is disabled", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(2, false)], nextCursor: null });
    renderPicker();
    const checkbox = await screen.findByRole("checkbox", { name: /acme\/repo-2/ });
    expect(checkbox.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Needs admin access on GitHub")).toBeTruthy();
  });

  test("Cancel is disabled while connecting, and a failed cancel is ignored", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(1)], nextCursor: null });
    saveRepositoriesMock.mockReturnValueOnce(new Promise(() => {}));
    cancelSetupMock.mockRejectedValueOnce(new Error("gone"));
    const view = renderPicker();
    fireEvent.click(await screen.findByRole("checkbox", { name: /acme\/repo-1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancelSetupMock).toHaveBeenCalledTimes(1));

    view.unmount();
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(1)], nextCursor: null });
    renderPicker();
    fireEvent.click(await screen.findByRole("checkbox", { name: /acme\/repo-1/ }));
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole("button", { name: "Save repositories" }));
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
  });

  test("connected repositories start checked; saving connects the new ones and disconnects the unchecked", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(1), repo(2), repo(3)], nextCursor: null });
    saveRepositoriesMock.mockResolvedValueOnce([]);
    const onClose = vi.fn();
    renderPicker([connection(1), connection(2)], onClose);
    expect((await screen.findByRole("checkbox", { name: /acme\/repo-1/ })).getAttribute("data-state")).toBe("checked");
    const save = screen.getByRole("button", { name: "Save repositories" });
    expect(save.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/repo-2/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/repo-3/ }));
    // Connecting new repositories needs the sharing consent.
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(consent());
    fireEvent.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveRepositoriesMock).toHaveBeenCalledWith({ setupId: "setup_1", providerRepositoryIds: [3], removeRepositoryLinkIds: ["link_2"] });
  });

  test("only removing repositories needs no consent", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(1, false)], nextCursor: null });
    saveRepositoriesMock.mockResolvedValueOnce([]);
    const onClose = vi.fn();
    renderPicker([connection(1)], onClose);
    // A connected repository stays removable without GitHub admin access.
    fireEvent.click(await screen.findByRole("checkbox", { name: /acme\/repo-1/ }));
    expect(screen.queryByRole("checkbox", { name: /Every member of this project/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save repositories" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveRepositoriesMock).toHaveBeenCalledWith({ setupId: "setup_1", providerRepositoryIds: [], removeRepositoryLinkIds: ["link_1"] });
  });

  test("a failed save leaves every connected repository in place", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(1), repo(2), repo(3)], nextCursor: null });
    saveRepositoriesMock.mockRejectedValueOnce(new Error("GitHub could not be reached"));
    renderPicker([connection(1), connection(2)]);
    fireEvent.click(await screen.findByRole("checkbox", { name: /acme\/repo-2/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/repo-3/ }));
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole("button", { name: "Save repositories" }));
    await waitFor(() => expect(saveRepositoriesMock).toHaveBeenCalled());
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  test("a connected repository GitHub does not list for this user can still be removed alone", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(1)], nextCursor: null });
    renderPicker([connection(1), connection(2)]);
    const hidden = await screen.findByRole("checkbox", { name: /acme\/repo-2/ });
    expect(hidden.getAttribute("data-state")).toBe("checked");
    fireEvent.click(hidden);
    expect(screen.getByRole("button", { name: "Save repositories" }).hasAttribute("disabled")).toBe(false);
  });

  test("an owner heading has the same room above and below it", async () => {
    listRepositoriesMock.mockResolvedValueOnce({ repositories: [repo(1)], nextCursor: null });
    renderPicker();
    await screen.findByRole("checkbox", { name: /acme\/repo-1/ });
    const classes = screen.getByText("acme", { selector: "p" }).className.split(" ");
    expect(classes).toContain("py-3");
    expect(classes.filter((name) => /^p[tb]-/.test(name))).toEqual([]);
  });
});
