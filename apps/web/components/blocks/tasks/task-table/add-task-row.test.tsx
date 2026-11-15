/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AddTaskRow } from "../add-task-row";

describe("AddTaskRow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("shows the plus icon", () => {
    render(<AddTaskRow addTask={vi.fn()} />);

    expect(document.querySelector("svg.lucide-plus")).toBeTruthy();
    expect(document.querySelector("svg.lucide-mic")).toBeNull();
  });

  test("focuses the task title input when clicking the plus affordance", () => {
    render(<AddTaskRow addTask={vi.fn()} />);

    const input = screen.getByPlaceholderText("Add task...");
    expect(document.activeElement).not.toBe(input);

    const focusButton = screen.getByRole("button", { name: "Focus add task title" });
    fireEvent.click(focusButton);

    expect(document.activeElement).toBe(input);
  });

  test("extracts trailing tags on uncontrolled Enter submit", () => {
    const addTask = vi.fn();

    render(<AddTaskRow addTask={addTask} />);

    const input = screen.getByPlaceholderText("Add task...");
    fireEvent.change(input, { target: { value: "Ship release notes #release #QA" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ship release notes",
        tags: ["release", "QA"],
      }),
      undefined
    );
  });

  test("infers task type from trailing type tag on uncontrolled Enter submit", () => {
    const addTask = vi.fn();

    render(<AddTaskRow addTask={addTask} />);

    const input = screen.getByPlaceholderText("Add task...");
    fireEvent.change(input, { target: { value: "Fix crash #mobile #bug" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Fix crash",
        tags: ["mobile"],
        taskType: expect.objectContaining({ key: "bug" }),
      }),
      undefined
    );
  });

  test("extracts trailing tags on uncontrolled blur submit", () => {
    const addTask = vi.fn();

    render(<AddTaskRow addTask={addTask} />);

    const input = screen.getByPlaceholderText("Add task...");
    fireEvent.change(input, { target: { value: "Ship release notes #release #QA" } });
    fireEvent.blur(input);

    expect(addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ship release notes",
        tags: ["release", "QA"],
      }),
      undefined
    );
  });

  test("keeps tags-only input as a literal title on uncontrolled Enter submit", () => {
    const addTask = vi.fn();

    render(<AddTaskRow addTask={addTask} />);

    const input = screen.getByPlaceholderText("Add task...");
    fireEvent.change(input, { target: { value: "#release #QA" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "#release #QA",
        tags: [],
      }),
      undefined
    );
  });

});
