/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { WorktreeList } from "./worktree-list";

const navigationState = vi.hoisted(() => ({ search: "" }));

vi.mock("@/lib/navigation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/navigation")>("@/lib/navigation");
  return {
    ...actual,
    AppLink: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
    useNavigation: () => ({ location: { search: navigationState.search } }),
  };
});

const PATHS = [
  { id: "repo", path: "/home/dev/repo", label: "repo" },
  { id: "wt", path: "/home/dev/repo-worktrees/feat-a", label: "feat-a", kind: "worktree" as const, parentPathId: "repo", branch: "feat/a" },
  { id: "lost", path: "/elsewhere/wt", label: "lost", kind: "worktree" as const, parentPathId: "gone", branch: "orphan" },
];

function renderList() {
  return render(
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
  });

  test("expands to the repo, its worktree, then orphans, linking to the changes view", () => {
    renderList();
    expect(screen.queryByText("feat/a")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show checkouts" }));

    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.includes("view=changes"));
    expect(links.map((link) => link.textContent)).toEqual(["repodev/repo", "feat/arepo-worktrees/feat-a", "orphan/elsewhere/wt"]);
    expect(links[1].getAttribute("href")).toContain("profileId=profile_1&pathId=wt&view=changes");
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
});
