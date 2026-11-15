import { isRecord } from "../../../sdk/adapters/adapter-interface.js";
import type { QuotaBucket, QuotaWindow } from "./validators.js";

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseBucket(value: unknown, fallbackId: string): QuotaBucket | undefined {
  if (!isRecord(value)) return undefined;
  const windows: QuotaWindow[] = [];
  for (const name of ["primary", "secondary"] as const) {
    const window = value[name];
    if (!isRecord(window)) continue;
    const used = finite(window.usedPercent);
    const duration = finite(window.windowDurationMins);
    const resetsAt = finite(window.resetsAt);
    windows.push({
      name,
      ...(used !== undefined && used >= 0 && used <= 100 ? { usedPercent: used } : {}),
      ...(duration !== undefined && duration > 0 ? { durationMinutes: duration } : {}),
      ...(resetsAt !== undefined && resetsAt >= 0 && resetsAt <= 8_640_000_000_000 ? { resetsAt } : {}),
    });
  }
  return {
    id: typeof value.limitId === "string" && value.limitId ? value.limitId : fallbackId,
    ...(typeof value.limitName === "string" && value.limitName ? { name: value.limitName } : {}),
    windows,
  };
}

export function parseQuotaBuckets(value: unknown): QuotaBucket[] {
  if (!isRecord(value)) return [];
  const buckets = new Map<string, QuotaBucket>();
  const legacy = parseBucket(value.rateLimits, "codex");
  if (legacy) buckets.set(legacy.id, legacy);
  if (isRecord(value.rateLimitsByLimitId)) {
    for (const [id, raw] of Object.entries(value.rateLimitsByLimitId)) {
      const bucket = parseBucket(raw, id);
      if (bucket) buckets.set(bucket.id, bucket);
    }
  }
  return [...buckets.values()];
}

export function readQuotaAccount(value: unknown): { identity: string; label: string } {
  const account = isRecord(value) && isRecord(value.account) ? value.account : undefined;
  if (!account || account.type !== "chatgpt") {
    throw new Error("Account quota requires a ChatGPT login on this runner. API-key billing and other authentication modes do not expose subscription quota.");
  }
  if (typeof account.email !== "string" || !account.email.trim()) {
    throw new Error("Codex did not identify the runtime account. Usage is unavailable; update Codex and sign in again.");
  }
  return {
    identity: JSON.stringify([account.email, account.id ?? null, account.planType ?? null]),
    label: account.email,
  };
}
