import {
  PROJECT_SETTINGS_SECTION_DESCRIPTIONS,
  PROJECT_SETTINGS_SECTION_LABELS,
} from "@/components/blocks/project/settings/project-settings-config";
import {
  SettingsPageContainer,
  SettingsPageHeader,
} from "@/components/custom/settings-layout";
import { isProjectSettingsSection } from "@/lib/navigation";
import { notFound } from "@/lib/navigation/server";
import { ProjectSettingsMobileHeader } from "./settings-mobile-header";
import { ProjectSettingsPageContent } from "./settings-page-content";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{
    organizationSlug: string;
    projectAlias: string;
    section: string;
  }>;
}) {
  const { organizationSlug, projectAlias, section } = await params;

  if (!isProjectSettingsSection(section)) {
    notFound();
  }

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col items-center px-6 pb-24 pt-10 md:pb-6 md:pt-12">
      <SettingsPageContainer className="flex flex-1 flex-col">
        <ProjectSettingsMobileHeader
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          activeSection={section}
        />
        <SettingsPageHeader
          title={PROJECT_SETTINGS_SECTION_LABELS[section]}
          description={PROJECT_SETTINGS_SECTION_DESCRIPTIONS[section]}
          className="mb-8 hidden md:block"
        />
        <ProjectSettingsPageContent
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          section={section}
        />
      </SettingsPageContainer>
    </main>
  );
}
