/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { appRoute } from "@/lib/navigation/routes";
import { WorktreeList } from "./worktree-list";

const navigationState = vi.hoisted(() => ({ search: "", navigate: vi.fn() }));
const convexState = vi.hoisted(() => ({ op: undefined as unknown, enqueue: vi.fn() }));
const toastState = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => (args === "skip" ? undefined : convexState.op),
  useMutation: () => convexState.enqueue,
}));

vi.mock("sonner", () => ({ toast: toastState }));

vi.mock("@/lib/navigation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/navigation")>("@/lib/navigation");
  return {
    ...actual,
    AppLink: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
    useNavigation: () => ({ location: { search: navigationState.search }, push: navigationState.navigate }),
  };
});

const PATHS = [
  { id: "repo", path: "/home/dev/repo", label: "repo" },
  { id: "wt", path: "/home/dev/repo-worktrees/feat-a", label: "feat-a", kind: "worktree" as const, parentPathId: "repo", branch: "feat/a" },
  { id: "lost", path: "/elsewhere/wt", label: "lost", kind: "worktree" as const, parentPathId: "gone", branch: "orphan" },
];

function renderList() {
  return render(listElement());
}

function listElement() {
  return (
    <WorktreeList
      profileId={"profile_1" as Id<"cliProfiles">}
      paths={PATHS}
      organizationSlug="org"
      projectAlias="ABC"
      compactLayout={false}
      avatar={<span>avatar</span>}
    >
      {(toggle) => (
        <button type="button" onClick={toggle}>
          row
        </button>
      )}
    </WorktreeList>
  );
}

