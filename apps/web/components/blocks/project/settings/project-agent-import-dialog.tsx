"use client";

import { ArrowDownToLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import type { ProjectAgentListItem } from "@/components/blocks/agents/agent-list-utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  showBatchDoneToast,
  showBatchProgressToast,
} from "@/lib/batch-progress-toast";
import { showConvexErrorToast } from "@/lib/errors";
import {
  generateImportedAgentName,
  getImportConflicts,
  type AgentImportConflict,
} from "./project-agent-import-utils";
import {
  ProjectAgentListFrame,
  ProjectAgentListSkeleton,
  ProjectAgentRow,
} from "./project-agent-list";
import { ProjectAgentEmptyListMessage } from "./project-agent-section-parts";

type ConflictResolution = "skip" | "rename";

interface PendingImportConflict {
  selectedAgents: ProjectAgentListItem[];
  conflicts: AgentImportConflict<ProjectAgentListItem>[];
}

export function ProjectAgentImportDialog({
  open,
  onOpenChange,
  projectId,
  organizationId,
  projectAgents,
  canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: Id<"projects">;
  organizationId: Id<"organizations"> | null;
  projectAgents: ProjectAgentListItem[];
  canManage: boolean;
}) {
  const [sourceProjectId, setSourceProjectId] =
    useState<Id<"projects"> | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<
    Id<"projectAgents">[]
  >([]);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingImportConflict, setPendingImportConflict] =
    useState<PendingImportConflict | null>(null);
  const [conflictResolution, setConflictResolution] =
    useState<ConflictResolution>("skip");

  const accessibleProjects = useQuery(
    api.projects.core.listAccessible,
    open ? {} : "skip"
  );
  const sourceAgents = useQuery(
    api.agents.projectAgents.listByProject,
    open && sourceProjectId ? { projectId: sourceProjectId } : "skip"
  );
  const copyFromProjectAgent = useMutation(
    api.agents.projectAgents.copyFromProjectAgent
  );

  const sourceProjects = useMemo(
    () =>
      (accessibleProjects ?? []).filter(
        (project) => project._id !== projectId
      ),
    [accessibleProjects, projectId]
  );
  const sourceAgentItems = useMemo(() => sourceAgents ?? [], [sourceAgents]);
  const selectedCount = selectedAgentIds.length;

  useEffect(() => {
    if (open) {
      return;
    }

    setSourceProjectId(null);
    setSelectedAgentIds([]);
    setPendingImportConflict(null);
    setConflictResolution("skip");
  }, [open]);

  function handleSourceProjectChange(value: string) {
    setSourceProjectId(value as Id<"projects">);
    setSelectedAgentIds([]);
  }

  function toggleAgentSelection(
    projectAgentId: Id<"projectAgents">,
    checked: boolean
  ) {
    setSelectedAgentIds((current) => {
      if (checked) {
        return current.includes(projectAgentId)
          ? current
          : [...current, projectAgentId];
      }

      return current.filter((selectedId) => selectedId !== projectAgentId);
    });
  }

  async function handleImportSelected() {
    const selectedAgents = selectedAgentIds
      .map((agentId) => sourceAgentItems.find((agent) => agent._id === agentId))
      .filter((agent): agent is ProjectAgentListItem => agent !== undefined);
    if (selectedAgents.length === 0) {
      return;
    }

    const conflicts = getImportConflicts(selectedAgents, projectAgents);
    if (conflicts.length > 0) {
      setConflictResolution("skip");
      setPendingImportConflict({ selectedAgents, conflicts });
      return;
    }

    await importSelectedAgents(selectedAgents, []);
  }

  async function importSelectedAgents(
    selectedAgents: ProjectAgentListItem[],
    conflicts: AgentImportConflict<ProjectAgentListItem>[],
    resolution: ConflictResolution = "skip"
  ) {
    const conflictedAgentIds = new Set(
      conflicts.map((conflict) => conflict.agent._id)
    );
    const importStartedAt = new Date();
    const importJobs = selectedAgents
      .map((agent, index) => {
        if (!conflictedAgentIds.has(agent._id)) {
          return { agent };
        }
        if (resolution === "rename") {
          return {
            agent,
            name: generateImportedAgentName(agent.name, importStartedAt, index),
          };
        }
        return null;
      })
      .filter((job): job is NonNullable<typeof job> => job !== null);

    if (importJobs.length === 0) {
      setSelectedAgentIds([]);
      onOpenChange(false);
      return;
    }

    const total = importJobs.length;
    const toastId = `project-agent-project-import-${projectId}`;
    let imported = 0;

    setIsImporting(true);
    showBatchProgressToast({
      toastId,
      completed: imported,
      total,
      label: "Importing",
    });

    try {
      for (const job of importJobs) {
        await copyFromProjectAgent({
          projectId,
          sourceProjectAgentId: job.agent._id,
          ...(job.name ? { name: job.name } : {}),
        });
        imported += 1;
        showBatchProgressToast({
          toastId,
          completed: imported,
          total,
          label: "Importing",
        });
      }

      showBatchDoneToast({
        toastId,
        total,
        label: "Imported",
        itemLabel: "agent",
      });
      setSelectedAgentIds([]);
      onOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, "Could not import selected agents");
      toast.dismiss(toastId);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleContinueConflictImport() {
    if (!pendingImportConflict) {
      return;
    }

    const pending = pendingImportConflict;
    setPendingImportConflict(null);
    await importSelectedAgents(
      pending.selectedAgents,
      pending.conflicts,
      conflictResolution
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,720px)] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-4 py-4 pr-12">
          <DialogTitle>From project</DialogTitle>
          <DialogDescription>
            Copy AI agents from another project you have access to.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={sourceProjectId ?? ""}
              onValueChange={handleSourceProjectChange}
              disabled={accessibleProjects === undefined || isImporting}
            >
              <SelectTrigger
                className="w-full min-w-0 sm:max-w-xs"
                aria-label="Source project"
              >
                <SelectValue
                  placeholder={
                    accessibleProjects === undefined
                      ? "Loading projects…"
                      : "Select a project"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sourceProjects.map((project) => (
                  <SelectItem key={project._id} value={project._id}>
                    {project.organizationId === organizationId
                      ? project.name
                      : `${project.organizationName} / ${project.name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="settings"
              className="sm:ml-auto"
              disabled={selectedCount === 0 || isImporting || !canManage}
              onClick={handleImportSelected}
            >
              <ArrowDownToLine className="size-4" />
              Import
              {selectedCount > 0 ? ` (${selectedCount})` : ""}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!sourceProjectId ? (
              accessibleProjects !== undefined && sourceProjects.length === 0 ? (
                <ProjectAgentEmptyListMessage className="h-full">
                  You do not have access to any other projects.
                </ProjectAgentEmptyListMessage>
              ) : (
                <ProjectAgentEmptyListMessage className="h-full">
                  Select a project to browse its AI agents.
                </ProjectAgentEmptyListMessage>
              )
            ) : sourceAgents === undefined ? (
              <ProjectAgentListSkeleton />
            ) : sourceAgentItems.length > 0 ? (
              <ProjectAgentListFrame>
                {sourceAgentItems.map((agent) => (
                  <ProjectAgentRow
                    key={agent._id}
                    agent={agent}
                    action={
                      <Checkbox
                        aria-label={`Select ${agent.name}`}
                        className="size-5 cursor-pointer"
                        checked={selectedAgentIds.includes(agent._id)}
                        disabled={!canManage || isImporting}
                        onCheckedChange={(checked) =>
                          toggleAgentSelection(agent._id, checked === true)
                        }
                      />
                    }
                  />
                ))}
              </ProjectAgentListFrame>
            ) : (
              <ProjectAgentEmptyListMessage className="h-full">
                This project has no AI agents to import.
              </ProjectAgentEmptyListMessage>
            )}
          </div>
        </div>
      </DialogContent>
      <Dialog
        open={pendingImportConflict !== null}
        onOpenChange={(conflictOpen) => {
          if (!conflictOpen && !isImporting) {
            setPendingImportConflict(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agent name conflicts</DialogTitle>
            <DialogDescription>
              The project already has agents with these names. Choose how to
              handle them before importing.
            </DialogDescription>
          </DialogHeader>
          {pendingImportConflict ? (
            <div className="space-y-4">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {pendingImportConflict.conflicts.map((conflict) => (
                  <li key={conflict.agent._id}>{conflict.projectAgent.name}</li>
                ))}
              </ul>
              <fieldset className="space-y-3">
                <legend className="sr-only">Conflict handling</legend>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="project-agent-import-conflict-resolution"
                    value="skip"
                    checked={conflictResolution === "skip"}
                    onChange={() => setConflictResolution("skip")}
                    className="mt-1 cursor-pointer"
                  />
                  <span className="grid gap-1">
                    <span className="text-sm font-medium">Skip existing</span>
                    <span className="text-sm text-muted-foreground">
                      Import only agents without conflicts.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="project-agent-import-conflict-resolution"
                    value="rename"
                    checked={conflictResolution === "rename"}
                    onChange={() => setConflictResolution("rename")}
                    className="mt-1 cursor-pointer"
                  />
                  <span className="grid gap-1">
                    <span className="text-sm font-medium">
                      Create with new name
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Copy conflicts with a timestamp suffix.
                    </span>
                  </span>
                </label>
              </fieldset>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isImporting}
              onClick={() => setPendingImportConflict(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isImporting}
              onClick={handleContinueConflictImport}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
