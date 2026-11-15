import type { ReactNode } from "react";
import { AgentAutomationProvider } from "@/components/blocks/tasks/agent-automation/agent-automation-provider";
import { ProjectTaskViewsShell } from "./project-task-views-shell";

export default async function ProjectTaskViewsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationSlug: string; projectAlias: string }>;
}) {
  const { organizationSlug, projectAlias } = await params;

  return (
    // Above the shell so the automation trigger context is an ancestor of the
    // shell's own useTasks/crud-actions instance (OS-1094).
    <AgentAutomationProvider organizationSlug={organizationSlug} projectAlias={projectAlias}>
      <ProjectTaskViewsShell>{children}</ProjectTaskViewsShell>
    </AgentAutomationProvider>
  );
}
