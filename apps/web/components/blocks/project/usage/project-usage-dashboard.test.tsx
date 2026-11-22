/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { ProjectUsageDashboard } from "./project-usage-dashboard";
import { PROJECT_USAGE_INFO_SLOT_ID } from "@/components/blocks/project/settings/project-settings-config";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({ useQuery: useQueryMock }));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation")>();

  return {
    ...actual,
    AppLink: ({
      children,
      href: linkTarget,
      ...props
    }: {
      children: ReactNode;
      href: ReturnType<typeof actual.routeTarget>;
    } & Omit<ComponentProps<"a">, "href">) => (
      <a href={actual.href(linkTarget)} {...props}>
        {children}
      </a>
    ),
  };
});

const PROJECT_ID = "project1" as Id<"projects">;

afterEach(() => {
  cleanup();
  useQueryMock.mockReset();
});

describe("ProjectUsageDashboard", () => {
  test("links task references while leaving unattached usage as plain text", () => {
    useQueryMock.mockReturnValue({
      totalCostUsd: 3,
      prevTotalCostUsd: 0,
      totalRuns: 2,
      byDay: [],
      byModel: [
        {
          model: "claude-sonnet-4-5",
          inputTokens: 100,
          cachedInputTokens: 50,
          outputTokens: 25,
          costUsd: 3,
        },
      ],
      byMember: [],
      byCli: [],
      topTasks: [
        {
          taskId: "task1",
          ref: "OS-1511",
          name: "Make the task ref a link",
          tokens: 100,
          runCount: 1,
          costUsd: 2,
        },
        {
          taskId: null,
          ref: null,
          name: null,
          tokens: 50,
          runCount: 1,
          costUsd: 1,
        },
      ],
    });

    render(
      <ProjectUsageDashboard
        projectId={PROJECT_ID}
        organizationSlug="acme"
        projectAlias="OS"
      />
    );

    expect(
      screen.getByRole("link", { name: "OS-1511" }).getAttribute("href")
    ).toBe("/o/acme/OS?task=OS-1511");
    expect(
      screen.getByText("No task (unattached threads)").closest("a")
    ).toBeNull();
  });

  test.each([0, 10])(
    "shows aggregate-only reported spend %s instead of the empty state",
    (costUsd) => {
      useQueryMock.mockReturnValue({
        totalCostUsd: costUsd,
        costMetadata: reported,
        prevCostMetadata: emptyMetadata,
        prevTotalCostUsd: 0,
        totalRuns: 1,
        byModel: [],
        byDay: [{ dayStartMs: Date.now(), costUsd, byModel: [] }],
        byMember: [],
        byCli: [],
        topTasks: [],
      });
      render(
        <ProjectUsageDashboard
          projectId={PROJECT_ID}
          organizationSlug="acme"
          projectAlias="OS"
        />
      );
      expect(screen.queryByText("No usage recorded yet")).toBeNull();
      expect(screen.getByText("Agent runs")).toBeTruthy();
      expect(
        screen.getAllByText(`$${costUsd.toFixed(2)}`).length
      ).toBeGreaterThan(0);
    }
  );
});

test.each([false, true])(
  "counts free and unpriced days when averaging spend, mixed=%s",
  (mixed) => {
    const byDay = [
      {
        dayStartMs: Date.now(),
        costUsd: 0,
        byModel: [],
        costMetadata: { hasReported: true },
      },
      {
        dayStartMs: Date.now() - 86_400_000,
        costUsd: 0,
        byModel: [],
        costMetadata: { hasUnpriced: true },
      },
      ...(mixed
        ? [{ dayStartMs: Date.now() - 172_800_000, costUsd: 12, byModel: [] }]
        : []),
    ];
    useQueryMock.mockReturnValue({
      totalCostUsd: mixed ? 12 : 0,
      costMetadata: { ...reported, hasUnpriced: true },
      prevCostMetadata: emptyMetadata,
      prevTotalCostUsd: 0,
      totalRuns: byDay.length,
      byDay,
      byModel: [],
      byMember: [],
      byCli: [],
      topTasks: [],
    });
    render(
      <ProjectUsageDashboard
        projectId={PROJECT_ID}
        organizationSlug="acme"
        projectAlias="OS"
      />
    );
    expect(screen.getByText(`${byDay.length} active days`)).toBeTruthy();
    if (mixed)
      expect(
        screen.getByLabelText("$4.00. ", { exact: false })
      ).toBeTruthy();
  }
);

