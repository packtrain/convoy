"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRedirectToLastProject } from "@/lib/routing/use-last-project";
import { FolderKanban, Plus } from "lucide-react";
import { ProjectDialog, type ProjectDialogData } from "@/components/blocks/project/project-dialog";
import { Button } from "@/components/ui/button";
import { Centered } from "@/components/custom/centered";
import { EmptyState } from "@/components/custom/empty-state";
import { useDialogWithData } from "@/hooks/ui/use-dialog";
import { OrgPermission, hasOrgPermission } from "@/lib/authz/permissions";
import { useRouteParams } from "@/lib/navigation";
import { Spinner } from "@/components/custom/spinner";

export default function OrganizationPage() {
  const params = useRouteParams<{ organizationSlug: string }>();
  const organizationSlug = params.organizationSlug;

  // Get org by slug to get the ID for querying projects
  const org = useQuery(api.organizations.core.getBySlug, { slug: organizationSlug });

  const allProjects = useQuery(api.projects.core.listByOrganization, org ? { organizationId: org._id } : "skip");
  // Never land on an archived project (docs/specs/project-archive.md).
  const projects = useMemo(() => allProjects?.filter((project) => !project.isArchived), [allProjects]);
  const myRole = useQuery(api.organizations.members.getMyRole, org ? { organizationId: org._id } : "skip");
  const projectDialog = useDialogWithData<ProjectDialogData>();
  const canCreate = hasOrgPermission(myRole, OrgPermission.PROJECT_CREATE);

  useRedirectToLastProject(organizationSlug, projects);

  // Loading state
  if (org === undefined || projects === undefined) {
    return (
      <Centered>
        <Spinner size="large" text="Loading…" />
      </Centered>
    );
  }

  // Empty state - no projects
  if (projects.length === 0) {
    return (
      <>
        <EmptyState
          fill
          icon={FolderKanban}
          title="No projects yet"
          description="Create a project to start organizing tasks and members."
          action={
            canCreate && org ? (
              <Button onClick={() => projectDialog.open({})}>
                <Plus className="size-4" />
                Create project
              </Button>
            ) : null
          }
        />
        {org ? <ProjectDialog organizationId={org._id} dialog={projectDialog} /> : null}
      </>
    );
  }

  // Redirecting state (projects exist but redirect hasn't happened yet)
  return (
    <Centered>
      <Spinner size="large" text="Redirecting" />
    </Centered>
  );
}
