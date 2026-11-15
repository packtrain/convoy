"use client";

import { use, useEffect, type ReactNode } from "react";
import { deriveProjectSettingsSidebarState } from "@/components/blocks/sidebar/app-sidebar-route-state";
import { useProjectSettingsAccess } from "@/components/blocks/project/settings/use-project-settings-access";
import { Centered } from "@/components/custom/centered";
import { Skeleton } from "@/components/ui/skeleton";
import { appRoute, useNavigation, useNavigationLocation } from "@/lib/navigation";

/**
 * Blocks sections and editor routes the caller may not open, deep links included
 * (docs/specs/read-only-viewer-ux.md#settings-sidebar-and-mobile-chrome-slice-6-os-1546).
 */
export default function ProjectSettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationSlug: string; projectAlias: string }>;
}) {
  const { organizationSlug, projectAlias } = use(params);
  const navigation = useNavigation();
  const { pathname } = useNavigationLocation();
  const { section } = deriveProjectSettingsSidebarState(pathname, organizationSlug);
  const { isLoading, canOpenSection } = useProjectSettingsAccess(
    organizationSlug,
    projectAlias
  );
  const isBlocked = section !== null && !canOpenSection(section);
  const shouldRedirect = isBlocked && !isLoading;

  useEffect(() => {
    if (shouldRedirect) {
      navigation.replace(
        appRoute.projectSettings(organizationSlug, projectAlias, "general")
      );
    }
  }, [navigation, organizationSlug, projectAlias, shouldRedirect]);

  if (isBlocked) {
    return (
      <Centered>
        <Skeleton className="h-8 w-32" />
      </Centered>
    );
  }

  return children;
}
