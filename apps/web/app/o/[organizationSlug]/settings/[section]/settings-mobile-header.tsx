"use client";

import { MobileSettingsSectionHeader } from "@/components/blocks/mobile/mobile-settings-section-header";
import { getOrganizationSettingsNavItems } from "@/components/blocks/organization/settings/organization-settings-navigation";
import { useDevSettings } from "@/lib/dev-mode/use-dev-mode";
import {
  ORGANIZATION_SETTINGS_SECTION_LABELS,
  type OrganizationSettingsSection,
} from "@/lib/navigation";

export function SettingsMobileHeader({
  organizationSlug,
  activeSection,
}: {
  organizationSlug: string;
  activeSection: OrganizationSettingsSection;
}) {
  const devSettings = useDevSettings();

  return (
    <MobileSettingsSectionHeader
      title={ORGANIZATION_SETTINGS_SECTION_LABELS[activeSection]}
      items={getOrganizationSettingsNavItems(
        organizationSlug,
        activeSection,
        devSettings
      )}
      className="mb-8"
    />
  );
}
