"use client";

import { useQuery } from "convex/react";
import { useAppConvexAuth } from "@/lib/auth/hooks";

import { GeneralSection } from "@/components/blocks/project/settings/general-section";
import { MembersSection } from "@/components/blocks/project/settings/members-section";
import { ProjectAgentsSection } from "@/components/blocks/project/settings/project-agents-section";
import { SlashCommandsSection } from "@/components/blocks/organization/settings/prompts/slash-commands-section";
import { SkillsSection } from "@/components/blocks/organization/settings/skills/skills-section";
import { WorkflowsSection } from "@/components/blocks/project/settings/workflows-section";
import { ListsSection } from "@/components/blocks/project/settings/lists-section";
import { LabelsSection } from "@/components/blocks/project/settings/labels-section";
import { ChecksSettingsSection } from "@/components/blocks/checks";
import {
  AutomationsSection,
  CustomizationSection,
  ImportExportSection,
  RecurringTasksSection,
  TemplatesSection,
} from "@/components/blocks/project/settings/project-settings-sections";
import { ProjectIntegrationsPage } from "@/components/blocks/integrations";
import { DangerZoneSection } from "@/components/blocks/project/settings/danger-section";
import { ProjectUsageDashboard } from "@/components/blocks/project/usage/project-usage-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { appRoute, useNavigation, type ProjectSettingsSection } from "@/lib/navigation";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { useDevSettings } from "@/lib/dev-mode/use-dev-mode";
import { resolveAvailableSectionId } from "@/components/blocks/project/settings/project-settings-config";

export function ProjectSettingsPageContent({
  organizationSlug,
  projectAlias,
  section: requestedSection,
}: {
  organizationSlug: string;
  projectAlias: string;
  section: ProjectSettingsSection;
}) {
  const navigation = useNavigation();
  const { isAuthenticated } = useAppConvexAuth();
  const devSettings = useDevSettings();
  // A gated section reached directly (deep link, back/forward) while its dev
  // toggle is off falls back to General instead of rendering gated content.
  const section = resolveAvailableSectionId(requestedSection, devSettings);

  const org = useQuery(api.organizations.core.getBySlug, isAuthenticated ? { slug: organizationSlug } : "skip");
  const project = useQuery(api.projects.core.getByAlias, org ? { organizationId: org._id, alias: projectAlias } : "skip");
  const projectId = project?._id ?? null;
  const organizationId = org?._id ?? null;
  const { canEditProject, canManageProjectAgents, canManageWorkflows } = useProjectPermissions(projectId);

  if (section === "general") {
    return (
      <GeneralSection
        project={project ?? null}
        canEdit={canEditProject}
        onAliasChanged={(newAlias) => {
          navigation.replace(appRoute.projectSettings(organizationSlug, newAlias, "general"));
        }}
      />
    );
  }

  if (section === "members") {
    if (!projectId || !organizationId) {
      return null;
    }
    return <MembersSection projectId={projectId} organizationId={organizationId} />;
  }

  if (section === "agents") {
    return (
      <ProjectAgentsSection
        projectId={projectId}
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
        canManage={canManageProjectAgents}
      />
    );
  }

  if (section === "prompts") {
    if (!projectId || !organizationId) {
      return null;
    }

    return (
      <SlashCommandsSection
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        projectId={projectId}
        projectAlias={projectAlias}
      />
    );
  }

  if (section === "skills") {
    if (!projectId || !organizationId) {
      return null;
    }

    return (
      <SkillsSection
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        projectId={projectId}
        projectAlias={projectAlias}
      />
    );
  }

  if (section === "workflows") {
    return (
      <WorkflowsSection
        projectId={projectId}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
        canManage={canManageWorkflows}
      />
    );
  }

  if (section === "lists") {
    return <ListsSection projectId={projectId} project={project ?? null} organizationSlug={organizationSlug} projectAlias={projectAlias} />;
  }

  if (section === "labels") {
    return <LabelsSection projectId={projectId} canEdit={canEditProject} />;
  }

  if (section === "checks") {
    return <ChecksSettingsSection projectId={projectId} canEdit={canEditProject} />;
  }

  if (section === "customization") {
    return (
      <CustomizationSection project={project ?? null} canEdit={canEditProject} organizationId={organizationId} devSettings={devSettings} />
    );
  }

  if (section === "templates") {
    return <TemplatesSection />;
  }
  if (section === "recurring") {
    return <RecurringTasksSection />;
  }
  if (section === "automations") {
    return <AutomationsSection />;
  }
  if (section === "integrations") {
    return <ProjectIntegrationsPage organizationSlug={organizationSlug} projectAlias={projectAlias} />;
  }
  if (section === "import-export") {
    return <ImportExportSection />;
  }

  if (section === "usage") {
    return (
      <div className="flex flex-1 flex-col space-y-6">
        {projectId ? (
          <ProjectUsageDashboard projectId={projectId} organizationSlug={organizationSlug} projectAlias={projectAlias} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-72 rounded-lg" />
          </div>
        )}
      </div>
    );
  }

  return <DangerZoneSection project={project ?? null} organizationId={organizationId} organizationSlug={organizationSlug} />;
}
