/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileTaskViewsHeader } from "./mobile-task-views-header";

afterEach(() => {
  cleanup();
  // The sheet's aria-hider marks the rest of the document while it is open, and
  // jsdom unmounts without the exit lifecycle that restores those nodes.
  document.querySelectorAll("[data-aria-hidden]").forEach((node) => {
    node.removeAttribute("aria-hidden");
    node.removeAttribute("data-aria-hidden");
  });
});

describe("MobileTaskViewsHeader", () => {
  test("renders the List selector right-aligned, immediately left of Filters", () => {
    render(
      <MobileTaskViewsHeader
        projectName="Contoso"
        listSelector={<button type="button">Inbox</button>}
        renderToolbar={() => <div />}
      />
    );

    const header = screen.getByText("Contoso").parentElement?.parentElement;
    const children = Array.from(header?.children ?? []);
    const selectorIndex = children.findIndex((child) =>
      child.textContent?.includes("Inbox")
    );
    const filtersIndex = children.findIndex((child) =>
      child.textContent?.includes("Filters")
    );

    // Project name group first (it owns the free space via mr-auto), then the
    // selector, then Filters — the selector sits next to Filters, not the name.
    expect(children[0]?.textContent).toBe("Contoso");
    expect(children[0]?.className).toContain("mr-auto");
    expect(selectorIndex).toBe(1);
    expect(filtersIndex).toBe(2);
  });

  test("renders the badge beside the project name, inside its group", () => {
    render(
      <MobileTaskViewsHeader
        projectName="Contoso"
        badge={<span>View only</span>}
        renderToolbar={() => <div />}
      />
    );

    const group = screen.getByText("Contoso").parentElement;
    expect(group?.className).toContain("mr-auto");
    expect(group?.textContent).toBe("ContosoView only");
  });

  test("opens the view options in a bottom sheet from Filters", () => {
    render(
      <MobileTaskViewsHeader
        projectName="Contoso"
        renderToolbar={() => <div data-testid="toolbar-panel" />}
      />
    );

    expect(screen.queryByTestId("toolbar-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));

    expect(screen.getByTestId("toolbar-panel")).toBeDefined();
    const sheet = document.querySelector<HTMLElement>(
      '[data-slot="drawer-content"]'
    );
    expect(sheet?.getAttribute("data-vaul-drawer-direction")).toBe("bottom");
    // The sheet body scrolls and clears the floating mobile nav bar.
    const body = document.querySelector<HTMLElement>(
      '[data-mobile-sheet-body="scroll"]'
    );
    expect(body?.style.paddingBottom).toBe("var(--mobile-nav-clearance)");
    expect(body?.className).toContain("overflow-y-auto");
    expect(body?.hasAttribute("data-vaul-no-drag")).toBe(true);
  });
});
