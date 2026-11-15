/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CliTypeSelector } from "./cli-type-selector";

// The rest of the selector's behavior is covered against a stubbed menu in
// cli-type-selector.test.tsx. This file keeps the real Radix menu, because the
// section reorder (OS-1899) depends on how Radix mounts and positions it: the
// content is portaled in a commit of its own, so anything that reads the
// resolved side from a mount effect sees no node at all.
vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

describe("CliTypeSelector menu side", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  const openMenu = () => {
    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      JSON.stringify({
        version: 1,
        modelsByCliType: {},
        combosByCliType: {
          codex: [{ cliModel: "gpt-5.5", cliEffort: "medium" }],
        },
      })
    );

    render(
      <CliTypeSelector
        value="codex"
        cliModel="default"
        onChange={vi.fn()}
        allowedCliTypes={["codex"]}
        favoriteCombos={[
          { cliType: "codex", cliModel: "gpt-5.4", isAvailable: true },
        ]}
      />
    );

    const trigger = document.querySelector<HTMLElement>(
      "[data-slot=dropdown-menu-trigger]"
    );
    if (!trigger) {
      throw new Error("menu trigger did not render");
    }
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    const content = document.querySelector<HTMLElement>(
      "[data-slot=dropdown-menu-content]"
    );
    if (!content) {
      throw new Error("menu content did not mount");
    }
    return content;
  };

  const expectOrder = (first: HTMLElement, second: HTMLElement) =>
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

  test("keeps Favorites and Last used on top while the menu points down", () => {
    const content = openMenu();

    expect(content.dataset.side).toBe("bottom");
    expectOrder(screen.getByText("Favorites"), screen.getByText("Last used"));
    expectOrder(screen.getByText("Last used"), screen.getByText("Reasoning"));
  });

  test("moves Favorites and Last used to the bottom once Radix flips the menu up", async () => {
    const content = openMenu();

    // Radix resolves the side asynchronously and flips `data-side` then; the
    // menu is parked off-screen until that happens.
    await act(async () => {
      content.dataset.side = "top";
    });

    expectOrder(screen.getByText("Reasoning"), screen.getByText("Last used"));
    expectOrder(screen.getByText("Last used"), screen.getByText("Favorites"));
  });
});
