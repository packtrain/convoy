"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type WorkflowRunStepAction = "retry" | "skip" | "approve";

/** The starting user's run controls with their busy flags — shared by the Run view and the Run rail. */
export function useWorkflowRunActions(runId: Id<"workflowRuns">) {
  const cancelRun = useMutation(api.workflows.runs.core.cancel);
  const resumeLane = useMutation(api.workflows.runs.core.resumeLane);
  const stepActions = {
    retry: useMutation(api.workflows.runs.core.retryStep),
    skip: useMutation(api.workflows.runs.core.skipStep),
    approve: useMutation(api.workflows.runs.core.approveStep),
  };
  const [isCanceling, setIsCanceling] = useState(false);
  const [resumingLaneId, setResumingLaneId] = useState<string | null>(null);
  const [busyStepId, setBusyStepId] = useState<Id<"workflowRunSteps"> | null>(null);

  const cancel = async () => {
    setIsCanceling(true);
    try {
      await cancelRun({ runId });
    } catch (error) {
      toast.error(error instanceof ConvexError ? String(error.data) : "Failed to cancel the run");
    } finally {
      setIsCanceling(false);
    }
  };

  const resume = async (laneId: string) => {
    setResumingLaneId(laneId);
    try {
      await resumeLane({ runId, laneId });
    } catch (error) {
      toast.error(error instanceof ConvexError ? String(error.data) : "Failed to resume the lane");
    } finally {
      setResumingLaneId(null);
    }
  };

  const stepAction = async (stepId: Id<"workflowRunSteps">, action: WorkflowRunStepAction) => {
    setBusyStepId(stepId);
    try {
      await stepActions[action]({ runId, stepId });
    } catch (error) {
      toast.error(error instanceof ConvexError ? String(error.data) : `Failed to ${action} the step`);
    } finally {
      setBusyStepId(null);
    }
  };

  return { cancel, resume, stepAction, isCanceling, resumingLaneId, busyStepId };
}
