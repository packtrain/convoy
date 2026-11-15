"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CliAccountUsage } from "@/convex/lib/contracts/validators";
import { formatUsageLimitReset } from "@/lib/cli-stream-ui/usage-limit";

function windowLabel(minutes: number | undefined, name: string): string {
  if (minutes === undefined) return `${name === "primary" ? "Primary" : "Secondary"} limit`;
  if (minutes === 10080) return "Weekly limit";
  if (minutes === 1440) return "Daily limit";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day limit`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

function creditAmount(value: number | undefined, currency: string | undefined): string {
  if (value === undefined || !currency) return "unavailable";
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(value / 10 ** digits);
  } catch {
    return "unavailable";
  }
}

export function AccountUsage({ usage }: { usage: CliAccountUsage }) {
  const [now, setNow] = useState(usage.refreshedAt);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section aria-label={usage.provider === "claude-code" ? "Claude account usage" : "Codex account usage"} className="my-2 w-full space-y-4 rounded-xl border bg-muted/30 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Account usage</p>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Account information" className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Info className="size-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)]">
            <p className="break-all">{usage.account}</p>
          </PopoverContent>
        </Popover>
      </div>
      {usage.source === "last-reported" && <p className="text-xs text-muted-foreground">Historical thread data; account unverified. These values may belong to a previous login.</p>}
      {usage.source === "unavailable" && <p className="text-sm text-muted-foreground">Account quota unavailable</p>}
      {usage.detail && <p className="text-xs text-muted-foreground">{usage.detail}</p>}
      {usage.buckets.map(bucket => (
        <div key={bucket.id} className="space-y-4">
          {usage.buckets.length > 1 && usage.provider !== "claude-code" && <p className="text-xs font-medium text-muted-foreground">{bucket.name ?? bucket.id}</p>}
          {bucket.windows.length === 0 && <p className="text-sm text-muted-foreground">Quota windows unavailable</p>}
          {bucket.windows.map(window => {
            const label = window.label ?? windowLabel(window.durationMinutes, window.name);
            const remaining = window.usedPercent === undefined ? undefined : Number((100 - window.usedPercent).toFixed(2));
            const resetDate = window.resetsAt === undefined ? undefined : new Date(window.resetsAt * 1000);
            const expired = window.resetsAt !== undefined && window.resetsAt * 1000 <= now;
            return (
              <div key={window.name} className="border-t pt-3">
                <p className="text-sm font-medium">{label}</p>
                {usage.source === "last-reported" && <p className="mt-1 text-xs text-muted-foreground">{window.reportedAt === undefined ? "Last reported time unavailable" : `Last reported ${new Date(window.reportedAt).toLocaleString()}`}</p>}
                {window.isUsingOverage && <p className="mt-1 text-xs text-muted-foreground">Using extra usage</p>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                  <span className="text-muted-foreground" title={resetDate?.toLocaleString()}>
                    {window.resetsAt === undefined ? "Reset time unavailable" : expired ? "Reset passed · Run /usage to refresh" : `Resets ${formatUsageLimitReset(window.resetsAt, now)}`}
                  </span>
                  <span className="font-medium tabular-nums">{remaining === undefined ? "Usage unavailable" : `${remaining}% left`}</span>
                </div>
                {remaining !== undefined && (
                  <div role="progressbar" aria-label={`${bucket.name ?? bucket.id} · ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining} aria-valuetext={`${remaining}% remaining`} title={`${window.usedPercent}% used`} className="mt-2.5 h-2 overflow-hidden rounded-full bg-foreground/10">
                    <div className="h-full rounded-full bg-foreground/80" style={{ width: `${remaining}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {usage.extraUsage && <div className="border-t pt-3 text-sm">
        <p className="font-medium">Extra usage {usage.extraUsage.enabled ? "enabled" : "disabled"}</p>
        <p className="mt-1 text-muted-foreground">{usage.extraUsage.usedPercent === undefined ? "Usage unavailable" : `${usage.extraUsage.usedPercent}% used`}</p>
        {(usage.extraUsage.monthlyLimit !== undefined || usage.extraUsage.usedCredits !== undefined) && <p className="mt-1 text-xs text-muted-foreground">
          Spent: {creditAmount(usage.extraUsage.usedCredits, usage.extraUsage.currency)} · Monthly limit: {creditAmount(usage.extraUsage.monthlyLimit, usage.extraUsage.currency)}
        </p>}
      </div>}
    </section>
  );
}
