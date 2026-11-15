/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const useQueryMock = vi.fn();
const approveStepMock = vi.fn().mockResolvedValue(null);

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => approveStepMock,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import type { Id } from "@/convex/_generated/dataModel";
import { WorkflowWaitCard } from "./workflow-wait-card";

const RUN_ID = "run_1" as Id<"workflowRuns">;
const THREAD_ID = "thread_1" as Id<"cliThreads">;

function runDetail(steps: Array<Record<string, unknown>>) {
  return {
    _id: RUN_ID,
    status: "needs_attention",
    stages: [{ stageId: "stage-1", name: "Work", steps }],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkflowWaitCard", () => {
  test("renders this thread's waiting step and approves it", () => {
    useQueryMock.mockReturnValue(
      runDetail([
        { _id: "step_1", title: "Sign off on the plan", status: "waiting", threadId: THREAD_ID },
        { _id: "step_2", title: "Ship it", status: "pending", threadId: undefined },
      ])
    );

    render(<WorkflowWaitCard runId={RUN_ID} threadId={THREAD_ID} threadStatus="waiting_input" />);

    expect(screen.getByText("Sign off on the plan")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(approveStepMock).toHaveBeenLastCalledWith({ runId: RUN_ID, stepId: "step_1" });
  });

  test("a held bash step shows the pinned script and its timeout before Approve", () => {
    useQueryMock.mockReturnValue(
      runDetail([
        {
          _id: "step_1",
          title: "Lint",
          type: "bash",
          status: "waiting",
          threadId: THREAD_ID,
          script: { script: "pnpm lint && pnpm test", timeoutMs: 90_000 },
        },
      ])
    );

    render(<WorkflowWaitCard runId={RUN_ID} threadId={THREAD_ID} threadStatus="completed" />);

    expect(screen.getByText("pnpm lint && pnpm test")).toBeDefined();
    expect(screen.getByText("Timeout 1m 30s")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  test("shown when a stopped turn left the thread failed", () => {
    useQueryMock.mockReturnValue(
      runDetail([{ _id: "step_1", title: "Wait for human", status: "waiting", threadId: THREAD_ID }])
    );

    render(<WorkflowWaitCard runId={RUN_ID} threadId={THREAD_ID} threadStatus="failed" />);

    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  test("hidden while the thread is running a steer turn", () => {
    useQueryMock.mockReturnValue(runDetail([{ _id: "step_1", title: "Sign off", status: "waiting", threadId: THREAD_ID }]));

    const { container } = render(<WorkflowWaitCard runId={RUN_ID} threadId={THREAD_ID} threadStatus="pending" />);

    // The wait re-parks the thread when the turn completes — the subscription
    // stays live so the card is back the moment it settles.
    expect(container.firstChild).toBeNull();
    expect(useQueryMock).toHaveBeenLastCalledWith(expect.anything(), { runId: RUN_ID });
  });

  test("hidden when the waiting step belongs to another lane's thread", () => {
    useQueryMock.mockReturnValue(
      runDetail([{ _id: "step_1", title: "Sign off", status: "waiting", threadId: "thread_other" }])
    );

    const { container } = render(<WorkflowWaitCard runId={RUN_ID} threadId={THREAD_ID} threadStatus="waiting_input" />);

    expect(container.firstChild).toBeNull();
  });
});
