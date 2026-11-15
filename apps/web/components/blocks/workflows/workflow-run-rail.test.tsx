/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";

const useQueryMock = vi.fn();
const resumeLaneMock = vi.fn().mockResolvedValue(null);
const approveStepMock = vi.fn().mockResolvedValue(null);
const retryStepMock = vi.fn().mockResolvedValue(null);
const cancelRunMock = vi.fn().mockResolvedValue(null);

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name.endsWith("resumeLane")) return resumeLaneMock;
    if (name.endsWith("approveStep")) return approveStepMock;
    if (name.endsWith("retryStep")) return retryStepMock;
    if (name.endsWith("skipStep")) return vi.fn();
    return cancelRunMock;
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/navigation", () => ({
  AppLink: ({ children, href, ...props }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  appRoute: { projectThreadDetail: (_o: string, _p: string, id: string) => `/threads/${id}` },
}));

import type { Id } from "@/convex/_generated/dataModel";
import { WorkflowRunRail } from "./workflow-run-rail";

const RUN_ID = "run_1" as Id<"workflowRuns">;
const THREAD_ID = "thread_1" as Id<"cliThreads">;
const PARAMS = { organizationSlug: "org", projectAlias: "proj" };

function stepItem(overrides: Record<string, unknown>) {
  return {
    _id: `step_${String(overrides.definitionStepId)}`,
    laneId: "lane-a",
    laneName: "Executor",
    title: "Do the thing",
    type: "prompt",
    status: "pending",
    ...overrides,
  };
}

function runDetail(steps: Array<Record<string, unknown>>, status = "running") {
  return {
    _id: RUN_ID,
    workflowId: "wf_1",
    workflowName: "Release Train",
    workflowDeleted: false,
    status,
    versionNumber: 1,
    startedAt: 1,
    lastActivityAt: 1,
    stages: [
      { stageId: "stage-1", name: "Stage 1", steps: steps.slice(0, 2) },
      { stageId: "stage-2", name: "Stage 2", steps: steps.slice(2) },
    ],
  };
}

// jsdom has no scrollTo; the rail centers its focus step with it.
Element.prototype.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function expand() {
  vi.useFakeTimers();
  fireEvent.mouseEnter(screen.getByRole("complementary", { name: "Workflow run progress" }));
  act(() => vi.advanceTimersByTime(250));
  vi.useRealTimers();
}

