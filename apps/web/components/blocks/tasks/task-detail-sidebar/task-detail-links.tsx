"use client";

import { format } from "date-fns";
import { PullRequestLink } from "@/components/blocks/integrations";
import { EXTERNAL_LINK_PRESENTATION } from "@/lib/tasks/external-link-presentation";
import {
  getExternalLinkLabel,
  type TaskExternalLink,
  type TaskExternalLinkInput,
} from "@/lib/tasks/external-links";
import { cn } from "@/lib/utils";

function getTaskDetailLinkLabel(link: TaskExternalLinkInput): string {
  const label = getExternalLinkLabel(link);

  if (link.kind !== "pull_request" || label.startsWith("PR:")) {
    return label;
  }

  return `PR: ${label}`;
}

function getTaskDetailLinkTitle(link: TaskExternalLink): string {
  if (Number.isFinite(link.updatedAt)) {
    return `Updated ${format(new Date(link.updatedAt), "PPpp")}`;
  }

  return `Created ${format(new Date(link.createdAt), "PPpp")}`;
}

/**
 * One external link as kind-colored icon + label; an anchor when it has a URL.
 * Shared with the thread tool-call rows (OS-1769).
 */
export function TaskExternalLinkLabel({
  link,
  title,
  className,
}: {
  link: TaskExternalLinkInput;
  title?: string;
  className?: string;
}) {
  const { icon: Icon, color } = EXTERNAL_LINK_PRESENTATION[link.kind];
  const url = "url" in link ? link.url : undefined;
  const rowClassName = cn(
    "flex min-w-0 items-center gap-1.5 text-sm text-foreground",
    className
  );
  const content = (
    <>
      <Icon className={cn("size-3.5 shrink-0", color)} />
      <span className="truncate">{getTaskDetailLinkLabel(link)}</span>
    </>
  );

  if (url && link.kind === "pull_request") {
    return (
      <PullRequestLink url={url} title={title} className={cn(rowClassName, "transition-opacity hover:opacity-80")}>
        {content}
      </PullRequestLink>
    );
  }

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        className={cn(rowClassName, "transition-opacity hover:opacity-80")}
      >
        {content}
      </a>
    );
  }

  return (
    <span title={title} className={rowClassName}>
      {content}
    </span>
  );
}

/**
 * Read-only list of a task's external links (commits, branches, PRs, URLs).
 * Links are created via MCP/CLI; items with a URL open in a new tab.
 */
export function TaskDetailLinks({ links }: { links: TaskExternalLink[] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
      {links.map((link) => (
        <TaskExternalLinkLabel
          key={link.id}
          link={link}
          title={getTaskDetailLinkTitle(link)}
        />
      ))}
    </div>
  );
}