const emptyMetadata = {
  hasReported: false,
  hasEstimated: false,
  hasUnpriced: false,
  hasLegacy: false,
  modelAllocationIncomplete: false,
};
const reported = { ...emptyMetadata, hasReported: true };
const unpriced = { ...emptyMetadata, hasUnpriced: true };
const dayStartMs = Math.floor(Date.now() / 86_400_000) * 86_400_000;

function dashboardFixture(costMetadata = reported, costUsd = 10) {
  const total = { costUsd, costMetadata };
  return {
    totalCostUsd: costUsd,
    costMetadata,
    prevTotalCostUsd: 5,
    prevCostMetadata: reported,
    totalRuns: 1,
    byDay: [
      { dayStartMs, ...total, byModel: [{ model: "gpt-6-astra", ...total }] },
    ],
    byModel: [
      {
        model: "gpt-6-astra",
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 10,
        ...total,
      },
    ],
    byMember: [{ userId: "user1", name: "Alice", ...total }],
    byCli: [{ cliType: "codex", ...total }],
    topTasks: [
      {
        taskId: "task1",
        ref: "OS-1531",
        name: "Cost disclosure",
        tokens: 130,
        runCount: 1,
        ...total,
      },
    ],
  };
}
function renderDashboard(data = dashboardFixture()) {
  useQueryMock.mockReturnValue(data);
  return render(
    <ProjectUsageDashboard
      projectId={PROJECT_ID}
      organizationSlug="acme"
      projectAlias="OS"
    />
  );
}

test("cache card shows the cached share and the uncached remainder", () => {
  renderDashboard();
  expect(screen.getByText("16.6%")).toBeTruthy();
  expect(
    screen.getByText(
      "of 120 input tokens came from prompt cache; 100 were uncached."
    )
  ).toBeTruthy();
});

test.each([
  [unpriced, 0, "Not priced"],
  [{ ...reported, hasEstimated: true }, 10, "$10.00"],
  [{ ...reported, hasUnpriced: true }, 10, "Some usage is not priced"],
  [
    { ...emptyMetadata, hasLegacy: true },
    10,
    "Historical cost source and pricing coverage are unknown",
  ],
])(
  "uses source and coverage labels throughout the dashboard",
  (metadata, costUsd, label) => {
    renderDashboard(dashboardFixture(metadata, costUsd));
    for (const heading of [
      "Total spend · 90d",
      "This month",
      "Avg per active day",
      "Tokens by model",
      "Spend by member",
      "Spend by CLI",
      "Most expensive tasks",
    ]) {
      expect(
        within(screen.getByText(heading).parentElement!).getAllByLabelText(
          label,
          { exact: false }
        ).length
      ).toBeGreaterThan(0);
    }
  }
);

test.each(["current", "previous"])(
  "suppresses comparisons when %s coverage is incomplete",
  (period) => {
    const data = dashboardFixture();
    if (period === "current")
      data.costMetadata = { ...reported, hasUnpriced: true };
    else data.prevCostMetadata = { ...reported, hasLegacy: true };
    renderDashboard(data);
    expect(
      within(screen.getByText("Total spend · 90d").parentElement!).queryByText(
        /100%/
      )
    ).toBeNull();
    expect(screen.queryByText(/Comparison unavailable/)).toBeNull();
  }
);

test("collapses tokens by model past four rows behind Show more", () => {
  const data = dashboardFixture();
  data.byModel = Array.from({ length: 6 }, (_, i) => ({
    ...data.byModel[0],
    model: `model-${i}`,
    inputTokens: 100 - i,
  }));
  renderDashboard(data);
  const card = screen.getByText("Tokens by model").parentElement!;
  expect(within(card).queryByText("model-4")).toBeNull();
  fireEvent.click(within(card).getByRole("button", { name: "Show 2 more" }));
  expect(within(card).getByText("model-5")).toBeTruthy();
  fireEvent.click(within(card).getByRole("button", { name: "Show less" }));
  expect(within(card).queryByText("model-4")).toBeNull();
});

test("omits the source unknown label from visible dashboard text", () => {
  const data = dashboardFixture({ ...emptyMetadata, hasLegacy: true }, 10);
  const { container } = renderDashboard(data);
  fireEvent.focus(
    container.querySelector('svg [role="graphics-symbol"]:last-child')!
  );
  expect(container.textContent).not.toContain("source unknown");
});

