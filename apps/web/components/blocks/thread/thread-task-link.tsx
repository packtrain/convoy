"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { Pill, PillContent, PillText } from "@/components/ui/pill";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { buildProjectTaskUrl, type ThreadTaskSummary } from "@/lib/threads/task-summary";
import { cn } from "@/lib/utils";
import { AppLink, shouldHandleInPlaceNavigation } from "@/lib/navigation";

interface ThreadTaskLinkProps {
  task: ThreadTaskSummary;
  href?: string;
  organizationSlug?: string;
  projectAlias?: string;
  className?: string;
  onNavigate?: () => void;
}

function handleInPlaceNavigate(
  event: ReactMouseEvent<HTMLAnchorElement>,
  onNavigate?: () => void
) {
  if (!onNavigate || !shouldHandleInPlaceNavigation(event)) {
    return;
  }

  event.preventDefault();
  onNavigate();
}

export function ThreadTaskRefLink({
  task,
  href,
  organizationSlug,
  projectAlias,
  className,
  onNavigate,
}: ThreadTaskLinkProps) {
  const resolvedHref =
    href ??
    (organizationSlug && projectAlias
      ? buildProjectTaskUrl(organizationSlug, projectAlias, task)
      : undefined);
  if (!resolvedHref) {
    return null;
  }

  const content = (
    <TaskRefWithType
      refId={task.refId}
      taskType={task.taskType}
      refInteractive={false}
      className="gap-1.5"
      refClassName="text-xs font-medium text-muted-foreground transition-colors group-hover/thread-task:text-foreground"
      typeClassName="shrink-0"
    />
  );

  if (onNavigate) {
    return (
      <a
        href={resolvedHref}
        onClick={(event) => handleInPlaceNavigate(event, onNavigate)}
        className={cn(
          "group/thread-task inline-flex min-w-0 cursor-pointer items-center rounded-md hover:text-foreground",
          className
        )}
      >
        {content}
      </a>
    );
  }

  return (
    <AppLink
      href={resolvedHref}
      className={cn(
        "group/thread-task inline-flex min-w-0 cursor-pointer items-center rounded-md hover:text-foreground",
        className
      )}
    >
      {content}
    </AppLink>
  );
}

export function ThreadTaskPillLink({
  task,
  href,
  organizationSlug,
  projectAlias,
  className,
  onNavigate,
}: ThreadTaskLinkProps) {
  const resolvedHref =
    href ??
    (organizationSlug && projectAlias
      ? buildProjectTaskUrl(organizationSlug, projectAlias, task)
      : undefined);
  if (!resolvedHref) {
    return null;
  }

  const content = (
    <PillContent>
      <TaskRefWithType
        refId={task.refId}
        taskType={task.taskType}
        refInteractive={false}
        className="shrink-0 gap-1.5"
        refClassName="text-sm font-medium text-foreground"
        typeClassName="shrink-0"
      />
      <PillText>{task.name}</PillText>
    </PillContent>
  );

  if (onNavigate) {
    return (
      <Pill asChild className={cn("max-w-[280px] pr-2 hover:bg-muted", className)}>
        <a
          href={resolvedHref}
          onClick={(event) => handleInPlaceNavigate(event, onNavigate)}
        >
          {content}
        </a>
      </Pill>
    );
  }

  return (
    <Pill asChild className={cn("max-w-[280px] pr-2 hover:bg-muted", className)}>
      <AppLink href={resolvedHref}>
        {content}
      </AppLink>
    </Pill>
  );
}
