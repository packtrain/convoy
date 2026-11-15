"use client";

import { ArrowDownToLine, CheckSquare, CircleFadingArrowUp, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import {
  filterAgents,
  type OrganizationAgentListItem,
  type ProjectAgentListItem,
} from "@/components/blocks/agents/agent-list-utils";
import { SearchInput } from "@/components/custom/search-input";
import { Badge } from "@/components/ui/badge";
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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  showBatchDoneToast,
  showBatchProgressToast,
} from "@/lib/batch-progress-toast";
import { showConvexErrorToast } from "@/lib/errors";
import {
  ProjectAgentListFrame,
  ProjectAgentListSkeleton,
  ProjectAgentRow,
} from "./project-agent-list";
import {
  generateImportedAgentName,
  getImportConflicts,
  normalizeAgentNameKey,
  type AgentImportConflict,
} from "./project-agent-import-utils";
import { ProjectAgentPreviewDialog } from "./project-agent-preview-dialog";
import { ProjectAgentEmptyListMessage } from "./project-agent-section-parts";

type ConflictResolution = "skip" | "rename" | "replace";

interface PendingImportConflict {
  selectedAgents: OrganizationAgentListItem[];
  conflicts: AgentImportConflict<OrganizationAgentListItem>[];
}

/**
 * Organization templates offered to a project. Installed templates keep their row —
 * dimmed and marked `Installed` — and the dialog stays open after an install, so
 * several can be installed in a row (docs/specs/agents.md#ui-placement).
 */
