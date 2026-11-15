const MAX_TASK_TITLE_LENGTH = 20;

function trimTaskTitle(taskTitle: string): string {
  const trimmed = taskTitle.trim();
  if (trimmed.length <= MAX_TASK_TITLE_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_TASK_TITLE_LENGTH - 3).trimEnd()}...`;
}

export function getArchiveUndoToastMessage(
  archivedCount: number,
  singleTaskTitle?: string
): string {
  if (archivedCount === 1) {
    if (!singleTaskTitle || singleTaskTitle.trim().length === 0) {
      return "Task archived.";
    }

    return `Task "${trimTaskTitle(singleTaskTitle)}" archived.`;
  }

  return `${archivedCount} tasks archived.`;
}
