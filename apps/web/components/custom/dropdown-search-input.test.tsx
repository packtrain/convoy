/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { Command } from "@/components/ui/command";
import { DropdownSearchInput } from "./dropdown-search-input";

describe("DropdownSearchInput", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the native search input in a transparent borderless frame", () => {
    render(<DropdownSearchInput placeholder="Search assignees..." />);

    const input = screen.getByPlaceholderText("Search assignees...");
    const frame = input.closest('[data-slot="input-group"]');

    expect(input.getAttribute("type")).toBe("text");
    expect(input.getAttribute("role")).toBe("searchbox");
    expect(frame?.className).toContain("border-0");
    expect(frame?.className).toContain("bg-transparent");
  });

  test("matches the 32px height of the picker rows below it", () => {
    render(<DropdownSearchInput placeholder="Search labels..." />);

    const frame = screen
      .getByPlaceholderText("Search labels...")
      .closest('[data-slot="input-group"]');

    expect(frame?.className).toContain("h-8");
    expect(frame?.className).not.toContain("h-10");
  });

  test("supports Command-backed filtering in the same frame", () => {
    const onValueChange = vi.fn();

    render(
      <Command shouldFilter={false}>
        <DropdownSearchInput
          mode="command"
          placeholder="Search statuses..."
          onValueChange={onValueChange}
        />
      </Command>
    );

    const input = screen.getByPlaceholderText("Search statuses...");
    const frame = input.closest('[data-slot="input-group"]');
    fireEvent.change(input, { target: { value: "done" } });

    expect(onValueChange).toHaveBeenCalledWith("done");
    expect(frame?.className).toContain("border-0");
    expect(frame?.className).toContain("bg-transparent");
  });
});
