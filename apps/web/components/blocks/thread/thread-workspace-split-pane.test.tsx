// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ThreadWorkspaceSplitPane } from "./thread-workspace-split-pane";

vi.mock("@/hooks/browser/use-mobile", () => ({ useIsMobile: () => false }));

test("a left sidebar comes before the content and grows to the right", () => {
  render(
    <ThreadWorkspaceSplitPane isSidebarOpen onCloseSidebar={vi.fn()} sidebarTitle="Files" sidebarSide="left">
      <main>Diff</main>
    </ThreadWorkspaceSplitPane>
  );
  const sidebar = screen.getByTestId("thread-detail-sidebar");
  expect(sidebar.nextElementSibling).toBe(screen.getByRole("main"));

  const handle = screen.getByRole("separator");
  const before = Number(handle.getAttribute("aria-valuenow"));
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  expect(screen.getByRole("complementary", { name: "Files" }).className).toContain("border-r");
});

test("the sidebar stays after the content by default", () => {
  render(
    <ThreadWorkspaceSplitPane isSidebarOpen onCloseSidebar={vi.fn()} sidebarTitle="Files">
      <main>Diff</main>
    </ThreadWorkspaceSplitPane>
  );
  expect(screen.getByRole("main").nextElementSibling).toBe(screen.getByTestId("thread-detail-sidebar"));
});
