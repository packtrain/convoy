// @vitest-environment jsdom
import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { writeFileTreeSide } from "@/lib/threads/changes-view-prefs";
import { FileTreePane } from "./file-tree-pane";

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <main>Diff</main>
      <FileTreePane containerRef={ref}>tree</FileTreePane>
    </div>
  );
}

afterEach(() => window.localStorage.clear());

test("on the left, the pane sorts first and its handle grows it to the right", () => {
  writeFileTreeSide("left");
  render(<Host />);
  const aside = screen.getByRole("complementary", { name: "Changed files" });
  expect(aside.parentElement?.className).toContain("order-first");
  expect(aside.className).toContain("border-r");

  const handle = screen.getByRole("separator", { name: "Resize file tree" });
  const before = Number(handle.getAttribute("aria-valuenow"));
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
});

test("on the right by default, the handle grows it to the left", () => {
  render(<Host />);
  const aside = screen.getByRole("complementary", { name: "Changed files" });
  expect(aside.parentElement?.className).not.toContain("order-first");
  expect(aside.className).toContain("border-l");

  const handle = screen.getByRole("separator", { name: "Resize file tree" });
  const before = Number(handle.getAttribute("aria-valuenow"));
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
});

test("the pane opens with the same Files header as the other file trees", () => {
  render(<Host />);
  const aside = screen.getByRole("complementary", { name: "Changed files" });
  expect(aside.firstElementChild?.textContent).toBe("Files");
});

test("the Files header shares the changes toolbar's bg-card, since they sit on one line", () => {
  render(<Host />);
  const aside = screen.getByRole("complementary", { name: "Changed files" });
  expect(aside.firstElementChild?.className).toContain("bg-card");
});
