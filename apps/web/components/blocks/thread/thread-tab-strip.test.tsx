/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ThreadTabStrip } from "./thread-tab-strip";

/** `max-w-80` on a thread tab, which is what makes the cut bistable. */
const MAX_TAB_WIDTH = 320;
/** The chevron button plus the gap it brings, minus the padding it replaces. */
const CHEVRON_WIDTH = 22;

/**
 * A bistable strip, found by iterating the real cut math: with the chevron on
 * tab 3 only three tabs fit, and with it on tab 2 — already clamped at
 * `max-w-80`, so it swallows the chevron for free — a fourth one does. Each
 * placement measures as correct and hands the chevron back to the other.
 */
const BISTABLE_WIDTHS = [213, 95, 336, 158, 271, 298];
const BISTABLE_AVAILABLE = 789;
const BISTABLE_ACTIVE_INDEX = 2;

const tabs = BISTABLE_WIDTHS.map((_, index) => ({
  id: `thread_${index}`,
  label: `Thread ${index}`,
}));

/**
 * jsdom reports every box as zero-width, so the layout the strip measures has
 * to be modelled: a tab is its natural width plus the chevron when it hosts
 * it, clamped to `max-w-80`.
 */
function stubLayout() {
  const original = {
    offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  };

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.slot === "thread-tab-strip" ? BISTABLE_AVAILABLE : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.slot !== "thread-tab") {
        return 0;
      }
      // Tabs render in `tabs` order, so DOM order is the index the strip
      // measures by (the cut active tab is moved with `order`, not markup).
      const strip = this.closest('[data-slot="thread-tab-strip"]');
      const index = strip
        ? [...strip.querySelectorAll('[data-slot="thread-tab"]')].indexOf(this)
        : -1;
      if (index < 0) {
        return 0;
      }
      const hostsChevron = this.querySelector('[aria-label="More threads"]') !== null;
      return Math.min(
        BISTABLE_WIDTHS[index] + (hostsChevron ? CHEVRON_WIDTH : 0),
        MAX_TAB_WIDTH
      );
    },
  });

  return () => {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, key, descriptor);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
      }
    }
  };
}

describe("ThreadTabStrip", () => {
  let restoreLayout: (() => void) | undefined;

  afterEach(() => {
    cleanup();
    restoreLayout?.();
    restoreLayout = undefined;
  });

  // The strip measures the row, and the chevron it places is inside what it
  // measures — so a cut with two equally correct answers used to re-measure
  // between them until React threw "Maximum update depth exceeded" (#185).
  test("settles on a bistable cut instead of re-measuring forever (OS-1658)", () => {
    restoreLayout = stubLayout();

    expect(() =>
      render(
        <ThreadTabStrip
          tabs={tabs}
          activeId={tabs[BISTABLE_ACTIVE_INDEX].id}
          onSelect={() => {}}
        />
      )
    ).not.toThrow();

    // It settled somewhere legitimate: the tail is in the dropdown, so the
    // chevron is on exactly one tab.
    expect(screen.getAllByLabelText("More threads")).toHaveLength(1);
  });

  // A flex row shrinks its items by default, so a raw ref was squeezed under
  // the title in the mobile sheet; the strip already pins it.
  test("keeps the task ref from shrinking in the mobile sheet", () => {
    render(
      <ThreadTabStrip
        tabs={tabs.slice(0, 2).map((tab) => ({ ...tab, leading: <span>OS-511</span> }))}
        activeId={tabs[0].id}
        onSelect={() => {}}
        collapsed
      />
    );

    fireEvent.click(screen.getByLabelText("More threads"));

    const row = screen.getByRole("button", { current: true });
    expect(row.querySelector(".shrink-0")?.textContent).toBe("OS-511");
  });

  // Rows truncate long titles, so the full one has to be reachable on hover.
  test("shows a menu row's full title on hover", () => {
    render(
      <ThreadTabStrip tabs={tabs.slice(0, 2)} activeId={tabs[0].id} onSelect={() => {}} collapsed />
    );

    fireEvent.click(screen.getByLabelText("More threads"));

    const row = screen.getByRole("button", { current: true });
    expect(row.querySelector(".truncate")?.getAttribute("title")).toBe("Thread 0");
  });
});
