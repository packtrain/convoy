"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import {
  OrganizationProjectForm,
  type OrganizationProjectFormValues,
} from "./organization-project-form";
import { MembersSection } from "@/components/blocks/project/settings/members-section";
import {
  SettingsPageContainer,
  SettingsPageHeader,
  SettingsTwoColumnSection,
} from "@/components/custom/settings-layout";
import { NotFoundState } from "@/components/blocks/not-found-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";
import { useCurrentOrgProject } from "@/lib/routing/current-org-project-context";

const PAGE_CLASSNAME =
  "flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12";

export function OrganizationProjectDetailPage({
  projectId,
}: {
  projectId: string;
}) {
  const navigation = useNavigation();
  const { organizationId, organizationSlug } = useCurrentOrgProject();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const project = useQuery(api.projects.core.getForOrganizationManagement, {
    projectId: projectId as Id<"projects">,
  });
  const updateProject = useMutation(api.projects.core.update);
  const updateAlias = useMutation(api.projects.core.updateAlias);

  const backTarget = appRoute.organizationProjects(organizationSlug);
  const initialValues = useMemo<OrganizationProjectFormValues>(
    () => ({
      name: project?.name ?? "",
      alias: project?.alias ?? "",
      description: project?.description ?? "",
      color: project?.color ?? null,
    }),
    [project]
  );

  function goBack() {
    navigation.push(backTarget);
  }

  async function handleSubmit(values: OrganizationProjectFormValues) {
    if (!project) {
      return;
    }

    setIsSubmitting(true);
    try {
      await updateProject({
        id: project._id,
        name: values.name,
        description: values.description?.trim() || undefined,
        color: values.color,
      });
      // Alias lives behind its own mutation (uniqueness check + ref impact), so
      // only call it when it actually changed.
      if (values.alias !== project.alias) {
        await updateAlias({ id: project._id, alias: values.alias });
      }
      toast.success("Project updated");
    } catch (error) {
      showConvexErrorToast(error, "Failed to update project");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (project === undefined) {
    return (
      <main className={PAGE_CLASSNAME}>
        <SettingsPageContainer className="flex flex-1 flex-col gap-6">
          <Skeleton className="h-9 w-64 rounded-md" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </SettingsPageContainer>
      </main>
    );
  }

  // Null covers "not found", "deleted", and "no org authority" alike — a caller
  // without the permission must not learn whether this project exists.
  if (project === null) {
    return (
      <main className={PAGE_CLASSNAME}>
        <NotFoundState
          title="Project not found"
          action={
            <Button type="button" variant="outline" onClick={goBack}>
              Back to projects
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <main
      className={PAGE_CLASSNAME}
      data-testid="organization-project-detail-page"
      data-project-id={project._id}
    >
      <SettingsPageContainer className="flex flex-1 flex-col gap-6">
        <SettingsPageHeader
          title="Edit project"
          backLink={{ href: backTarget, label: "Back to projects" }}
        />

        <OrganizationProjectForm
          initialValues={initialValues}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
        />

        <SettingsTwoColumnSection
          title="Members"
          description="Who has access to this project and what they can do."
          className="border-b-0 pb-0"
        >
          <MembersSection
            projectId={project._id}
            organizationId={organizationId}
            canManage
          />
        </SettingsTwoColumnSection>
      </SettingsPageContainer>
    </main>
  );
}
