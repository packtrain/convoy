import {
  isOrganizationSettingsSection,
  ORGANIZATION_SETTINGS_SECTION_LABELS,
} from "@/lib/navigation";
import { notFound } from "@/lib/navigation/server";
import {
  SettingsPageContainer,
  SettingsPageHeader,
} from "@/components/custom/settings-layout";
import { SettingsMobileHeader } from "./settings-mobile-header";
import { SettingsPageContent } from "./settings-page-content";

export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; section: string }>;
}) {
  const { organizationSlug, section } = await params;

  if (!isOrganizationSettingsSection(section)) {
    notFound();
  }

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col items-center px-6 pb-24 pt-10 md:pb-6 md:pt-12">
      <SettingsPageContainer className="flex flex-1 flex-col">
        <SettingsMobileHeader
          organizationSlug={organizationSlug}
          activeSection={section}
        />
        <SettingsPageHeader
          title={ORGANIZATION_SETTINGS_SECTION_LABELS[section]}
          className="mb-8 hidden md:block"
        />
        <SettingsPageContent section={section} />
      </SettingsPageContainer>
    </main>
  );
}
