/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { PullRequestSelectorDialog } from "./pull-request-selector-dialog";

// cmdk measures its list and scrolls the active item; jsdom has neither.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

let listStatus = "Exhausted";
vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({
    results: [
      { _id: "pr_1", repositoryId: "repo_1", number: 482, title: "Add search", author: "octocat", state: "open", draft: false },
      { _id: "pr_2", repositoryId: "repo_1", number: 17, title: "Fix login", author: "maya", state: "open", draft: false },
    ],
    status: listStatus,
    loadMore: vi.fn(),
  }),
}));
vi.mock("./use-integration-status", () => ({
  useIntegrationStatus: () => ({ connections: [{ repositoryId: "repo_1", repository: { owner: "acme", name: "web" } }] }),
}));

const onSelect = vi.fn();
const dialog = () => render(<PullRequestSelectorDialog projectId={"project_1" as Id<"projects">} open onOpenChange={vi.fn()} onSelect={onSelect} />);
const search = (value: string) => fireEvent.change(screen.getByPlaceholderText("Search pull requests or paste a URL..."), { target: { value } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listStatus = "Exhausted";
});

describe("PullRequestSelectorDialog (OS-2193)", () => {
  test("filters loaded PRs by title or #number and attaches the picked one", () => {
    dialog();
    search("login");
    expect(screen.queryByText("Add search")).toBeNull();
    search("#48");
    fireEvent.click(screen.getByText("Add search"));
    expect(onSelect).toHaveBeenCalledWith({ owner: "acme", name: "web", number: 482, ref: "acme/web#482" });
  });

  test("a pasted URL from an unconnected repository attaches too", () => {
    dialog();
    search("https://github.com/Other/Repo/pull/9");
    fireEvent.click(screen.getByText("Attach Other/Repo#9"));
    expect(onSelect).toHaveBeenCalledWith({ owner: "Other", name: "Repo", number: 9, ref: "other/repo#9" });
  });

  test("no loaded match says more can be loaded", () => {
    listStatus = "CanLoadMore";
    dialog();
    search("nothing like this");
    expect(screen.getByText("No loaded pull requests match. Load more, or paste a pull request URL.")).toBeTruthy();
  });
});
