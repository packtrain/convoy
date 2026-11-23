"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  formatProjectSelectionTriggerText,
  type ApiKeyScopeInput,
} from "./api-key-scope-types";

export type { ApiKeyScopeInput } from "./api-key-scope-types";

const NO_ORG_SCOPE = "__none__";

type ApiKeyScopePickerProps = {
  value: ApiKeyScopeInput;
  onChange: (value: ApiKeyScopeInput) => void;
};

export function ApiKeyScopePicker({ value, onChange }: ApiKeyScopePickerProps) {
  const organizations = useQuery(api.organizations.core.listForUser, {});
  const projects = useQuery(
    api.projects.core.listByOrganization,
    value ? { organizationId: value.organizationId } : "skip"
  );

  const availableProjectIds = useMemo(
    () => new Set((projects ?? []).map((project) => project._id)),
    [projects]
  );
  const selectedProjectIds = new Set(value?.projectIds ?? []);
  const isProjectSelectorDisabled = !value;
  const selectedProjects =
    projects?.filter((project) => selectedProjectIds.has(project._id)) ?? [];
  // Archived projects are offered only while selected (docs/specs/project-archive.md).
  const projectChoices = projects?.filter((project) => !project.isArchived || selectedProjectIds.has(project._id));

  useEffect(() => {
    if (!value || projects === undefined) {
      return;
    }

    const reconciledProjectIds = value.projectIds.filter((projectId) =>
      availableProjectIds.has(projectId)
    );
    // An empty list means every project, so dropping the last one would widen
    // the key. Leave it; the server rejects the stale ID on save.
    if (reconciledProjectIds.length === value.projectIds.length || reconciledProjectIds.length === 0) {
      return;
    }

    onChange({
      organizationId: value.organizationId,
      projectIds: reconciledProjectIds,
    });
  }, [availableProjectIds, onChange, projects, value]);

  const handleOrganizationChange = (organizationId: string) => {
    if (organizationId === NO_ORG_SCOPE) {
      onChange(null);
      return;
    }

    onChange({
      organizationId: organizationId as Id<"organizations">,
      projectIds: [],
    });
  };

  const handleProjectToggle = (projectId: Id<"projects">, checked: boolean) => {
    if (!value) {
      return;
    }

    const nextProjectIds = checked
      ? [...value.projectIds, projectId]
      : value.projectIds.filter((id) => id !== projectId);

    onChange({
      organizationId: value.organizationId,
      projectIds: [...new Set(nextProjectIds)],
    });
  };

  const projectTriggerText = formatProjectSelectionTriggerText({
    projectIds: value?.projectIds ?? [],
    projects: selectedProjects,
    isLoading: Boolean(value && projects === undefined),
  });

  return (
    <div className="space-y-2">
      <Label>Scope</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-2">
          <Select
            value={value?.organizationId ?? NO_ORG_SCOPE}
            onValueChange={handleOrganizationChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Organization" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ORG_SCOPE}>All my organizations</SelectItem>
              {(organizations ?? []).map((organization) => (
                <SelectItem key={organization._id} value={organization._id}>
                  {organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={isProjectSelectorDisabled}
              className={cn(
                "w-full justify-between font-normal",
                isProjectSelectorDisabled && "text-muted-foreground"
              )}
            >
              <span className="truncate">{projectTriggerText}</span>
              <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-1" align="start">
            {projectChoices === undefined ? (
              <div aria-label="Loading projects" className="space-y-1 p-1">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="flex items-center gap-2 px-1 py-1.5">
                    <Skeleton className="size-4 rounded-sm" />
                    <Skeleton className="h-4 flex-1 rounded-sm" />
                    <Skeleton className="h-3 w-8 rounded-sm" />
                  </div>
                ))}
              </div>
            ) : projectChoices.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No accessible projects.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {projectChoices.map((project) => (
                  <label
                    key={project._id}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={selectedProjectIds.has(project._id)}
                      onCheckedChange={(checked) =>
                        handleProjectToggle(project._id, checked === true)
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {project.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {project.alias}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {selectedProjectIds.size > 0 && (
        <p className="text-xs text-muted-foreground">
          Limiting a key to projects also blocks it from organization prompts,
          which appear in every project.
        </p>
      )}
    </div>
  );
}
