/** @vitest-environment jsdom */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlanDecisionButtons } from "./plan-decision-buttons";
import * as decisions from "@/lib/threads/plan-decision";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("plan decision buttons", () => {
  test("keeps approval available when Act is the only supported mode", async () => {
    vi.spyOn(decisions, "getPlanDecisionOptions").mockReturnValue([
      { key: "approve-act", label: "Approve & continue in Act", decision: { nextMode: "agent" } },
    ]);
    const onDecide = vi.fn();
    render(<PlanDecisionButtons cliType="codex" onDecide={onDecide} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Approve & continue in Act" })); });
    expect(onDecide).toHaveBeenCalledExactlyOnceWith({ nextMode: "agent" });
    expect(screen.queryByRole("button", { name: "More approval modes" })).toBeNull();
  });
  test.each(["codex", "claude-code"] as const)("offers Act in the %s approval dropdown", async cliType => {
    let finish!: () => void;
    const onDecide = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<PlanDecisionButtons cliType={cliType} onDecide={onDecide} />);
    const primary = screen.getByRole("button", { name: /Approve & continue in (Sandboxed|Auto)/ });
    const ask = screen.getByRole("button", { name: "Approve, ask per tool" });
    expect(screen.queryByRole("button", { name: "Approve & continue in Act" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "More approval modes" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const choice = await screen.findByRole("menuitem", { name: "Approve & continue in Act" });
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    fireEvent.click(choice);
    expect(onDecide).toHaveBeenCalledExactlyOnceWith({ nextMode: "agent" });
    expect(primary.hasAttribute("disabled")).toBe(true);
    expect(ask.hasAttribute("disabled")).toBe(true);
    expect(trigger.hasAttribute("disabled")).toBe(true);
    await act(async () => { finish(); });
    expect(primary.hasAttribute("disabled")).toBe(false);
  });

  test.each([
    ["Approve & continue in Sandboxed", "auto"],
    ["Approve, ask per tool", "default"],
  ])("keeps %s directly available", async (label, mode) => {
    const onDecide = vi.fn();
    render(<PlanDecisionButtons cliType="codex" onDecide={onDecide} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })); });
    expect(onDecide).toHaveBeenCalledExactlyOnceWith({ nextMode: mode });
  });
});
