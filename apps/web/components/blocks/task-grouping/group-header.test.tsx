// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { GroupHeader } from "./group-header";

afterEach(cleanup);
const group = { id: "owner:alice", title: "Alice", cards: [] };

test("header only exposes the collapse control", () => {
  const toggle = vi.fn();
  render(<GroupHeader group={group} count={0} collapsed toggle={toggle} />);
  const button = screen.getByRole("button", { name: "Expand Alice" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(toggle).toHaveBeenCalledOnce();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("header button keys do not reach task-row shortcuts", () => {
  const taskShortcut = vi.fn();
  render(
    <div onKeyDown={taskShortcut}>
      <GroupHeader group={group} count={1} collapsed={false} toggle={vi.fn()} />
    </div>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Collapse Alice" }), {
    key: " ",
  });
  expect(taskShortcut).not.toHaveBeenCalled();
});

test("header matches task height and compact task chevrons", () => {
  const { container } = render(
    <GroupHeader group={group} count={1} collapsed={false} toggle={vi.fn()} />,
  );
  expect((container.firstElementChild as HTMLElement).style.height).toBe(
    "44px",
  );
  expect(container.querySelector("svg")?.classList.contains("h-4")).toBe(true);
});

test("chevron matches the task expand control", () => {
  const { container } = render(
    <GroupHeader group={group} count={1} collapsed={false} toggle={vi.fn()} />,
  );
  expect(container.querySelector("svg")?.classList.contains("h-4")).toBe(true);
});
