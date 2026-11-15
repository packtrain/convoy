"use client";

import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { showConvexErrorToast } from "@/lib/errors";

const CHOICE_LABELS = {
  ask: "Ask each time",
  auto: "Start automatically",
} as const;

/**
 * Per-project assignment-automation decisions (OS-1131). The preference is
 * personal — automation threads run as the assigning user on their machine —
 * so it is managed here in user settings, listed explicitly per accessible
 * project (a dropdown, not a toggle, so the default reads as a decision too).
 */
export function AgentAutomationSection() {
  const projects = useQuery(api.projects.core.listAccessible, {});
  const preferences = useQuery(api.users.projectPreferences.listForUser, {});
  const upsertPreferences = useMutation(api.users.projectPreferences.upsert);
  const isLoading = projects === undefined || preferences === undefined;

  const autoStartByProject = useMemo(
    () => new Map((preferences ?? []).map((preference) => [preference.projectId, preference.agentAutoStart])),
    [preferences]
  );
  const sortedProjects = useMemo(
    () => [...(projects ?? [])].sort((a, b) => a.organizationName.localeCompare(b.organizationName) || a.name.localeCompare(b.name)),
    [projects]
  );

  const handleChange = (projectId: Id<"projects">, choice: string) => {
    void upsertPreferences({ projectId, agentAutoStart: choice === "auto" }).catch((error) => {
      showConvexErrorToast(error, "Could not update the auto-start preference");
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Agents</h2>
        <p className="text-sm text-muted-foreground">
          What happens when you assign a task to an automation-enabled agent. &quot;Start automatically&quot; skips the composer and starts
          the thread immediately; these choices apply only to you.
        </p>
      </div>

      {isLoading ? (
        <div className="divide-y divide-border rounded-lg border border-border">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40 max-w-full rounded-sm" />
                <Skeleton className="h-3 w-24 max-w-full rounded-sm" />
              </div>
              <Skeleton className="h-8 w-40 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      ) : sortedProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">You do not have access to any projects yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {sortedProjects.map((project) => {
            const autoStart = autoStartByProject.get(project._id) ?? false;
            return (
              <div key={project._id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium">{project.name}</h3>
                  <p className="truncate text-xs text-muted-foreground">{project.organizationName}</p>
                </div>
                <Select value={autoStart ? "auto" : "ask"} onValueChange={(choice) => handleChange(project._id, choice)}>
                  <SelectTrigger
                    variant="badge"
                    className="shrink-0"
                    aria-label={`Assignment automation for ${project.name}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ask">{CHOICE_LABELS.ask}</SelectItem>
                    <SelectItem value="auto">{CHOICE_LABELS.auto}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
