/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineRun } from "@/lib/threads/run-timeline";
import {
  ThreadChangesToolbar,
  ThreadSidebarTabBar,
  ThreadTabList,
  type ThreadTab,
} from "./thread-sidebar-tabs";

// Render the selector popover inline so its content is testable without Radix
// portal/pointer plumbing.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function makeRun(postRef: string, prompt: string): TimelineRun {
  return {
    prompt,
    additions: 1,
    deletions: 0,
    fileCount: 1,
    createdAt: Date.now(),
    diffSummary: {
      preRef: `pre-${postRef}`,
      postRef,
      files: [],
      fileCount: 1,
      additions: 1,
      deletions: 0,
    },
  };
}

const runs = [makeRun("ref-a", "First run"), makeRun("ref-b", "Second run")];

const defaultTabs: ThreadTab[] = [
  { id: "changes", label: "Changes" },
  { id: "tasks", label: "Tasks" },
];

function renderTabBar(
  overrides: Partial<Parameters<typeof ThreadSidebarTabBar<string>>[0]> = {}
) {
  const props = {
    tabs: defaultTabs,
    activeId: "changes",
    onSelect: vi.fn(),
    onCloseSidebar: vi.fn(),
    ...overrides,
  };
  render(<ThreadSidebarTabBar {...props} />);
  return props;
}

function renderToolbar(overrides: Partial<Parameters<typeof ThreadChangesToolbar>[0]> = {}) {
  const props = {
    label: "All changes",
    changesViewKind: "all" as const,
    runs,
    onSelectView: vi.fn(),
    onOpenRange: vi.fn(),
    onRevertRun: vi.fn(),
    allCollapsed: false,
    onToggleCollapseAll: vi.fn(),
    diffStyle: "unified" as const,
    onToggleDiffStyle: vi.fn(),
    wordWrap: false,
    onToggleWordWrap: vi.fn(),
    ...overrides,
  };
  return { ...props, ...render(<ThreadChangesToolbar {...props} />) };
}

