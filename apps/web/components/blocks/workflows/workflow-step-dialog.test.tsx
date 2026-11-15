/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { WorkflowStep } from "@/convex/lib/contracts/workflowDefinition";
import { rememberNewThreadCliModel } from "@/lib/threads/remembered-new-thread-cli-models";
import { WorkflowStepDialog, type StepComposerContext } from "./workflow-step-dialog";

// The real thread composer needs Convex providers; a textarea plus selector
// stubs (driving selectorsProps) stand in.
vi.mock("@/components/blocks/thread/thread-composer", () => ({
  ThreadComposer: ({
    initialInput,
    onInputChange,
    onComposerDocumentChange,
    selectorsProps,
  }: {
    initialInput?: string;
    onInputChange?: (value: string) => void;
    onComposerDocumentChange?: (document: unknown) => void;
    selectorsProps?: {
      hideRuntimeSelector?: boolean;
      onModeChange?: (value: string) => void;
      onCliModelChange?: (value: string) => void;
      onProjectAgentChange?: (value: string | undefined) => void;
    };
  }) => (
    <div>
      <textarea
        aria-label="Prompt text"
        defaultValue={initialInput}
        onChange={(event) => onInputChange?.(event.target.value)}
      />
      <span>{selectorsProps?.hideRuntimeSelector ? "runtime-selector-hidden" : "runtime-selector"}</span>
      <span>{selectorsProps?.onProjectAgentChange ? "agent-selector" : "agent-selector-absent"}</span>
      <button type="button" onClick={() => selectorsProps?.onModeChange?.("plan")}>
        set-mode
      </button>
      <button type="button" onClick={() => selectorsProps?.onCliModelChange?.("opus")}>
        set-model
      </button>
      <button type="button" onClick={() => selectorsProps?.onProjectAgentChange?.("agent-2")}>
        set-agent
      </button>
      <button type="button" onClick={() => onComposerDocumentChange?.(TEST_COMPOSER_DOCUMENT)}>
        add-ref
      </button>
    </div>
  ),
}));

// Only dereferenced from the stub's onClick at test time, after module init.
const TEST_COMPOSER_DOCUMENT = {
  version: 1 as const,
  refs: [
    {
      type: "slash-command" as const,
      id: "cmd-1" as Id<"slashCommands">,
      scope: "project" as const,
      key: "review",
      canonicalKey: "project:review",
      displayLabel: "/review",
    },
  ],
};

// Radix Select doesn't open from jsdom events; render the items as buttons.
vi.mock("@/components/ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const Ctx = createContext<(value: string) => void>(() => {});
  return {
    Select: ({ onValueChange, children }: { onValueChange: (value: string) => void; children: ReactNode }) => (
      <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const onValueChange = useContext(Ctx);
      return (
        <button type="button" onClick={() => onValueChange(value)}>
          {children}
        </button>
      );
    },
  };
});

