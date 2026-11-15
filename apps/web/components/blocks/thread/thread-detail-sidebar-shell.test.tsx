/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ThreadDetailSidebarShell } from "./thread-detail-sidebar-shell";

const { useIsMobileMock } = vi.hoisted(() => ({
  useIsMobileMock: vi.fn(() => false),
}));

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: useIsMobileMock,
}));

vi.mock("@/components/ui/drawer", () =>
  import("@/test-utils/mocks/drawer")
);

describe("ThreadDetailSidebarShell", () => {
  const bounds = { min: 400, max: 900 };

  afterEach(() => {
    cleanup();
    useIsMobileMock.mockReturnValue(false);
  });

  test("does not render when closed", () => {
    render(
      <ThreadDetailSidebarShell
        isOpen={false}
        width={400}
        onClose={vi.fn()}
        bounds={bounds}
        onResizeMouseDown={vi.fn()}
        onResizeByStep={vi.fn()}
      >
        <div>Sidebar</div>
      </ThreadDetailSidebarShell>
    );

    expect(screen.queryByTestId("thread-detail-sidebar")).toBeNull();
  });

  test("renders the sidebar with an accessible resize separator and close action", () => {
    render(
      <ThreadDetailSidebarShell
        isOpen={true}
        width={420}
        onClose={vi.fn()}
        bounds={bounds}
        onResizeMouseDown={vi.fn()}
        onResizeByStep={vi.fn()}
        title="Thread sidebar"
      >
        <div>Sidebar</div>
      </ThreadDetailSidebarShell>
    );

    const sidebar = screen.getByTestId("thread-detail-sidebar");
    const handle = screen.getByRole("separator", {
      name: "Resize thread detail sidebar",
    });

    expect(sidebar.getAttribute("style")).toContain("width: 420px");
    expect(handle.getAttribute("aria-valuemin")).toBe(String(bounds.min));
    expect(handle.getAttribute("aria-valuemax")).toBe(String(bounds.max));
    expect(handle.getAttribute("aria-valuenow")).toBe("420");
    expect(
      screen.getByTestId("thread-detail-sidebar-body").className
    ).not.toContain("p-4");
    expect(screen.getByRole("button", { name: "Close thread sidebar" })).toBeDefined();
  });

  test("supports keyboard resize step shortcuts and persists updates", () => {
    const onResizeByStep = vi.fn();

    render(
      <ThreadDetailSidebarShell
        isOpen={true}
        width={420}
        onClose={vi.fn()}
        bounds={bounds}
        onResizeMouseDown={vi.fn()}
        onResizeByStep={onResizeByStep}
      >
        <div>Sidebar</div>
      </ThreadDetailSidebarShell>
    );

    const handle = screen.getByRole("separator", {
      name: "Resize thread detail sidebar",
    });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });

    expect(onResizeByStep).toHaveBeenNthCalledWith(1, 16, { persist: true });
    expect(onResizeByStep).toHaveBeenNthCalledWith(2, -48, { persist: true });
  });

  test("can render without the default shell header", () => {
    render(
      <ThreadDetailSidebarShell
        isOpen={true}
        width={420}
        onClose={vi.fn()}
        bounds={bounds}
        onResizeMouseDown={vi.fn()}
        onResizeByStep={vi.fn()}
        title="Task details"
        showHeader={false}
      >
        <div>Sidebar</div>
      </ThreadDetailSidebarShell>
    );

    expect(
      screen.queryByRole("button", { name: "Close thread sidebar" })
    ).toBeNull();
    expect(screen.getByTestId("thread-detail-sidebar-body")).toBeDefined();
  });

  test("renders task details in a full-screen right mobile drawer without resize controls", () => {
    useIsMobileMock.mockReturnValue(true);

    render(
      <ThreadDetailSidebarShell
        isOpen={true}
        width={420}
        onClose={vi.fn()}
        bounds={bounds}
        onResizeMouseDown={vi.fn()}
        onResizeByStep={vi.fn()}
        title="Task details"
        showHeader={false}
      >
        <div>Sidebar</div>
      </ThreadDetailSidebarShell>
    );

    const drawer = screen.getByTestId("thread-detail-drawer");
    expect(screen.getByTestId("drawer-root").getAttribute("data-direction")).toBe("right");
    expect(drawer.className).toContain("h-dvh");
    expect(drawer.className).toContain("w-screen");
    expect(
      screen.queryByRole("separator", { name: "Resize thread detail sidebar" })
    ).toBeNull();
    expect(screen.getByText("Sidebar")).toBeDefined();
  });

  test("does not render the mobile drawer when closed", () => {
    useIsMobileMock.mockReturnValue(true);

    render(
      <ThreadDetailSidebarShell
        isOpen={false}
        width={420}
        onClose={vi.fn()}
        bounds={bounds}
        onResizeMouseDown={vi.fn()}
        onResizeByStep={vi.fn()}
        title="Task details"
      >
        <div>Sidebar</div>
      </ThreadDetailSidebarShell>
    );

    expect(screen.queryByTestId("thread-detail-drawer")).toBeNull();
  });

  test("closes through the existing close handler when mobile drawer dismisses", () => {
    useIsMobileMock.mockReturnValue(true);
    const onClose = vi.fn();

    render(
      <ThreadDetailSidebarShell
        isOpen={true}
        width={420}
        onClose={onClose}
        bounds={bounds}
        onResizeMouseDown={vi.fn()}
        onResizeByStep={vi.fn()}
        title="Task details"
      >
        <div>Sidebar</div>
      </ThreadDetailSidebarShell>
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss drawer" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
