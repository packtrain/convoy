/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadListItem } from "./thread-list-item";
import { ARCHIVED_TASK_LIST_ICON_CLASS } from "@/components/blocks/project/task-lists/task-list-identity";

type ThreadRowChat = ComponentProps<typeof ThreadListItem>["chat"];

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children, side, align }: { children: ReactNode; side?: string; align?: string }) => (
    <div data-testid="thread-branch-popover" data-side={side} data-align={align}>
      {children}
    </div>
  ),
}));

describe("ThreadListItem", () => {
  afterEach(() => {
    cleanup();
  });

  test("keeps attention indicator visible in full layout when attention is unacknowledged", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Needs attention",
          status: "failed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: true,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByTitle("Error")).toBeTruthy();
  });

  test("shows the streaming status label in the full-layout title row", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Streaming thread",
          status: "streaming",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByTitle("Streaming response")).toBeDefined();
    expect(screen.getByText("Working")).toBeDefined();
  });

  test.each([
    {
      name: "unread",
      status: "completed" as const,
      hasUnread: true,
      requiresAttention: false,
      highlight: "unread",
      colorClassName: "bg-info",
    },
    {
      name: "in progress",
      status: "streaming" as const,
      hasUnread: true,
      requiresAttention: false,
      highlight: "in-progress",
      colorClassName: "bg-info",
    },
    {
      name: "waiting for input",
      status: "waiting_input" as const,
      hasUnread: true,
      requiresAttention: true,
      highlight: "waiting-input",
      colorClassName: "bg-warning",
    },
    {
      name: "failed",
      status: "failed" as const,
      hasUnread: true,
      requiresAttention: true,
      highlight: "failed",
      colorClassName: "bg-destructive",
    },
  ])("highlights a full-layout $name card from the corner", ({ status, hasUnread, requiresAttention, highlight, colorClassName }) => {
    const { container } = render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Highlighted thread",
          status,
          cliType: "codex",
          hasUnread,
          requiresAttention,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    const cornerHighlight = container.querySelector(`[data-thread-card-highlight="${highlight}"]`);
    expect(cornerHighlight).toBeTruthy();
    expect(cornerHighlight?.className).toContain(colorClassName);
  });

  test("does not add a status corner highlight to compact rows", () => {
    const { container } = render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Compact unread thread",
          status: "completed",
          cliType: "codex",
          hasUnread: true,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(container.querySelector("[data-thread-card-highlight]")).toBeNull();
  });

  test("highlights the active compact thread with only a background and marks its link as current", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Active compact thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    const link = screen.getByRole("link", {
      name: "Open thread Active compact thread",
    });
    const row = screen.getByTitle("Active compact thread").closest(".group");

    expect(link.getAttribute("aria-current")).toBe("page");
    expect(row?.className).toContain("bg-primary/10");
    expect(row?.className).toContain("hover:bg-primary/10");
    expect(row?.className).not.toContain("ring-");
    expect(row?.className).not.toContain("before:");
  });

  test("keeps the active full-layout card selected with a tinted background and subtle outline", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Active full card",
          status: "failed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: true,
          lastActivityAt: Date.now(),
        }}
        isActive
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    const link = screen.getByRole("link", {
      name: "Open thread Active full card",
    });
    const row = screen.getByTitle("Active full card").closest(".group");

    expect(link.getAttribute("aria-current")).toBe("page");
    expect(row?.className).toContain("bg-primary/10");
    expect(row?.className).toContain("hover:bg-primary/10");
    expect(row?.className).toContain("ring-1");
    expect(row?.className).toContain("ring-primary/20");
    expect(row?.className).not.toContain("ring-2");
    expect(row?.className).not.toContain("ring-primary/70");
    expect(screen.getByTitle("Error")).toBeDefined();
  });

  test("renders slash command links as display labels in full layout titles", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "[/client-summary](convoy://command/org:client-summary) test",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    const title = screen.getByTitle("/client-summary test");
    expect(title.textContent).toBe("/client-summary test");
    expect(title.textContent).not.toContain("convoy://command");
    expect(screen.getByText("/client-summary").className).not.toContain("text-info");
  });

  test("renders the branch inline in the full layout metadata", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Worktree thread",
          branch: "feat/thread-branch",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByText("feat/thread-branch")).toBeTruthy();
    expect(screen.queryByTestId("thread-branch-popover")).toBeNull();
  });

  test("hides attention indicator in compact layout after explicit acknowledgment", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Acknowledged thread",
          status: "waiting_input",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.queryByTitle("Awaiting input")).toBeNull();
    expect(screen.queryByTitle("Error")).toBeNull();
    expect(screen.queryByTitle("Unread")).toBeNull();
  });

  test("shows awaiting-input indicator instead of spinner while streaming with a pending interaction", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Question mid-stream",
          status: "streaming",
          hasPendingInteraction: true,
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByTitle("Awaiting input")).toBeTruthy();
    expect(screen.queryByTitle("Streaming response")).toBeNull();
  });

  test("shows awaiting-input indicator in compact layout while streaming with a pending interaction", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Compact question mid-stream",
          status: "streaming",
          hasPendingInteraction: true,
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByTitle("Awaiting input")).toBeTruthy();
    expect(screen.queryByTitle("Streaming response")).toBeNull();
  });

  test("renders slash command links as display labels in compact layout titles", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "[/client-summary](convoy://command/org:client-summary) test",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    const title = screen.getByTitle("/client-summary test");
    expect(title.textContent).toBe("/client-summary test");
    expect(title.textContent).not.toContain("convoy://command");
    expect(screen.getByText("/client-summary").className).not.toContain("text-info");
  });

  test("renders the compact branch details in a popover on the right", () => {
    const lastActivityAt = Date.UTC(2026, 6, 15, 9, 45);
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Compact worktree thread",
          branch: "feat/compact-branch",
          pathLabel: "apps/web",
          pathString: "/workspace/contoso/apps/web",
          gitRemoteUrl: "git@github.com:contoso/contoso.git",
          linesAdded: 234,
          linesRemoved: 34,
          status: "completed",
          cliType: "codex",
          agent: {
            name: "Reviewer",
            color: "blue",
            isDeleted: false,
          },
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt,
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    const popover = screen.getByTestId("thread-branch-popover");
    expect(popover.dataset.side).toBe("right");
    expect(popover.dataset.align).toBe("start");
    expect(within(popover).getByText("Compact worktree thread")).toBeTruthy();
    expect(screen.queryByText("Repository")).toBeNull();
    expect(screen.getByText("contoso/contoso")).toBeTruthy();
    expect(screen.queryByText("Working directory")).toBeNull();
    expect(screen.getByText("apps/web")).toBeTruthy();
    expect(screen.queryByText("Branch")).toBeNull();
    expect(screen.getByText("feat/compact-branch")).toBeTruthy();
    expect(screen.queryByText("Codex")).toBeNull();
    expect(within(popover).getByText("Reviewer")).toBeTruthy();
    expect(screen.getByText("Changes")).toBeTruthy();
    expect(screen.getByLabelText("234 additions, 34 deletions")).toBeTruthy();
    expect(screen.getByText("+234")).toBeTruthy();
    expect(screen.getByText("−34")).toBeTruthy();
    expect(screen.queryByText("Agent")).toBeNull();
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(
      screen.getByText(
        new Date(lastActivityAt).toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
        })
      )
    ).toBeTruthy();
  });

  test("renders the PR badge as an external link in compact and full layouts", () => {
    const pullRequest = {
      provider: "github" as const,
      number: 123,
      title: "Add PR badge",
      url: "https://github.com/contoso/contoso/pull/123",
      state: "open" as const,
      headBranch: "feat/pr-badge",
      baseBranch: "main",
      capturedAt: Date.now(),
    };
    const chat = {
      _id: "thread_1" as Id<"cliThreads">,
      title: "Thread with PR",
      branch: "feat/pr-badge",
      pullRequest,
      status: "completed" as const,
      cliType: "codex" as const,
      hasUnread: false,
      requiresAttention: false,
      lastActivityAt: Date.now(),
    };

    const { unmount } = render(
      <ThreadListItem chat={chat} isActive={false} compactLayout organizationSlug="contoso" projectAlias="OS" showActions={false} />
    );

    const compactBadge = screen.getAllByLabelText(
      "PR #123 · Open — Add PR badge"
    )[0];
    expect(compactBadge.getAttribute("href")).toBe(pullRequest.url);
    expect(compactBadge.getAttribute("target")).toBe("_blank");
    // Badge shows the short PR ref next to the state icon.
    expect(compactBadge.textContent).toBe("#123");
    // Hover card gains the Pull request row with the ref + title link.
    expect(screen.queryByText("Pull request · Open")).toBeNull();
    expect(screen.getByText("PR #123 Add PR badge")).toBeTruthy();
    unmount();

    render(
      <ThreadListItem
        chat={chat}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByLabelText("PR #123 · Open — Add PR badge").getAttribute("href")).toBe(pullRequest.url);
  });

  test("shows the Attached pull request's number in compact and full layouts (OS-2193)", () => {
    const chat = {
      _id: "thread_1" as Id<"cliThreads">,
      title: "Review the PR",
      attachedPullRequest: { owner: "Contoso", name: "Web", number: 7, ref: "contoso/web#7" },
      status: "completed" as const,
      cliType: "codex" as const,
      hasUnread: false,
      requiresAttention: false,
      lastActivityAt: Date.now(),
    };
    for (const compactLayout of [true, false]) {
      const { unmount } = render(
        <ThreadListItem chat={chat} isActive={false} compactLayout={compactLayout} organizationSlug="contoso" projectAlias="OS" showActions={false} />
      );
      const badge = screen.getByLabelText("Attached pull request Contoso/Web#7");
      expect(badge.textContent).toBe("#7");
      expect(badge.getAttribute("href")).toBe("https://github.com/Contoso/Web/pull/7");
      unmount();
    }
  });

  test("an Attached pull request that is also the branch's PR shows once (OS-2193)", () => {
    const chat = {
      _id: "thread_1" as Id<"cliThreads">,
      title: "Review the PR",
      attachedPullRequest: { owner: "contoso", name: "web", number: 7, ref: "contoso/web#7" },
      pullRequest: {
        provider: "github" as const,
        number: 7,
        title: "Add PR badge",
        url: "https://github.com/Contoso/Web/pull/7",
        state: "open" as const,
        headBranch: "feat/pr-badge",
        baseBranch: "main",
        capturedAt: Date.now(),
      },
      status: "completed" as const,
      cliType: "codex" as const,
      hasUnread: false,
      requiresAttention: false,
      lastActivityAt: Date.now(),
    };
    render(<ThreadListItem chat={chat} isActive={false} compactLayout organizationSlug="contoso" projectAlias="OS" showActions={false} />);
    expect(screen.queryByLabelText("Attached pull request contoso/web#7")).toBeNull();
    expect(screen.getAllByLabelText("PR #7 · Open — Add PR badge").length).toBeGreaterThan(0);
  });

  test("run rows link a tinted, name-titled workflow badge to the workflow editor in both layouts", () => {
    const chat = {
      _id: "thread_1" as Id<"cliThreads">,
      title: "Release Train run",
      status: "completed" as const,
      cliType: "claude-code" as const,
      hasUnread: false,
      requiresAttention: false,
      lastActivityAt: Date.now(),
      kind: "group" as const,
      workflowRunId: "run_1" as ThreadRowChat["workflowRunId"],
      workflow: {
        _id: "wf_1" as Id<"workflows">,
        name: "Release Train",
        color: "#ef4444",
      },
    };

    const { unmount } = render(
      <ThreadListItem chat={chat} isActive={false} compactLayout organizationSlug="contoso" projectAlias="OS" showActions={false} />
    );
    const compactBadge = screen.getByLabelText("Workflow: Release Train");
    expect(compactBadge.getAttribute("title")).toBe("Workflow: Release Train");
    // A real anchor, so middle click opens the editor in a new tab.
    expect(compactBadge.getAttribute("href")).toBe("/o/contoso/OS/settings/workflows/wf_1");
    expect(compactBadge.style.color).toBe("rgb(239, 68, 68)");
    unmount();

    render(
      <ThreadListItem
        chat={chat}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );
    const fullBadge = screen.getByLabelText("Workflow: Release Train");
    expect(fullBadge.getAttribute("href")).toBe("/o/contoso/OS/settings/workflows/wf_1");
    expect(fullBadge.style.color).toBe("rgb(239, 68, 68)");
  });

  test("a run row whose workflow no longer resolves keeps a plain, unlinked badge", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Orphaned run",
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
          kind: "group",
          workflowRunId: "run_1" as ThreadRowChat["workflowRunId"],
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    const badge = screen.getByLabelText("Workflow run");
    expect(badge.getAttribute("href")).toBeNull();
  });

  // A lane thread carries the run's id too, but it is *inside* the run — badging
  // it would render twice for one run with no distinction (OS-1879).
  test("renders no workflow badge on a run's lane thread", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_2" as Id<"cliThreads">,
          title: "Release Train — Lane 1",
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
          parentThreadId: "thread_1" as Id<"cliThreads">,
          workflowRunId: "run_1" as ThreadRowChat["workflowRunId"],
          workflow: { _id: "wf_1" as Id<"workflows">, name: "Release Train", color: "#ef4444" },
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.queryByLabelText(/Workflow/)).toBeNull();
  });

  test("renders no workflow badge on rows without a run binding", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Plain thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.queryByLabelText("Workflow run")).toBeNull();
  });

  test("renders no PR badge when the thread has no snapshot", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Thread without PR",
          branch: "feat/no-pr",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.queryByLabelText(/^(PR #|MR !)/)).toBeNull();
    expect(screen.queryByText(/^Pull request ·/)).toBeNull();
  });

  test("labels GitLab snapshots as merge requests", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "GitLab thread",
          status: "completed",
          cliType: "codex",
          pullRequest: {
            provider: "gitlab",
            number: 7,
            title: "Fix pipeline",
            url: "https://gitlab.com/acme/repo/-/merge_requests/7",
            state: "merged",
            headBranch: "fix/pipeline",
            baseBranch: "main",
            capturedAt: Date.now(),
          },
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    const badge = screen.getByLabelText("MR !7 · Merged — Fix pipeline");
    expect(badge.textContent).toBe("!7");
  });

  test("updates compact branch stats when cumulative changes increase", () => {
    const chat = {
      _id: "thread_1" as Id<"cliThreads">,
      title: "Changing thread",
      branch: "feat/changing-thread",
      linesAdded: 10,
      linesRemoved: 2,
      status: "completed" as const,
      cliType: "codex" as const,
      hasUnread: false,
      requiresAttention: false,
      lastActivityAt: Date.now(),
    };
    const { rerender } = render(
      <ThreadListItem chat={chat} isActive={false} compactLayout organizationSlug="contoso" projectAlias="OS" showActions={false} />
    );

    expect(screen.getByLabelText("10 additions, 2 deletions")).toBeTruthy();

    rerender(
      <ThreadListItem
        chat={{ ...chat, linesAdded: 24, linesRemoved: 5 }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByLabelText("24 additions, 5 deletions")).toBeTruthy();
  });

  test("keeps compact metadata visible on hover when actions are hidden", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Single linked thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByText("now").parentElement?.className).not.toContain("group-hover:invisible");
  });

  test("shows an avatar-only agent chip in the full layout", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Bound thread",
          status: "completed",
          cliType: "codex",
          agent: { name: "Reviewer", color: "#22c55e", isDeleted: false },
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByTitle("Reviewer")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    // Name remains available to assistive technology and as a tooltip.
    expect(screen.getByText("Reviewer").className).toContain("sr-only");
  });

  test("shows an avatar-only agent chip in the compact layout", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Bound thread",
          status: "completed",
          cliType: "codex",
          agent: { name: "Reviewer", color: "#22c55e", isDeleted: false },
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByTitle("Reviewer")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    // Name is tooltip/screen-reader only in compact rows.
    expect(screen.getByText("Reviewer").className).toContain("sr-only");
  });

  test("hides compact CLI metadata on hover while keeping the agent visible", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Bound thread",
          status: "completed",
          cliType: "codex",
          agent: { name: "Reviewer", color: "#22c55e", isDeleted: false },
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
      />
    );

    const agentChip = screen.getByTitle("Reviewer");
    const relativeTime = screen.getByText("now");

    expect(agentChip.parentElement?.className).not.toContain("group-hover:invisible");
    expect(relativeTime.parentElement?.className).toContain("group-hover:hidden");
    expect(relativeTime.parentElement?.parentElement?.className).toContain("justify-end");
    expect(relativeTime.parentElement?.querySelector("svg")).toBeTruthy();
  });

  test("keeps compact inline actions hit-testable without an overlay", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Bound thread",
          status: "completed",
          cliType: "codex",
          agent: { name: "Reviewer", color: "#22c55e", isDeleted: false },
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
      />
    );

    const actionsButton = screen.getByRole("button", {
      name: "Thread actions",
    });
    const rowContent = actionsButton.closest(".pointer-events-none");
    const actionRow = actionsButton.parentElement;

    expect(rowContent).toBeTruthy();
    expect(rowContent?.className).toContain("relative");
    expect(actionRow?.className).toContain("group-hover:flex");
    expect(actionRow?.className).not.toContain("absolute");
    expect(actionsButton.className).toContain("pointer-events-auto");
    expect(actionsButton.className).toContain("size-4");
    expect(actionsButton.className).toContain("cursor-pointer");
  });

  test("unmounts the actions menu without an exit animation so it cannot detach while closing", async () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Detaching thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        onRenameRequest={vi.fn()}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0, ctrlKey: false, pointerType: "mouse" }
    );

    const menu = await screen.findByRole("menu");

    // Radix flips the trigger to data-state="closed" at the START of the exit
    // animation while the menu is still mounted and still being re-measured, so
    // no CSS latch can cover the closing window: the hover-swapped trigger goes
    // back to `display: none` and measures 0x0, and the closing menu is
    // repositioned to viewport 0,0. Suppressing the exit animation makes
    // Presence unmount synchronously, removing that window (OS-1596).
    expect(menu.className).toContain("data-closed:animate-none!");
  });

  test("keeps the full-layout actions trigger anchored while its menu is open", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Anchored thread",
          status: "completed",
          cliType: "codex",
          agent: { name: "Reviewer", color: "#22c55e", isDeleted: false },
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
      />
    );

    const actionsButton = screen.getByRole("button", { name: "Thread actions" });
    const actionRow = actionsButton.parentElement;
    const metadata = actionRow?.previousElementSibling;

    // `invisible` keeps the box, but the metadata layer it shares a grid cell
    // with must stay hidden while the menu is open, otherwise both paint at
    // once as soon as the pointer leaves the row (OS-1596).
    expect(actionRow?.className).toContain("group-has-[[data-state=open]]:visible");
    expect(metadata?.className).toContain("group-has-[[data-state=open]]:invisible");
  });

  test("keeps the menu's done action enabled while a run streams (OS-2176)", async () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Running menu thread",
          status: "streaming",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          isDone: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
      />
    );

    fireEvent.contextMenu(screen.getByTitle("Running menu thread"));

    const doneAction = await screen.findByRole("menuitem", { name: "Mark as done" });
    expect(doneAction.hasAttribute("data-disabled")).toBe(false);
  });

  test("opens the thread actions from a row right-click", async () => {
    const onRenameRequest = vi.fn();

    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Context menu thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        onRenameRequest={onRenameRequest}
      />
    );

    fireEvent.contextMenu(screen.getByTitle("Context menu thread"));

    const renameAction = await screen.findByRole("menuitem", {
      name: "Rename",
    });
    fireEvent.click(renameAction);

    expect(onRenameRequest).toHaveBeenCalledTimes(1);
  });

  test("opens thread actions from a compact branch row right-click", async () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Compact context menu thread",
          branch: "feat/context-menu",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        onRenameRequest={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByTitle("Compact context menu thread"));

    expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
  });

  test("does not mount row context actions when actions are hidden", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Actions hidden thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
        onRenameRequest={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByTitle("Actions hidden thread"));

    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
  });

  test("does not mount compact row context actions when actions are hidden", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Compact actions hidden thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
        onRenameRequest={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByTitle("Compact actions hidden thread"));

    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
  });

  test("does not mount compact branch row context actions when actions are hidden", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Compact branch actions hidden thread",
          branch: "feat/actions-hidden",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
        onRenameRequest={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByTitle("Compact branch actions hidden thread"));

    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
  });

  test("renders the deleted-agent placeholder dimmed in rows", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Bound thread",
          status: "completed",
          cliType: "codex",
          agent: { name: "Deleted agent", color: "#94a3b8", isDeleted: true },
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
      />
    );

    expect(screen.getByTitle("Deleted agent").className).toContain("opacity-60");
  });

  test("shows the compact sidebar done shortcut before actions", () => {
    const onToggleDoneRequest = vi.fn();
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Review thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          isDone: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showDoneState
        onToggleDoneRequest={onToggleDoneRequest}
      />
    );

    const doneButton = screen.getByRole("button", { name: "Mark as done" });
    const actionsButton = screen.getByRole("button", {
      name: "Thread actions",
    });
    const actionRow = actionsButton.parentElement;

    expect(actionRow?.firstElementChild).toBe(doneButton);
    expect(actionRow?.className).toContain("gap-1.5");
    expect(actionRow?.className).not.toContain("absolute");
    expect(actionRow?.className).not.toContain("bg-muted");
    expect(doneButton.textContent).toBe("Done");
    expect(doneButton.querySelector("svg")).toBeNull();
    expect(doneButton.getAttribute("data-size")).toBe("2xs");
    expect(doneButton.className).toContain("bg-transparent");
    expect(doneButton.className).toContain("hover:bg-transparent");
    expect(doneButton.className).not.toContain("bg-background");
    expect(actionsButton.className).toContain("hover:bg-transparent");
    expect(doneButton.className).toContain("transition-none");
    fireEvent.click(doneButton);
    expect(onToggleDoneRequest).toHaveBeenCalledWith(expect.objectContaining({ _id: "thread_1" }));
  });

  test("keeps the done shortcut enabled while a run streams (OS-2176)", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Running thread",
          status: "streaming",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          isDone: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showDoneState
        onToggleDoneRequest={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Mark as done" })
    ).toHaveProperty("disabled", false);
  });

  test("shows compact done state in the leading gutter and dims the row", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Finished review",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          isDone: true,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showDoneState
        onToggleDoneRequest={vi.fn()}
      />
    );

    const doneIndicator = screen.getByTitle("Done");
    const row = screen.getByTitle("Finished review").closest(".group");

    expect(doneIndicator.parentElement?.firstElementChild).toBe(doneIndicator);
    expect(row?.className).toContain("opacity-60");
    expect(screen.getByRole("button", { name: "Mark as not done" })).toBeTruthy();
  });

  test("shows the full-layout done checkmark before the task ref and title", () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Finished review",
          associatedTask: {
            _id: "task_1" as Id<"tasks">,
            refId: "OS-42",
            name: "Fix login",
            isArchived: false,
            taskType: {
              key: "task",
              name: "Task",
              icon: "SquareCheckBig",
              color: "#64748b",
              isSystem: true,
            },
          },
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          isDone: true,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showDoneState
        onToggleDoneRequest={vi.fn()}
      />
    );

    const doneButton = screen.getByRole("button", {
      name: "Mark as not done",
    });
    const actionsButton = screen.getByRole("button", {
      name: "Thread actions",
    });
    const title = screen.getByTitle("Finished review");
    const doneIndicator = screen.getByTitle("Done");
    const taskRef = screen.getByRole("link", { name: /OS-42/i });
    const titleRow = title.parentElement;
    const topLine = title.parentElement?.parentElement;

    expect(doneButton.textContent).toBe("Not done");
    expect(doneButton.className).toContain("rounded-full");
    expect(doneButton.querySelector("svg")).toBeNull();
    expect(doneButton.getAttribute("data-size")).toBe("2xs");
    expect(topLine?.contains(doneButton)).toBe(true);
    expect(actionsButton.parentElement?.contains(doneButton)).toBe(false);
    expect(Array.from(titleRow?.children ?? [])).toEqual([
      doneIndicator,
      taskRef,
      title,
    ]);
  });

  const multiSelectChat = {
    _id: "thread_1" as Id<"cliThreads">,
    title: "Selectable thread",
    status: "completed" as const,
    cliType: "codex" as const,
    hasUnread: false,
    requiresAttention: false,
    lastActivityAt: Date.now(),
  };

  test("does not mount a selection checkbox outside multiselect mode", () => {
    render(
      <ThreadListItem
        chat={multiSelectChat}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
        onToggleSelect={vi.fn()}
      />
    );

    expect(
      screen.queryByRole("checkbox", {
        name: "Select thread Selectable thread",
      })
    ).toBeNull();
  });

  test("multiselect mode shows a persistent checkbox and toggles without navigating", () => {
    const onToggleSelect = vi.fn();
    const onSelectThread = vi.fn();
    render(
      <ThreadListItem
        chat={multiSelectChat}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
        multiSelectEnabled
        selected={false}
        onToggleSelect={onToggleSelect}
        onSelectThread={onSelectThread}
      />
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Select thread Selectable thread",
    });
    // Persistent: no hover-gated visibility classes on the checkbox.
    expect(checkbox.className).not.toContain("group-hover");

    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith(multiSelectChat._id, false);
    expect(onSelectThread).not.toHaveBeenCalled();
  });

  test("multiselect checkbox forwards shift+click in compact layout", () => {
    const onToggleSelect = vi.fn();
    render(
      <ThreadListItem
        chat={multiSelectChat}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
        multiSelectEnabled
        selected={false}
        onToggleSelect={onToggleSelect}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select thread Selectable thread" }), { shiftKey: true });
    expect(onToggleSelect).toHaveBeenCalledWith(multiSelectChat._id, true);
  });

  test("keeps the status indicator visible next to the checkbox", () => {
    render(
      <ThreadListItem
        chat={{ ...multiSelectChat, status: "failed", requiresAttention: true }}
        isActive={false}
        compactLayout
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
        multiSelectEnabled
        selected={false}
        onToggleSelect={vi.fn()}
      />
    );

    expect(screen.getByRole("checkbox", { name: "Select thread Selectable thread" })).toBeDefined();
    expect(screen.getByTitle("Error")).toBeDefined();
  });

  test("selected rows get the selection background", () => {
    render(
      <ThreadListItem
        chat={multiSelectChat}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        showActions={false}
        multiSelectEnabled
        selected
        onToggleSelect={vi.fn()}
      />
    );

    const row = screen.getByTitle("Selectable thread").closest(".group");
    expect(row?.className).toContain("bg-muted/70");
  });

  test("group container renders the same card driven by the projected status and hides Continue locally", async () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Group row",
          kind: "group",
          status: "streaming",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        onRenameRequest={vi.fn()}
      />
    );

    // Same card: the projected status drives the normal spinner/label.
    expect(screen.getByTitle("Streaming response")).toBeDefined();
    expect(screen.getByText("Working")).toBeDefined();

    fireEvent.contextMenu(screen.getByTitle("Group row"));
    expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Continue locally" })).toBeNull();
  });

  test("plain threads keep the Continue locally action", async () => {
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Plain row",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        onRenameRequest={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByTitle("Plain row"));
    expect(await screen.findByRole("menuitem", { name: "Continue locally" })).toBeTruthy();
  });

  test("Copy thread ID copies the raw thread id", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <ThreadListItem
        chat={{
          _id: "thread_1" as Id<"cliThreads">,
          title: "Id row",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        }}
        isActive={false}
        compactLayout={false}
        organizationSlug="contoso"
        projectAlias="OS"
        onRenameRequest={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByTitle("Id row"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy thread ID" }));

    expect(writeText).toHaveBeenCalledWith("thread_1");
  });

  // Read-only sharing (OS-1575, docs/specs/cli-thread-sharing.md). The owner
  // toggles it from the same menu the row, the tab and the detail header share.
  describe("shared badge (OS-1576)", () => {
    function renderSharedRow(
      compactLayout: boolean,
      chat: Partial<ThreadRowChat> = {}
    ) {
      render(
        <ThreadListItem
          chat={{
            _id: "thread_1" as Id<"cliThreads">,
            title: "Shared row",
            status: "completed",
            cliType: "codex",
            hasUnread: false,
            requiresAttention: false,
            lastActivityAt: Date.now(),
            ...chat,
          }}
          isActive={false}
          compactLayout={compactLayout}
          organizationSlug="contoso"
          projectAlias="OS"
          showActions={false}
        />
      );
    }

    test.each([true, false])(
      "marks a shared row (compactLayout: %s)",
      (compactLayout) => {
        renderSharedRow(compactLayout, { sharedAt: 1000 });

        expect(screen.getByTitle("Shared with project")).toBeDefined();
      }
    );

    test.each([true, false])(
      "leaves an unshared row unmarked (compactLayout: %s)",
      (compactLayout) => {
        renderSharedRow(compactLayout);

        expect(screen.queryByTitle("Shared with project")).toBeNull();
      }
    );

    test.each([true, false])(
      "names the badge for assistive tech (compactLayout: %s)",
      (compactLayout) => {
        renderSharedRow(compactLayout, { sharedAt: 1000 });

        // `aria-label` is ignored on a role-less element, and the icon is
        // `aria-hidden`, so without a role the badge has no accessible name.
        expect(
          screen.getByRole("img", { name: "Shared with project" })
        ).toBeDefined();
      }
    );

    test.each([true, false])(
      "keeps the badge hit-testable so its tooltip can fire (compactLayout: %s)",
      (compactLayout) => {
        renderSharedRow(compactLayout, { sharedAt: 1000 });

        // Both row bodies are `pointer-events-none`. Without opting back in,
        // hit-testing skips the badge and its `title` — the only thing that
        // explains an icon-only marker — never shows.
        expect(screen.getByTitle("Shared with project").className).toContain(
          "pointer-events-auto"
        );
      }
    );

    test.each([true, false])(
      "colours the badge like the header's Shared pill (compactLayout: %s)",
      (compactLayout) => {
        renderSharedRow(compactLayout, { sharedAt: 1000 });

        // Same amber as the thread header, so the row and the detail view do
        // not disagree about what "shared" looks like (OS-1799).
        expect(screen.getByTitle("Shared with project").className).toContain(
          ARCHIVED_TASK_LIST_ICON_CLASS
        );
      }
    );

    test.each([true, false])(
      "orders the badge after the PR badge (compactLayout: %s)",
      (compactLayout) => {
        renderSharedRow(compactLayout, {
          sharedAt: 1000,
          pullRequest: {
            provider: "github",
            number: 7,
            title: "Share threads",
            url: "https://github.com/contoso/contoso/pull/7",
            state: "open",
            headBranch: "feat/share",
            baseBranch: "main",
            capturedAt: 1000,
          },
        });

        const prBadge = screen.getAllByLabelText(
          "PR #7 · Open — Share threads"
        )[0];
        const sharedBadge = screen.getAllByRole("img", {
          name: "Shared with project",
        })[0];

        // Same relative order in both densities, so toggling the density
        // preference does not shuffle two adjacent icons.
        expect(
          prBadge.compareDocumentPosition(sharedBadge) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      }
    );
  });

  describe("share actions", () => {
    function renderRow(chat: Partial<ThreadRowChat> & { title: string }) {
      render(
        <ThreadListItem
          chat={{
            _id: "thread_1" as Id<"cliThreads">,
            status: "completed",
            cliType: "codex",
            hasUnread: false,
            requiresAttention: false,
            lastActivityAt: Date.now(),
            ...chat,
          }}
          isActive={false}
          compactLayout={false}
          organizationSlug="contoso"
          projectAlias="OS"
          onRenameRequest={vi.fn()}
        />
      );
      fireEvent.contextMenu(screen.getByTitle(chat.title));
    }

    // `share` patches only `sharedAt` — no `lastActivityAt` bump — so the memo
    // comparator is the only thing standing between the subscription update and
    // the row. Mounting fresh per assertion (as the tests below do) cannot catch
    // this: the row has to survive a re-render with the new value.
    test("the open menu follows a share that lands while it is open", () => {
      const chat = {
        _id: "thread_1" as Id<"cliThreads">,
        title: "Live row",
        status: "completed" as const,
        cliType: "codex" as const,
        hasUnread: false,
        requiresAttention: false,
        lastActivityAt: 1_000,
      };
      // Every other prop must keep its identity across the rerender, or the
      // comparator bails for an unrelated reason and proves nothing.
      const onRenameRequest = vi.fn();
      const row = (rowChat: typeof chat & { sharedAt?: number }) => (
        <ThreadListItem
          chat={rowChat}
          isActive={false}
          compactLayout={false}
          organizationSlug="contoso"
          projectAlias="OS"
          onRenameRequest={onRenameRequest}
        />
      );

      const { rerender } = render(row(chat));
      fireEvent.contextMenu(screen.getByTitle("Live row"));
      expect(
        screen.getByRole("menuitem", { name: "Share with project team" })
      ).toBeTruthy();

      // Same row, new subscription payload: only `sharedAt` changed.
      rerender(row({ ...chat, sharedAt: 2_000 }));

      expect(screen.getByRole("menuitem", { name: "Stop sharing" })).toBeTruthy();
      expect(
        screen.queryByRole("menuitem", { name: "Share with project team" })
      ).toBeNull();
    });

    test("an unshared thread offers Share with project team", async () => {
      renderRow({ title: "Unshared row" });

      expect(
        await screen.findByRole("menuitem", { name: "Share with project team" })
      ).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Stop sharing" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull();
    });

    test("a shared thread offers Copy link and Stop sharing", async () => {
      renderRow({ title: "Shared row", sharedAt: Date.now() });

      expect(await screen.findByRole("menuitem", { name: "Copy link" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Stop sharing" })).toBeTruthy();
      expect(
        screen.queryByRole("menuitem", { name: "Share with project team" })
      ).toBeNull();
    });

    test("Copy link copies the thread's absolute URL", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      renderRow({ title: "Copyable row", sharedAt: Date.now() });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));

      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/o/contoso/OS/threads/thread_1`
      );
    });

    // The backend rejects a workflow run's container (`SHARE_WORKFLOW_RUN`),
    // so the menu must not offer an action that can only fail.
    test("a workflow run offers no share action", async () => {
      renderRow({ title: "Run row", kind: "group", workflowRunId: "wfrun_1" as Id<"workflowRuns"> });

      expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
      expect(
        screen.queryByRole("menuitem", { name: "Share group" })
      ).toBeNull();
      expect(
        screen.queryByRole("menuitem", { name: "Share with project team" })
      ).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull();
    });

    // A group is shared as one unit (OS-1579): the container is the shareable
    // row, and its tabs act on it rather than on themselves.
    describe("group sharing (OS-1579)", () => {
      test("a group container offers to share the whole group", async () => {
        renderRow({ title: "Group row", kind: "group" });

        expect(
          await screen.findByRole("menuitem", { name: "Share group" })
        ).toBeTruthy();
      });

      test("a shared group container offers Copy link and Stop sharing group", async () => {
        renderRow({ title: "Group row", kind: "group", sharedAt: Date.now() });

        expect(await screen.findByRole("menuitem", { name: "Copy link" })).toBeTruthy();
        expect(
          screen.getByRole("menuitem", { name: "Stop sharing group" })
        ).toBeTruthy();
      });

      // The child never carries `sharedAt` of its own — the group's state
      // arrives as `containerSharedAt`, and reading its own field would show
      // "Share" on an already-shared group.
      test("a group child reads its container's share state", async () => {
        renderRow({
          title: "Child row",
          parentThreadId: "container_1" as Id<"cliThreads">,
          containerKind: "group",
          containerSharedAt: 4000,
        });

        expect(
          await screen.findByRole("menuitem", { name: "Stop sharing group" })
        ).toBeTruthy();
        expect(
          screen.queryByRole("menuitem", { name: "Share group" })
        ).toBeNull();
      });

      test("a group child in an unshared group offers to share the group", async () => {
        renderRow({
          title: "Child row",
          parentThreadId: "container_1" as Id<"cliThreads">,
          containerKind: "group",
        });

        expect(
          await screen.findByRole("menuitem", { name: "Share group" })
        ).toBeTruthy();
      });

      // A run tab is indistinguishable from a group tab without the container's
      // run binding — and would offer to share a container the backend refuses
      // (`SHARE_WORKFLOW_RUN`).
      test("a workflow-run child offers no share action", async () => {
        renderRow({
          title: "Run child row",
          parentThreadId: "run_1" as Id<"cliThreads">,
          containerKind: "group",
          containerWorkflowRunId: "wfrun_1" as Id<"workflowRuns">,
        });

        expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
        expect(
          screen.queryByRole("menuitem", { name: "Share group" })
        ).toBeNull();
        expect(
          screen.queryByRole("menuitem", { name: "Share with project team" })
        ).toBeNull();
        expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull();
      });

      test("Copy link on a group child copies the container's URL", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        renderRow({
          title: "Child row",
          parentThreadId: "container_1" as Id<"cliThreads">,
          containerKind: "group",
          containerSharedAt: 4000,
        });
        fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));

        expect(writeText).toHaveBeenCalledWith(
          `${window.location.origin}/o/contoso/OS/threads/container_1`
        );
      });
    });
  });
});
