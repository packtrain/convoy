import { afterEach, describe, expect, it, vi } from "vitest";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { readClaudeUsage } from "./index.js";
import { parseClaudeUsage } from "./parsers.js";

const response = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 20, resets_at: null } } };
const account = { email: "user@example.com", subscriptionType: "max", apiProvider: "firstParty" };
function query(overrides: Record<string, unknown> = {}): Query {
  return {
    accountInfo: vi.fn().mockResolvedValue(account),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: vi.fn().mockResolvedValue(response),
    ...overrides,
  } as unknown as Query;
}

afterEach(() => vi.useRealTimers());

describe("Claude account usage", () => {
  it("keeps all named, model-scoped and future windows separately", () => {
    const keys = ["five_hour", "seven_day", "seven_day_oauth_apps", "seven_day_opus", "seven_day_sonnet", "future_window"];
    const report = parseClaudeUsage({ rate_limits_available: true, rate_limits: {
      ...Object.fromEntries(keys.map(key => [key, { utilization: 0, resets_at: "2026-10-09T12:00:00Z" }])),
      model_scoped: [{ display_name: "New model", utilization: 37, resets_at: null }],
      extra_usage: { is_enabled: false, monthly_limit: 5000, used_credits: 1000, utilization: 20, currency: "USD" },
    } }, "account");
    expect(report.buckets.map(bucket => bucket.id)).toEqual([...keys, "model_scoped:0:New model"]);
    expect(report.buckets[0].windows[0]).toMatchObject({ usedPercent: 0, resetsAt: 1791547200 });
    expect(report.buckets.at(-1)?.windows[0]).toMatchObject({ label: "Weekly New model limit", usedPercent: 37 });
    expect(report.extraUsage).toEqual({ enabled: false, monthlyLimit: 5000, usedCredits: 1000, usedPercent: 20, currency: "USD" });
  });

  it("retains unknown fields as unavailable, without converting them to zero", () => {
    const report = parseClaudeUsage({ rate_limits_available: true, rate_limits: {
      five_hour: { utilization: null, resets_at: null },
      seven_day: { utilization: NaN, resets_at: "bad" },
      seven_day_opus: { utilization: -1, resets_at: null },
      seven_day_sonnet: null,
    } }, "account");
    expect(report.buckets).toHaveLength(3);
    for (const bucket of report.buckets) {
      expect(bucket.windows[0].usedPercent).toBeUndefined();
      expect(bucket.windows[0].resetsAt).toBeUndefined();
    }
  });

  it("refuses API-key and third-party accounts before requesting quota", async () => {
    for (const info of [{ apiKeySource: "env" }, { ...account, apiProvider: "bedrock" }]) {
      const run = query({ accountInfo: async () => info });
      expect((await readClaudeUsage(run, new AbortController().signal)).source).toBe("unavailable");
      expect(run.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET).not.toHaveBeenCalled();
    }
  });

  it("discards results when the account changes", async () => {
    const run = query({ accountInfo: vi.fn().mockResolvedValueOnce(account).mockResolvedValueOnce({ ...account, email: "other@example.com" }) });
    expect(await readClaudeUsage(run, new AbortController().signal)).toMatchObject({
      source: "unavailable", buckets: [], detail: expect.stringContaining("account changed"),
    });
  });

  it("bounds a silent control request and clears its timer", async () => {
    vi.useFakeTimers();
    const pending = readClaudeUsage(query({ accountInfo: () => new Promise(() => {}) }), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toMatchObject({ source: "unavailable", detail: expect.stringContaining("timed out") });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending lookup", async () => {
    const controller = new AbortController();
    const pending = readClaudeUsage(query({ accountInfo: () => new Promise(() => {}) }), controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ source: "unavailable", detail: "Usage lookup cancelled." });
  });

  it.each(["Authorization: bearer secret", "Claude did not report quota: bearer secret"])("does not leak SDK error payloads: %s", async message => {
    const run = query({ accountInfo: async () => { throw new Error(message); } });
    expect(JSON.stringify(await readClaudeUsage(run, new AbortController().signal))).not.toContain("secret");
  });
});
