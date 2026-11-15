import {
  isOrganizationSettingsSection,
  isProjectSettingsSection,
  type OrganizationSettingsSection,
  type ProjectSettingsSection,
} from "@/lib/navigation";

export { isOrganizationSettingsSection };

export interface OrganizationSettingsSidebarState {
  section: OrganizationSettingsSection | null;
}

export interface ProjectSettingsSidebarState {
  projectAlias: string | null;
  section: ProjectSettingsSection | null;
}

function normalizePathname(pathname: string): string {
  if (!pathname) {
    return "/";
  }

  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

export function deriveOrganizationSettingsSidebarState(
  pathname: string,
  organizationSlug: string
): OrganizationSettingsSidebarState {
  const normalizedPathname = normalizePathname(pathname);
  const segments = normalizedPathname.split("/").filter(Boolean);

  if (
    segments[0] !== "o" ||
    segments[1] !== organizationSlug ||
    segments[2] !== "settings" ||
    segments.length < 4
  ) {
    return { section: null };
  }

  const section = segments[3];
  return {
    section: isOrganizationSettingsSection(section) ? section : null,
  };
}

// Project settings routes are /o/{slug}/{projectAlias}/settings/{section}.
export function deriveProjectSettingsSidebarState(
  pathname: string,
  organizationSlug: string
): ProjectSettingsSidebarState {
  const normalizedPathname = normalizePathname(pathname);
  const segments = normalizedPathname.split("/").filter(Boolean);

  if (
    segments[0] !== "o" ||
    segments[1] !== organizationSlug ||
    segments[3] !== "settings" ||
    segments.length < 5
  ) {
    return { projectAlias: null, section: null };
  }

  const section = segments[4];
  return {
    projectAlias: segments[2],
    section: isProjectSettingsSection(section) ? section : null,
  };
}
