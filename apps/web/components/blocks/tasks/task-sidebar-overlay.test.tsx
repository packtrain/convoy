/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ARTIFACT_RESIZE_BOUNDS, RESIZE_BOUNDS } from "@/lib/tasks/constants";
import {
  TaskSidebarOverlay,
  type TaskSidebarResizeControls,
} from "./task-sidebar-overlay";

const { useIsMobileMock } = vi.hoisted(() => ({
  useIsMobileMock: vi.fn(() => false),
}));

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: useIsMobileMock,
}));

vi.mock("@/components/ui/drawer", () =>
  import("@/test-utils/mocks/drawer")
);

function makeResizeControls(
  overrides: Partial<TaskSidebarResizeControls> = {}
): TaskSidebarResizeControls {
  return {
    width: 420,
    onMouseDown: vi.fn(),
    onStep: vi.fn(),
    ...overrides,
  };
}

describe("TaskSidebarOverlay", () => {
  afterEach(() => {
    cleanup();
    useIsMobileMock.mockReturnValue(false);
  });

  test("exposes accessible resize separator with current width", () => {
    const ref = { current: null };

    render(
      <TaskSidebarOverlay
        sidebarOverlayRef={ref}
        sidebarContainerStyle={{ width: "320px" }}
        isOpen={true}
        detailsResize={makeResizeControls()}
        artifactResize={null}
        onClose={vi.fn()}
      >
        <div>Sidebar</div>
      </TaskSidebarOverlay>
    );

    const handle = screen.getByRole("separator", { name: "Resize task sidebar" });
    expect(handle.getAttribute("aria-valuemin")).toBe(String(RESIZE_BOUNDS.min));
    expect(handle.getAttribute("aria-valuemax")).toBe(String(RESIZE_BOUNDS.max));
    expect(handle.getAttribute("aria-valuenow")).toBe("420");
    expect(
      screen.queryByRole("separator", { name: "Resize artifact panel" })
    ).toBeNull();
  });

  test("renders artifact and task-sidebar handles when an artifact panel is open", () => {
    const ref = { current: null };
    const detailsResize = makeResizeControls();
    const artifactResize = makeResizeControls({ width: 900 });

    render(
      <TaskSidebarOverlay
        sidebarOverlayRef={ref}
        sidebarContainerStyle={{ width: "1200px" }}
        isOpen={true}
        detailsResize={detailsResize}
        artifactResize={artifactResize}
        onClose={vi.fn()}
      >
        <div>Sidebar</div>
      </TaskSidebarOverlay>
    );

    const artifactHandle = screen.getByRole("separator", {
      name: "Resize artifact panel",
    });
    expect(artifactHandle.getAttribute("aria-valuemin")).toBe(
      String(ARTIFACT_RESIZE_BOUNDS.min)
    );
    expect(artifactHandle.getAttribute("aria-valuemax")).toBe(
      String(ARTIFACT_RESIZE_BOUNDS.max)
    );
    expect(artifactHandle.getAttribute("aria-valuenow")).toBe("900");

    const detailsHandle = screen.getByRole("separator", {
      name: "Resize task sidebar",
    });
    expect(detailsHandle.getAttribute("aria-valuenow")).toBe("420");
    // The details handle sits on the artifact/details boundary.
    expect(detailsHandle.style.right).toBe("var(--task-sidebar-effective-width)");

    fireEvent.mouseDown(artifactHandle);
    fireEvent.mouseDown(detailsHandle);
    expect(artifactResize.onMouseDown).toHaveBeenCalledTimes(1);
    expect(detailsResize.onMouseDown).toHaveBeenCalledTimes(1);
  });

  test("supports keyboard resize step shortcuts and persists updates", () => {
    const ref = { current: null };
    const detailsResize = makeResizeControls();
    const artifactResize = makeResizeControls();

    render(
      <TaskSidebarOverlay
        sidebarOverlayRef={ref}
        sidebarContainerStyle={{ width: "320px" }}
        isOpen={true}
        detailsResize={detailsResize}
        artifactResize={artifactResize}
        onClose={vi.fn()}
      >
        <div>Sidebar</div>
      </TaskSidebarOverlay>
    );

    const detailsHandle = screen.getByRole("separator", {
      name: "Resize task sidebar",
    });
    fireEvent.keyDown(detailsHandle, { key: "ArrowLeft" });
    fireEvent.keyDown(detailsHandle, { key: "ArrowRight", shiftKey: true });

    expect(detailsResize.onStep).toHaveBeenNthCalledWith(1, 16, { persist: true });
    expect(detailsResize.onStep).toHaveBeenNthCalledWith(2, -48, { persist: true });

    const artifactHandle = screen.getByRole("separator", {
      name: "Resize artifact panel",
    });
    fireEvent.keyDown(artifactHandle, { key: "ArrowLeft" });
    expect(artifactResize.onStep).toHaveBeenCalledWith(16, { persist: true });
  });

  test("renders task details in a full-screen right drawer on mobile without resize controls", () => {
    useIsMobileMock.mockReturnValue(true);
    const ref = { current: null };

    render(
      <TaskSidebarOverlay
        sidebarOverlayRef={ref}
        sidebarContainerStyle={{ width: "320px" }}
        isOpen={true}
        detailsResize={makeResizeControls()}
        artifactResize={makeResizeControls()}
        onClose={vi.fn()}
      >
        <div>Sidebar</div>
      </TaskSidebarOverlay>
    );

    const drawer = screen.getByTestId("task-detail-drawer");
    expect(screen.getByTestId("drawer-root").getAttribute("data-direction")).toBe("right");
    expect(drawer.className).toContain("h-dvh");
    expect(drawer.className).toContain("w-screen");
    expect(screen.queryByRole("separator", { name: "Resize task sidebar" })).toBeNull();
    expect(screen.queryByRole("separator", { name: "Resize artifact panel" })).toBeNull();
    expect(screen.getByText("Sidebar")).toBeDefined();
  });

  test("does not render the mobile drawer when closed", () => {
    useIsMobileMock.mockReturnValue(true);
    const ref = { current: null };

    render(
      <TaskSidebarOverlay
        sidebarOverlayRef={ref}
        sidebarContainerStyle={{ width: "320px" }}
        isOpen={false}
        detailsResize={makeResizeControls()}
        artifactResize={null}
        onClose={vi.fn()}
      >
        <div>Sidebar</div>
      </TaskSidebarOverlay>
    );

    expect(screen.queryByTestId("task-detail-drawer")).toBeNull();
  });

  test("closes through the existing close handler when mobile drawer dismisses", () => {
    useIsMobileMock.mockReturnValue(true);
    const ref = { current: null };
    const onClose = vi.fn();

    render(
      <TaskSidebarOverlay
        sidebarOverlayRef={ref}
        sidebarContainerStyle={{ width: "320px" }}
        isOpen={true}
        detailsResize={makeResizeControls()}
        artifactResize={null}
        onClose={onClose}
      >
        <div>Sidebar</div>
      </TaskSidebarOverlay>
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss drawer" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