export function ProjectAgentTemplateDialog({
  open,
  onOpenChange,
  projectId,
  organizationId,
  projectAgents,
  canManage,
  onUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: Id<"projects">;
  organizationId: Id<"organizations"> | null;
  projectAgents: ProjectAgentListItem[];
  canManage: boolean;
  /** Hands an outdated installed copy to the section's refresh confirmation. */
  onUpdate: (projectAgentId: Id<"projectAgents">) => void;
}) {
  const [templateSearch, setTemplateSearch] = useState("");
  const [previewAgent, setPreviewAgent] = useState<OrganizationAgentListItem | null>(null);
  const [copyingAgentId, setCopyingAgentId] = useState<Id<"agents"> | null>(
    null
  );
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Id<"agents">[]>([]);
  const [isImportingSelected, setIsImportingSelected] = useState(false);
  const [pendingImportConflict, setPendingImportConflict] =
    useState<PendingImportConflict | null>(null);
  const [conflictResolution, setConflictResolution] =
    useState<ConflictResolution>("skip");
  const orgAgents = useQuery(
    api.agents.core.listByOrganization,
    open && organizationId ? { organizationId } : "skip"
  );
  const copyFromAgent = useMutation(api.agents.projectAgents.copyFromAgent);
  const replaceFromAgent = useMutation(api.agents.projectAgents.replaceFromAgent);
  const orgAgentItems = useMemo(() => orgAgents ?? [], [orgAgents]);
  const visibleOrgAgents = useMemo(
    () => filterAgents(orgAgentItems, { category: "All", search: templateSearch }),
    [orgAgentItems, templateSearch]
  );
  const selectedCount = selectedAgentIds.length;
  const isBusy = copyingAgentId !== null || isImportingSelected;
  // Installed templates stay listed and marked, not filtered out; a second copy
  // under the same name would collide with the first, so they lose the install
  // action rather than the row (OS-1805).
  const installedByTemplate = useMemo(() => {
    const copyBySource = new Map(
      projectAgents.flatMap((agent) =>
        agent.sourceAgentId ? [[agent.sourceAgentId, agent] as const] : []
      )
    );
    const installedNames = new Set(
      projectAgents.map((agent) => normalizeAgentNameKey(agent.name))
    );

    return new Map(
      orgAgentItems.map((agent) => {
        const copy = copyBySource.get(agent._id);

        return [
          agent._id,
          {
            isInstalled:
              copy !== undefined ||
              installedNames.has(normalizeAgentNameKey(agent.name)),
            outdatedCopyId:
              copy && agent.version > (copy.installedVersion ?? 1)
                ? copy._id
                : undefined,
          },
        ] as const;
      })
    );
  }, [orgAgentItems, projectAgents]);

  useEffect(() => {
    if (open) {
      return;
    }

    setTemplateSearch("");
    setPreviewAgent(null);
    setIsSelecting(false);
    setSelectedAgentIds([]);
    setPendingImportConflict(null);
    setConflictResolution("skip");
  }, [open]);

  async function handleCopy(agentId: Id<"agents">) {
    setCopyingAgentId(agentId);
    try {
      // The dialog stays open so several templates can be installed one after another.
      await copyFromAgent({ projectId, agentId });
      toast.success("Agent installed into this project");
    } catch (error) {
      showConvexErrorToast(error, "Could not copy agent template");
    } finally {
      setCopyingAgentId(null);
    }
  }

  function toggleSelectionMode() {
    if (isSelecting) {
      setSelectedAgentIds([]);
    }
    setIsSelecting((value) => !value);
  }

  function toggleAgentSelection(agentId: Id<"agents">, checked: boolean) {
    setSelectedAgentIds((current) => {
      if (checked) {
        return current.includes(agentId) ? current : [...current, agentId];
      }

      return current.filter((selectedAgentId) => selectedAgentId !== agentId);
    });
  }

  async function handleImportSelected() {
    if (selectedAgentIds.length === 0) {
      return;
    }

    const selectedAgents = selectedAgentIds
      .map((agentId) => orgAgentItems.find((agent) => agent._id === agentId))
      .filter((agent): agent is OrganizationAgentListItem => agent !== undefined);
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
    selectedAgents: OrganizationAgentListItem[],
    conflicts: AgentImportConflict<OrganizationAgentListItem>[],
    resolution: ConflictResolution = "skip"
  ) {
    const conflictByAgentId = new Map(
      conflicts.map((conflict) => [conflict.agent._id, conflict] as const)
    );
    const importStartedAt = new Date();
    const importJobs = selectedAgents
      .map((agent, index) => {
        const conflict = conflictByAgentId.get(agent._id);
        if (!conflict) {
          return { kind: "copy" as const, agent };
        }
        if (resolution === "rename") {
          return {
            kind: "copy" as const,
            agent,
            name: generateImportedAgentName(agent.name, importStartedAt, index),
          };
        }
        if (resolution === "replace") {
          return { kind: "replace" as const, agent, projectAgent: conflict.projectAgent };
        }
        return null;
      })
      .filter((job): job is NonNullable<typeof job> => job !== null);

    if (importJobs.length === 0) {
      setSelectedAgentIds([]);
      setIsSelecting(false);
      onOpenChange(false);
      return;
    }

    const total = importJobs.length;
    const toastId = `project-agent-template-import-${projectId}`;
    let imported = 0;

    setIsImportingSelected(true);
    showBatchProgressToast({
      toastId,
      completed: imported,
      total,
      label: "Importing",
    });

    try {
      for (const job of importJobs) {
        if (job.kind === "replace") {
          await replaceFromAgent({
            projectAgentId: job.projectAgent._id,
            agentId: job.agent._id,
            // `Replace existing` is the user saying they accept losing local content.
            overwriteLocalEdits: true,
          });
        } else {
          await copyFromAgent({
            projectId,
            agentId: job.agent._id,
            ...(job.name ? { name: job.name } : {}),
          });
        }
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
      setIsSelecting(false);
      onOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, "Could not import selected agent templates");
      toast.dismiss(toastId);
    } finally {
      setIsImportingSelected(false);
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
          <DialogTitle>From template</DialogTitle>
          <DialogDescription>
            Copy an organization agent template into this project.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="Search templates"
              aria-label="Search agent templates"
              className="min-w-0 flex-1"
            />
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button
                type="button"
                variant="outline"
                size="settings"
                disabled={isBusy || !canManage}
                onClick={toggleSelectionMode}
              >
                {isSelecting ? (
                  <X className="size-4" />
                ) : (
                  <CheckSquare className="size-4" />
                )}
                {isSelecting ? "Cancel selection" : "Select multiple"}
              </Button>
              {isSelecting ? (
                <Button
                  type="button"
                  size="settings"
                  disabled={selectedCount === 0 || isBusy || !canManage}
                  onClick={handleImportSelected}
                >
                  <ArrowDownToLine className="size-4" />
                  Import
                </Button>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {orgAgents === undefined ? (
              <ProjectAgentListSkeleton />
            ) : visibleOrgAgents.length > 0 ? (
              <ProjectAgentListFrame>
                {visibleOrgAgents.map((agent) => {
                  const installed = installedByTemplate.get(agent._id);
                  const outdatedCopyId = installed?.outdatedCopyId;

                  return (
                    <ProjectAgentRow
                      key={agent._id}
                      agent={agent}
                      className={installed?.isInstalled ? "opacity-60" : undefined}
                      templateState={{ templateVersion: agent.version }}
                      onClick={() => setPreviewAgent(agent)}
                      showActionsMenu={false}
                      action={
                        <span className="flex items-center gap-2">
                          {installed?.isInstalled ? (
                            <Badge variant="outline">Installed</Badge>
                          ) : null}
                          {isSelecting ? (
                            <Checkbox
                              aria-label={`Select ${agent.name}`}
                              className="size-5 cursor-pointer"
                              checked={selectedAgentIds.includes(agent._id)}
                              disabled={!canManage || isBusy}
                              onCheckedChange={(checked) =>
                                toggleAgentSelection(agent._id, checked === true)
                              }
                            />
                          ) : outdatedCopyId ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon-sm"
                              aria-label={`Update ${agent.name} to v${agent.version}`}
                              className="shrink-0 text-muted-foreground"
                              disabled={!canManage}
                              onClick={() => onUpdate(outdatedCopyId)}
                            >
                              <CircleFadingArrowUp className="size-4" />
                            </Button>
                          ) : installed?.isInstalled ? null : (
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon-sm"
                              aria-label={`Add ${agent.name} to project`}
                              className="shrink-0 text-muted-foreground"
                              disabled={!canManage || copyingAgentId !== null}
                              onClick={() => handleCopy(agent._id)}
                            >
                              <ArrowDownToLine className="size-4" />
                            </Button>
                          )}
                        </span>
                      }
                    />
                  );
                })}
              </ProjectAgentListFrame>
            ) : (
              <ProjectAgentEmptyListMessage className="h-full">
                No templates match this search.
              </ProjectAgentEmptyListMessage>
            )}
          </div>
        </div>
      </DialogContent>
      <Dialog
        open={pendingImportConflict !== null}
        onOpenChange={(conflictOpen) => {
          if (!conflictOpen && !isImportingSelected) {
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
                    name="agent-import-conflict-resolution"
                    value="skip"
                    checked={conflictResolution === "skip"}
                    onChange={() => setConflictResolution("skip")}
                    className="mt-1 cursor-pointer"
                  />
                  <span className="grid gap-1">
                    <span className="text-sm font-medium">Skip existing</span>
                    <span className="text-sm text-muted-foreground">
                      Import only templates without conflicts.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="agent-import-conflict-resolution"
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
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="agent-import-conflict-resolution"
                    value="replace"
                    checked={conflictResolution === "replace"}
                    onChange={() => setConflictResolution("replace")}
                    className="mt-1 cursor-pointer"
                  />
                  <span className="grid gap-1">
                    <span className="text-sm font-medium">Replace existing</span>
                    <span className="text-sm text-muted-foreground">
                      Update matching project agents.
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
              disabled={isImportingSelected}
              onClick={() => setPendingImportConflict(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isImportingSelected}
              onClick={handleContinueConflictImport}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {previewAgent ? (
        <ProjectAgentPreviewDialog
          agentId={previewAgent._id}
          name={previewAgent.name}
          description={previewAgent.description}
          prompt={previewAgent.prompt}
          isInstalled={installedByTemplate.get(previewAgent._id)?.isInstalled === true}
          isInstalling={copyingAgentId !== null}
          onInstall={handleCopy}
          onClose={() => setPreviewAgent(null)}
        />
      ) : null}
    </Dialog>
  );
}
