"use client";

import { MobileSettingsSectionHeader } from "@/components/blocks/mobile/mobile-settings-section-header";
import { getProjectSettingsNavItems } from "@/components/blocks/project/settings/project-settings-navigation";
import { useProjectSettingsAccess } from "@/components/blocks/project/settings/use-project-settings-access";
import { useDevSettings } from "@/lib/dev-mode/use-dev-mode";
import type { ProjectSettingsSection } from "@/lib/navigation";

export function ProjectSettingsMobileHeader({
  organizationSlug,
  projectAlias,
  activeSection,
}: {
  organizationSlug: string;
  projectAlias: string;
  activeSection: ProjectSettingsSection;
}) {
  const devSettings = useDevSettings();
  const { canOpenSection } = useProjectSettingsAccess(organizationSlug, projectAlias);
  const items = getProjectSettingsNavItems({
    organizationSlug,
    projectAlias,
    activeSection,
    devSettings,
    canOpenSection,
  });
  const activeLabel =
    items.find((item) => item.id === activeSection)?.label ?? "Settings";

  return (
    <MobileSettingsSectionHeader
      title={activeLabel}
      items={items}
      className="mb-6"
    />
  );
}
