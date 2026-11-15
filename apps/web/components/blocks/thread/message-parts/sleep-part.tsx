"use client";

import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import type { SleepPart as SleepPartModel } from "@/lib/cli-stream-ui";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";

function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m${rest ? ` ${rest}s` : ""}` : `${rest}s`;
}

export function SleepRow({
  state,
  requested,
  elapsed,
  remaining,
}: {
  state: SleepPartModel["state"] | "overdue";
  requested?: number;
  elapsed?: number;
  remaining?: number;
}) {
  const label = state === "completed"
    ? elapsed === undefined ? "Sleep completed" : `Slept for ${duration(elapsed)}`
    : state === "interrupted" ? "Sleep interrupted"
    : state === "ended" ? "Sleep ended"
    : state === "overdue" ? "Waiting to resume" : "Sleeping";

  return (
    <CollapsibleToolPart
      icon={Moon}
      title={label}
      trailing={
        <>
          {requested !== undefined && (
            <span className="shrink-0 text-muted-foreground/80">· {duration(requested)} requested</span>
          )}
          {state === "sleeping" && remaining !== undefined && (
            <span className="ml-auto min-w-20 shrink-0 text-right font-mono tabular-nums">
              ~{duration(remaining)} left
            </span>
          )}
        </>
      }
    >
      <dl className="mb-2 ml-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-l border-border py-2 pl-3 text-xs leading-5 text-muted-foreground">
        <dt>Requested</dt><dd>{requested === undefined ? "Not provided" : duration(requested)}</dd>
        <dt>Elapsed</dt><dd>{elapsed === undefined ? "Not recorded" : duration(elapsed)}</dd>
        <dt>Status</dt><dd>{state === "completed" ? "Completed" : state === "interrupted" ? "Run interrupted" : state === "ended" ? "Completion not recorded" : "Awaiting completion"}</dd>
      </dl>
    </CollapsibleToolPart>
  );
}

export function SleepPart({ part }: { part: SleepPartModel }) {
  const [now, setNow] = useState(() => Date.now());
  const pending = part.state === "sleeping";
  const startedAt = part.startedAt;

  useEffect(() => {
    if (!pending || startedAt === undefined) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [pending, startedAt]);

  const end = pending ? now : part.completedAt;
  const elapsed = startedAt !== undefined && end !== undefined && end >= startedAt
    ? Math.floor((end - startedAt) / 1_000) : undefined;
  const remaining = pending && startedAt !== undefined && part.durationMs !== undefined
    ? Math.max(0, Math.ceil((part.durationMs - Math.max(0, now - startedAt)) / 1_000))
    : undefined;

  return (
    <SleepRow
      state={pending && remaining === 0 ? "overdue" : part.state}
      requested={part.durationMs === undefined ? undefined : Math.ceil(part.durationMs / 1_000)}
      elapsed={elapsed}
      remaining={remaining}
    />
  );
}