describe("WorkflowRunRail", () => {
  test("collapsed dots are one expand control; hover shows stage labels and controls", () => {
    useQueryMock.mockReturnValue(
      runDetail([
        stepItem({ definitionStepId: "a1", title: "Investigate", status: "completed", threadId: "thread_0" }),
        stepItem({ definitionStepId: "a2", title: "Lint", type: "bash", status: "waiting", threadId: THREAD_ID }),
        stepItem({ definitionStepId: "b1", title: "Review", laneId: "lane-b", laneName: "Reviewer", held: true }),
      ])
    );

    render(<WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} />);

    // The dot column expands the panel before its links become interactive.
    const trigger = screen.getByRole("button", { name: "Expand workflow run progress" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.querySelector("svg")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByText("Stage 1")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(1);

    expand();
    expect(screen.getByText("Stage 1")).toBeDefined();
    expect(screen.getByText("Release Train")).toBeDefined();
    expect(screen.getByRole("button", { name: "Pin workflow run progress" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(approveStepMock).toHaveBeenLastCalledWith({ runId: RUN_ID, stepId: "step_a2" });
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(resumeLaneMock).toHaveBeenLastCalledWith({ runId: RUN_ID, laneId: "lane-b" });
  });

  test("rows link to other threads; the open thread's own rows do not navigate", () => {
    useQueryMock.mockReturnValue(
      runDetail([
        stepItem({ definitionStepId: "a1", title: "Investigate", status: "completed", threadId: THREAD_ID }),
        stepItem({ definitionStepId: "b1", title: "Review", laneId: "lane-b", status: "running", threadId: "thread_2" }),
        stepItem({ definitionStepId: "a2", title: "Ship" }),
      ])
    );

    render(<WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} />);

    expand();
    expect(screen.getByRole("link", { name: "Review" }).getAttribute("href")).toBe("/threads/thread_2");
    expect(screen.queryByRole("link", { name: /Investigate/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Ship/ })).toBeNull();
  });

  test("activating the dot column pins the panel, transfers focus, and Escape restores it", () => {
    useQueryMock.mockReturnValue(runDetail([stepItem({ definitionStepId: "a1" })]));
    render(<WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} />);
    const trigger = screen.getByRole("button", { name: "Expand workflow run progress" });
    trigger.focus();
    fireEvent.click(trigger, { detail: 0 });
    const pin = screen.getByRole("button", { name: "Unpin workflow run progress" });
    expect(document.activeElement).toBe(pin);
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    fireEvent.mouseLeave(screen.getByRole("complementary"));
    expect(screen.getByText("Release Train")).toBeDefined();
    fireEvent.keyDown(pin, { key: "Escape" });
    expect(screen.queryByText("Release Train")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Expand workflow run progress" }));
  });

  test("hover pinning reports its actual state and unpinning releases the panel", () => {
    useQueryMock.mockReturnValue(runDetail([stepItem({ definitionStepId: "a1" })]));
    render(<WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} />);
    expand();
    const pin = screen.getByRole("button", { name: "Pin workflow run progress" });
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pin);
    fireEvent.mouseLeave(screen.getByRole("complementary"));
    fireEvent.click(screen.getByRole("button", { name: "Unpin workflow run progress" }));
    expect(screen.queryByText("Release Train")).toBeNull();
  });

  test("hover expansion preserves focused trigger and keyboard access after the pointer leaves", () => {
    useQueryMock.mockReturnValue(runDetail([stepItem({ definitionStepId: "a1" })]));
    render(<WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} />);
    screen.getByRole("button", { name: "Expand workflow run progress" }).focus();
    expand();
    const pin = screen.getByRole("button", { name: "Pin workflow run progress" });
    expect(document.activeElement).toBe(pin);
    fireEvent.mouseLeave(screen.getByRole("complementary"));
    expect(screen.getByText("Release Train")).toBeDefined();
    act(() => pin.blur());
    expect(screen.queryByText("Release Train")).toBeNull();
  });

  test("Escape clears pending hover expansion without reaching parent shortcuts", () => {
    vi.useFakeTimers();
    useQueryMock.mockReturnValue(runDetail([stepItem({ definitionStepId: "a1" })]));
    const onKeyDown = vi.fn();
    render(<div onKeyDown={onKeyDown}><WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} /></div>);
    const rail = screen.getByRole("complementary");
    fireEvent.mouseEnter(rail);
    fireEvent.keyDown(rail, { key: "Escape" });
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText("Release Train")).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  test("a terminal run keeps the rail but drops every control, Cancel included", () => {
    useQueryMock.mockReturnValue(
      runDetail(
        [
          stepItem({ definitionStepId: "a1", title: "Investigate", status: "completed", threadId: THREAD_ID }),
          stepItem({ definitionStepId: "a2", title: "Lint", status: "failed", threadId: THREAD_ID }),
        ],
        "canceled"
      )
    );

    render(<WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} />);
    expand();

    expect(screen.getByText("Canceled")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull();
  });

  test("Cancel confirms before canceling", () => {
    useQueryMock.mockReturnValue(runDetail([stepItem({ definitionStepId: "a1", status: "running", threadId: THREAD_ID })]));

    render(<WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} />);
    expand();

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(cancelRunMock).not.toHaveBeenCalled();
    // The dialog's confirm shares the label; it is the last one rendered.
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel run" }).at(-1)!);
    expect(cancelRunMock).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  test("renders nothing while the run is loading or gone", () => {
    useQueryMock.mockReturnValue(undefined);
    const { container, rerender } = render(<WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} />);
    expect(container.firstChild).toBeNull();
    useQueryMock.mockReturnValue(null);
    rerender(<WorkflowRunRail runId={RUN_ID} threadId={THREAD_ID} params={PARAMS} />);
    expect(container.firstChild).toBeNull();
  });
});