test("cost details open from the (i) beside the page description, not an accordion", () => {
  const slot = document.createElement("span");
  slot.id = PROJECT_USAGE_INFO_SLOT_ID;
  document.body.append(slot);
  renderDashboard(dashboardFixture({ ...reported, hasUnpriced: true }, 10));
  expect(screen.queryByText("Cost details")).toBeNull();
  fireEvent.click(within(slot).getByRole("button", { name: "Cost details" }));
  expect(screen.getByRole("dialog").textContent).toContain("Some usage is not priced");
  slot.remove();
});

test("daily chart tooltip leaves explanations to Cost details", () => {
  const data = dashboardFixture({ ...reported, hasEstimated: true }, 10);
  const { container } = renderDashboard(data);
  const lastDay = container.querySelector(
    'svg [role="graphics-symbol"]:last-child'
  )!;
  fireEvent.focus(lastDay);
  const tooltip = screen.getByText("Total").parentElement!.parentElement!;
  expect(tooltip.textContent).not.toContain("Estimates use standard");
  expect(lastDay.getAttribute("aria-label")).toContain(
    "Estimates use standard"
  );
});

test("shows authoritative daily total when it cannot be allocated to models", () => {
  const data = dashboardFixture(
    { ...reported, modelAllocationIncomplete: true },
    12
  );
  data.byModel = [];
  data.byDay[0].byModel = [];
  const { container } = renderDashboard(data);
  fireEvent.mouseMove(
    container.querySelector('svg[role="img"] g:last-child')!,
    { clientX: 100, clientY: 100 }
  );
  expect(screen.getAllByText("Daily total").length).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/Model breakdown is incomplete/).length
  ).toBeGreaterThan(0);
});

test("no usage is the shared unframed empty state, centered", () => {
  renderDashboard({
    ...dashboardFixture(),
    totalCostUsd: 0,
    totalRuns: 0,
    costMetadata: emptyMetadata,
    byDay: [],
    byModel: [],
    byMember: [],
    byCli: [],
    topTasks: [],
  });

  const empty = expectEmptyState("No usage recorded yet");
  expectVerticallyCentered(empty, empty);
});

test("discloses history gaps even without surviving usage", () => {
  const data = {
    ...dashboardFixture(),
    totalCostUsd: 0,
    totalRuns: 0,
    costMetadata: { ...emptyMetadata, hasDataGap: true },
    byDay: [],
    byModel: [],
    byMember: [],
    byCli: [],
    topTasks: [],
  };
  renderDashboard(data);
  expect(
    screen.getAllByText(/Historical usage was excluded/).length
  ).toBeGreaterThan(0);
  expect(screen.queryByText("No usage recorded yet")).toBeNull();
});

test("daily chart exposes unpriced days by keyboard and retains the known subtotal", () => {
  const data = dashboardFixture({ ...reported, hasUnpriced: true }, 10);
  const { container } = renderDashboard(data);
  const lastDay = container.querySelector(
    'svg [role="graphics-symbol"]:last-child'
  )!;
  fireEvent.focus(lastDay);
  expect(lastDay.getAttribute("aria-label")).toContain("$10.00");
  expect(lastDay.getAttribute("aria-label")).toContain(
    "Some usage is not priced"
  );
  expect(screen.getByText("Total").parentElement!.textContent).toContain("$10.00");
  expect(screen.getByText("Total").parentElement!.textContent).not.toContain("known");
  fireEvent.keyDown(lastDay, { key: "Escape" });
  expect(screen.queryByText("Total")).toBeNull();
});

test("a known month stays reported when the previous month is unpriced", () => {
  const data = dashboardFixture({ ...reported, hasUnpriced: true });
  data.byDay[0].costMetadata = reported;
  data.byDay.push({
    ...data.byDay[0],
    dayStartMs: Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      0
    ),
    costMetadata: unpriced,
    costUsd: 0,
  });
  renderDashboard(data);
  expect(
    within(screen.getByText("This month").parentElement!).getByText("$10.00")
  ).toBeTruthy();
  expect(
    within(screen.getByText("Total spend · 90d").parentElement!).getByLabelText(
      "$10.00. ",
      { exact: false }
    )
  ).toBeTruthy();
  expect(screen.getByText("Total spend · 90d").parentElement!.textContent).not.toMatch(/known|estimated/);
});

test("comparison discloses estimates even when only the prior period is estimated", () => {
  const data = dashboardFixture();
  data.prevCostMetadata = { ...emptyMetadata, hasEstimated: true };
  renderDashboard(data);
  expect(screen.getByText(/Comparison includes estimates/)).toBeTruthy();
});
