/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { MdxTocHeading } from "./extract-mdx-headings";
import { useMdxTableOfContents } from "./use-mdx-table-of-contents";

const headingTitles = ["First", "Second", "Third"];
const headingSpacing = 400;
const topOffset = 96;

let scrollOffset = 0;
let animationFrames: FrameRequestCallback[] = [];

function flushAnimationFrames() {
  const pending = animationFrames;
  animationFrames = [];
  act(() => {
    pending.forEach((callback) => callback(0));
  });
}

function stubRect(element: Element, top: number) {
  element.getBoundingClientRect = () => ({ top, bottom: top + 24 }) as DOMRect;
}

function buildHeadings(): MdxTocHeading[] {
  return headingTitles.map((title, index) => ({
    depth: 2,
    id: `heading-${index + 1}`,
    line: index + 1,
    title,
  }));
}

function Harness({ headings }: { headings: MdxTocHeading[] }) {
  const editorRootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { scrollToHeading, visibleActiveHeadingId } = useMdxTableOfContents({
    headings,
    editorRootRef,
    scrollContainerRef,
    topOffset,
    updateHash: false,
  });

  return (
    <div ref={scrollContainerRef} data-testid="scroll-container">
      <div ref={editorRootRef}>
        <div className="mdx-editor-kit__content">
          {headings.map((heading) => (
            <h2 key={heading.id}>{heading.title}</h2>
          ))}
        </div>
      </div>
      <output data-testid="active">{visibleActiveHeadingId}</output>
      <button type="button" onClick={() => scrollToHeading(2)}>
        jump
      </button>
    </div>
  );
}

function positionHeadings(container: HTMLElement) {
  const scrollContainer = container.querySelector<HTMLElement>('[data-testid="scroll-container"]')!;
  stubRect(scrollContainer, 0);
  // jsdom has no scrollTo; the hook only needs it to not throw.
  scrollContainer.scrollTo = () => undefined;
  container.querySelectorAll("h2").forEach((heading, index) => {
    stubRect(heading, index * headingSpacing - scrollOffset);
  });
}

beforeEach(() => {
  scrollOffset = 0;
  animationFrames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("tracks the active heading while the container scrolls", () => {
  const { container, getByTestId } = render(<Harness headings={buildHeadings()} />);
  positionHeadings(container);
  flushAnimationFrames();

  expect(getByTestId("active").textContent).toBe("heading-1");

  scrollOffset = 850;
  positionHeadings(container);
  act(() => {
    getByTestId("scroll-container").dispatchEvent(new Event("scroll"));
  });
  flushAnimationFrames();

  expect(getByTestId("active").textContent).toBe("heading-3");
});

test("resumes scroll tracking when the headings change while a click lock is pending", () => {
  const { container, getByText, getByTestId, rerender } = render(
    <Harness headings={buildHeadings()} />
  );
  positionHeadings(container);
  flushAnimationFrames();

  // Clicking a ToC entry pins that heading for a moment so the smooth scroll
  // doesn't flicker through everything on the way.
  act(() => {
    getByText("jump").click();
  });
  expect(getByTestId("active").textContent).toBe("heading-3");

  // An edit (or any re-render with fresh headings) re-runs the scroll effect
  // mid-lock. The pin must not survive it, or scrolling never updates again.
  rerender(<Harness headings={buildHeadings()} />);
  positionHeadings(container);

  scrollOffset = 0;
  positionHeadings(container);
  act(() => {
    getByTestId("scroll-container").dispatchEvent(new Event("scroll"));
  });
  flushAnimationFrames();

  expect(getByTestId("active").textContent).toBe("heading-1");
});
