/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { WorkflowDefinition, WorkflowStep } from "@/convex/lib/contracts/workflowDefinition";
import type { Id } from "@/convex/_generated/dataModel";
import { CLI_TYPE_MAP } from "@/lib/cli-runtime-ui/registry";
import type { StepComposerContext } from "./workflow-step-dialog";
import { WorkflowGrid } from "./workflow-grid";

// The real thread composer needs Convex providers; a textarea stands in.
vi.mock("@/components/blocks/thread/thread-composer", () => ({
  ThreadComposer: ({
    initialInput,
    onInputChange,
  }: {
    initialInput?: string;
    onInputChange?: (value: string) => void;
  }) => (
    <textarea
      aria-label="Prompt text"
      defaultValue={initialInput}
      onChange={(event) => onInputChange?.(event.target.value)}
    />
  ),
}));

// The real lane menu is the composer's Radix menu; a stub that emits the same
// selections stands in (its logic has its own test file).
vi.mock("@/components/blocks/workflows/workflow-lane-menu", () => ({
  WorkflowLaneMenu: ({
    lane,
    disabled,
    onSelect,
    onDelete,
  }: {
    lane: { name: string; type: "single" | "parallel" };
    disabled?: boolean;
    onSelect: (selection: { type: "single" | "parallel"; defaults?: { cliType: string } }) => void;
    onDelete?: () => void;
  }) => (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onSelect(
            lane.type === "single" ? { type: "parallel" } : { type: "single", defaults: { cliType: "claude-code" } }
          )
        }
      >
        {`lane-runtime ${lane.name}`}
      </button>
      {onDelete ? (
        <button type="button" disabled={disabled} onClick={onDelete}>
          {`Delete lane ${lane.name}`}
        </button>
      ) : null}
    </div>
  ),
}));

