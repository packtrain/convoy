import type { SubpageNavigationItem } from "@/components/custom/subpage-navigation";
import { appRoute, type ProjectSettingsSection } from "@/lib/navigation";
import type { DevSettingsSnapshot } from "@/lib/dev-mode/use-dev-mode";
import {
  isSectionAvailable,
  PROJECT_SETTINGS_NAV_ITEM_CONFIG,
  type SectionId,
} from "./project-settings-config";

/**
 * Builds the project settings sidebar subpage navigation, mirroring the
 * organization settings nav. Sections the caller may not open are hidden.
 * Dev-gated ones not currently available are hidden, or disabled under `showUnfinishedItems`.
 */
export function getProjectSettingsNavItems({
  organizationSlug,
  projectAlias,
  activeSection,
  devSettings,
  canOpenSection,
}: {
  organizationSlug: string;
  projectAlias: string;
  activeSection: ProjectSettingsSection | null;
  devSettings: DevSettingsSnapshot;
  canOpenSection: (section: SectionId) => boolean;
}): SubpageNavigationItem[] {
  return PROJECT_SETTINGS_NAV_ITEM_CONFIG.flatMap((section) => {
    if (!canOpenSection(section.id)) return [];
    if (!isSectionAvailable(section, devSettings)) {
      if (!devSettings.showUnfinishedItems) return [];
      return {
        id: section.id,
        label: section.label,
        icon: section.icon,
        disabled: true as const,
        isActive: false,
      };
    }

    return {
      id: section.id,
      label: section.label,
      icon: section.icon,
      href: appRoute.projectSettings(organizationSlug, projectAlias, section.id),
      isActive: activeSection === section.id,
    };
  });
}
