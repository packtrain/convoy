"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Check, Hand } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The wait step's amber identity, shared by the editor card, the run row and this card. */
export const WAIT_SURFACE_CLASS = "bg-warning-soft";
export const WAIT_ICON_CLASS = "text-warning";
export const WAIT_TITLE_CLASS = "text-warning-foreground";
/** Exec accent: blue = "runs on your machine", matching the action catalog. */
export const BASH_SURFACE_CLASS = "bg-info-soft";
export const BASH_ICON_CLASS = "text-info";
export const BASH_TITLE_CLASS = "text-info-foreground";
export const BASH_CHIP_CLASS = "shrink-0 rounded bg-info/20 px-1.5 py-0.5 text-xs font-medium text-info-foreground";

/** A bash step's timeout as `1h 30m`, `1m 30s`, or `45s`; 1s–6h by the version cut. */
export function formatScriptTimeout(timeoutMs: number): string {
  const totalSeconds = Math.round(timeoutMs / 1000);
  const parts = [
    [Math.floor(totalSeconds / 3600), "h"],
    [Math.floor((totalSeconds % 3600) / 60), "m"],
    [totalSeconds % 60, "s"],
  ] as const;
  const shown = parts.filter(([value]) => value > 0).map(([value, unit]) => `${value}${unit}`);
  return shown.length > 0 ? shown.join(" ") : "0s";
}

/** The pinned script and timeout an Approve authorizes, shared by the card and the Run view row. */
export function WorkflowScriptPreview({ script, className }: { script: { script: string; timeoutMs: number }; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background/60 p-2 font-mono text-xs">
        {script.script}
      </pre>
      <p className="mt-1 text-xs text-muted-foreground">Timeout {formatScriptTimeout(script.timeoutMs)}</p>
    </div>
  );
}

/**
 * The waiting step's in-thread approval card (docs/specs/workflows.md → Wait
 * steps; a bash step held for approval waits the same way). Hidden while a
 * turn runs; back once it settles, whatever the outcome. Approve is duplicated
 * on the Workflow tab's step row (workflow-run-panel.tsx).
 */
export function WorkflowWaitCard({
  runId,
  threadId,
  threadStatus,
  className,
}: {
  runId: Id<"workflowRuns">;
  threadId: Id<"cliThreads">;
  threadStatus: Doc<"cliThreads">["status"];
  className?: string;
}) {
  // Subscribed unconditionally — the Workflow tab holds the same query, and
  // skip/unskip would blank the card for a round trip after every turn.
  const run = useQuery(api.workflows.runs.core.get, { runId });
  const approveStep = useMutation(api.workflows.runs.core.approveStep);
  const [isApproving, setIsApproving] = useState(false);

  const isIdle = threadStatus === "completed" || threadStatus === "waiting_input" || threadStatus === "failed";
  const step = isIdle
    ? run?.stages.flatMap((stage) => stage.steps).find((s) => s.status === "waiting" && s.threadId === threadId)
    : undefined;
  if (!step) {
    return null;
  }

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await approveStep({ runId, stepId: step._id });
    } catch (error) {
      toast.error(error instanceof ConvexError ? String(error.data) : "Failed to approve the step");
    } finally {
      setIsApproving(false);
    }
  };

  return (
    // Positional classes stay on the wrapper so the card keeps its own padding.
    <div className={cn("min-w-0", className)}>
      <div className={cn("rounded-lg border border-border p-3", WAIT_SURFACE_CLASS)}>
        <div className="mb-2 flex min-w-0 items-center gap-2 text-sm font-medium">
          <Hand className={cn("size-4 shrink-0", WAIT_ICON_CLASS)} />
          <span className={cn("truncate", WAIT_TITLE_CLASS)}>{step.title}</span>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          {step.type === "bash"
            ? "The workflow wants to run this script on your machine. Send messages to keep working in this thread, or approve to run it."
            : "The workflow is waiting for you. Send messages to keep working in this thread, or approve to continue the run."}
        </p>
        {step.script ? <WorkflowScriptPreview script={step.script} className="mb-2" /> : null}
        {/* Callout-action principle (danger-callout.tsx): the callout's own bg color, darkened. */}
        <Button
          size="sm"
          className="bg-[color-mix(in_oklab,var(--color-amber-500)_60%,black)] text-white hover:bg-[color-mix(in_oklab,var(--color-amber-500)_52%,black)]"
          disabled={isApproving}
          onClick={() => void handleApprove()}
        >
          <Check className="size-3.5" /> Approve
        </Button>
      </div>
    </div>
  );
}
