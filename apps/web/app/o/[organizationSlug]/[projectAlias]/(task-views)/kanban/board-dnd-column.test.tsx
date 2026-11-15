/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BoardDndColumn } from "./board-dnd-column";

vi.mock("@dnd-kit/core", () => ({
  useDroppable: ({ id }: { id: string }) => ({
    setNodeRef: () => {},
    isOver: id.startsWith("column:"),
  }),
}));

afterEach(cleanup);

describe("BoardDndColumn", () => {
  test("the body drop highlight covers the column up to the header", () => {
    const { container } = render(
      <BoardDndColumn columnId="todo" hasActiveDrag isDropAllowed>
        <div>card</div>
      </BoardDndColumn>
    );

    const highlight = container.querySelector("[class*='bg-blue-500/5']");
    expect(highlight?.className).toContain("inset-0");
    expect(highlight?.className).not.toContain("top-14");
  });
});
