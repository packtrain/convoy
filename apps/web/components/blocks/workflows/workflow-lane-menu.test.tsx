/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { LaneDefinition } from "@/convex/lib/contracts/workflowDefinition";
import { getCliModes } from "@/lib/cli-runtime-ui/registry";
import { WorkflowLaneMenu } from "./workflow-lane-menu";

// The real CLI selector is the composer's Radix menu; a stub driving the same
// props stands in (the step-dialog test's treatment of the composer).
vi.mock("@/components/blocks/thread/cli-type-selector", () => ({
  CliTypeSelector: ({
    value,
    onChange,
    onCliModelChange,
    keepOpenOnSelect,
    triggerContent,
    triggerAriaLabel,
    leadingItems,
    trailingItems,
  }: {
    value?: string;
    onChange: (value: string) => void;
    onCliModelChange?: (value: string) => void;
    keepOpenOnSelect?: boolean;
    triggerContent?: ReactNode;
    triggerAriaLabel?: string;
    leadingItems?: ReactNode;
    trailingItems?: ReactNode;
  }) => (
    <div>
      <span>{`aria:${triggerAriaLabel ?? "none"}`}</span>
      <span>{triggerContent ? "trigger-parallel" : `trigger:${value}`}</span>
      <span>{`selected:${value ?? "none"}`}</span>
      <span>{keepOpenOnSelect ? "stays-open" : "closes-on-select"}</span>
      <div>{leadingItems}</div>
      <button type="button" onClick={() => onChange("codex")}>
        pick-codex
      </button>
      <button type="button" onClick={() => onCliModelChange?.("opus")}>
        pick-model
      </button>
      {/* A cross-runtime model pick fires both callbacks in one click. */}
      <button
        type="button"
        onClick={() => {
          onChange("codex");
          onCliModelChange?.("gpt-5");
        }}
      >
        pick-codex-model
      </button>
      <div>{trailingItems}</div>
    </div>
  ),
}));

