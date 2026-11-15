"use client";

import { ArrowDownToLine, Bot, ChevronDown, FolderInput, Library, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import {
  ALL_CATEGORY,
  UNCATEGORIZED_CATEGORY,
  filterAgents,
  getAgentCategories,
  type OrganizationAgentListItem,
  type ProjectAgentListItem,
} from "@/components/blocks/agents/agent-list-utils";
import { SettingsCatalogCategoryNav } from "@/components/blocks/settings-catalog/settings-catalog-category-nav";
import { SearchInput } from "@/components/custom/search-input";
import { EmptyState } from "@/components/custom/empty-state";
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
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showBatchDoneToast, showBatchProgressToast } from "@/lib/batch-progress-toast";
import { showConvexErrorToast } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";
import { ProjectAgentListFrame, ProjectAgentListSkeleton, ProjectAgentRow } from "./project-agent-list";
import { ProjectAgentEmptyListMessage } from "./project-agent-section-parts";
import { ProjectAgentImportDialog } from "./project-agent-import-dialog";
import { ProjectAgentTemplateDialog } from "./project-agent-template-dialog";

interface ProjectAgentsSectionProps {
  projectId: Id<"projects"> | null;
  organizationId: Id<"organizations"> | null;
  organizationSlug: string;
  projectAlias: string;
  canManage: boolean;
}