// Radix menus don't open from jsdom events; render the items inline instead.
// Spreading the real module keeps any export this file doesn't stub working.
vi.mock("@/components/ui/dropdown-menu", async () => ({
  ...(await vi.importActual<typeof import("@/components/ui/dropdown-menu")>("@/components/ui/dropdown-menu")),
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

function definitionWith(laneCount: number, stageCount: number): WorkflowDefinition {
  return {
    lanes: Array.from({ length: laneCount }, (_, i) => ({
      laneId: `lane-${i + 1}`,
      name: `Lane ${i + 1}`,
      type: "single" as const,
    })),
    stages: Array.from({ length: stageCount }, (_, i) => ({
      stageId: `stage-${i + 1}`,
      name: `Stage ${i + 1}`,
      steps: [],
    })),
  };
}

const TEST_COMPOSER: StepComposerContext = {
  organizationId: "org-1" as Id<"organizations">,
  projectId: "project-1" as Id<"projects">,
};

function Harness({
  initial,
  disabled,
  composer,
}: {
  initial: WorkflowDefinition;
  disabled?: boolean;
  composer?: StepComposerContext;
}) {
  const [definition, setDefinition] = useState(initial);
  return <WorkflowGrid definition={definition} onChange={setDefinition} disabled={disabled} composer={composer} />;
}

function gridTemplateColumns(): string {
  const inner = screen.getByTestId("workflow-grid").firstElementChild as HTMLElement;
  return inner.style.gridTemplateColumns;
}

describe("WorkflowGrid", () => {
  beforeAll(() => {
    // Radix Checkbox (in the step dialog) measures itself; jsdom has no ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });
  afterEach(cleanup);

  test("deleting the last lane keeps a valid grid template and Add Lane recovers", () => {
    render(<Harness initial={definitionWith(1, 1)} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete lane Lane 1" }));

    expect(gridTemplateColumns()).not.toContain("repeat(0");
    expect(screen.queryByLabelText("Lane 1 name")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add lane" }));
    expect(screen.getByLabelText("Lane 1 name")).toHaveProperty("value", "Lane 1");
  });

  test("deleting a lane or stage that holds steps confirms first; empty ones delete in one click", () => {
    render(<Harness initial={definitionWithBashStep()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete lane Lane 1" }));
    // Nothing deleted yet — the confirm dialog is up, and Cancel keeps it that way.
    expect(screen.getByText("pnpm test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("pnpm test")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete lane Lane 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("pnpm test")).toBeNull();
    expect(screen.queryByLabelText("Lane 1 name")).toBeNull();

    // The stage is empty now, so its delete needs no confirmation.
    fireEvent.click(screen.getByRole("button", { name: "Delete stage Stage 1" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByLabelText("Stage 1 name")).toBeNull();
  });

  test("Add Lane and Add Stage hide at the server caps", () => {
    // Separate renders: a full 12×50 grid is too slow for jsdom.
    const { unmount } = render(<Harness initial={definitionWith(12, 1)} />);
    expect(screen.queryByRole("button", { name: "Add lane" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add stage" })).toBeTruthy();
    unmount();

    render(<Harness initial={definitionWith(1, 50)} />);
    expect(screen.getByRole("button", { name: "Add lane" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add stage" })).toBeNull();
  });

  test("disabled blocks renames and structure edits without hiding the affordances", () => {
    render(<Harness initial={definitionWith(1, 1)} disabled />);

    expect((screen.getByLabelText("Lane 1 name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Stage 1 name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add lane" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add stage" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete lane Lane 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("lane and stage rename inputs carry positional accessible names", () => {
    render(<Harness initial={definitionWith(2, 2)} />);

    expect(screen.getByLabelText("Lane 2 name")).toHaveProperty("value", "Lane 2");
    expect(screen.getByLabelText("Stage 2 name")).toHaveProperty("value", "Stage 2");
  });

  test("the Wait dropdown item adds the step directly, with no dialog", () => {
    render(<Harness initial={definitionWith(1, 1)} />);

    // One match = the menu item; a second appears once the card lands.
    expect(screen.getAllByText("Wait for human")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Wait for human" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByText("Wait for human")).toHaveLength(2);
  });

  test("the Bash dropdown item opens the config dialog before adding", () => {
    render(<Harness initial={definitionWith(1, 1)} />);

    fireEvent.click(screen.getByRole("button", { name: "Bash script" }));
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: "pnpm lint" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("pnpm lint")).toBeTruthy();
  });

  test("edits and deletes a Bash step through its card, without a type picker", () => {
    render(<Harness initial={definitionWithBashStep()} />);

    fireEvent.click(screen.getByText("pnpm test"));
    expect(screen.queryByLabelText("Step type")).toBeNull();
    expect(screen.getByLabelText("Timeout (minutes)")).toHaveProperty("value", "10");
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: "pnpm lint" } });
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));
    expect(screen.getByText("pnpm lint")).toBeTruthy();

    fireEvent.click(screen.getByText("pnpm lint"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("pnpm lint")).toBeNull();
  });

  test("a Bash step's card shows its name, timeout, and result-handling pill in the exec accent", () => {
    const definition = definitionWithBashStep();
    definition.stages[0].steps[0] = {
      stepId: "step-bash",
      laneId: "lane-1",
      name: "Checks",
      action: { type: "bash", script: "pnpm test", timeoutMs: 600_000, reportOutput: "stop_on_failure" },
    };
    render(<Harness initial={definition} />);

    expect(screen.getByText("Checks").className).toContain("text-info-foreground");
    expect(screen.getByText("Timeout: 10m")).toBeTruthy();
    expect(screen.getByText("Stop on failure").className).toContain("bg-info/20");
  });

  test("step placeholder hides for read-only grids and at the per-stage step cap", () => {
    const atCap = definitionWith(1, 1);
    atCap.stages[0].steps = Array.from({ length: 50 }, (_, i) => ({
      stepId: `step-${i}`,
      laneId: "lane-1",
      action: { type: "wait" as const },
    }));
    const { unmount } = render(<Harness initial={atCap} />);
    expect(screen.queryByRole("button", { name: "Add step..." })).toBeNull();
    unmount();

    render(<WorkflowGrid definition={definitionWithBashStep()} />);
    expect(screen.queryByRole("button", { name: "Add step..." })).toBeNull();
    // Read-only cards are not buttons.
    expect(screen.getByText("pnpm test").closest("button")).toBeNull();
  });

  test("disabled blocks step edits without hiding them", () => {
    render(<Harness initial={definitionWithBashStep()} disabled />);

    expect((screen.getByRole("button", { name: "Add step..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("pnpm test").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  test("cards are drag-wired when editable, drag-disabled while saving, inert read-only", () => {
    const dragMarker = (root: HTMLElement) =>
      root.querySelector("[data-workflow-dnd-step]")?.getAttribute("data-workflow-dnd-step") ?? null;

    const editable = render(<Harness initial={definitionWithBashStep()} />);
    expect(dragMarker(editable.container)).toBe("enabled");
    editable.unmount();

    const saving = render(<Harness initial={definitionWithBashStep()} disabled />);
    expect(dragMarker(saving.container)).toBe("disabled");
    saving.unmount();

    const readOnly = render(<WorkflowGrid definition={definitionWithBashStep()} />);
    expect(dragMarker(readOnly.container)).toBeNull();
  });

  test("the Prompt dropdown item opens the composer dialog and adds the step", async () => {
    render(<Harness initial={definitionWith(1, 1)} composer={TEST_COMPOSER} />);

    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    fireEvent.change(await screen.findByLabelText("Prompt text"), { target: { value: "Plan the release" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Plan the release")).toBeTruthy();
  });

  test("a new parallel-lane prompt starts on the runtime of the lane's last Prompt (OS-1892)", async () => {
    const definition = definitionWithOverriddenPrompt("parallel");
    definition.stages[0].steps[0].action = {
      type: "prompt",
      content: { displayContent: "Plan the work" },
      overrides: { cliType: "claude-code", cliModel: "haiku" },
    };
    render(<Harness initial={definition} composer={TEST_COMPOSER} />);

    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    fireEvent.change(await screen.findByLabelText("Prompt text"), { target: { value: "Review the work" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));

    expect(screen.getAllByText("Haiku")).toHaveLength(2);
  });

  test("a parallel lane's prompt card renders its runtime like the lane header and opens the dialog", async () => {
    const definition = definitionWithOverriddenPrompt("parallel");
    render(<Harness initial={definition} composer={TEST_COMPOSER} />);

    // Icon + model + effort, as the lane header's trigger reads — no runtime-name pill.
    expect(screen.queryByText(CLI_TYPE_MAP["claude-code"])).toBeNull();
    expect(screen.getByText("custom-model")).toBeTruthy();
    expect(screen.getByText("extreme")).toBeTruthy();
    expect(screen.getByText("my-mode")).toBeTruthy();

    fireEvent.click(screen.getByText("Plan the work"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(((await screen.findByLabelText("Prompt text")) as HTMLTextAreaElement).value).toBe("Plan the work");
  });

  test("a single lane's prompt card shows only the mode pill — runtime, model, and effort come from the lane", () => {
    render(<Harness initial={definitionWithOverriddenPrompt("single")} composer={TEST_COMPOSER} />);

    expect(screen.getByText("my-mode")).toBeTruthy();
    expect(screen.queryByText("custom-model")).toBeNull();
    expect(screen.queryByText("extreme")).toBeNull();
    expect(screen.queryByText(CLI_TYPE_MAP["claude-code"])).toBeNull();
  });

  test("flipping a lane to single sheds its prompts' runtime pills in the same edit", () => {
    const definition = definitionWithOverriddenPrompt("parallel");
    // A real mode: reconcile sheds modes the effective runtime lacks.
    const action = definition.stages[0].steps[0].action;
    if (action.type === "prompt") {
      action.overrides = { ...action.overrides, mode: "plan" };
    }
    render(<Harness initial={definition} composer={TEST_COMPOSER} />);
    expect(screen.getByText("custom-model")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "lane-runtime Lane 1" }));

    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.queryByText("custom-model")).toBeNull();
    expect(screen.queryByText("extreme")).toBeNull();
    expect(screen.queryByText(CLI_TYPE_MAP["claude-code"])).toBeNull();
  });

  test("flipping a lane to parallel pins a runtime onto its prompts in the same edit", () => {
    const definition = definitionWithOverriddenPrompt("single");
    definition.stages[0].steps[0] = {
      stepId: "step-p",
      laneId: "lane-1",
      action: { type: "prompt", content: { displayContent: "Plan the work" }, overrides: { mode: "plan" } },
    };
    render(<Harness initial={definition} composer={TEST_COMPOSER} />);
    expect(screen.queryByText(CLI_TYPE_MAP["claude-code"])).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "lane-runtime Lane 1" }));

    expect(screen.getByText(CLI_TYPE_MAP["claude-code"])).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
  });

  test("read-only grids get no lane Delete item", () => {
    render(<WorkflowGrid definition={definitionWithBashStep()} />);

    expect(screen.queryByRole("button", { name: "Delete lane Lane 1" })).toBeNull();
  });

  test("prompt cards render slash-command refs as their labels, not raw link syntax", () => {
    const definition = definitionWith(1, 1);
    definition.stages[0].steps = [
      {
        stepId: "step-p",
        laneId: "lane-1",
        action: {
          type: "prompt",
          content: { displayContent: "Run [/review](convoy://command/review) now" },
        },
      },
    ];
    render(<Harness initial={definition} />);

    const grid = screen.getByTestId("workflow-grid");
    expect(grid.textContent).toContain("Run /review now");
    expect(grid.textContent).not.toContain("convoy://");
  });

  test("prompt cards without a composer context are draggable but do not open the step dialog", () => {
    const definition = definitionWith(1, 1);
    definition.stages[0].steps = [
      { stepId: "step-p", laneId: "lane-1", action: { type: "prompt", content: { displayContent: "Plan the work" } } },
    ];
    render(<Harness initial={definition} />);

    const card = screen.getByText("Plan the work");
    expect(card.closest("[data-workflow-dnd-step]")).not.toBeNull();
    expect(card.closest("button")).toBeNull();
    fireEvent.click(card);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

function definitionWithOverriddenPrompt(laneType: "single" | "parallel"): WorkflowDefinition {
  const definition = definitionWith(1, 1);
  definition.lanes[0].type = laneType;
  definition.stages[0].steps = [
    {
      stepId: "step-p",
      laneId: "lane-1",
      action: {
        type: "prompt",
        content: { displayContent: "Plan the work" },
        // Unknown model/effort/mode values fall back to their raw strings.
        overrides: { cliType: "claude-code", cliModel: "custom-model", cliEffort: "extreme", mode: "my-mode" },
      },
    },
  ];
  return definition;
}

function definitionWithBashStep(): WorkflowDefinition {
  const definition = definitionWith(1, 1);
  const step: WorkflowStep = {
    stepId: "step-bash",
    laneId: "lane-1",
    action: { type: "bash", script: "pnpm test", timeoutMs: 600_000, reportOutput: "on_failure" },
  };
  definition.stages[0].steps = [step];
  return definition;
}
