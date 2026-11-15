/**
 * Which Checks a task shows. Pure, so the web's optimistic task-type update derives the
 * same rows `getForTask` will (docs/specs/task-checks.md → Which Checks apply).
 */

type CatalogEntry = { key: string; label: string; instruction: string };

/** The checklist a task type defaults to, if any. */
export function findTaskTypeDefault<T extends { taskTypeKeys: string[] }>(checklists: T[], taskTypeKey: string): T | null {
  return checklists.find((checklist) => checklist.taskTypeKeys.includes(taskTypeKey)) ?? null;
}

/** The checklist's Checks in order, then every other Check that has a result. */
export function deriveCheckRows<R>(
  checklistKeys: string[],
  catalog: CatalogEntry[],
  reported: { key: string; label: string; results: R[] }[]
) {
  const definitions = new Map(catalog.map((definition) => [definition.key, definition]));
  const inChecklist = new Set(checklistKeys.filter((key) => definitions.has(key)));
  const byKey = new Map(reported.map((check) => [check.key, check]));
  const keys = [...inChecklist, ...[...byKey.keys()].filter((key) => !inChecklist.has(key))];
  return keys.map((key) => {
    const definition = definitions.get(key);
    const check = byKey.get(key);
    return {
      key,
      label: definition?.label ?? check?.label ?? key,
      instruction: definition?.instruction ?? "",
      added: !inChecklist.has(key),
      results: check?.results ?? [],
    };
  });
}

type TaskChecksLike = {
  checklists: { _id: string; isDefault: boolean; checkKeys: string[]; taskTypeKeys: string[] }[];
  checklistId: string | null;
  followsTypeDefault: boolean;
  catalog: CatalogEntry[];
  checks: { key: string; label: string; results: unknown[] }[];
};

/** `getForTask`'s answer after the task's type changes to `taskTypeKey`. */
export function retypeTaskChecks<T extends TaskChecksLike>(data: T, taskTypeKey: string): T {
  const typeDefault = findTaskTypeDefault(data.checklists, taskTypeKey);
  const checklists = data.checklists.map((checklist) => ({ ...checklist, isDefault: checklist._id === typeDefault?._id }));
  if (!data.followsTypeDefault) return { ...data, checklists };
  const reported = data.checks.filter((check) => check.results.length > 0);
  return {
    ...data,
    checklists,
    checklistId: typeDefault?._id ?? null,
    checks: deriveCheckRows(typeDefault?.checkKeys ?? [], data.catalog, reported),
  };
}
