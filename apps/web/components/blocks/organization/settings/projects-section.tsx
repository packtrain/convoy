"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Ellipsis, FolderKanban, Hash, Plus, Settings, Trash2 } from "lucide-react";

import { ProjectDialog, type ProjectDialogData } from "@/components/blocks/project/project-dialog";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Empty, EmptyState } from "@/components/custom/empty-state";
import { SearchInput } from "@/components/custom/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useDialogWithData } from "@/hooks/ui/use-dialog";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrgPermission, hasOrgPermission } from "@/lib/authz/permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";

type OrgManagedProject = {
  _id: Id<"projects">;
  name: string;
  alias: string;
  color?: string;
  isArchived: boolean;
  createdAt: number;
  creator: { name: string } | null;
};

export function ProjectsSection({
  organizationId,
  organizationSlug,
}: {
  organizationId: Id<"organizations">;
  organizationSlug: string;
}) {
  const navigation = useNavigation();
  const projectDialog = useDialogWithData<ProjectDialogData>();
  const [projectToDelete, setProjectToDelete] = useState<OrgManagedProject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [search, setSearch] = useState("");

  const projects = useQuery(api.projects.core.listAllForOrganization, {
    organizationId,
  });
  const myRole = useQuery(api.organizations.members.getMyRole, {
    organizationId,
  });
  const deleteProject = useMutation(api.projects.core.remove);

  const canManage = hasOrgPermission(myRole, OrgPermission.PROJECTS_MANAGE_ALL);
  const canCreate = hasOrgPermission(myRole, OrgPermission.PROJECT_CREATE);
  const canDelete = hasOrgPermission(myRole, OrgPermission.PROJECT_DELETE);

  async function handleDelete() {
    if (!projectToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteProject({ id: projectToDelete._id });
      setProjectToDelete(null);
    } catch (error) {
      showConvexErrorToast(error, "Failed to delete project");
    } finally {
      setIsDeleting(false);
    }
  }

  const query = search.trim().toLowerCase();
  const visibleProjects = (projects ?? []).filter((project) =>
    `${project.name} ${project.alias}`.toLowerCase().includes(query)
  );

  if (projects === undefined || myRole === undefined) {
    return <ProjectsSectionSkeleton />;
  }

  if (!canManage) {
    return (
      <Empty variant="dashed">Only organization owners and admins can manage projects.</Empty>
    );
  }

  return (
    <section className="flex flex-1 flex-col space-y-5" data-testid="organization-projects-section">
      {projects.length === 0 ? (
        <EmptyState
          fill
          icon={FolderKanban}
          title="No projects yet"
          description="Create a project to start organizing tasks and members."
          action={
            canCreate ? (
              <Button variant="secondary" onClick={() => projectDialog.open({})}>
                <Plus className="size-4" />
                Create project
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
              className="sm:max-w-sm"
            />
            {canCreate ? (
              <Button variant="outline" size="settings" onClick={() => projectDialog.open({})}>
                <Plus className="size-4" />
                New project
              </Button>
            ) : null}
          </div>

          {visibleProjects.length === 0 ? (
            <Empty variant="dashed">No projects match this search.</Empty>
          ) : (
            <SettingsCatalogListFrame>
              {visibleProjects.map((project) => (
                <ProjectRow
                  key={project._id}
                  project={project}
                  onOpen={() =>
                    navigation.push(
                      appRoute.organizationProjectDetail(organizationSlug, project._id)
                    )
                  }
                  onDelete={canDelete ? () => setProjectToDelete(project) : undefined}
                />
              ))}
            </SettingsCatalogListFrame>
          )}
        </>
      )}

      <ProjectDialog organizationId={organizationId} dialog={projectDialog} />

      <ConfirmDialog
        open={projectToDelete !== null}
        onClose={() => setProjectToDelete(null)}
        title="Delete project"
        description={`Are you sure you want to delete "${projectToDelete?.name}"? This action cannot be undone.`}
        busy={isDeleting}
        confirm={{
          label: "Delete",
          variant: "destructive",
          onClick: handleDelete,
          autoCloseOnClick: false,
        }}
        cancel={{ label: "Cancel" }}
      />
    </section>
  );
}

function ProjectRow({
  project,
  onOpen,
  onDelete,
}: {
  project: OrgManagedProject;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex w-full items-stretch transition-colors hover:bg-muted/50">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${project.name}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Hash
          className="size-4 shrink-0"
          strokeWidth={1}
          style={project.color ? { color: project.color } : undefined}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-medium">{project.name}</h3>
            <Badge variant="outline" className="shrink-0 font-mono text-xs">
              {project.alias}
            </Badge>
            {project.isArchived ? (
              <Badge variant="secondary" className="shrink-0">
                Archived
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {project.creator ? `created by ${project.creator.name}, ` : "created "}
            {formatDistanceToNow(project.createdAt, { addSuffix: true })}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 items-center py-4 pr-4 pl-0">
        <ProjectRowMenu projectName={project.name} onOpen={onOpen} onDelete={onDelete} />
      </div>
    </div>
  );
}

function ProjectRowMenu({
  projectName,
  onOpen,
  onDelete,
}: {
  projectName: string;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label={`${projectName} actions`}
          className="shrink-0 text-muted-foreground"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onOpen}>
          <Settings className="size-4" />
          Manage
        </DropdownMenuItem>
        {onDelete ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectsSectionSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-full max-w-sm rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>
      <SettingsCatalogListFrame>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 p-4">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 rounded-sm" />
              <Skeleton className="h-3 w-56 max-w-full rounded-sm" />
            </div>
            <Skeleton className="size-8 shrink-0 rounded-md" />
          </div>
        ))}
      </SettingsCatalogListFrame>
    </div>
  );
}
