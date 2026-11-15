"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useAppConvexAuth } from "@/lib/auth/hooks";

import type { ProjectAgentListItem } from "@/components/blocks/agents/agent-list-utils";
import { CompactThreadRowContent } from "@/components/blocks/thread/compact-thread-row-content";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/convex/_generated/api";
import {
  AgentAutomationTriggerProvider,
  type AgentAutomationAssignment,
  type AgentAutomationTrigger,
} from "@/lib/tasks/agent-automation/context";
import { getUnresolvedAgentThreadWork, type Task, type TaskAgentThreadWorkEntry } from "@/lib/tasks/types";
import { AgentAutomationAutoSubmit } from "./agent-automation-auto-submit";
import { AgentAutomationComposerDialog } from "./agent-automation-composer-dialog";

interface AutomationFlow {
  task: Task;
  agent: ProjectAgentListItem;
  unresolved: TaskAgentThreadWorkEntry[];
  stage: "confirm" | "compose" | "auto";
}

/**
 * Hosts the assignment-automation flow (OS-1094): when the web UI assigns a task to an
 * automation-enabled project agent, confirm if the task already has unresolved thread
 * work, then open the prefilled composer dialog. MCP/CLI assignment never triggers it.
 *
 * Mounted in the task-views layout ABOVE the shell so the trigger context is an ancestor
 * of every `useTasks`/crud-actions instance. It resolves the project from the route
 * slugs itself (the queries dedupe with the shell's).
 */
export function AgentAutomationProvider({
  organizationSlug,
  projectAlias,
  children,
}: {
  organizationSlug: string;
  projectAlias: string;
  children: ReactNode;
}) {
  const { isAuthenticated } = useAppConvexAuth();
  const org = useQuery(api.organizations.core.getBySlug, isAuthenticated ? { slug: organizationSlug } : "skip");
  const project = useQuery(
    api.projects.core.getByAlias,
    isAuthenticated && org ? { organizationId: org._id, alias: projectAlias } : "skip"
  );
  const projectId = project?._id;
  const projectAgents = useQuery(api.agents.projectAgents.listByProject, projectId ? { projectId } : "skip");
  const projectAgentsRef = useRef(projectAgents);
  useEffect(() => {
    projectAgentsRef.current = projectAgents;
  }, [projectAgents]);

  // OS-1131: per-user per-project "auto-start" preference — when on, skip the
  // composer dialog and submit the automation thread headlessly.
  const projectPreferences = useQuery(api.users.projectPreferences.get, projectId ? { projectId } : "skip");
  const agentAutoStart = projectPreferences?.agentAutoStart ?? false;
  const agentAutoStartRef = useRef(agentAutoStart);
  useEffect(() => {
    agentAutoStartRef.current = agentAutoStart;
  }, [agentAutoStart]);

  const [flow, setFlow] = useState<AutomationFlow | null>(null);

  const onTaskAssignedToAgent = useCallback(({ task, projectAgentId }: AgentAutomationAssignment) => {
    const agent = (projectAgentsRef.current ?? []).find((candidate) => candidate._id === projectAgentId);
    if (!agent?.automation?.enabled) {
      return;
    }
    const unresolved = getUnresolvedAgentThreadWork(task.agentThreadWork);
    const sendStage = agentAutoStartRef.current ? "auto" : "compose";
    setFlow({ task, agent, unresolved, stage: unresolved.length > 0 ? "confirm" : sendStage });
  }, []);

  const trigger = useMemo<AgentAutomationTrigger>(() => ({ onTaskAssignedToAgent }), [onTaskAssignedToAgent]);

  return (
    <AgentAutomationTriggerProvider value={trigger}>
      {children}
      {flow?.stage === "confirm" ? (
        <ExistingWorkConfirmDialog
          flow={flow}
          onCancel={() => setFlow(null)}
          onContinue={() => setFlow({ ...flow, stage: agentAutoStart ? "auto" : "compose" })}
        />
      ) : null}
      {flow?.stage === "auto" && projectId ? (
        <AgentAutomationAutoSubmit
          key={`${flow.task._id}:${flow.agent._id}`}
          projectId={projectId}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          task={flow.task}
          agent={flow.agent}
          onFallback={() => setFlow({ ...flow, stage: "compose" })}
          onDone={() => setFlow(null)}
        />
      ) : null}
      {flow?.stage === "compose" && projectId && org ? (
        <AgentAutomationComposerDialog
          projectId={projectId}
          organizationId={org._id}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          task={flow.task}
          agent={flow.agent}
          onClose={() => setFlow(null)}
        />
      ) : null}
    </AgentAutomationTriggerProvider>
  );
}

function ExistingWorkConfirmDialog({ flow, onCancel, onContinue }: { flow: AutomationFlow; onCancel: () => void; onContinue: () => void }) {
  return (
    <AlertDialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Agent work already in progress</AlertDialogTitle>
          <AlertDialogDescription>
            {flow.task.refId} already has unresolved agent thread work. You can still start another thread — multiple runs on the same task
            are allowed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid gap-1.5">
          {flow.unresolved.map((entry) => (
            <li key={entry.threadId}>
              <CompactThreadRowContent
                title={entry.threadTitle}
                status={entry.status}
                cliType={entry.cliType}
                lastActivityAt={entry.updatedAt}
                forceStatusIndicator
                userName={entry.userName}
                className="rounded-md border border-border px-2 py-1.5"
              />
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer" onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction className="cursor-pointer" onClick={onContinue}>
            Start another thread
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
