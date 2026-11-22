import { describe, expect, test } from "vitest";
import {
  sumCostTotals,
  describeCost,
  canCompareCosts,
  assignModelColors,
  formatModelLabel,
  formatUsd,
  modelTokenShares,
} from "./cost-summary";

describe("formatModelLabel", () => {
  test("drops the cross-region inference prefix", () => {
    expect(formatModelLabel("us.anthropic.claude-opus-4-8")).toBe(
      "anthropic.claude-opus-4-8"
    );
    expect(
      formatModelLabel("eu.anthropic.claude-haiku-4-5-20251001-v1:0")
    ).toBe("anthropic.claude-haiku-4-5-20251001-v1:0");
  });

  test("leaves unprefixed model ids unchanged", () => {
    expect(formatModelLabel("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(formatModelLabel("gpt-5")).toBe("gpt-5");
  });
});

describe("formatUsd", () => {
  test("keeps sub-cent changes visible in totals below one dollar", () => {
    expect(formatUsd(0.0351)).toBe("$0.0351");
    expect(formatUsd(0.038929935)).toBe("$0.0389");
    expect(formatUsd(0.04)).toBe("$0.04");
    expect(formatUsd(0.2)).toBe("$0.20");
  });

  test("two decimals for dollars and zero, four for smaller spend", () => {
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
  });
});

describe("modelTokenShares", () => {
  test("computes % of total tokens, largest first", () => {
    const shares = modelTokenShares([
      {
        model: "small",
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 15,
        costUsd: 0.01,
      },
      {
        model: "big",
        inputTokens: 50,
        cachedInputTokens: 20,
        outputTokens: 5,
        costUsd: 0.1,
      },
    ]);
    expect(shares.map((share) => share.model)).toEqual(["big", "small"]);
    expect(shares[0]?.shareOfTokens).toBe(75);
    expect(shares[1]?.shareOfTokens).toBe(25);
  });

  test("zero tokens yields zero shares", () => {
    expect(
      modelTokenShares([
        {
          model: "m",
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        },
      ])[0]?.shareOfTokens
    ).toBe(0);
  });
});

describe("assignModelColors", () => {
  test("assigns slots alphabetically regardless of input order", () => {
    const colors = assignModelColors(["zeta", "alpha", "zeta"]);
    expect(colors.get("alpha")).toBe("var(--chart-1)");
    expect(colors.get("zeta")).toBe("var(--chart-2)");
  });

  test("caps at slot 5", () => {
    const colors = assignModelColors(["a", "b", "c", "d", "e", "f"]);
    expect(colors.get("f")).toBe("var(--chart-5)");
  });
});

test("month totals preserve mixed source, unpriced, and legacy evidence", () => {
  const base = {
    hasReported: false,
    hasEstimated: false,
    hasUnpriced: false,
    hasLegacy: false,
    modelAllocationIncomplete: false,
  };
  const rows = [
    { costUsd: 10, costMetadata: { ...base, hasReported: true } },
    {
      costUsd: 2,
      costMetadata: { ...base, hasEstimated: true, pricingSnapshot: "v1" },
    },
    { costUsd: 0, costMetadata: { ...base, hasUnpriced: true } },
    { costUsd: 3 },
  ];
  const result = sumCostTotals(rows);
  expect(result).toEqual(sumCostTotals([...rows].reverse()));
  expect(result).toMatchObject({
    costUsd: 15,
    costMetadata: {
      hasReported: true,
      hasEstimated: true,
      hasUnpriced: true,
      hasLegacy: true,
      pricingSnapshot: "v1",
    },
  });
  expect(sumCostTotals([])).toMatchObject({ costUsd: 0, costMetadata: base });
});

const emptyMetadata = {
  hasReported: false,
  hasEstimated: false,
  hasUnpriced: false,
  hasLegacy: false,
  modelAllocationIncomplete: false,
};

test.each([
  [{ hasReported: true }, 0, "$0.00", "Reported by the runtime"],
  [{ hasReported: true }, 10, "$10.00", "not verified"],
  [{ hasEstimated: true }, 2, "$2.00", "API-equivalent"],
  [
    { hasReported: true, hasEstimated: true },
    12,
    "$12.00",
    "invoices",
  ],
  [{ hasUnpriced: true }, 0, "Not priced", "Some usage is not priced"],
  [
    { hasReported: true, hasUnpriced: true },
    10,
    "$10.00",
    "only known costs",
  ],
  [
    { hasReported: true, hasUnpriced: true },
    0,
    "$0.00",
    "Some usage is not priced",
  ],
  [{ hasLegacy: true }, 0, "$0.00", "coverage are unknown"],
  [
    { hasLegacy: true, hasEstimated: true },
    4,
    "$4.00",
    "API-equivalent",
  ],
  [{ hasDataGap: true }, 0, "Not priced", "Historical usage was excluded"],
  [{ hasReported: true, hasDataGap: true }, 10, "$10.00", "data gap"],
])(
  "describes independent source and coverage flags %j",
  (flags, costUsd, label, explanation) => {
    const result = describeCost({
      costUsd,
      costMetadata: { ...emptyMetadata, ...flags },
    });
    expect(result.label).toBe(label);
    expect(result.description).toContain(explanation);
  }
);

test("legacy absence never establishes reported cost, including positive amounts", () => {
  expect(describeCost({ costUsd: 3 }).label).toBe("$3.00");
  expect(describeCost({ costUsd: 0 }).label).toBe("$0.00");
});

test("complete aggregate cost remains comparable even with incomplete model allocation", () => {
  expect(
    canCompareCosts(
      { ...emptyMetadata, hasReported: true, modelAllocationIncomplete: true },
      emptyMetadata
    )
  ).toBe(true);
  for (const flag of ["hasUnpriced", "hasLegacy", "hasDataGap"] as const) {
    const incomplete = { ...emptyMetadata, [flag]: true };
    expect(canCompareCosts(incomplete, emptyMetadata)).toBe(false);
    expect(canCompareCosts(emptyMetadata, incomplete)).toBe(false);
  }
  expect(canCompareCosts(undefined, emptyMetadata)).toBe(false);
});

test("month merges preserve history gaps alongside known numeric totals", () => {
  const total = sumCostTotals([
    { costUsd: 0, costMetadata: { ...emptyMetadata, hasDataGap: true } },
    { costUsd: 5, costMetadata: { ...emptyMetadata, hasReported: true } },
  ]);
  expect(total.costUsd).toBe(5);
  expect(describeCost(total).label).toBe("$5.00");
  expect(describeCost(total).description).toContain(
    "Historical usage was excluded"
  );
});


// Labels show the amount only; source and coverage live in the description.
test.each([false, true])("labels carry no source or coverage qualifiers, reported=%s", (hasReported) => {
  const cost = { costUsd: 0, costMetadata: { ...emptyMetadata, hasEstimated: true, hasReported, hasUnpriced: true, hasLegacy: true } };
  expect(describeCost(cost).label).toBe("$0.00");
  expect(describeCost(cost).description).toContain("Some usage is not priced");
});
