/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountUsage } from "./account-usage";
import type { CliAccountUsage } from "@/convex/lib/contracts/validators";

afterEach(cleanup);

const usage: CliAccountUsage = {
  provider: "claude-code", source: "reported", account: "user@example.com", refreshedAt: 1791547200000,
  buckets: [{ id: "claude", windows: [
    { name: "five_hour", label: "5-hour limit", usedPercent: 25 },
    { name: "weekly_opus", label: "Weekly Opus limit" },
    { name: "new", label: "New provider window", usedPercent: 0 },
  ] }],
  extraUsage: { enabled: true, usedPercent: 10 },
};

test("shows every Claude window below the warning threshold and marks unknown values", () => {
  render(<AccountUsage usage={usage} />);
  expect(screen.getByRole("region", { name: "Claude account usage" })).toBeDefined();
  expect(screen.getByText("5-hour limit")).toBeDefined();
  expect(screen.getByText("Weekly Opus limit")).toBeDefined();
  expect(screen.getByText("New provider window")).toBeDefined();
  expect(screen.getByText("75% left")).toBeDefined();
  expect(screen.getByText("100% left")).toBeDefined();
  expect(screen.getByText("Usage unavailable")).toBeDefined();
  expect(screen.queryByText(/Reported at/)).toBeNull();
  expect(screen.getByText(/Extra usage enabled/)).toBeDefined();
  expect(screen.getAllByRole("button", { name: "Account information" })).toHaveLength(1);
});

test("historical snapshots show unknown observation time, account uncertainty and overage", () => {
  render(<AccountUsage usage={{ ...usage, source: "last-reported", extraUsage: undefined,
    account: "Historical thread data; account unverified",
    buckets: [{ id: "weekly", windows: [{ name: "weekly", label: "Weekly limit", isUsingOverage: true }] }],
  }} />);
  expect(screen.getByText(/Historical thread data; account unverified/)).toBeDefined();
  expect(screen.getByText(/Last reported time unavailable/)).toBeDefined();
  expect(screen.queryByText(/Reported at/)).toBeNull();
  expect(screen.getByText("Using extra usage")).toBeDefined();
});

test("unavailable data has a readable empty state", () => {
  render(<AccountUsage usage={{ ...usage, source: "unavailable", buckets: [], extraUsage: undefined }} />);
  expect(screen.getByText("Account quota unavailable")).toBeDefined();
  expect(screen.queryByRole("progressbar")).toBeNull();
});
