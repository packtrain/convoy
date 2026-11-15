interface ResolveCreateTaskListRefArgs {
  activeProjectAlias: string | null;
  selectedProjectAlias: string;
  activeListRef: string | null | undefined;
}

export function resolveCreateTaskListRef({
  activeProjectAlias,
  selectedProjectAlias,
  activeListRef,
}: ResolveCreateTaskListRefArgs): string | undefined {
  if (activeProjectAlias !== selectedProjectAlias) {
    return undefined;
  }

  const normalizedListRef = activeListRef?.trim().toUpperCase();
  return normalizedListRef || undefined;
}