describe("WorktreeList", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    navigationState.search = "";
    navigationState.navigate.mockReset();
    convexState.op = undefined;
    convexState.enqueue.mockReset();
    toastState.error.mockReset();
    toastState.success.mockReset();
  });

  test("expands to the repo, its worktree, then orphans, linking to the changes view", () => {
    renderList();
    expect(screen.queryByText("feat/a")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show checkouts" }));

    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.includes("view=changes"));
    expect(links.map((link) => link.textContent)).toEqual(["repodev/repo", "feat/arepo-worktrees/feat-a", "orphan/elsewhere/wt"]);
    expect(links[1].getAttribute("href")).toContain("profileId=profile_1&pathId=wt&view=changes");
  });

  test("a multi-repo folder lists its repos under it, each repo its worktrees (OS-2647)", () => {
    window.localStorage.setItem("convoy.worktree-list-expanded-profiles", JSON.stringify(["profile_1"]));
    render(
      <WorktreeList
        profileId={"profile_1" as Id<"cliProfiles">}
        paths={[
          { id: "acme", path: "/code/acme", label: "acme" },
          { id: "r1", path: "/code/acme/new-app", label: "new-app", kind: "repo", parentPathId: "acme" },
          { id: "r2", path: "/code/acme/packages/api", label: "packages/api", kind: "repo", parentPathId: "acme" },
          { id: "w1", path: "/code/acme/new-app-worktrees/x", label: "x", kind: "worktree", parentPathId: "r1", branch: "feat/x" },
        ]}
        organizationSlug="org"
        projectAlias="ABC"
        compactLayout={false}
        avatar={<span>avatar</span>}
      >
        {() => <span>row</span>}
      </WorktreeList>
    );

    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.includes("view=changes"));
    expect(links.map((link) => link.getAttribute("title"))).toEqual([
      "/code/acme", "/code/acme/new-app", "/code/acme/new-app-worktrees/x", "/code/acme/packages/api",
    ]);
    // A repo opens in its folder's switcher: one URL per view.
    expect(links[1].getAttribute("href")).toContain("pathId=acme&repo=r1&view=changes");
    expect(links[2].getAttribute("href")).toContain("pathId=w1&view=changes");
    expect(screen.queryByText("2 repos")).toBeNull();
  });

  test("marks the repo row open in its folder's switcher, not the folder row", () => {
    window.localStorage.setItem("convoy.worktree-list-expanded-profiles", JSON.stringify(["profile_1"]));
    navigationState.search = "?view=changes&profileId=profile_1&pathId=acme&repo=r1";
    render(
      <WorktreeList
        profileId={"profile_1" as Id<"cliProfiles">}
        paths={[
          { id: "acme", path: "/code/acme", label: "acme" },
          { id: "r1", path: "/code/acme/new-app", label: "new-app", kind: "repo", parentPathId: "acme" },
        ]}
        organizationSlug="org"
        projectAlias="ABC"
        compactLayout={false}
        avatar={<span>avatar</span>}
      >
        {() => <span>row</span>}
      </WorktreeList>
    );
    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("title"))).toEqual(["/code/acme/new-app"]);
    navigationState.search = "";
  });

  test("the row toggles the checkouts like the chevron", () => {
    renderList();

    fireEvent.click(screen.getByRole("button", { name: "row" }));
    expect(screen.getByText("feat/a")).toBeDefined();
    expect(screen.getByRole("button", { name: "Hide checkouts" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "row" }));
    expect(screen.queryByText("feat/a")).toBeNull();
  });

  test("sorts checkouts by label and worktrees by branch, not stored order", () => {
    window.localStorage.setItem("convoy.worktree-list-expanded-profiles", JSON.stringify(["profile_1"]));
    render(
      <WorktreeList
        profileId={"profile_1" as Id<"cliProfiles">}
        paths={[
          { id: "zed", path: "/home/dev/zed", label: "zed" },
          { id: "zed-b", path: "/home/dev/zed-worktrees/b", label: "b", kind: "worktree", parentPathId: "zed", branch: "feat/b" },
          { id: "zed-a", path: "/home/dev/zed-worktrees/a", label: "a", kind: "worktree", parentPathId: "zed", branch: "feat/a" },
          { id: "alpha", path: "/home/dev/alpha", label: "alpha" },
        ]}
        organizationSlug="org"
        projectAlias="ABC"
        compactLayout={false}
        avatar={<span>avatar</span>}
      >
        {() => <span>row</span>}
      </WorktreeList>
    );

    const names = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.includes("view=changes"))
      .map((link) => link.getAttribute("title"));
    expect(names).toEqual(["/home/dev/alpha", "/home/dev/zed", "/home/dev/zed-worktrees/a", "/home/dev/zed-worktrees/b"]);
  });

  test("marks the checkout whose changes view is open", () => {
    window.localStorage.setItem("convoy.worktree-list-expanded-profiles", JSON.stringify(["profile_1"]));
    navigationState.search = "?view=changes&profileId=profile_1&pathId=wt";

    renderList();

    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["feat/arepo-worktrees/feat-a"]);
  });

  test("only worktree rows offer Remove, behind a confirm dialog (OS-2459)", async () => {
    window.localStorage.setItem("convoy.worktree-list-expanded-profiles", JSON.stringify(["profile_1"]));
    navigationState.search = "?view=changes&profileId=profile_1&pathId=wt";
    convexState.enqueue.mockResolvedValue("op_1");
    const view = renderList();

    expect(screen.queryByRole("button", { name: "Remove worktree repo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove worktree feat/a" }));
    expect(screen.getByText(/\/home\/dev\/repo-worktrees\/feat-a will be deleted/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Remove worktree" }));

    await waitFor(() => expect(convexState.enqueue).toHaveBeenCalledWith({ profileId: "profile_1", kind: "remove", pathId: "wt" }));
    convexState.op = { _id: "op_1", status: "done" };
    await act(async () => view.rerender(listElement()));

    expect(toastState.success).toHaveBeenCalledWith("Worktree removed");
    // Its changes view was open, so the page goes back to the threads page.
    expect(navigationState.navigate).toHaveBeenCalledWith(appRoute.projectThreads("org", "ABC"));
  });

  test("a refused removal toasts the CLI error with a View changes action (OS-2459)", async () => {
    window.localStorage.setItem("convoy.worktree-list-expanded-profiles", JSON.stringify(["profile_1"]));
    convexState.enqueue.mockResolvedValue("op_1");
    const view = renderList();

    fireEvent.click(screen.getByRole("button", { name: "Remove worktree feat/a" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove worktree" }));
    await waitFor(() => expect(convexState.enqueue).toHaveBeenCalled());
    convexState.op = { _id: "op_1", status: "failed", error: "Worktree has uncommitted changes" };
    await act(async () => view.rerender(listElement()));

    expect(toastState.error).toHaveBeenCalledTimes(1);
    const [message, options] = toastState.error.mock.calls[0];
    expect(message).toBe("Worktree has uncommitted changes");
    options.action.onClick();
    expect(navigationState.navigate).toHaveBeenCalledWith(
      appRoute.projectThreadsWithPreselection("org", "ABC", { profileId: "profile_1", pathId: "wt", view: "changes" })
    );
    expect(navigationState.navigate).toHaveBeenCalledTimes(1);
  });
});