describe("ThreadSidebarTabBar", () => {
  afterEach(cleanup);

  test("selects panels via the underline tabs", () => {
    const { onSelect } = renderTabBar();

    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(onSelect).toHaveBeenCalledWith("tasks");
  });

  test("renders a closable tab for each entry that provides onClose", () => {
    const onClose = vi.fn();
    renderTabBar({
      tabs: [...defaultTabs, { id: "task", label: "ABC-12", onClose }],
    });
    expect(screen.getByRole("tab", { name: "ABC-12" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close ABC-12 tab" }));
    expect(onClose).toHaveBeenCalled();

    cleanup();
    renderTabBar();
    expect(screen.queryByRole("tab", { name: "ABC-12" })).toBeNull();
  });

  test("renders the sidebar collapse toggle at the far-right edge", () => {
    const { onCloseSidebar } = renderTabBar();

    const button = screen.getByRole("button", {
      name: "Close thread sidebar",
    });
    expect(button.getAttribute("data-size")).toBe("icon-sm");
    expect(button.parentElement?.className).toContain("ml-auto");
    expect(button.parentElement?.parentElement?.className).toContain("pr-4");

    fireEvent.click(button);
    expect(onCloseSidebar).toHaveBeenCalledTimes(1);
  });

  // The layout toggle lives here while the sidebar is open so it always sits
  // at the workspace's top-right corner.
  test("renders trailing content before the collapse toggle", () => {
    renderTabBar({ trailing: <button type="button">Switch layout</button> });

    const trailing = screen.getByRole("button", { name: "Switch layout" });
    const close = screen.getByRole("button", { name: "Close thread sidebar" });
    expect(trailing.parentElement).toBe(close.parentElement);
    expect(
      trailing.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  // A read-only viewer keeps the Changes tab visible but inert, so the
  // workspace doesn't silently change shape (docs/specs/cli-thread-sharing.md).
  test("a disabled tab does not select and explains why", () => {
    const { onSelect } = renderTabBar({
      activeId: "tasks",
      tabs: [
        {
          id: "changes",
          label: "Changes",
          disabled: true,
          disabledReason: "Changes are only available to the thread owner",
        },
        { id: "tasks", label: "Tasks" },
      ],
    });

    const tab = screen.getByRole("tab", { name: "Changes" });
    expect(tab.getAttribute("aria-disabled")).toBe("true");
    expect(tab.getAttribute("title")).toBe(
      "Changes are only available to the thread owner"
    );

    fireEvent.click(tab);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("can render the new-thread Tasks-only tab bar", () => {
    renderTabBar({
      tabs: [{ id: "tasks", label: "Tasks" }],
      activeId: "tasks",
    });

    expect(screen.queryByRole("tab", { name: "Changes" })).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Close thread sidebar" })
    ).toBeDefined();
  });
});

describe("ThreadTabList", () => {
  afterEach(cleanup);

  // The full-width layout (OS-1396) puts the thread itself in the tab list,
  // and sub-threads will add more — nothing here may be hardcoded.
  test("renders arbitrary tabs, including the thread tab", () => {
    const onSelect = vi.fn();
    render(
      <ThreadTabList
        tabs={[
          { id: "thread", label: "Thread" },
          { id: "thread:child", label: "Sub-thread" },
          ...defaultTabs,
        ]}
        activeId="thread"
        onSelect={onSelect}
      />
    );

    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(
      screen.getByRole("tab", { name: "Thread" }).getAttribute("aria-selected")
    ).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Sub-thread" }));
    expect(onSelect).toHaveBeenCalledWith("thread:child");
  });

  // Tabs never shrink, so a narrow sidebar must scroll them, not clip them.
  test("scrolls horizontally when the tabs overflow", () => {
    render(<ThreadTabList tabs={defaultTabs} activeId="changes" onSelect={vi.fn()} />);

    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("overflow-x-auto");
    expect(tablist.className).not.toContain("overflow-hidden");
  });

  // The mobile sidebar is a right-hand vaul drawer, which drags on any
  // horizontal swipe unless the target opts out.
  test("swiping the tabs scrolls them instead of dragging the mobile drawer", () => {
    render(<ThreadTabList tabs={defaultTabs} activeId="changes" onSelect={vi.fn()} />);

    expect(screen.getByRole("tablist").hasAttribute("data-vaul-no-drag")).toBe(true);
  });

  test("keeps a tab icon from shrinking when its label is long", () => {
    render(
      <ThreadTabList
        tabs={[
          {
            id: "artifact",
            label: "Code review: Lane types and runtime settings (OS-1813)",
            icon: <svg data-testid="artifact-tab-icon" />,
          },
        ]}
        activeId="artifact"
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByTestId("artifact-tab-icon").parentElement?.className).toContain(
      "shrink-0"
    );
  });
});

describe("ThreadChangesToolbar", () => {
  afterEach(cleanup);

  test("uses the card surface for the secondary toolbar row", () => {
    const { container } = renderToolbar();

    expect(container.firstElementChild?.className).toContain("bg-card");
  });

  test("the selector shows the active view label", () => {
    renderToolbar({ label: "Runs 1-2" });
    expect(
      screen.getByRole("button", { name: /Runs 1-2/ })
    ).toBeTruthy();
  });

  test("the selector menu offers the latest run above All changes", () => {
    const { onSelectView } = renderToolbar({ label: "Run 1" });
    fireEvent.click(screen.getByRole("button", { name: "Run 1" }));
    const items = screen.getAllByRole("button").map((button) => button.textContent);
    expect(items.indexOf("Latest run")).toBeLessThan(items.indexOf("All changes"));
    fireEvent.click(screen.getByRole("button", { name: "Latest run" }));
    expect(onSelectView).toHaveBeenCalledWith("latest");
  });

  test("the selector menu picks the cumulative All changes view", () => {
    const { onSelectView } = renderToolbar({ label: "Run 1" });

    fireEvent.click(screen.getByRole("button", { name: "All changes" }));
    expect(onSelectView).toHaveBeenCalledWith("all");
  });

  test("the selector menu offers Working tree and History only when the caller allows it (OS-2234, OS-2535)", () => {
    renderToolbar();
    expect(screen.queryByRole("button", { name: "Working tree" })).toBeNull();
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    cleanup();

    const { onSelectView } = renderToolbar({ showCheckoutViews: true });
    const items = screen.getAllByRole("button").map((button) => button.textContent);
    expect(items.indexOf("All changes")).toBeLessThan(items.indexOf("Working tree"));
    expect(items.indexOf("Working tree")).toBeLessThan(items.indexOf("History"));
    fireEvent.click(screen.getByRole("button", { name: "Working tree" }));
    expect(onSelectView).toHaveBeenCalledWith("worktree");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onSelectView).toHaveBeenCalledWith("history");
  });

  test("the selector menu commits a run range like the timeline", () => {
    const { onOpenRange } = renderToolbar();

    // First click anchors, second commits — same behavior as the timeline
    // panel. Rows are newest-first, so "Second run" is index 2 (1-based).
    fireEvent.click(screen.getByRole("button", { name: /Second run/ }));
    fireEvent.click(screen.getByRole("button", { name: /First run/ }));
    expect(onOpenRange).toHaveBeenCalledWith(
      expect.objectContaining({ preRef: "pre-ref-a", postRef: "ref-b" }),
      { from: 1, to: 2 }
    );
  });

  test("the collapse-all button toggles and reflects state", () => {
    const { onToggleCollapseAll } = renderToolbar();
    const button = screen.getByRole("button", { name: "Collapse all files" });
    expect(button.getAttribute("data-size")).toBe("icon-sm");
    fireEvent.click(button);
    expect(onToggleCollapseAll).toHaveBeenCalled();

    cleanup();
    renderToolbar({ allCollapsed: true });
    expect(screen.getByRole("button", { name: "Expand all files" })).toBeTruthy();
  });

  test("the diff-style button toggles and reflects state", () => {
    const { onToggleDiffStyle } = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Split diff" }));
    expect(onToggleDiffStyle).toHaveBeenCalled();

    cleanup();
    renderToolbar({ diffStyle: "split" });
    expect(screen.getByRole("button", { name: "Unified diff" })).toBeTruthy();
  });

  test("the word-wrap button toggles and reflects state", () => {
    const { onToggleWordWrap } = renderToolbar();
    const button = screen.getByRole("button", { name: "Enable word wrap" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onToggleWordWrap).toHaveBeenCalled();

    cleanup();
    renderToolbar({ wordWrap: true });
    expect(
      screen.getByRole("button", { name: "Disable word wrap" }).getAttribute("aria-pressed")
    ).toBe("true");
  });
});


test("the file tree toggle exposes its state and invokes its action", () => {
  const onToggleFileTree = vi.fn();
  renderToolbar({ fileTreeOpen: true, onToggleFileTree });
  const button = screen.getByRole("button", { name: "Hide file tree" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button.parentElement?.lastElementChild).toBe(button);
  fireEvent.click(button);
  expect(onToggleFileTree).toHaveBeenCalledOnce();
});

describe("ThreadChangesToolbar diff toggles (UX OS-2535 round 2 #1)", () => {
  afterEach(() => {
    cleanup();
  });

  test("leaves out the diff toggles when no diff is on screen", () => {
    renderToolbar({ changesViewKind: "history", label: "History", diffToggles: false });

    expect(screen.queryByRole("button", { name: "Enable word wrap" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse all files" })).toBeNull();
  });
});
