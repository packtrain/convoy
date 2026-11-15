/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadSidebarSettings } from "./thread-sidebar-settings";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuRadioGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuRadioItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

function renderSettings(
  callbacks: {
    onEnableMultiSelect?: () => void;
    onViewSharedThreads?: () => void;
    onHideList?: () => void;
  } = {}
) {
  return render(
    <ThreadSidebarSettings
      sortBy="created"
      compactLayout={false}
      groupDone={false}
      onSortByChange={vi.fn()}
      onCompactLayoutChange={vi.fn()}
      onGroupDoneChange={vi.fn()}
      onEnableMultiSelect={callbacks.onEnableMultiSelect}
      onViewSharedThreads={callbacks.onViewSharedThreads}
      onHideList={callbacks.onHideList}
    />
  );
}

describe("ThreadSidebarSettings", () => {
  afterEach(() => {
    cleanup();
  });

  test("the trigger is named and each switch is labelled", () => {
    renderSettings();

    expect(screen.getByRole("button", { name: "Thread list settings" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Compact layout" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Group done threads" })).toBeTruthy();
  });

  test("omits Select multiple when no enable callback is provided (mobile)", () => {
    renderSettings();

    expect(screen.queryByText("Select multiple")).toBeNull();
  });

  test("shows Select multiple and invokes the callback", () => {
    const onEnableMultiSelect = vi.fn();
    renderSettings({ onEnableMultiSelect });

    fireEvent.click(screen.getByText("Select multiple"));

    expect(onEnableMultiSelect).toHaveBeenCalledTimes(1);
  });

  test("omits Shared threads when no callback is provided (mobile)", () => {
    renderSettings();

    expect(screen.queryByText("Shared threads")).toBeNull();
  });

  test("shows Shared threads and invokes the callback (OS-1576)", () => {
    const onViewSharedThreads = vi.fn();
    renderSettings({ onViewSharedThreads });

    fireEvent.click(screen.getByText("Shared threads"));

    expect(onViewSharedThreads).toHaveBeenCalledTimes(1);
  });

  test("omits Hide thread list when no callback is provided (mobile)", () => {
    renderSettings();

    expect(screen.queryByText("Hide thread list")).toBeNull();
  });

  test("Hide thread list is the first entry and invokes the callback", () => {
    const onHideList = vi.fn();
    renderSettings({ onHideList, onEnableMultiSelect: vi.fn() });

    const items = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-label") !== "Thread list settings");
    expect(items[0]?.textContent).toContain("Hide thread list");
    fireEvent.click(items[0]!);

    expect(onHideList).toHaveBeenCalledTimes(1);
  });

  test("Hide thread list shows its shortcut as a keycap", () => {
    renderSettings({ onHideList: vi.fn() });

    const item = screen.getByText("Hide thread list").closest("button");
    expect(item?.querySelector("[data-slot=kbd]")?.textContent).toBe("[");
  });
});
