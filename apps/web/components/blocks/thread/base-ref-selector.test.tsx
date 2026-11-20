/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WorkspaceSelectors } from "./base-ref-selector";
import type { BaseRefPathEntry } from "@/lib/threads/base-ref-selection";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => "op_1"),
  useQuery: () => undefined,
}));

const PATHS: BaseRefPathEntry[] = [
  { id: "path_1", path: "/repo", label: "repo", gitRemoteUrl: "git@github.com:acme/repo.git" },
  { id: "wt_1", path: "/repo-worktrees/feat-x", label: "feat-x", kind: "worktree", parentPathId: "path_1", branch: "feat/x" },
];

const BASE_PROPS = {
  profileId: "profile_1",
  pathId: "path_1",
  paths: PATHS,
  isProfileOnline: false,
  onChange: vi.fn(),
};

describe("WorkspaceSelectors", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  test("default selection shows the local environment and the locally checked-out branch", () => {
    window.localStorage.setItem(
      "convoy.base-ref-refs:profile_1:path_1",
      JSON.stringify({ refs: [{ name: "main", isCurrent: true, remoteOnly: false }] })
    );
    render(<WorkspaceSelectors {...BASE_PROPS} value={undefined} />);

    expect(screen.getByTitle("Environment: Work locally")).toBeDefined();
    expect(screen.getByTitle("Environment: Work locally").querySelector("span")?.className).toContain("@2xl/composer-bar:inline");
    expect(screen.getByTitle("Branch checked out locally: main")).toBeDefined();
  });

  test("existing-worktree selection shows the worktree environment and its branch", () => {
    render(<WorkspaceSelectors {...BASE_PROPS} value={{ type: "worktree", pathId: "wt_1" }} />);

    expect(screen.getByTitle("Environment: Worktree")).toBeDefined();
    expect(screen.getByTitle("Worktree branch: feat/x")).toBeDefined();
  });

  test("new-worktree selection exposes an editable base-branch trigger", () => {
    render(<WorkspaceSelectors {...BASE_PROPS} value={{ type: "branch", baseRef: undefined, startFromOrigin: false }} />);

    expect(screen.getByTitle("Environment: New worktree")).toBeDefined();
    expect(screen.getByTitle("Base branch: Default branch")).toBeDefined();
  });

  test("renders nothing for paths without a git origin", () => {
    const { container } = render(
      <WorkspaceSelectors
        {...BASE_PROPS}
        paths={[{ id: "path_1", path: "/plain", label: "plain" }]}
        value={undefined}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
