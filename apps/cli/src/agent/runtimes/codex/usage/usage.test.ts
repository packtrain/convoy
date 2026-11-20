import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexUsage } from "./index.js";
import { parseQuotaBuckets } from "./parsers.js";
import type { JsonRpc } from "../../json-rpc.js";

const account = { account: { type: "chatgpt", email: "one@example.com", planType: "plus" } };
const quota = { rateLimits: { limitId: "codex", primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1730947200 } } };
function rpc(handler?: (method: string) => unknown): JsonRpc {
  return {
    request: vi.fn(async (method: string) => handler ? handler(method) : method === "account/read" ? account : quota),
    notify: vi.fn(), close: vi.fn(),
  };
}
afterEach(() => vi.useRealTimers());

describe("Codex quota", () => {
  it("normalizes multiple buckets, prefers the bucket map and preserves missing fields", () => {
    expect(parseQuotaBuckets({
      ...quota,
      rateLimitsByLimitId: {
        codex: { limitId: "codex", limitName: "Codex", primary: { usedPercent: 0 }, secondary: { windowDurationMins: 17 } },
        review: { primary: { usedPercent: 42, windowDurationMins: 60 }, secondary: null },
        invalid: null,
      },
    })).toEqual([
      { id: "codex", name: "Codex", windows: [{ name: "primary", usedPercent: 0 }, { name: "secondary", durationMinutes: 17 }] },
      { id: "review", windows: [{ name: "primary", usedPercent: 42, durationMinutes: 60 }] },
    ]);
  });

  it("keeps invalid or absent values unknown instead of inventing zero usage", () => {
    const buckets = parseQuotaBuckets({ rateLimits: { primary: { usedPercent: NaN, windowDurationMins: -1, resetsAt: Infinity }, secondary: { usedPercent: 101 } } });
    expect(buckets[0]?.windows).toEqual([{ name: "primary" }, { name: "secondary" }]);
    expect(parseQuotaBuckets(null)).toEqual([]);
  });

  it("preserves reset seconds and refresh milliseconds in the structured snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_730_900_000_000);
    const report = await createCodexUsage().read(rpc());
    expect(report).toEqual({
      account: "one@example.com", refreshedAt: Date.now(), buckets: [{
        id: "codex", windows: [{ name: "primary", usedPercent: 25, durationMinutes: 15, resetsAt: 1730947200 }],
      }],
    });
  });

  it.each([null, { type: "apiKey" }, { type: "chatgpt" }])("rejects unsupported or unidentified accounts: %j", async value => {
    const client = rpc(() => ({ account: value }));
    await expect(createCodexUsage().read(client)).rejects.toThrow(/ChatGPT login|identify the runtime account/);
    expect(client.request).not.toHaveBeenCalledWith("account/rateLimits/read");
  });

  it("rejects unavailable quota and does not reuse a previous successful refresh", async () => {
    const usage = createCodexUsage();
    await usage.read(rpc());
    await expect(usage.read(rpc(method => method === "account/read" ? account : {}))).rejects.toThrow("Usage is unavailable");
  });

  it("rejects a different account returned after the quota lookup", async () => {
    let reads = 0;
    const client = rpc(method => method === "account/read"
      ? ++reads === 1 ? account : { account: { ...account.account, email: "two@example.com" } }
      : quota);
    await expect(createCodexUsage().read(client)).rejects.toThrow("account changed");
  });

  it("accepts repeated ChatGPT auth notifications during unchanged-account reads", async () => {
    const usage = createCodexUsage();
    const client = rpc(method => {
      if (method === "account/read") {
        usage.onNotification("account/updated", { authMode: "chatgpt", planType: "plus" });
        return account;
      }
      return quota;
    });
    await expect(usage.read(client)).resolves.toMatchObject({ buckets: [{ windows: [{ usedPercent: 25 }] }] });
  });

  it("invalidates results on an account-change notification even if identity reads match", async () => {
    const usage = createCodexUsage();
    const client = rpc(method => {
      if (method === "account/read") return account;
      usage.onNotification("account/updated", { authMode: null, planType: null });
      usage.onNotification("account/updated", { authMode: "chatgpt", planType: "plus" });
      return quota;
    });
    await expect(usage.read(client)).rejects.toThrow("account changed");
  });

  it("rejects a completed login during refresh even when auth mode and final identity match", async () => {
    const usage = createCodexUsage();
    const client = rpc(method => {
      if (method === "account/read") return account;
      usage.onNotification("account/login/completed", { success: true });
      usage.onNotification("account/updated", { authMode: "chatgpt", planType: "plus" });
      return quota;
    });
    await expect(usage.read(client)).rejects.toThrow("account changed");
  });

  it("merges current lookup notifications per bucket without reusing previous-run state", async () => {
    const usage = createCodexUsage();
    usage.onNotification("account/rateLimits/updated", { rateLimits: { limitId: "old", primary: { usedPercent: 99 } } });
    const client = rpc(method => {
      if (method === "account/read") return account;
      usage.onNotification("account/rateLimits/updated", { rateLimits: { limitId: "review", primary: { usedPercent: 42 } } });
      return quota;
    });
    const report = await usage.read(client);
    expect(report.buckets.map(bucket => bucket.id)).toEqual(["codex", "review"]);
    expect(report.buckets.map(bucket => bucket.windows[0]?.usedPercent)).toEqual([25, 42]);
    expect((await usage.read(rpc())).buckets.map(bucket => bucket.id)).toEqual(["codex"]);
  });

  it("bounds a stalled RPC and propagates failures", async () => {
    vi.useFakeTimers();
    const pending = createCodexUsage().read(rpc(() => new Promise(() => {})));
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    await expect(createCodexUsage().read(rpc(() => { throw new Error("network unavailable"); }))).rejects.toThrow("network unavailable");
  });


});