beforeAll(() => {
  // Radix Checkbox measures itself; jsdom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

const bashStep: WorkflowStep = {
  stepId: "step-1",
  laneId: "lane-1",
  action: { type: "bash", script: "pnpm test\n", timeoutMs: 90_000, reportOutput: "on_failure" },
};

const TEST_COMPOSER: StepComposerContext = {
  organizationId: "org-1" as Id<"organizations">,
  projectId: "project-1" as Id<"projects">,
};

function promptStep(): WorkflowStep {
  return { stepId: "step-1", laneId: "lane-1", action: { type: "prompt", content: { displayContent: "do it" } } };
}

function lastAction(onSubmit: ReturnType<typeof vi.fn>) {
  return onSubmit.mock.calls.at(-1)?.[0].action;
}

describe("WorkflowStepDialog", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  test("an untouched save round-trips the raw script and a fractional-minute timeout", () => {
    const onSubmit = vi.fn();
    render(<WorkflowStepDialog step={bashStep} onOpenChange={() => {}} onSubmit={onSubmit} />);

    expect(screen.getByLabelText("Timeout (minutes)")).toHaveProperty("value", "1.5");
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: undefined,
      action: { type: "bash", script: "pnpm test\n", timeoutMs: 90_000, reportOutput: "on_failure" },
    });
  });

  test("timeout converts before rounding; empty and invalid input fall back to 10 minutes", () => {
    const onSubmit = vi.fn();
    render(<WorkflowStepDialog step={null} onOpenChange={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: "true" } });

    fireEvent.change(screen.getByLabelText("Timeout (minutes)"), { target: { value: "0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(lastAction(onSubmit)).toMatchObject({ timeoutMs: 24_000 });

    fireEvent.change(screen.getByLabelText("Timeout (minutes)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(lastAction(onSubmit)).toMatchObject({ timeoutMs: 600_000 });

    fireEvent.change(screen.getByLabelText("Timeout (minutes)"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(lastAction(onSubmit)).toMatchObject({ timeoutMs: 600_000 });
  });

  test("result handling selects among the three states", () => {
    const onSubmit = vi.fn();
    render(<WorkflowStepDialog step={bashStep} onOpenChange={() => {}} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop on failure" }));
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    expect(lastAction(onSubmit)).toMatchObject({ reportOutput: "stop_on_failure" });
  });

  test("a parallel lane locks result handling to stop on failure (OS-1886)", () => {
    const onSubmit = vi.fn();
    render(
      <WorkflowStepDialog
        step={bashStep}
        lane={{ laneId: "lane-1", name: "Checks", type: "parallel" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    // The select mock drops `disabled`; the note and the submitted value are the lock.
    expect(screen.getByText("A parallel lane runs scripts in their own thread, with no agent to report to.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Always report to the agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    expect(lastAction(onSubmit)).toMatchObject({ reportOutput: "stop_on_failure" });
  });

  test("a prompt step without a composer context renders nothing instead of a wait form that would overwrite it", () => {
    render(<WorkflowStepDialog step={promptStep()} onOpenChange={() => {}} onSubmit={vi.fn()} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a prompt save keeps overrides the form doesn't edit and omits a ref-less composer document", async () => {
    const step: WorkflowStep = {
      stepId: "step-1",
      laneId: "lane-1",
      action: {
        type: "prompt",
        content: { displayContent: "do it" },
        overrides: { projectAgentId: "agent-1" as Id<"projectAgents">, cliType: "claude-code", cliModel: "opus" },
      },
    };
    const onSubmit = vi.fn();
    render(
      <WorkflowStepDialog
        step={step}
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "parallel" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(await screen.findByLabelText("Prompt text"), { target: { value: "do it properly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    expect(lastAction(onSubmit)).toEqual({
      type: "prompt",
      content: { displayContent: "do it properly", composerDocument: undefined },
      overrides: {
        projectAgentId: "agent-1",
        cliType: "claude-code",
        cliModel: "opus",
        cliEffort: undefined,
        mode: undefined,
      },
    });

    // Emptying the prompt disables the submit, like an empty bash script.
    fireEvent.change(screen.getByLabelText("Prompt text"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "Save step" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a prompt save carries the composer document once a ref is added", async () => {
    const onSubmit = vi.fn();
    render(
      <WorkflowStepDialog
        step={promptStep()}
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "single" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "add-ref" }));
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    expect(lastAction(onSubmit).content).toEqual({
      displayContent: "do it",
      composerDocument: TEST_COMPOSER_DOCUMENT,
    });
  });

  test("a single lane hides the runtime selector; mode is the only step override", async () => {
    const onSubmit = vi.fn();
    render(
      <WorkflowStepDialog
        step={promptStep()}
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "single" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    expect(await screen.findByText("runtime-selector-hidden")).toBeTruthy();
    // A model pick has no handler in a single lane; even if one fired, save sheds it.
    fireEvent.click(screen.getByRole("button", { name: "set-model" }));
    fireEvent.click(screen.getByRole("button", { name: "set-mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    expect(lastAction(onSubmit).overrides).toEqual({ mode: "plan" });
  });

  test("a single lane save sheds thread-level overrides left by a lane-type move", async () => {
    const step: WorkflowStep = {
      stepId: "step-1",
      laneId: "lane-1",
      action: {
        type: "prompt",
        content: { displayContent: "do it" },
        overrides: { projectAgentId: "agent-1" as Id<"projectAgents">, cliType: "codex", cliModel: "opus" },
      },
    };
    const onSubmit = vi.fn();
    render(
      <WorkflowStepDialog
        step={step}
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "single" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    await screen.findByLabelText("Prompt text");
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    expect(lastAction(onSubmit).overrides).toBeUndefined();
  });

  test("a parallel lane shows the runtime selector and pins the runtime with a mode pick", async () => {
    const onSubmit = vi.fn();
    render(
      <WorkflowStepDialog
        step={promptStep()}
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "parallel" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    expect(await screen.findByText("runtime-selector")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "set-mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    expect(lastAction(onSubmit).overrides).toMatchObject({ cliType: "claude-code", mode: "plan" });
  });

  test("a new parallel-lane prompt seeds the remembered last-used CLI, model, and effort (OS-1892)", async () => {
    rememberNewThreadCliModel("codex", "gpt-5.5", "high");
    const onSubmit = vi.fn();
    render(
      <WorkflowStepDialog
        step={null}
        createType="prompt"
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "parallel" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(await screen.findByLabelText("Prompt text"), { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));

    expect(lastAction(onSubmit).overrides).toMatchObject({ cliType: "codex", cliModel: "gpt-5.5", cliEffort: "high" });
  });

  test("a new parallel-lane prompt seeds from the lane's last Prompt before the remembered selection", async () => {
    rememberNewThreadCliModel("codex", "gpt-5.5", "high");
    const onSubmit = vi.fn();
    render(
      <WorkflowStepDialog
        step={null}
        createType="prompt"
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "parallel" }}
        seedOverrides={{ cliType: "claude-code", cliModel: "haiku", cliEffort: "low", mode: "plan" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(await screen.findByLabelText("Prompt text"), { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));

    expect(lastAction(onSubmit).overrides).toEqual({
      projectAgentId: undefined,
      cliType: "claude-code",
      cliModel: "haiku",
      cliEffort: "low",
      mode: undefined,
    });
  });

  test("editing an existing parallel-lane prompt keeps its own runtime over the remembered one", async () => {
    rememberNewThreadCliModel("codex", "gpt-5.5", "high");
    const onSubmit = vi.fn();
    render(
      <WorkflowStepDialog
        step={promptStep()}
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "parallel" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    await screen.findByLabelText("Prompt text");
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));

    expect(lastAction(onSubmit).overrides).toMatchObject({ cliType: "claude-code", cliModel: undefined });
  });

  test("a parallel lane edits the step's Project agent; a single lane never offers it", async () => {
    const onSubmit = vi.fn();
    const { unmount } = render(
      <WorkflowStepDialog
        step={promptStep()}
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "parallel" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    expect(await screen.findByText("agent-selector")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "set-agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Save step" }));
    expect(lastAction(onSubmit).overrides).toMatchObject({ projectAgentId: "agent-2", cliType: "claude-code" });
    unmount();

    render(
      <WorkflowStepDialog
        step={promptStep()}
        composer={TEST_COMPOSER}
        lane={{ laneId: "lane-1", name: "Lane 1", type: "single" }}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );
    expect(await screen.findByText("agent-selector-absent")).toBeTruthy();
  });

  test("the fields sit in a form that submits, and the script cap is on the textarea", () => {
    const onSubmit = vi.fn();
    render(<WorkflowStepDialog step={bashStep} onOpenChange={() => {}} onSubmit={onSubmit} />);

    const script = screen.getByLabelText("Script") as HTMLTextAreaElement;
    expect(script.maxLength).toBe(32_000);
    fireEvent.submit(script.closest("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalled();
  });
});