// Radix menus don't open from jsdom events; render the items inline instead.
vi.mock("@/components/ui/dropdown-menu", async () => ({
  ...(await vi.importActual<typeof import("@/components/ui/dropdown-menu")>("@/components/ui/dropdown-menu")),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function singleLane(defaults?: LaneDefinition["defaults"]): LaneDefinition {
  return { laneId: "lane-1", name: "Lane 1", type: "single", defaults };
}

const PARALLEL_LANE: LaneDefinition = { laneId: "lane-1", name: "Lane 1", type: "parallel" };

function lastSelection(onSelect: ReturnType<typeof vi.fn>) {
  return onSelect.mock.calls.at(-1)?.[0];
}

describe("WorkflowLaneMenu", () => {
  afterEach(cleanup);

  test("one menu that stays open on picks; the trigger shows the lane's runtime or Parallel", () => {
    const { unmount } = render(
      <WorkflowLaneMenu lane={singleLane({ cliType: "codex" })} projectAgents={[]} onSelect={vi.fn()} />
    );
    expect(screen.getByText("trigger:codex")).toBeTruthy();
    expect(screen.getByText("stays-open")).toBeTruthy();
    // Every lane's trigger is named after its lane, not its runtime label.
    expect(screen.getByText("aria:Lane Lane 1 settings")).toBeTruthy();
    unmount();

    render(<WorkflowLaneMenu lane={PARALLEL_LANE} projectAgents={[]} onSelect={vi.fn()} />);
    expect(screen.getByText("trigger-parallel")).toBeTruthy();
    // No runtime reads as selected in the menu while the lane is Parallel.
    expect(screen.getByText("selected:none")).toBeTruthy();
  });

  test("the leading Parallel item makes the lane parallel", () => {
    const onSelect = vi.fn();
    render(<WorkflowLaneMenu lane={singleLane({ cliType: "codex" })} projectAgents={[]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Parallel" }));

    expect(lastSelection(onSelect)).toEqual({ type: "parallel" });
  });

  test("picking a runtime on a parallel lane makes it single with that runtime pinned", () => {
    const onSelect = vi.fn();
    render(<WorkflowLaneMenu lane={PARALLEL_LANE} projectAgents={[]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "pick-codex" }));

    expect(lastSelection(onSelect)).toEqual({ type: "single", defaults: { cliType: "codex" } });
  });

  test("a model pick pins the displayed runtime and keeps the other defaults", () => {
    const onSelect = vi.fn();
    render(
      <WorkflowLaneMenu
        lane={singleLane({ cliType: "claude-code", mode: "plan", projectAgentId: "agent-1" as Id<"projectAgents"> })}
        projectAgents={[]}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "pick-model" }));

    expect(lastSelection(onSelect)).toEqual({
      type: "single",
      defaults: { cliType: "claude-code", cliModel: "opus", mode: "plan", projectAgentId: "agent-1" },
    });
  });

  test("switching the runtime drops the previous runtime's model, effort, and mode but keeps the agent", () => {
    const onSelect = vi.fn();
    render(
      <WorkflowLaneMenu
        lane={singleLane({
          cliType: "claude-code",
          cliModel: "opus",
          cliEffort: "high",
          mode: "plan",
          projectAgentId: "agent-1" as Id<"projectAgents">,
        })}
        projectAgents={[]}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "pick-codex" }));

    expect(lastSelection(onSelect)).toEqual({
      type: "single",
      defaults: { cliType: "codex", projectAgentId: "agent-1" },
    });
  });

  test("a cross-runtime model pick lands both the runtime and model, still shedding the old mode", () => {
    const onSelect = vi.fn();
    render(
      <WorkflowLaneMenu
        lane={singleLane({
          cliType: "claude-code",
          cliModel: "opus",
          mode: "plan",
          projectAgentId: "agent-1" as Id<"projectAgents">,
        })}
        projectAgents={[]}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "pick-codex-model" }));

    expect(lastSelection(onSelect)).toEqual({
      type: "single",
      defaults: { cliType: "codex", cliModel: "gpt-5", projectAgentId: "agent-1" },
    });
  });

  test("a mode pick stores it on the defaults with the lane's runtime pinned", () => {
    const onSelect = vi.fn();
    const modes = getCliModes("claude-code");
    render(<WorkflowLaneMenu lane={singleLane({ cliType: "claude-code" })} projectAgents={[]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: modes[1].label }));

    expect(lastSelection(onSelect)).toEqual({
      type: "single",
      defaults: { cliType: "claude-code", mode: modes[1].value },
    });
  });

  test("agent picks set and clear the lane's Project agent; the submenu trigger is the selection itself", () => {
    const onSelect = vi.fn();
    render(
      <WorkflowLaneMenu
        lane={singleLane({ cliType: "codex", mode: "plan", projectAgentId: "agent-2" as Id<"projectAgents"> })}
        projectAgents={[{ _id: "agent-2", name: "Reviewer", appearance: { color: "#22c55e" } }]}
        onSelect={onSelect}
      />
    );

    // Once in the submenu trigger, once as the submenu's item.
    expect(screen.getAllByText("Reviewer")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Reviewer" }));
    expect(lastSelection(onSelect)).toEqual({
      type: "single",
      defaults: { cliType: "codex", mode: "plan", projectAgentId: "agent-2" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Default" }));
    expect(lastSelection(onSelect)).toEqual({
      type: "single",
      defaults: { cliType: "codex", mode: "plan", projectAgentId: undefined },
    });
  });

  test("mode and agent are single-lane defaults — a parallel lane's menu has neither", () => {
    const modes = getCliModes("claude-code");
    render(
      <WorkflowLaneMenu
        lane={PARALLEL_LANE}
        projectAgents={[{ _id: "agent-2", name: "Reviewer", appearance: { color: "#22c55e" } }]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.queryByText(modes[0].label)).toBeNull();
    expect(screen.queryByText("Reviewer")).toBeNull();
  });

  test("the agent submenu hides when the project has no agents", () => {
    render(<WorkflowLaneMenu lane={singleLane()} projectAgents={[]} onSelect={vi.fn()} />);

    expect(screen.queryByText("Default")).toBeNull();
  });

  test("a stored agent that no longer exists stays clearable: Unknown agent trigger, Default clears", () => {
    const onSelect = vi.fn();
    render(
      <WorkflowLaneMenu
        lane={singleLane({ cliType: "codex", projectAgentId: "agent-gone" as Id<"projectAgents"> })}
        projectAgents={[]}
        onSelect={onSelect}
      />
    );

    expect(screen.getByText("Unknown agent")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Default" }));
    expect(lastSelection(onSelect)).toEqual({
      type: "single",
      defaults: { cliType: "codex", projectAgentId: undefined },
    });
  });

  test("disabled blocks the injected items too, not just the runtime list", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      <WorkflowLaneMenu
        lane={singleLane({ cliType: "codex", projectAgentId: "agent-2" as Id<"projectAgents"> })}
        projectAgents={[{ _id: "agent-2", name: "Reviewer", appearance: { color: "#22c55e" } }]}
        disabled
        onSelect={onSelect}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Parallel" }));
    fireEvent.click(screen.getByRole("button", { name: getCliModes("codex")[0].label }));
    fireEvent.click(screen.getByRole("button", { name: "Default" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete lane" }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  test("Delete lane renders only with an onDelete and fires it", () => {
    const onDelete = vi.fn();
    const { unmount } = render(
      <WorkflowLaneMenu lane={singleLane()} projectAgents={[]} onSelect={vi.fn()} onDelete={onDelete} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete lane" }));
    expect(onDelete).toHaveBeenCalled();
    unmount();

    render(<WorkflowLaneMenu lane={singleLane()} projectAgents={[]} onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Delete lane" })).toBeNull();
  });
});
