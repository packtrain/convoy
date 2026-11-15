import { useEffect } from "react";
import { appRoute, useNavigation } from "@/lib/navigation";
import { getLastProjectAlias, setLastProjectAlias } from "./last-project-storage";

export function useLastProject(
  orgSlug: string,
  projectAlias: string | null
): void {
  useEffect(() => {
    if (projectAlias) {
      setLastProjectAlias(orgSlug, projectAlias);
    }
  }, [orgSlug, projectAlias]);
}

export function useRedirectToLastProject(
  orgSlug: string,
  projects: Array<{ alias: string }> | undefined
): void {
  const navigation = useNavigation();

  useEffect(() => {
    if (projects && projects.length > 0) {
      const lastAlias = getLastProjectAlias(orgSlug);
      const target =
        (lastAlias && projects.find((p) => p.alias === lastAlias)) ||
        projects[0];
      navigation.replace(appRoute.project(orgSlug, target.alias));
    }
  }, [navigation, projects, orgSlug]);
}
