"use client";

import { useQuery } from "convex/react";

import { GeneralSection } from "@/components/blocks/organization/settings/general-section";
import { MembersSection } from "@/components/blocks/organization/settings/members-section";
import { ProjectsSection } from "@/components/blocks/organization/settings/projects-section";
import { DangerSection } from "@/components/blocks/organization/settings/danger-section";
import { AgentsSection } from "@/components/blocks/organization/settings/agents/agents-section";
import { SlashCommandsSection } from "@/components/blocks/organization/settings/prompts/slash-commands-section";
import { SkillsSection } from "@/components/blocks/organization/settings/skills/skills-section";
import { SettingsTwoColumnSection } from "@/components/custom/settings-layout";
import { api } from "@/convex/_generated/api";
import {
  appRoute,
  useNavigation,
  type OrganizationSettingsSection,
} from "@/lib/navigation";
import { useCurrentOrgProject } from "@/lib/routing/current-org-project-context";

export function SettingsPageContent({
  section,
}: {
  section: OrganizationSettingsSection;
}) {
  const navigation = useNavigation();
  const { organizationId, organizationSlug } = useCurrentOrgProject();
  const organization = useQuery(api.organizations.core.getById, {
    id: organizationId,
  });

  if (section === "members") {
    return (
      <MembersSection
        organizationId={organizationId}
        organization={organization}
      />
    );
  }

  if (section === "projects") {
    return (
      <ProjectsSection
        organizationId={organizationId}
        organizationSlug={organizationSlug}
      />
    );
  }

  if (section === "prompts") {
    return (
      <SlashCommandsSection
        organizationId={organizationId}
        organizationSlug={organizationSlug}
      />
    );
  }

  if (section === "agents") {
    return (
      <AgentsSection
        organizationId={organizationId}
        organizationSlug={organizationSlug}
      />
    );
  }

  if (section === "skills") {
    return (
      <SkillsSection
        organizationId={organizationId}
        organizationSlug={organizationSlug}
      />
    );
  }

  return (
    <div className="space-y-8">
      <SettingsTwoColumnSection
        title="Organization"
        description="Name, URL, and workspace color."
      >
        <GeneralSection
          organization={organization}
          onSlugChanged={(newSlug) => {
            navigation.replace(appRoute.organizationSettings(newSlug, "general"));
          }}
        />
      </SettingsTwoColumnSection>

      <SettingsTwoColumnSection
        title="Danger zone"
        description="Actions that cannot be undone."
        tone="danger"
        className="border-b-0 pb-0"
      >
        <DangerSection
          organizationId={organizationId}
          organization={organization}
          onOrganizationLeft={() => undefined}
        />
      </SettingsTwoColumnSection>
    </div>
  );
}
