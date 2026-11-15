export type ProjectRouteSection =
  | "list"
  | "kanban"
  | "threads"
  | "watch-tower"
  | "pull-requests"
  | "artifacts"
  | "other"
  | null;

export interface ProjectRouteState {
  activeProjectAlias: string | null;
  activeSection: ProjectRouteSection;
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

export function deriveProjectRouteState(
  pathname: string,
  organizationSlug: string
): ProjectRouteState {
  const normalizedPathname = normalizePathname(pathname);
  const segments = normalizedPathname.split("/").filter(Boolean);

  if (
    segments[0] !== "o" ||
    segments[1] !== organizationSlug ||
    segments.length < 3
  ) {
    return {
      activeProjectAlias: null,
      activeSection: null,
    };
  }

  const activeProjectAlias = segments[2];
  const section = segments[3];

  if (!section) {
    return {
      activeProjectAlias,
      activeSection: "list",
    };
  }

  if (
    section === "kanban" ||
    section === "threads" ||
    section === "artifacts" ||
    section === "watch-tower" ||
    section === "pull-requests"
  ) {
    return {
      activeProjectAlias,
      activeSection: section,
    };
  }

  return {
    activeProjectAlias,
    activeSection: "other",
  };
}
