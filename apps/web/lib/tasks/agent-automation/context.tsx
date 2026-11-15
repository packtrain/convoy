"use client";

import { createContext, useContext } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { Task } from "@/lib/tasks/types";

// Assignment automation (OS-1094): assigning a task to an automation-enabled
// project agent in the web UI opens a prefilled thread composer. The trigger is
// deliberately UI-only — MCP/CLI assignment paths never reach this context.

export interface AgentAutomationAssignment {
  /** Snapshot of the task at assignment time (pre-update). */
  task: Task;
  projectAgentId: Id<"projectAgents">;
}

export interface AgentAutomationTrigger {
  onTaskAssignedToAgent: (assignment: AgentAutomationAssignment) => void;
}

const AgentAutomationContext = createContext<AgentAutomationTrigger | null>(null);

export const AgentAutomationTriggerProvider = AgentAutomationContext.Provider;

/** Null when no automation provider is mounted (e.g. surfaces outside the task views) — callers no-op. */
export function useAgentAutomationTrigger(): AgentAutomationTrigger | null {
  return useContext(AgentAutomationContext);
}
