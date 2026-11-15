/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";

const useQueryMock = vi.fn();
const resumeLaneMock = vi.fn().mockResolvedValue(null);
const retryStepMock = vi.fn().mockResolvedValue(null);
const skipStepMock = vi.fn().mockResolvedValue(null);
const approveStepMock = vi.fn().mockResolvedValue(null);
const cancelRunMock = vi.fn().mockResolvedValue(null);

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name.endsWith("resumeLane")) return resumeLaneMock;
    if (name.endsWith("retryStep")) return retryStepMock;
    if (name.endsWith("skipStep")) return skipStepMock;
    if (name.endsWith("approveStep")) return approveStepMock;
    return cancelRunMock;
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/navigation", () => ({
  AppLink: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  appRoute: { projectThreadDetail: () => "/threads/x", projectWorkflowDetail: () => "/workflows/x" },
}));

import type { Id } from "@/convex/_generated/dataModel";
import { WorkflowRunPanel } from "./workflow-run-panel";

const RUN_ID = "run_1" as Id<"workflowRuns">;
const PARAMS = { organizationSlug: "org", projectAlias: "proj" };

function stepItem(overrides: Record<string, unknown>) {
  return {
    _id: `step_${String(overrides.definitionStepId)}`,
    laneName: "Lane",
    title: "Do the thing",
    type: "prompt",
    status: "pending",
    ...overrides,
  };
}

