/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RepoSwitcher } from "./repo-switcher";

describe("RepoSwitcher", () => {
  test("names a repo's worktree by its branch, with its folder path as the title (OS-2647)", () => {
    const repos = [
      { id: "wt", label: "new-app-worktrees/feat-x", kind: "worktree" as const, branch: "feat/x" },
      { id: "new", label: "new-app", kind: "repo" as const },
    ];
    render(<RepoSwitcher repos={repos} value="wt" onChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Repository: feat/x" });
    expect(trigger.getAttribute("title")).toBe("new-app-worktrees/feat-x");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(screen.getByRole("menuitemradio", { name: "feat/x" }).getAttribute("title")).toBe("new-app-worktrees/feat-x");
    expect(screen.getByRole("menuitemradio", { name: "new-app" })).toBeDefined();
  });
});
