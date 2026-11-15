/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BoardLayout } from "./board-layout";

const columns = [
  { id: "alpha", title: "Alpha" },
  { id: "bravo", title: "Bravo" },
  { id: "charlie", title: "Charlie" },
];

describe("BoardLayout", () => {
  test("renders columns in the provided order", () => {
    render(
      <BoardLayout
        columns={columns}
        renderColumn={(column) => <section>{column.title}</section>}
      />
    );

    const renderedColumns = columns.map((column) => screen.getByText(column.title));

    for (let index = 0; index < renderedColumns.length - 1; index += 1) {
      expect(
        renderedColumns[index].compareDocumentPosition(renderedColumns[index + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).not.toBe(0);
    }
  });

  test("owns the shared full-height scroll structure", () => {
    const { container } = render(
      <BoardLayout
        columns={columns}
        renderColumn={(column) => <section>{column.title}</section>}
      />
    );

    const scrollContainer = container.firstElementChild as HTMLDivElement | null;
    expect(scrollContainer?.className).toContain("h-full");
    expect(scrollContainer?.className).toContain("overflow-auto");

    const track = scrollContainer?.firstElementChild as HTMLDivElement | null;
    expect(track?.className).toContain("flex");
    expect(track?.className).toContain("min-h-full");
    expect(track?.className).toContain("min-w-max");
  });

  test("snaps one column per view on mobile and disables snapping on desktop", () => {
    const { container } = render(
      <BoardLayout
        columns={columns}
        renderColumn={(column) => <section>{column.title}</section>}
      />
    );

    const scrollContainer = container.firstElementChild as HTMLDivElement;
    expect(scrollContainer.className).toContain("snap-x");
    expect(scrollContainer.className).toContain("snap-mandatory");
    expect(scrollContainer.className).toContain("md:snap-none");

    // Mobile gutters center a snapped column and leave space before the
    // first column; desktop has no gutters.
    const track = scrollContainer.firstElementChild as HTMLDivElement;
    expect(track.className).toContain("px-[3.75vw]");
    expect(track.className).toContain("md:px-0");

    const columnWrappers = Array.from(track.children) as HTMLDivElement[];
    expect(columnWrappers).toHaveLength(columns.length);
    for (const wrapper of columnWrappers) {
      expect(wrapper.className).toContain("snap-center");
      expect(wrapper.className).toContain("md:snap-align-none");
    }
  });

  test("keeps fixed-width columns by default", () => {
    const { container } = render(
      <BoardLayout
        columns={columns}
        renderColumn={(column) => <section>{column.title}</section>}
      />
    );

    const track = container.firstElementChild?.firstElementChild as HTMLDivElement;
    expect(track.className).not.toContain("md:w-full");
    for (const wrapper of Array.from(track.children) as HTMLDivElement[]) {
      expect(wrapper.className).not.toContain("md:grow");
    }
  });

  test("shares the width evenly on desktop when asked, keeping the mobile gallery", () => {
    const { container } = render(
      <BoardLayout
        fillWidth
        columns={columns}
        renderColumn={(column) => <section>{column.title}</section>}
      />
    );

    const scrollContainer = container.firstElementChild as HTMLDivElement;
    const track = scrollContainer.firstElementChild as HTMLDivElement;

    expect(track.className).toContain("md:w-full");
    // `min-w-max` would size the track to its content (the longest card title
    // in every column summed), so the even split would divide a track far wider
    // than the viewport and the board would overflow. Desktop must drop it; the
    // columns' own `md:min-w-80` is what makes a too-narrow board scroll.
    expect(track.className).toContain("md:min-w-0");

    for (const wrapper of Array.from(track.children) as HTMLDivElement[]) {
      expect(wrapper.className).toContain("md:grow");
      expect(wrapper.className).toContain("md:basis-0");
      // Every column needs the SAME floor for the shares to come out equal.
      // Left to `min-width: auto` a flex item can't shrink below its own
      // content, so the column with the longest card title would stay wider
      // than its neighbours.
      expect(wrapper.className).toContain("md:min-w-80");
      // Mobile stays a one-column-per-view snap gallery.
      expect(wrapper.className).toContain("snap-center");
    }
    expect(scrollContainer.className).toContain("snap-mandatory");
  });
});
