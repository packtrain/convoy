import { readLocalJson, removeLocalValue, writeLocalJson } from "@/lib/browser/local-storage";

const STORAGE_KEY = "convoy.project-sidebar.collapsed-projects.v1";

export function loadCollapsedProjectIds(): Set<string> {
  const value = readLocalJson(STORAGE_KEY);
  if (!Array.isArray(value)) {
    return new Set();
  }

  return new Set(value.filter((id): id is string => typeof id === "string"));
}

export function saveCollapsedProjectIds(projectIds: Set<string>): void {
  if (projectIds.size === 0) {
    removeLocalValue(STORAGE_KEY);
    return;
  }

  writeLocalJson(STORAGE_KEY, [...projectIds]);
}

export const projectListCollapseStorageKey = STORAGE_KEY;
