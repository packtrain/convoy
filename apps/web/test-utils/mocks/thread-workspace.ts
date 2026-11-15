import { vi } from "vitest";
import type { ArchiveFilter } from "@/lib/tasks/types";

export function createThreadWorkspaceState(
  overrides: Record<string, unknown> = {},
  // The real hook calls `onOpenTask` from every opener, which is what reveals a
  // collapsed surface (OS-1663). Pass the hook args to model that.
  hookArgs?: { onOpenTask?: () => void }
) {
  // `task=<REF>` is what puts a task in the sidebar, so a fixture with a
  // `detailsTask` implies the param — the workspace reads the param directly.
  // Pass `taskRefId` explicitly to model the resolving beat (param, no doc).
  const detailsTask = overrides.detailsTask as { refId?: string } | undefined;
  return {
    taskRefId: detailsTask?.refId ?? null,
    detailsTask: undefined,
    attachedTask: null,
    artifactId: null,
    threadArtifactId: null,
    archiveFilter: "active" as ArchiveFilter,
    setTask: vi.fn((...args: unknown[]) => {
      void args;
      hookArgs?.onOpenTask?.();
    }),
    closeTaskSidebar: vi.fn(),
    setTaskArtifact: vi.fn(),
    setArtifact: vi.fn(),
    selectThreadArtifact: vi.fn(),
    closeThreadArtifact: vi.fn(),
    setAttachedTask: vi.fn(),
    allowedStatuses: [],
    allTasks: [],
    taskOperations: {
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      addTask: vi.fn(),
      reorderTasks: vi.fn(),
      reorderMultiple: vi.fn(),
      setParent: vi.fn(),
      setParentMultiple: vi.fn(),
      bulkUpdateStatus: vi.fn(),
      bulkUpdateAssignee: vi.fn(),
      bulkUpdatePriority: vi.fn(),
      bulkUpdateDueDate: vi.fn(),
      bulkUpdateTaskType: vi.fn(),
      moveToList: vi.fn(),
      bulkArchive: vi.fn(),
      bulkDelete: vi.fn(),
      duplicateTask: vi.fn(),
      unarchiveTask: vi.fn(),
    },
    inputRefs: { current: new Map() },
    focusInput: vi.fn(),
    currentUserId: "user_1",
    openTaskByClientId: vi.fn(() => hookArgs?.onOpenTask?.()),
    taskLinkHref: (task: { refId: string; isArchived: boolean }) =>
      `/o/contoso/OS/threads/thread_1?task=${task.refId}${task.isArchived ? "&archived=true" : ""}`,
    ...overrides,
  };
}