export function ProjectAgentsSection({ projectId, organizationId, organizationSlug, projectAlias, canManage }: ProjectAgentsSectionProps) {
  const navigation = useNavigation();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY);
  const [deleteAgentId, setDeleteAgentId] = useState<Id<"projectAgents"> | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedEmptyAgentIds, setSelectedEmptyAgentIds] = useState<Id<"agents">[]>([]);
  const [isImportingEmptyAgents, setIsImportingEmptyAgents] = useState(false);
  const [refreshAgentId, setRefreshAgentId] = useState<Id<"projectAgents"> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const projectAgents = useQuery(api.agents.projectAgents.listByProject, projectId ? { projectId } : "skip");
  const projectAgentItems = useMemo(() => projectAgents ?? [], [projectAgents]);
  // Managers also need the catalog for the update-available hints on installed copies.
  const shouldLoadOrganizationAgents = canManage && organizationId !== null;
  const organizationAgents = useQuery(
    api.agents.core.listByOrganization,
    shouldLoadOrganizationAgents && organizationId ? { organizationId } : "skip"
  );
  const deleteProjectAgent = useMutation(api.agents.projectAgents.deleteProjectAgent);
  const copyFromAgent = useMutation(api.agents.projectAgents.copyFromAgent);
  const replaceFromAgent = useMutation(api.agents.projectAgents.replaceFromAgent);

  const categories = useMemo(() => getAgentCategories(projectAgentItems), [projectAgentItems]);
  const hasCategorySidebar = categories.some((category) => category.name !== ALL_CATEGORY && category.name !== UNCATEGORIZED_CATEGORY);
  const activeCategory = categories.some((category) => category.name === selectedCategory) ? selectedCategory : ALL_CATEGORY;
  const visibleProjectAgents = useMemo(
    () => filterAgents(projectAgentItems, { category: activeCategory, search }),
    [activeCategory, projectAgentItems, search]
  );
  const organizationAgentItems = useMemo(() => organizationAgents ?? [], [organizationAgents]);
  const suggestedOrganizationAgents = useMemo(
    () =>
      filterAgents(organizationAgentItems, {
        category: "All",
        search: "",
      }).slice(0, 3),
    [organizationAgentItems]
  );
  const templateVersions = useMemo(
    () => new Map(organizationAgentItems.map((agent) => [agent._id, agent.version])),
    [organizationAgentItems]
  );
  const deletingAgent = projectAgentItems.find((agent) => agent._id === deleteAgentId) ?? null;
  const refreshingAgent = projectAgentItems.find((agent) => agent._id === refreshAgentId) ?? null;

  useEffect(() => {
    const suggestedIds = new Set(suggestedOrganizationAgents.map((agent) => agent._id));

    setSelectedEmptyAgentIds((current) => current.filter((agentId) => suggestedIds.has(agentId)));
  }, [suggestedOrganizationAgents]);

  if (!projectId) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">No project selected.</p>
      </div>
    );
  }

  function agentHref(agent: ProjectAgentListItem) {
    return appRoute.projectAgentDetail(organizationSlug, projectAlias, agent._id);
  }

  function handleCreate() {
    navigation.push(appRoute.projectAgentNew(organizationSlug, projectAlias));
  }

  function handleDeleteOpenChange(open: boolean) {
    setDeleteOpen(open);
    if (!open) {
      setDeleteAgentId(null);
    }
  }

  async function handleDelete() {
    if (!deleteAgentId) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteProjectAgent({ projectAgentId: deleteAgentId });
      handleDeleteOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, "Could not delete project agent");
    } finally {
      setIsDeleting(false);
    }
  }

  /** The source template's version when it is ahead of the installed one. */
  function availableTemplateVersion(agent: ProjectAgentListItem) {
    if (!agent.sourceAgentId) {
      return undefined;
    }

    const templateVersion = templateVersions.get(agent.sourceAgentId);
    return templateVersion !== undefined && templateVersion > (agent.installedVersion ?? 1) ? templateVersion : undefined;
  }

  /** Installed-copy template state for a row, or none for project-created agents. */
  function templateStateFor(agent: ProjectAgentListItem) {
    if (!agent.sourceAgentId) {
      return undefined;
    }

    return {
      installedVersion: agent.installedVersion ?? 1,
      availableVersion: availableTemplateVersion(agent),
      locallyEdited: agent.locallyEdited === true,
    };
  }

  /**
   * A copy with no `installedVersion` predates versioning, so whether it diverged
   * is unknowable — the confirmation says so instead of claiming it is clean
   * (OS-1759).
   */
  function mayHaveLocalEdits(agent: ProjectAgentListItem) {
    return agent.locallyEdited === true || agent.installedVersion === undefined;
  }

  async function refreshFromTemplate(agent: ProjectAgentListItem) {
    if (!agent.sourceAgentId) {
      return;
    }

    setIsRefreshing(true);
    try {
      // The dialog is the consent, so the mutation is always told to overwrite.
      await replaceFromAgent({
        projectAgentId: agent._id,
        agentId: agent.sourceAgentId,
        overwriteLocalEdits: true,
      });
      setRefreshAgentId(null);
      const version = availableTemplateVersion(agent);
      toast.success(version === undefined ? `${agent.name} reset to its template` : `${agent.name} updated to v${version}`);
    } catch (error) {
      showConvexErrorToast(error, "Could not update the agent from its template");
    } finally {
      setIsRefreshing(false);
    }
  }

  function toggleEmptyAgentSelection(agentId: Id<"agents">, checked: boolean) {
    setSelectedEmptyAgentIds((current) => {
      if (checked) {
        return current.includes(agentId) ? current : [...current, agentId];
      }

      return current.filter((selectedAgentId) => selectedAgentId !== agentId);
    });
  }

  async function handleImportEmptyAgents() {
    if (!projectId || selectedEmptyAgentIds.length === 0) {
      return;
    }

    const selectedAgents = selectedEmptyAgentIds
      .map((agentId) => suggestedOrganizationAgents.find((agent) => agent._id === agentId))
      .filter((agent): agent is OrganizationAgentListItem => agent !== undefined);
    if (selectedAgents.length === 0) {
      return;
    }

    const total = selectedAgents.length;
    const toastId = `project-agent-empty-import-${projectId}`;
    let imported = 0;

    setIsImportingEmptyAgents(true);
    showBatchProgressToast({
      toastId,
      completed: imported,
      total,
      label: "Importing",
    });

    try {
      for (const agent of selectedAgents) {
        await copyFromAgent({ projectId, agentId: agent._id });
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
      setSelectedEmptyAgentIds([]);
    } catch (error) {
      showConvexErrorToast(error, "Could not import selected agent templates");
      toast.dismiss(toastId);
    } finally {
      setIsImportingEmptyAgents(false);
    }
  }

  const isEmptyProject = projectAgents !== undefined && projectAgentItems.length === 0;

  /** The toolbar's create group; an empty project shows it inside the empty state. */
  function creationActions(variant: "outline" | "secondary") {
    const size = variant === "outline" ? "settings" : "default";
    return (
      <ButtonGroup className="shrink-0">
        <Button type="button" variant={variant} size={size} onClick={handleCreate}>
          <Plus className="size-4" />
          New agent
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant={variant} size={size} className="px-2" aria-label="More agent creation options">
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => setTemplateOpen(true)}>
              <Library className="size-4" />
              From template
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>
              <FolderInput className="size-4" />
              From project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col space-y-5" data-testid="project-agents-section">
        {isEmptyProject && shouldLoadOrganizationAgents && organizationAgents === undefined ? (
          <ProjectAgentListSkeleton />
        ) : isEmptyProject ? (
          canManage && suggestedOrganizationAgents.length > 0 ? (
            <ProjectAgentImportEmptyState
              agents={suggestedOrganizationAgents}
              selectedAgentIds={selectedEmptyAgentIds}
              isImporting={isImportingEmptyAgents}
              creationActions={creationActions("outline")}
              onToggleAgent={toggleEmptyAgentSelection}
              onImport={handleImportEmptyAgents}
            />
          ) : (
            <EmptyState
              fill
              icon={Bot}
              title="No project agents yet"
              description={
                canManage
                  ? "Create a project agent or copy one from the organization catalog."
                  : "No project agents have been added yet."
              }
              action={canManage ? creationActions("secondary") : null}
            />
          )
        ) : (
          <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search project agents"
              aria-label="Search project agents"
              className="sm:max-w-sm"
            />
            {canManage ? creationActions("outline") : null}
          </div>

          <div className={hasCategorySidebar ? "grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]" : "grid gap-5"}>
            {hasCategorySidebar ? (
              <SettingsCatalogCategoryNav
                ariaLabel="Agent categories"
                categories={categories}
                selectedCategory={activeCategory}
                onSelectCategory={setSelectedCategory}
              />
            ) : null}

            <div className="min-w-0">
              {projectAgents === undefined ? (
                <ProjectAgentListSkeleton />
              ) : visibleProjectAgents.length > 0 ? (
                <ProjectAgentListFrame>
                  {visibleProjectAgents.map((agent) => {
                    const templateState = templateStateFor(agent);

                    return (
                      <ProjectAgentRow
                        key={agent._id}
                        agent={agent}
                        templateState={templateState}
                        href={canManage ? agentHref(agent) : undefined}
                        // A clean copy that is already current has nothing to fetch and
                        // nothing to reset, so it gets no action.
                        onRefresh={
                          canManage && templateState && (templateState.availableVersion !== undefined || mayHaveLocalEdits(agent))
                            ? () => setRefreshAgentId(agent._id)
                            : undefined
                        }
                        refreshLabel={templateState?.availableVersion === undefined ? "Reset" : "Update"}
                        onDelete={
                          canManage
                            ? () => {
                                setDeleteAgentId(agent._id);
                                setDeleteOpen(true);
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </ProjectAgentListFrame>
              ) : (
                <ProjectAgentEmptyListMessage>No project agents match this search.</ProjectAgentEmptyListMessage>
              )}
            </div>
          </div>
          </>
        )}
      </div>

      <ProjectAgentTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        projectId={projectId}
        organizationId={organizationId}
        projectAgents={projectAgentItems}
        canManage={canManage}
        onUpdate={setRefreshAgentId}
      />
      <ProjectAgentImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectId={projectId}
        organizationId={organizationId}
        projectAgents={projectAgentItems}
        canManage={canManage}
      />
      <ProjectAgentRefreshDialog
        agentName={refreshingAgent?.name ?? ""}
        knownEdited={refreshingAgent?.locallyEdited === true}
        preVersioning={refreshingAgent !== null && refreshingAgent.installedVersion === undefined}
        availableVersion={refreshingAgent ? availableTemplateVersion(refreshingAgent) : undefined}
        open={refreshingAgent !== null}
        isRefreshing={isRefreshing}
        onOpenChange={(open) => {
          if (!open) {
            setRefreshAgentId(null);
          }
        }}
        onConfirm={() => {
          if (refreshingAgent) {
            void refreshFromTemplate(refreshingAgent);
          }
        }}
      />
      <SettingsCatalogDeleteDialog
        title="Delete project agent?"
        description={`Delete ${deletingAgent?.name ?? "this agent"}? Existing task assignments will keep their stored reference.`}
        open={deleteOpen}
        onOpenChange={handleDeleteOpenChange}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </>
  );
}

/**
 * A refresh always overwrites the copy, so it is always confirmed first — a clean
 * copy included (docs/specs/agents.md#template-versions-and-refresh). With no
 * template version ahead the same overwrite is the way back, labelled `Reset`.
 */
function ProjectAgentRefreshDialog({
  agentName,
  knownEdited,
  preVersioning,
  availableVersion,
  open,
  isRefreshing,
  onOpenChange,
  onConfirm,
}: {
  agentName: string;
  knownEdited: boolean;
  preVersioning: boolean;
  availableVersion?: number;
  open: boolean;
  isRefreshing: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const action = availableVersion === undefined ? "Reset" : "Update";
  const title =
    availableVersion === undefined
      ? "Reset to the organization version?"
      : knownEdited || preVersioning
        ? "Overwrite local changes?"
        : `Update to v${availableVersion}?`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {knownEdited
              ? `${agentName} was edited in this project. `
              : preVersioning
                ? `${agentName} was installed before this project tracked template versions, so local changes cannot be detected. `
                : ""}
            Its name, description, prompt, category and appearance are replaced with the organization template
            {availableVersion === undefined ? "" : ` v${availableVersion}`}, and this cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRefreshing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isRefreshing}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProjectAgentImportEmptyState({
  agents,
  selectedAgentIds,
  isImporting,
  creationActions,
  onToggleAgent,
  onImport,
}: {
  agents: OrganizationAgentListItem[];
  selectedAgentIds: Id<"agents">[];
  isImporting: boolean;
  creationActions: ReactNode;
  onToggleAgent: (agentId: Id<"agents">, checked: boolean) => void;
  onImport: () => void;
}) {
  return (
    <EmptyState
      fill
      icon={Library}
      title="Import organization agents"
      description="This project does not have agents yet. Select templates from your organization to copy into this project."
      actionClassName="w-full max-w-xl text-left"
      action={
        <>
          <div className="border-y divide-y">
            {agents.map((agent) => (
              <ProjectAgentRow
                key={agent._id}
                agent={agent}
                templateState={{ templateVersion: agent.version }}
                action={
                  <Checkbox
                    aria-label={`Select ${agent.name}`}
                    className="size-5 cursor-pointer"
                    checked={selectedAgentIds.includes(agent._id)}
                    disabled={isImporting}
                    onCheckedChange={(checked) => onToggleAgent(agent._id, checked === true)}
                  />
                }
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
            {creationActions}
            <Button type="button" size="settings" disabled={selectedAgentIds.length === 0 || isImporting} onClick={onImport}>
              <ArrowDownToLine className="size-4" />
              Import
            </Button>
          </div>
        </>
      }
    />
  );
}
