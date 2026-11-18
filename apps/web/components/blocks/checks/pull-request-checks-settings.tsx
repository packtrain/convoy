"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { showConvexErrorToast } from "@/lib/errors";

const NONE = "none";

/** Settings → Pull requests: the PR default Checklist and the publish switch, also found in Settings → Checks. */
export function PullRequestChecksSettings({
  projectId,
  canEdit,
  publishPullRequestChecks,
}: {
  projectId: Id<"projects"> | null;
  canEdit: boolean;
  publishPullRequestChecks: boolean;
}) {
  const checklists = useQuery(api.checks.checklists.list, projectId ? { projectId } : "skip");
  const setDefaults = useMutation(api.checks.checklists.setDefaults);
  const [isSaving, setIsSaving] = useState(false);

  if (!projectId || checklists === undefined) {
    return (
      <div className="space-y-6">
        {[0, 1].map((row) => (
          <div key={row} className="flex items-center justify-between gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="h-6 w-20 rounded-md" />
          </div>
        ))}
      </div>
    );
  }

  const handleChange = async (value: string) => {
    setIsSaving(true);
    try {
      // Task types left out keep their defaults.
      await setDefaults({ projectId, taskTypes: [], pullRequests: value === NONE ? null : (value as Id<"checklists">) });
    } catch (error) {
      showConvexErrorToast(error, "Failed to save the default checklist");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingRow title="Default checklist" description="Every pull request gets this checklist unless someone picks another one on it. Build checklists in Checks.">
        <Select value={checklists.find((checklist) => checklist.pullRequests)?._id ?? NONE} onValueChange={(value) => void handleChange(value)} disabled={!canEdit || isSaving}>
          <SelectTrigger variant="badge" className="shrink-0" aria-label="Default checklist for pull requests">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No checks</SelectItem>
            {checklists.map((checklist) => (
              <SelectItem key={checklist._id} value={checklist._id}>
                {checklist.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <PublishSwitch projectId={projectId} checked={publishPullRequestChecks} canEdit={canEdit} />
    </div>
  );
}

/** Whether Pull request check results leave Convoy, on every Git host (docs/specs/github-integration.md → Pull request checks). */
export function PublishSwitch({ projectId, checked, canEdit }: { projectId: Id<"projects">; checked: boolean; canEdit: boolean }) {
  const update = useMutation(api.projects.core.update);
  const [isSaving, setIsSaving] = useState(false);
  const handleChange = async (publishPullRequestChecks: boolean) => {
    setIsSaving(true);
    try {
      await update({ id: projectId, publishPullRequestChecks });
    } catch (error) {
      showConvexErrorToast(error, "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <SettingRow title="Publish results to the Git host" description="On GitHub, each Pull request check result becomes a check run on the PR's commit.">
      <Switch
        aria-label="Publish results to the Git host"
        checked={checked}
        onCheckedChange={(value) => void handleChange(value)}
        disabled={!canEdit || isSaving}
        className="shrink-0 cursor-pointer"
      />
    </SettingRow>
  );
}

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <Label>{title}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
