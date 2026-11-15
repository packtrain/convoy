const MAX_TASK_TITLE_LENGTH = 20;

function trimTaskTitle(taskTitle: string): string {
  const trimmed = taskTitle.trim();
  if (trimmed.length <= MAX_TASK_TITLE_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_TASK_TITLE_LENGTH - 3).trimEnd()}...`;
}

export function getDeleteUndoToastMessage(
  deletedCount: number,
  singleTaskTitle?: string
): string {
  if (deletedCount === 1) {
    if (!singleTaskTitle || singleTaskTitle.trim().length === 0) {
      return "Task deleted.";
    }

    return `Task "${trimTaskTitle(singleTaskTitle)}" deleted.`;
  }

  return `${deletedCount} tasks deleted.`;
}

export async function restoreDeletedTasks(
  deletedIds: string[],
  restoreTask: (id: string) => Promise<void>
): Promise<{ succeeded: number; failed: number }> {
  const settled = await Promise.allSettled(
    deletedIds.map((id) => restoreTask(id))
  );
  const failed = settled.filter((result) => result.status === "rejected").length;

  return {
    succeeded: deletedIds.length - failed,
    failed,
  };
}
