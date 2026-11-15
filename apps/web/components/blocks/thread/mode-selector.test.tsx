/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { setTestHotkeyPlatform } from "@/test-utils/hotkeys";
import { ModeSelector } from "./mode-selector";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioGroup: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
    onValueChange?: (value: string) => void;
  }) => (
    <div>
      {children}
      <button type="button" onClick={() => onValueChange?.("plan")}>
        Select plan
      </button>
    </div>
  ),
  DropdownMenuRadioItem: ({
    children,
    value,
  }: {
    children: ReactNode;
    value: string;
  }) => <div data-value={value}>{children}</div>,
  DropdownMenuSeparator: () => <div />,
}));

describe("ModeSelector", () => {
  afterEach(() => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0",
    });
    cleanup();
  });

  test("OpenCode offers Act, Ask to approve, and Plan modes", () => {
    render(
      <ModeSelector cliType="opencode" value="agent" onChange={vi.fn()} />
    );

    expect(
      document.querySelector('[data-value="agent"]')
    ).not.toBeNull();
    expect(
      document.querySelector('[data-value="default"]')
    ).not.toBeNull();
    expect(document.querySelector('[data-value="plan"]')).not.toBeNull();
  });

  test("uses default cursor when disabled", () => {
    render(
      <ModeSelector
        cliType="codex"
        value="agent"
        onChange={vi.fn()}
        disabled
      />
    );

    const trigger = screen.getByTitle("Act");
    expect(trigger.classList.contains("cursor-default")).toBe(true);
  });

  test("does not fire onChange when disabled", () => {
    const onChange = vi.fn();

    render(
      <ModeSelector
        cliType="codex"
        value="agent"
        onChange={onChange}
        disabled
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Select plan" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  test("shows the plan mode toggle hint", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    render(
      <ModeSelector
        cliType="claude-code"
        value="agent"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText("Shift+Tab toggles Plan mode")).toBeTruthy();
  });
});
