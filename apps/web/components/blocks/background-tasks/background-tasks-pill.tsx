"use client";

import { useEffect, useState } from "react";
import { Activity, Bot, CircleDashed, Network, Terminal, Workflow } from "lucide-react";
import type { CliThreadBackgroundTasks, CliStopConfirmation } from "@/convex/lib/contracts/validators";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function taskPresentation(type: string) {
  switch (type) {
    case "local_bash": return { Icon: Terminal, label: "Shell command" };
    case "local_agent": return { Icon: Bot, label: "Agent" };
    case "remote_agent": return { Icon: Bot, label: "Remote agent" };
    case "in_process_teammate": return { Icon: Bot, label: "Teammate" };
    case "local_workflow": return { Icon: Workflow, label: "Workflow" };
    case "mcp_task": return { Icon: Network, label: "MCP task" };
    case "monitor_mcp":
    case "monitor_ws": return { Icon: Activity, label: "Monitor" };
    default: return { Icon: CircleDashed, label: "Background task" };
  }
}

function TaskPopover({ snapshot, stop }: { snapshot: CliThreadBackgroundTasks; stop?: CliStopConfirmation }) {
  const stopLabel = stop?.status === "stopping" ? "Stopping…"
    : stop?.status === "unconfirmed" ? "Couldn't confirm stopped" : "Runtime stopped";
  const label = stop ? stopLabel : `${snapshot.totalCount} ${snapshot.totalCount === 1 ? "job" : "jobs"} running`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="2xs" shape="pill" className="gap-1 text-muted-foreground" aria-label={label}>
          <span className={stop && stop.status !== "stopping" ? "inline-flex" : "inline-flex motion-safe:animate-spin"} aria-hidden="true">
            <CircleDashed className="size-3" />
          </span>
          {stop ? <span aria-live="polite">{stopLabel}</span> : <>
            <span className="tabular-nums">{snapshot.totalCount}</span>
            <span className="hidden @lg/composer-bar:inline">{snapshot.totalCount === 1 ? "job" : "jobs"}</span>
          </>}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-2rem)]" aria-label="Background tasks">
        <div className="text-xs font-medium">{stop ? "Stopped turn" : "Background tasks"}</div>
        {stop ? <div className="space-y-1 py-2 text-xs text-muted-foreground">
          <p>{stop.status === "stopping" ? "Waiting for the CLI to confirm runtime shutdown."
            : stop.status === "unconfirmed" ? "The CLI did not confirm shutdown within 15 seconds. It may be disconnected."
            : "The CLI confirmed runtime shutdown."}</p>
          <p>Detached processes and remote jobs may still be running.</p>
          <p>{snapshot.totalCount > 0 ? `${snapshot.totalCount} last-known ${snapshot.totalCount === 1 ? "job" : "jobs"}.`
            : "No job details were reported."}</p>
        </div> : null}
        <ul className="max-h-64 space-y-3 overflow-y-auto overscroll-contain py-1" aria-label={stop ? "Last-known background tasks" : "Running background tasks"} tabIndex={0}>
          {snapshot.tasks.map((task) => {
            const { Icon, label: typeLabel } = taskPresentation(task.type);
            return (
              <li key={task.id} className="flex items-start gap-2">
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 text-xs">
                  <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{task.description.trim() || typeLabel}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{typeLabel}</div>
                </div>
              </li>
            );
          })}
        </ul>
        {snapshot.totalCount > snapshot.tasks.length ? (
          <p className="text-[11px] text-muted-foreground">Showing the first {snapshot.tasks.length} tasks.</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function StopConfirmationPill({ stop }: { stop: CliStopConfirmation }) {
  const expiresAt = stop.status === "stopped" ? (stop.acknowledgedAt ?? stop.requestedAt) + 5_000 : undefined;
  const [expiredAt, setExpiredAt] = useState<number | undefined>(() =>
    expiresAt !== undefined && expiresAt <= Date.now() ? expiresAt : undefined
  );

  useEffect(() => {
    if (expiresAt === undefined) return;
    const timer = setTimeout(() => setExpiredAt(expiresAt), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  if (expiresAt !== undefined && expiredAt === expiresAt) return null;
  return <TaskPopover stop={stop} snapshot={stop.jobs ?? {
    messageId: stop.messageId, totalCount: 0, tasks: [],
  }} />;
}

export function BackgroundTasksPill({ snapshot, stopConfirmation }: {
  snapshot?: CliThreadBackgroundTasks;
  stopConfirmation?: CliStopConfirmation;
}) {
  if (snapshot && snapshot.totalCount > 0) {
    return <TaskPopover key={`${snapshot.messageId}:${snapshot.sessionId ?? ""}`} snapshot={snapshot} />;
  }
  if (!stopConfirmation) return null;
  return <StopConfirmationPill key={`${stopConfirmation.runId}:${stopConfirmation.requestedAt}`} stop={stopConfirmation} />;
}
