import { isRecord } from "../../../sdk/adapters/adapter-interface.js";
import type { ClaudeUsageReport, ClaudeUsageWindow } from "./validators.js";
import { ClaudeUsageUnavailableError } from "./errors.js";

function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function percentage(value: unknown): number | undefined {
  const number = nonnegative(value);
  return number !== undefined && number <= 100 ? number : undefined;
}

function window(value: Record<string, unknown>, name: string, label: string): ClaudeUsageWindow {
  const usedPercent = percentage(value.utilization);
  const reset = typeof value.resets_at === "string" ? Date.parse(value.resets_at) : NaN;
  return {
    name, label,
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(Number.isFinite(reset) && reset >= 0 ? { resetsAt: reset / 1000 } : {}),
  };
}

const LABELS: Record<string, string> = {
  five_hour: "5-hour limit",
  seven_day: "Weekly limit",
  seven_day_oauth_apps: "Weekly OAuth apps limit",
  seven_day_opus: "Weekly Opus limit",
  seven_day_sonnet: "Weekly Sonnet limit",
  seven_day_overage_included: "Weekly included extra usage limit",
};

/** Preserve provider windows, including newly added named windows. */
export function parseClaudeUsage(value: unknown, account: string): ClaudeUsageReport {
  if (!isRecord(value) || value.rate_limits_available !== true || !isRecord(value.rate_limits)) {
    throw new ClaudeUsageUnavailableError("Claude did not report subscription quota. A supported Claude login with profile access is required.");
  }
  const buckets: ClaudeUsageReport["buckets"] = [];
  for (const [key, entry] of Object.entries(value.rate_limits)) {
    if (key === "extra_usage") continue;
    if (key === "model_scoped" && Array.isArray(entry)) {
      entry.forEach((model, index) => {
        if (!isRecord(model) || typeof model.display_name !== "string") return;
        const id = `model_scoped:${index}:${model.display_name}`;
        buckets.push({ id, windows: [window(model, id, `Weekly ${model.display_name} limit`)] });
      });
    } else if (isRecord(entry) && ("utilization" in entry || "resets_at" in entry)) {
      const label = typeof entry.display_name === "string" ? entry.display_name : LABELS[key] ?? key.replaceAll("_", " ");
      buckets.push({ id: key, windows: [window(entry, key, label)] });
    }
  }
  const extra = value.rate_limits.extra_usage;
  let extraUsage: ClaudeUsageReport["extraUsage"];
  if (isRecord(extra) && typeof extra.is_enabled === "boolean") {
    extraUsage = { enabled: extra.is_enabled };
    const usedPercent = percentage(extra.utilization);
    const monthlyLimit = nonnegative(extra.monthly_limit);
    const usedCredits = nonnegative(extra.used_credits);
    if (usedPercent !== undefined) extraUsage.usedPercent = usedPercent;
    if (monthlyLimit !== undefined) extraUsage.monthlyLimit = monthlyLimit;
    if (usedCredits !== undefined) extraUsage.usedCredits = usedCredits;
    if (typeof extra.currency === "string") extraUsage.currency = extra.currency;
  }
  if (buckets.length === 0 && !extraUsage) throw new ClaudeUsageUnavailableError("Claude did not report any quota windows.");
  return {
    provider: "claude-code", source: "reported", account, refreshedAt: Date.now(), buckets,
    detail: "Claude may return cached quota data.",
    ...(extraUsage ? { extraUsage } : {}),
  };
}

export function readClaudeAccount(value: unknown): { identity: string; label: string } {
  if (!isRecord(value) || typeof value.email !== "string" || !value.email.trim() ||
    (value.apiProvider !== undefined && value.apiProvider !== "firstParty") ||
    !value.subscriptionType) {
    throw new ClaudeUsageUnavailableError("Subscription quota requires a Claude account login on this runner.");
  }
  return {
    label: value.email,
    identity: JSON.stringify([value.email, value.organization, value.subscriptionType, value.tokenSource, value.apiKeySource]),
  };
}
