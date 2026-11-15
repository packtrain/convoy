"use client";

import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskListSettingsManagement } from "@/components/blocks/project/task-lists/task-list-management";
import type { TaskListItem } from "@/components/blocks/project/task-lists/task-list-types";
import { Skeleton } from "@/components/ui/skeleton";
import { appRoute, href, projectEntryTarget, type DefaultViewSettings } from "@/lib/navigation";

interface ListsSectionProps {
  projectId: Id<"projects"> | null;
  project?: DefaultViewSettings | null;
  organizationSlug?: string;
  projectAlias?: string;
}

export function ListsSection({
  projectId,
  project,
  organizationSlug,
  projectAlias,
}: ListsSectionProps) {
  const [archived, setArchived] = useState(false);
  // Opening a List from settings honors that List's default view (OS-1566).
  const getOpenTasksHref =
    organizationSlug && projectAlias
      ? (list: TaskListItem) =>
          href(
            projectEntryTarget(
              appRoute.project(organizationSlug, projectAlias).pathname,
              project,
              { listRef: list.ref, list }
            )
          )
      : undefined;

  if (!projectId) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-4/5 rounded-sm" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-72 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TaskListSettingsManagement
        projectId={projectId}
        archived={archived}
        showArchiveFilter
        onArchivedChange={setArchived}
        getOpenTasksHref={getOpenTasksHref}
      />
    </div>
  );
}
