/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProfileHoverCard } from "./profile-hover-card";

type RootProps = { open?: boolean; onOpenChange?: (open: boolean) => void; openDelay?: number; closeDelay?: number };
const rootProps = vi.hoisted(() => ({ current: null as RootProps | null }));
const contentProps = vi.hoisted(() => ({ current: null as { side?: string } | null }));

vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children, ...props }: RootProps & { children: ReactNode }) => {
    rootProps.current = props;
    return <div>{children}</div>;
  },
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HoverCardContent: ({ children, side }: { children: ReactNode; side?: string }) => {
    contentProps.current = { side };
    return <div>{children}</div>;
  },
}));

describe("ProfileHoverCard", () => {
  test("uses the specified delay and renders profile connection details", () => {
    render(
      <ProfileHoverCard
        profile={{
          name: "Local Dev",
          profileKey: "os-devcontainer",
          hostname: "workstation.local",
          isOnline: true,
          createdAt: new Date("2026-07-10T10:00:00Z").getTime(),
          sessionStartedAt: Date.now() - 60_000,
          runtimes: [{ type: "codex", version: "0.9.0" }],
          paths: [{ id: "path-1", label: "workspace", path: "/workspace" }],
        }}
      >
        <span>Local Dev</span>
      </ProfileHoverCard>
    );

    expect(rootProps.current).toMatchObject({ openDelay: 500, closeDelay: 120 });
    expect(screen.getByText("workstation.local")).toBeDefined();
    expect(screen.getByText("Codex")).toBeDefined();
    expect(screen.getByText("/workspace")).toBeDefined();
  });

  test("stays closed after being disabled while open (OS-2253)", () => {
    const profile = { name: "Local Dev", isOnline: true, runtimes: [], paths: [] };
    const { rerender } = render(
      <ProfileHoverCard profile={profile}>
        <span>Local Dev</span>
      </ProfileHoverCard>
    );
    act(() => rootProps.current?.onOpenChange?.(true));
    expect(rootProps.current?.open).toBe(true);

    rerender(
      <ProfileHoverCard profile={profile} disabled>
        <span>Local Dev</span>
      </ProfileHoverCard>
    );
    rerender(
      <ProfileHoverCard profile={profile}>
        <span>Local Dev</span>
      </ProfileHoverCard>
    );
    expect(rootProps.current?.open).toBe(false);
  });

  test("lists a folder's repos under it (OS-2647)", () => {
    render(
      <ProfileHoverCard
        profile={{
          name: "Local Dev",
          isOnline: true,
          runtimes: [],
          paths: [
            { id: "acme", label: "acme", path: "/code/acme" },
            { id: "r1", label: "new-app", path: "/code/acme/new-app", kind: "repo", parentPathId: "acme" },
            { id: "r2", label: "packages/api", path: "/code/acme/packages/api", kind: "repo", parentPathId: "acme" },
          ],
        }}
      >
        <span>Local Dev</span>
      </ProfileHoverCard>
    );

    expect(screen.getByRole("list", { name: "Repos in acme" }).textContent).toBe("new-apppackages/api");
    expect(screen.queryByText("2 repos")).toBeNull();
  });

  test("opens below its trigger on a phone, where there is no room beside it", () => {
    const width = window.innerWidth;
    window.innerWidth = 390;
    try {
      render(
        <ProfileHoverCard profile={{ name: "Local Dev", isOnline: true, runtimes: [], paths: [] }}>
          <span>Local Dev</span>
        </ProfileHoverCard>
      );
      expect(contentProps.current?.side).toBe("bottom");
    } finally {
      window.innerWidth = width;
    }
  });

  test("nests a repo's worktrees under it and counts one worktree in the singular", () => {
    render(
      <ProfileHoverCard
        profile={{
          name: "Local Dev",
          isOnline: true,
          runtimes: [],
          paths: [
            { id: "acme", label: "acme", path: "/code/acme" },
            { id: "r1", label: "new-app", path: "/code/acme/new-app", kind: "repo", parentPathId: "acme" },
            { id: "w1", label: "feat/x", path: "/code/acme/new-app-worktrees/feat-x", kind: "worktree", parentPathId: "r1" },
          ],
        }}
      >
        <span>Local Dev</span>
      </ProfileHoverCard>
    );

    expect(screen.getByRole("list", { name: "Worktrees of new-app" }).textContent).toBe("feat/x");
    expect(screen.getByText("1 + 1 worktree")).toBeDefined();
  });
});
