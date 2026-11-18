"use client";

import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGithubIntegrationEnabled } from "@/lib/dev-mode/use-dev-mode";
import { showConvexErrorToast } from "@/lib/errors";
import { cn } from "@/lib/utils";

const CHOICE_LABELS = {
  ask: "Ask each time",
  auto: "Start automatically",
} as const;

type Choice = "agentAutoStart" | "guideAutoStart";
type Preferences = Record<Choice, boolean>;

/**
 * Per-project "next time" decisions: assignment automation (OS-1131) and
 * Generate guide (OS-2414). Personal — the threads run as the member on their
 * machine — and a dropdown per project, so the default reads as a decision too.
 */
export function AgentAutomationSection() {
  const projects = useQuery(api.projects.core.listAccessible, {});
  const preferences = useQuery(api.users.projectPreferences.listForUser, {});
  const upsertPreferences = useMutation(api.users.projectPreferences.upsert);
  const showGuides = useGithubIntegrationEnabled();
  const isLoading = projects === undefined || preferences === undefined;

  const preferencesByProject = useMemo(
    () => new Map<Id<"projects">, Preferences>((preferences ?? []).map(({ projectId, ...choices }) => [projectId, choices])),
    [preferences]
  );
  const sortedProjects = useMemo(
    () => [...(projects ?? [])].sort((a, b) => a.organizationName.localeCompare(b.organizationName) || a.name.localeCompare(b.name)),
    [projects]
  );

  const handleChange = (projectId: Id<"projects">, choice: Choice, value: string) => {
    void upsertPreferences({ projectId, [choice]: value === "auto" }).catch((error) => {
      showConvexErrorToast(error, "Could not update the auto-start preference");
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Agents</h2>
        <p className="text-sm text-muted-foreground">
          What happens when you assign a task to an automation-enabled agent{showGuides ? " or click Generate guide on a pull request" : ""}.
          &quot;Start automatically&quot; skips the composer and starts the thread immediately; these choices apply only to you.
        </p>
      </div>

      {isLoading ? (
        <div className="divide-y divide-border rounded-lg border border-border">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className={cn("flex justify-between gap-4 px-4 py-3", showGuides ? "items-start" : "items-center")}>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40 max-w-full rounded-sm" />
                <Skeleton className="h-3 w-24 max-w-full rounded-sm" />
              </div>
              {showGuides ? (
                <div className="grid shrink-0 grid-cols-[auto_auto] items-center gap-x-3 gap-y-1">
                  {Array.from({ length: 2 }).map((_, choice) => [
                    <Skeleton key={`label-${choice}`} className="h-3 w-24 rounded-sm" />,
                    <Skeleton key={`select-${choice}`} className="h-8 w-40 rounded-md" />,
                  ])}
                </div>
              ) : (
                <Skeleton className="h-8 w-40 shrink-0 rounded-md" />
              )}
            </div>
          ))}
        </div>
      ) : sortedProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">You do not have access to any projects yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {sortedProjects.map((project) => {
            const choices = preferencesByProject.get(project._id);
            const select = (choice: Choice, flow: string) => (
              <Select value={choices?.[choice] ? "auto" : "ask"} onValueChange={(value) => handleChange(project._id, choice, value)}>
                <SelectTrigger variant="badge" className="shrink-0" aria-label={`${flow} for ${project.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ask">{CHOICE_LABELS.ask}</SelectItem>
                  <SelectItem value="auto">{CHOICE_LABELS.auto}</SelectItem>
                </SelectContent>
              </Select>
            );
            return (
              <div key={project._id} className={cn("flex justify-between gap-4 px-4 py-3", showGuides ? "items-start" : "items-center")}>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium">{project.name}</h3>
                  <p className="truncate text-xs text-muted-foreground">{project.organizationName}</p>
                </div>
                {showGuides ? (
                  <div className="grid shrink-0 grid-cols-[auto_auto] items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Assigned to an agent</span>
                    {select("agentAutoStart", "Assignment automation")}
                    <span>Generate PR guide</span>
                    {select("guideAutoStart", "Generate PR guide")}
                  </div>
                ) : (
                  select("agentAutoStart", "Assignment automation")
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