function runDetail(steps: Array<Record<string, unknown>>) {
  return {
    _id: RUN_ID,
    workflowId: "wf_1",
    workflowName: "Release Train",
    status: "running",
    versionNumber: 1,
    startedAt: 1,
    lastActivityAt: 1,
    stages: [{ stageId: "stage-1", name: "Work", steps }],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function precedes(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("WorkflowRunPanel", () => {
  test("each held step's Resume resumes its own lane", () => {
    useQueryMock.mockReturnValue(
      runDetail([
        stepItem({ definitionStepId: "a2", laneId: "lane-a", title: "Fix findings", held: true }),
        stepItem({ definitionStepId: "b2", laneId: "lane-b", title: "Verify fixes", held: true }),
        stepItem({ definitionStepId: "c2", laneId: "lane-c", title: "Ship it" }),
      ])
    );

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    // Resume renders on the two held rows only; the header keeps Cancel.
    const buttons = screen.getAllByRole("button", { name: "Resume" });
    expect(buttons).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Cancel run" })).toBeDefined();

    fireEvent.click(buttons[0]);
    expect(resumeLaneMock).toHaveBeenLastCalledWith({ runId: RUN_ID, laneId: "lane-a" });
    fireEvent.click(buttons[1]);
    expect(resumeLaneMock).toHaveBeenLastCalledWith({ runId: RUN_ID, laneId: "lane-b" });
  });

  test("a failed step's Retry and Skip act on that step", async () => {
    useQueryMock.mockReturnValue(
      runDetail([
        stepItem({ definitionStepId: "a1", laneId: "lane-a", title: "Build it", status: "failed", threadId: "thread_1" }),
        stepItem({ definitionStepId: "b1", laneId: "lane-b", title: "Review it" }),
      ])
    );

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    // Retry/Skip render on the failed row only — as siblings of the row's
    // link, never inside it (no interactive content in an anchor).
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Skip" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Retry" }).closest("a")).toBeNull();
    expect(screen.getByRole("button", { name: "Skip" }).closest("a")).toBeNull();
    // Actions sit between the status glyph and the title, not at the row's end.
    expect(precedes(screen.getByRole("button", { name: "Skip" }), screen.getByText("Build it"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryStepMock).toHaveBeenLastCalledWith({ runId: RUN_ID, stepId: "step_a1" });
    // Let the retry settle — both buttons disable while the step is busy.
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(skipStepMock).toHaveBeenLastCalledWith({ runId: RUN_ID, stepId: "step_a1" });
  });

  test("a waiting bash step shows its pinned script next to Approve", () => {
    useQueryMock.mockReturnValue(
      runDetail([
        stepItem({
          definitionStepId: "a1",
          laneId: "lane-a",
          title: "Lint",
          type: "bash",
          status: "waiting",
          script: { script: "pnpm lint", timeoutMs: 60_000 },
        }),
        stepItem({ definitionStepId: "b1", laneId: "lane-b", title: "Review it", type: "bash", script: { script: "hidden", timeoutMs: 1_000 } }),
      ])
    );

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    expect(screen.getByText("pnpm lint")).toBeDefined();
    expect(screen.getByText("Timeout 1m")).toBeDefined();
    // Only the held step exposes its script; the rest stay compact rows.
    expect(screen.queryByText("hidden")).toBeNull();
  });

  test("a step row with a thread is one stretched link, so hover covers the glyph, Approve, and the script", () => {
    useQueryMock.mockReturnValue(
      runDetail([
        stepItem({
          definitionStepId: "a1",
          laneId: "lane-a",
          title: "Lint",
          type: "bash",
          status: "waiting",
          threadId: "thread_1",
          script: { script: "pnpm lint", timeoutMs: 60_000 },
        }),
      ])
    );

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    const link = screen.getByRole("link", { name: "Open thread Lint" });
    expect(link.className).toContain("absolute inset-0");
    const row = link.closest("li")!;
    expect(row.className).toMatch(/hover:bg-/);
    // Approve and the script sit on the same card, above the link, never inside it.
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(row.contains(approve)).toBe(true);
    expect(link.contains(approve)).toBe(false);
    expect(row.contains(screen.getByText("pnpm lint"))).toBe(true);
  });

  test("a waiting step's Approve completes that step", () => {
    useQueryMock.mockReturnValue(
      runDetail([
        stepItem({ definitionStepId: "a1", laneId: "lane-a", title: "Sign off", status: "waiting", threadId: "thread_1" }),
        stepItem({ definitionStepId: "b1", laneId: "lane-b", title: "Review it" }),
      ])
    );

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve.closest("a")).toBeNull();
    expect(precedes(approve, screen.getByText("Sign off"))).toBe(true);
    fireEvent.click(approve);
    expect(approveStepMock).toHaveBeenLastCalledWith({ runId: RUN_ID, stepId: "step_a1" });
  });

  test("a deleted workflow's name renders as plain text, not a dead editor link", () => {
    useQueryMock.mockReturnValue({
      ...runDetail([stepItem({ definitionStepId: "a1", laneId: "lane-a" })]),
      workflowDeleted: true,
    });

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    expect(screen.getByText("Release Train").closest("a")).toBeNull();
  });

  test("header shows the version right after the name, before the status badge", () => {
    useQueryMock.mockReturnValue(runDetail([stepItem({ definitionStepId: "a1", laneId: "lane-a" })]));

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    expect(screen.getByText("Release Train").parentElement?.textContent).toBe("Release Trainv1Running");
    // The name is a real anchor into the workflow editor.
    expect(screen.getByText("Release Train").closest("a")?.getAttribute("href")).toBe("/workflows/x");
  });

  test("a prompt step's lane label carries its resolved model and effort", () => {
    useQueryMock.mockReturnValue(
      runDetail([
        stepItem({
          definitionStepId: "a1",
          laneId: "lane-a",
          cliType: "claude-code",
          cliModel: "opus-5",
          cliEffort: "high",
        }),
      ])
    );

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    expect(screen.getByText("Opus 5")).toBeDefined();
    expect(screen.getByText("High")).toBeDefined();
    expect(screen.getByText("Lane")).toBeDefined();
  });

  test("a step with no runtime shows the lane name without a dangling separator", () => {
    useQueryMock.mockReturnValue(runDetail([stepItem({ definitionStepId: "a1", laneId: "lane-a", type: "wait" })]));

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    expect(screen.getByText("Lane").parentElement?.textContent).toBe("Lane");
  });

  test("Cancel run asks for confirmation before canceling", () => {
    useQueryMock.mockReturnValue(runDetail([stepItem({ definitionStepId: "a1", laneId: "lane-a" })]));

    render(<WorkflowRunPanel runId={RUN_ID} params={PARAMS} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    // The click opens the dialog — nothing is canceled until it is confirmed.
    expect(cancelRunMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Keep running" }));
    expect(cancelRunMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel run" }));
    expect(cancelRunMock).toHaveBeenLastCalledWith({ runId: RUN_ID });
  });
});
