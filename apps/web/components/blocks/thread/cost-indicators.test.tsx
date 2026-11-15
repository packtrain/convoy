/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { CostIndicator } from "./cost-indicators";

const useQueryMock = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useQuery: useQueryMock }));

const TASK_ID = "task1" as Id<"tasks">;
const THREAD_ID = "thread1" as Id<"cliThreads">;

function makeSummary(totalCostUsd: number) {
  return {
    totalCostUsd,
    costMetadata: {
      hasReported: true,
      hasEstimated: false,
      hasUnpriced: false,
      hasLegacy: false,
      modelAllocationIncomplete: false,
    },
    byModel: [
      {
        model: "claude-opus-4-6",
        inputTokens: 100,
        cachedInputTokens: 300,
        outputTokens: 100,
        costUsd: totalCostUsd,
      },
    ],
    byDay: [],
  };
}

/** Route each query to its own summary so task vs thread can differ. */
function mockSummaries(task: unknown, thread: unknown) {
  useQueryMock.mockImplementation((_fn, args) =>
    args === "skip" ? undefined : args && "taskId" in args ? task : thread
  );
}

afterEach(() => {
  cleanup();
  useQueryMock.mockReset();
});

describe("cost indicators", () => {
  test("renders a single value when task and thread match", () => {
    mockSummaries(makeSummary(1.234), makeSummary(1.234));
    render(<CostIndicator taskId={TASK_ID} threadId={THREAD_ID} />);
    expect(
      screen.getByRole("button", { name: "Agent cost $1.23" })
    ).toBeTruthy();
  });

  test("renders both values as task / thread when they differ", () => {
    mockSummaries(makeSummary(5), makeSummary(1));
    render(<CostIndicator taskId={TASK_ID} threadId={THREAD_ID} />);
    expect(
      screen.getByRole("button", { name: "Agent cost $5.00 / $1.00" })
    ).toBeTruthy();
  });

  test("renders a single value when only one summary is present", () => {
    mockSummaries(undefined, makeSummary(1.234));
    render(<CostIndicator threadId={THREAD_ID} />);
    expect(
      screen.getByRole("button", { name: "Agent cost $1.23" })
    ).toBeTruthy();
  });

  test("hides while loading and when nothing was recorded", () => {
    mockSummaries(undefined, undefined);
    const { container } = render(<CostIndicator threadId={THREAD_ID} />);
    expect(container.innerHTML).toBe("");

    mockSummaries(
      { ...makeSummary(0), byModel: [], costMetadata: {} },
      { ...makeSummary(0), byModel: [], costMetadata: {} }
    );
    const { container: zeroContainer } = render(
      <CostIndicator taskId={TASK_ID} threadId={THREAD_ID} />
    );
    expect(zeroContainer.innerHTML).toBe("");
  });
});

const metadata = {
  hasReported: false,
  hasEstimated: false,
  hasUnpriced: false,
  hasLegacy: false,
  modelAllocationIncomplete: false,
};

test.each([
  ["reported zero", 0, { hasReported: true }, "$0.00"],
  ["unpriced", 0, { hasUnpriced: true }, "Not priced"],
  ["estimate", 2, { hasEstimated: true }, "$2.00"],
  ["mixed", 10, { hasReported: true, hasUnpriced: true }, "$10.00 known"],
  ["legacy", 0, { hasLegacy: true }, "$0.00"],
] as const)("renders %s usage in the header", (_name, amount, flags, label) => {
  mockSummaries(undefined, {
    ...makeSummary(amount),
    costMetadata: { ...metadata, ...flags },
  });
  render(<CostIndicator threadId={THREAD_ID} />);
  expect(screen.getByRole("button").textContent).toBe(label);
});

test("retains task and thread coverage when numeric totals match", () => {
  mockSummaries(
    {
      ...makeSummary(10),
      costMetadata: { ...metadata, hasReported: true, hasUnpriced: true },
    },
    makeSummary(10)
  );
  render(<CostIndicator taskId={TASK_ID} threadId={THREAD_ID} />);
  expect(screen.getByRole("button").textContent).toBe("$10.00 known / $10.00");
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("Task cost")).toBeTruthy();
  expect(screen.getByText("Thread cost")).toBeTruthy();
  expect(screen.getByText(/Some usage is not priced/)).toBeTruthy();
});

test("keeps aggregate-only reported zero visible and explains incomplete allocation", () => {
  mockSummaries(undefined, {
    ...makeSummary(0),
    byModel: [],
    costMetadata: {
      ...metadata,
      hasReported: true,
      modelAllocationIncomplete: true,
    },
  });
  render(<CostIndicator threadId={THREAD_ID} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText(/Model breakdown is incomplete/)).toBeTruthy();
});

function mockEstimatedSummary() {
  const summary = makeSummary(2);
  const costMetadata = { ...metadata, hasEstimated: true, pricingSnapshot: "snapshot-v1" };
  mockSummaries(undefined, {
    ...summary,
    costMetadata,
    byModel: summary.byModel.map((entry) => ({ ...entry, costMetadata })),
  });
}

test.each([false, true])("legacy costs omit source unknown throughout the popup, estimated=%s", (hasEstimated) => {
  const summary = makeSummary(0.8398);
  const costMetadata = { ...metadata, hasLegacy: true, hasEstimated };
  const legacySummary = {
    ...summary,
    costMetadata,
    byModel: summary.byModel.map((entry) => ({ ...entry, costMetadata })),
  };
  mockSummaries(legacySummary, legacySummary);
  render(<CostIndicator taskId={TASK_ID} threadId={THREAD_ID} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryAllByText(/source unknown/)).toHaveLength(0);
  expect(screen.getAllByText("$0.8398 total")).toHaveLength(2);
  expect(screen.getAllByText("500 tokens · 100% · $0.8398")).toHaveLength(2);
});

test("model rows omit the repeated estimate qualifier", () => {
  mockEstimatedSummary();
  render(<CostIndicator threadId={THREAD_ID} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText(/500 tokens/).textContent).toBe("500 tokens · 100% · $2.00");
});

test("popover keeps estimate wording in the top total without the pricing paragraph", () => {
  mockEstimatedSummary();
  render(<CostIndicator threadId={THREAD_ID} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("$2.00 estimated total")).toBeTruthy();
  expect(screen.queryByText(/Estimates use standard short-context/)).toBeNull();
  expect(screen.queryByText(/Pricing snapshot/)).toBeNull();
});
