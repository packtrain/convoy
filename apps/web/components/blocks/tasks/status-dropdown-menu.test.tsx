/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Status } from "@/lib/tasks/types";
import { StatusDropdownMenu } from "./status-dropdown-menu";

if (!globalThis.ResizeObserver) {
  const ResizeObserverMock = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
  };

  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => { };
}

describe("StatusDropdownMenu", () => {
  afterEach(() => {
    cleanup();
  });

  test("focuses the search input when the dropdown opens", async () => {
    render(
      <StatusDropdownMenu
        status={Status.TODO}
        onStatusChange={vi.fn()}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    const input = await screen.findByPlaceholderText("Search statuses...");

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  test("filters the status list as the user types", async () => {
    render(
      <StatusDropdownMenu
        status={Status.TODO}
        onStatusChange={vi.fn()}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    const input = await screen.findByPlaceholderText("Search statuses...");
    fireEvent.change(input, { target: { value: "plan" } });

    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Plan Review")).toBeDefined();
    expect(screen.queryByText("Triage")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  test("selects a filtered status", async () => {
    const onStatusChange = vi.fn();

    render(
      <StatusDropdownMenu
        status={Status.TODO}
        onStatusChange={onStatusChange}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    const input = await screen.findByPlaceholderText("Search statuses...");
    fireEvent.change(input, { target: { value: "blocked" } });
    fireEvent.click(screen.getByText("Blocked"));

    expect(onStatusChange).toHaveBeenCalledWith(Status.BLOCKED);
  });

  test("does not trigger row-open behavior when selecting a status", async () => {
    const onStatusChange = vi.fn();
    const onOpenDetails = vi.fn();

    render(
      <div
        onClick={(event) => {
          const target = event.target as HTMLElement;
          const isInteractive =
            target.closest("input") ||
            target.closest("button") ||
            target.closest('[role="checkbox"]') ||
            target.closest("[data-interactive]") ||
            target.closest("[data-drag-handle]");

          if (!isInteractive) {
            onOpenDetails();
          }
        }}
      >
        <StatusDropdownMenu
          status={Status.TODO}
          onStatusChange={onStatusChange}
          trigger={<button type="button">Open status menu</button>}
        />
      </div>
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    await screen.findByPlaceholderText("Search statuses...");
    fireEvent.click(screen.getByText("Blocked"));

    expect(onStatusChange).toHaveBeenCalledWith(Status.BLOCKED);
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  test("shows an empty state when no statuses match the query", async () => {
    render(
      <StatusDropdownMenu
        status={Status.TODO}
        onStatusChange={vi.fn()}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    const input = await screen.findByPlaceholderText("Search statuses...");
    fireEvent.change(input, { target: { value: "zzz" } });

    expect(screen.getByText("No statuses found.")).toBeDefined();
  });

  test("closes on Escape and resets the query before reopening", async () => {
    render(
      <StatusDropdownMenu
        status={Status.TODO}
        onStatusChange={vi.fn()}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    const input = await screen.findByPlaceholderText("Search statuses...");
    fireEvent.change(input, { target: { value: "plan" } });

    expect(screen.queryByText("Triage")).toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search statuses...")).toBeNull();
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    await screen.findByPlaceholderText("Search statuses...");

    expect(screen.getByText("Triage")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Plan Review")).toBeDefined();
  });

  test("marks the current status as checked", async () => {
    render(
      <StatusDropdownMenu
        status={Status.PLAN_REVIEW}
        onStatusChange={vi.fn()}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    const currentStatusItem = (await screen.findByText("Plan Review")).closest(
      "[data-searchable-picker-item]"
    );
    const otherStatusItem = screen.getByText("Planning").closest(
      "[data-searchable-picker-item]"
    );

    expect(currentStatusItem?.getAttribute("data-checked")).toBe("true");
    expect(otherStatusItem?.getAttribute("data-checked")).toBe("false");
  });

  test("renders In Progress and Done first with a separator below them", async () => {
    render(
      <StatusDropdownMenu
        status={Status.TODO}
        onStatusChange={vi.fn()}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    await screen.findByPlaceholderText("Search statuses...");

    const options = Array.from(
      document.querySelectorAll("[data-searchable-picker-item]")
    );
    const separator = document.querySelector(
      '[data-slot="dropdown-menu-separator"]'
    );

    expect(options[0]?.getAttribute("data-value")).toBe(Status.IN_PROGRESS);
    expect(options[1]?.getAttribute("data-value")).toBe(Status.DONE);
    expect(separator).not.toBeNull();
  });

  test("limits choices to the provided statuses while keeping the current disabled status visible", async () => {
    render(
      <StatusDropdownMenu
        status={Status.BLOCKED}
        statuses={[Status.TODO, Status.DONE]}
        onStatusChange={vi.fn()}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    await screen.findByPlaceholderText("Search statuses...");

    expect(screen.getByText("Blocked")).toBeDefined();
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
    expect(screen.queryByText("Triage")).toBeNull();
  });

  test("uses a smaller scrollable list height so overflow is visually obvious", async () => {
    render(
      <StatusDropdownMenu
        status={Status.TODO}
        onStatusChange={vi.fn()}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    await screen.findByPlaceholderText("Search statuses...");

    const list = document.querySelector('[data-slot="searchable-picker-list"]');
    expect(list?.className).toContain("max-h-58");
    expect(list?.className).toContain("overflow-y-auto");
  });

  test("moves focus from the search input into the list and back with arrows", async () => {
    const onStatusChange = vi.fn();

    render(
      <StatusDropdownMenu
        status={Status.TODO}
        onStatusChange={onStatusChange}
        trigger={<button type="button">Open status menu</button>}
      />
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open status menu" }),
      { button: 0, ctrlKey: false }
    );

    const input = await screen.findByPlaceholderText("Search statuses...");
    input.focus();

    fireEvent.keyDown(input, { key: "ArrowDown" });

    const firstItem = document.querySelector<HTMLElement>(
      "[data-searchable-picker-item]"
    );
    expect(document.activeElement).toBe(firstItem);

    fireEvent.keyDown(firstItem as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    expect(onStatusChange).toHaveBeenCalledWith(Status.IN_PROGRESS);
  });
  test("a controlled open prop opens the picker without a click", async () => {
    render(
      <StatusDropdownMenu
        open
        onOpenChange={vi.fn()}
        status={Status.TODO}
        onStatusChange={vi.fn()}
        trigger={<button type="button">Open status menu</button>}
      />
    );
    expect(await screen.findByPlaceholderText("Search statuses...")).toBeTruthy();
  });
});
