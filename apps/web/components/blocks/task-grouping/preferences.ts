import { useCallback, useMemo, useState } from "react";
import { readLocalJson, writeLocalJson } from "@/lib/browser/local-storage";

export function readCollapsedGroups(scope: string): Set<string> {
  const value = readLocalJson(`task-grouping:${scope}`);
  return new Set(
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [],
  );
}
export function writeCollapsedGroups(
  scope: string,
  groups: ReadonlySet<string>,
): void {
  writeLocalJson(`task-grouping:${scope}`, [...groups]);
}

/** Collapsed group ids for one scope, persisted in browser preferences. */
export function useCollapsedGroups(scope: string) {
  const [stored, setStored] = useState(() => ({
    scope,
    collapsed: readCollapsedGroups(scope),
  }));
  const collapsed = useMemo(
    () => (stored.scope === scope ? stored.collapsed : readCollapsedGroups(scope)),
    [scope, stored],
  );
  const replace = useCallback((next: Set<string>) => {
    writeCollapsedGroups(scope, next);
    setStored({ scope, collapsed: next });
  }, [scope]);
  const toggle = useCallback((groupId: string) => {
    const next = new Set(collapsed);
    if (!next.delete(groupId)) next.add(groupId);
    replace(next);
  }, [collapsed, replace]);
  return { collapsed, replace, toggle };
}
