/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThreadAgentSelector } from "./thread-agent-selector";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

const AGENTS = [
  { _id: "agent-2", name: "Reviewer", appearance: { color: "#22c55e" } },
  { _id: "agent-1", name: "Implementer", appearance: { color: "#3b82f6" } },
];

describe("ThreadAgentSelector", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders nothing when the project has no active agents", () => {
    const { container } = render(
      <ThreadAgentSelector agents={[]} value={undefined} onChange={vi.fn()} />
    );

    expect(container.innerHTML).toBe("");
  });

  test("a stored agent that no longer exists stays clearable: Unknown agent trigger, Default clears", () => {
    const onChange = vi.fn();
    render(<ThreadAgentSelector agents={[]} value="agent-gone" onChange={onChange} />);

    expect(screen.getByTitle("Unknown agent")).toBeDefined();
    // Default is not check-marked while an id (even a stale one) is stored.
    const defaultItem = screen.getByRole("button", { name: /Default/ });
    expect(defaultItem.querySelectorAll("svg")).toHaveLength(1);

    fireEvent.click(defaultItem);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  test("offers Default plus the project's agents sorted by name", () => {
    render(
      <ThreadAgentSelector agents={AGENTS} value={undefined} onChange={vi.fn()} />
    );

    const options = screen.getAllByRole("button");
    // Trigger + "Default" + two agents.
    expect(options).toHaveLength(4);
    expect(screen.getByText("Implementer")).toBeDefined();
    expect(screen.getByText("Reviewer")).toBeDefined();
    const implementerIndex = options.findIndex((option) =>
      option.textContent?.includes("Implementer")
    );
    const reviewerIndex = options.findIndex((option) =>
      option.textContent?.includes("Reviewer")
    );
    expect(implementerIndex).toBeLessThan(reviewerIndex);
  });

  test("defaults the trigger to Default", () => {
    render(
      <ThreadAgentSelector agents={AGENTS} value={undefined} onChange={vi.fn()} />
    );

    expect(screen.getByTitle("Default")).toBeDefined();
  });

  test("collapses to its icon below a 2xl composer bar", () => {
    render(<ThreadAgentSelector agents={AGENTS} value={undefined} onChange={vi.fn()} />);
    expect(screen.getByTitle("Default").querySelector("span")?.className).toContain("hidden min-w-0 max-w-32 truncate @2xl/composer-bar:inline");
  });

  test("shows the selected agent's name and initials avatar on the trigger", () => {
    render(
      <ThreadAgentSelector agents={AGENTS} value="agent-2" onChange={vi.fn()} />
    );

    const trigger = screen.getByTitle("Reviewer");
    expect(trigger).toBeDefined();
    // Initials avatar for the selected agent renders inside the trigger too.
    expect(screen.getAllByText("R").length).toBeGreaterThanOrEqual(1);
  });

  test("selecting an agent fires onChange with its id", () => {
    const onChange = vi.fn();
    render(
      <ThreadAgentSelector agents={AGENTS} value={undefined} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: /Implementer/ }));

    expect(onChange).toHaveBeenCalledWith("agent-1");
  });

  test("selecting Default fires onChange with undefined", () => {
    const onChange = vi.fn();
    render(
      <ThreadAgentSelector agents={AGENTS} value="agent-1" onChange={onChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: /Default/ }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  // Assignment automation (OS-1138 Phase 4): the pill shows the bound agent
  // normally but can't be changed — like the locked attached task.
  describe("locked", () => {
    test("shows the bound agent without the muted disabled styling", () => {
      render(
        <ThreadAgentSelector agents={AGENTS} value="agent-2" onChange={vi.fn()} locked />
      );

      const trigger = screen.getByTitle("Reviewer");
      expect(trigger.getAttribute("aria-disabled")).toBe("true");
      expect(trigger.classList.contains("cursor-default")).toBe(true);
      expect(trigger.classList.contains("text-muted-foreground/80")).toBe(false);
    });

    test("ignores selection changes", () => {
      const onChange = vi.fn();
      render(
        <ThreadAgentSelector agents={AGENTS} value="agent-2" onChange={onChange} locked />
      );

      fireEvent.click(screen.getByRole("button", { name: /Implementer/ }));
      fireEvent.click(screen.getByRole("button", { name: /Default/ }));

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  test("uses pointer cursor when enabled and default cursor when disabled", () => {
    render(
      <ThreadAgentSelector agents={AGENTS} value={undefined} onChange={vi.fn()} />
    );
    expect(screen.getByTitle("Default").classList.contains("cursor-pointer")).toBe(true);
    cleanup();

    render(
      <ThreadAgentSelector agents={AGENTS} value={undefined} onChange={vi.fn()} disabled />
    );
    expect(screen.getByTitle("Default").classList.contains("cursor-default")).toBe(true);
  });
});
