/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { MobileThreadListPanel } from "./mobile-thread-list-panel";

const threadsState = vi.hoisted(() => ({ isLoading: false }));

vi.mock("@/lib/threads/hooks/use-cli-threads", () => ({
  useCliThreads: () => ({
    threads: [],
    doneThreads: [],
    pinnedThreads: [],
    isLoading: threadsState.isLoading,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    hasMoreDone: false,
    isLoadingMoreDone: false,
    loadMoreDone: vi.fn(),
    removeThread: vi.fn(),
    markRead: vi.fn(),
    markUnread: vi.fn(),
    renameThread: vi.fn(),
    pinThread: vi.fn(),
    unpinThread: vi.fn(),
  }),
}));

vi.mock("@/lib/preferences/use-user-preferences", () => ({
  useUserPreferences: () => ({
    threadSortBy: "updatedAt",
    threadCompactLayout: false,
    threadGroupDone: false,
    isLoading: false,
    setThreadSortBy: vi.fn(),
    setThreadCompactLayout: vi.fn(),
    setThreadGroupDone: vi.fn(),
  }),
}));

vi.mock("@/components/blocks/thread/thread-sidebar-settings", () => ({
  ThreadSidebarSettings: () => <div>Settings</div>,
}));

vi.mock("@/components/blocks/thread/thread-list-sections", () => ({
  ThreadListSections: () => <div>Thread sections</div>,
}));

vi.mock("@/components/blocks/thread/thread-connected-clis-section", () => ({
  ThreadConnectedClisSection: ({ projectName }: { projectName: string }) => (
    <div>Connected CLIs for {projectName}</div>
  ),
}));

vi.mock("@/components/blocks/thread/rename-thread-dialog", () => ({
  RenameThreadDialog: () => null,
}));

vi.mock("@/components/blocks/thread/delete-thread-dialog", () => ({
  DeleteThreadDialog: () => null,
}));

describe("MobileThreadListPanel", () => {
  afterEach(() => {
    cleanup();
    threadsState.isLoading = false;
  });

  test("skeletons the thread rows while the list loads", () => {
    threadsState.isLoading = true;
    render(
      <MobileThreadListPanel
        projectId={"project_1" as Id<"projects">}
        projectName="Project Alpha"
        organizationSlug="org"
        projectAlias="ABC"
        currentThreadId={undefined}
        onClose={() => {}}
      />
    );

    expect(screen.getByLabelText("Loading threads").querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });

  test("shows Connected CLIs above the thread sections (OS-1993)", () => {
    render(
      <MobileThreadListPanel
        projectId={"project_1" as Id<"projects">}
        projectName="Project Alpha"
        organizationSlug="org"
        projectAlias="ABC"
        currentThreadId={undefined}
        onClose={() => {}}
      />
    );

    const text = document.body.textContent ?? "";
    expect(text.indexOf("Connected CLIs for Project Alpha")).toBeGreaterThan(-1);
    expect(text.indexOf("Connected CLIs")).toBeLessThan(text.indexOf("Thread sections"));
  });
});
