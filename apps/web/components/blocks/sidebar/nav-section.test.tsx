/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SidebarMenu, SidebarProvider } from "@/components/ui/sidebar";
import { NavItemsEmptyState } from "./nav-section";

describe("NavItemsEmptyState", () => {
  afterEach(cleanup);

  test("is a real button, so the keyboard can reach it", () => {
    const onClick = vi.fn();
    render(
      <SidebarProvider>
        <SidebarMenu>
          <NavItemsEmptyState title="+ New project" onClick={onClick} />
        </SidebarMenu>
      </SidebarProvider>
    );

    const button = screen.getByRole("button", { name: "+ New project" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
