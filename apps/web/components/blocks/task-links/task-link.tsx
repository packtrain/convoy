"use client";

import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { FileText, GitPullRequest } from "lucide-react";
import { TaskTypeGlyph } from "@/components/blocks/tasks/task-ref-with-type";
import { StatusIcon } from "@/components/blocks/tasks/task-table/badges";
import { PillMeta } from "@/components/ui/pill";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { AppLink, shouldHandleInPlaceNavigation, useRouteParams } from "@/lib/navigation";
import { getThreadPullRequestPresentation } from "@/lib/threads/pull-request";
import { cn } from "@/lib/utils";
import { parseSnapshot, type ConvoyLink, type PullRequestLinkTarget } from "./parsers";

export type TaskLinkHandlers = {
  /** Opens the task in the host's sidebar (OS-1686). */
  onOpenTask?: (refId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
};

export const TaskLinkHandlersContext = createContext<TaskLinkHandlers>({});

/** `standalone`: the link is a whole paragraph or list item. `row`: it sits in a link table. */
export const LayoutContext = createContext({ standalone: false, row: false });

type LinkProps = { link: ConvoyLink; title?: string; children?: ReactNode };

const blockClassName = (row: boolean) =>
  cn(
    "flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground no-underline transition-colors hover:bg-muted/70",
    !row && "my-1 max-w-xl rounded-lg border border-border bg-muted/30"
  );
// Lifted 1.5px so the chip centers on the surrounding text line.
const chipClassName =
  "relative -top-[1.5px] mx-0.5 inline-flex h-6 max-w-[320px] items-center gap-1.5 rounded-md border border-border bg-muted/50 px-1.5 align-middle text-sm text-foreground no-underline transition-colors hover:bg-muted";

/** The link text, unless it only repeats the URL or the ref. */
function linkName(children: ReactNode, link: { path: string }, ref: string) {
  return typeof children === "string" && children !== ref && !children.includes(link.path) ? children : undefined;
}

/** Plain left clicks on a link to the current project open in place; the rest navigate. */
function useOpenInPlace(link: ConvoyLink, open: ((id: string) => void) | undefined, id: string) {
  const params = useRouteParams<{ organizationSlug?: string; projectAlias?: string }>();
  const sameProject =
    params?.organizationSlug === link.organizationSlug &&
    params?.projectAlias?.toLowerCase() === link.projectAlias.toLowerCase();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (!open || !sameProject || !shouldHandleInPlaceNavigation(event)) return;
    event.preventDefault();
    open(id);
  };
}

export function TaskLink({ link, title, children }: LinkProps) {
  const { standalone, row } = useContext(LayoutContext);
  const { onOpenTask } = useContext(TaskLinkHandlersContext);
  const onClick = useOpenInPlace(link, onOpenTask, link.refId);
  const { typeKey, status } = parseSnapshot(title);
  const name = linkName(children, link, link.refId);
  const taskType = resolveTaskTypeSummary(typeKey);
  const ref = <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{link.refId}</span>;

  if (standalone) {
    return (
      <AppLink href={link.path} onClick={onClick} data-testid="task-link-block" className={blockClassName(row)}>
        <TaskTypeGlyph taskType={taskType} />
        {ref}
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {status && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <StatusIcon status={status} className="size-3.5" />
            {status}
          </span>
        )}
      </AppLink>
    );
  }

  return (
    <AppLink href={link.path} onClick={onClick} data-testid="task-link-chip" className={chipClassName}>
      <TaskTypeGlyph taskType={taskType} sizeClassName="size-3.5" />
      {ref}
      {name && <span className="min-w-0 truncate font-medium">{name}</span>}
      {status && (
        <span title={status} className="flex shrink-0">
          <StatusIcon status={status} className="size-3.5" />
          <span className="sr-only">{status}</span>
        </span>
      )}
    </AppLink>
  );
}

export function ArtifactLink({ link, title, children }: LinkProps & { link: { artifactId: string } }) {
  const { standalone, row } = useContext(LayoutContext);
  const { onOpenArtifact } = useContext(TaskLinkHandlersContext);
  const onClick = useOpenInPlace(link, onOpenArtifact, link.artifactId);
  const typeKey = parseSnapshot(title).typeKey;
  const extension = typeKey === "md" || typeKey === "html" ? typeKey : undefined;
  const badge = extension && <PillMeta variant="badge" className="mt-px">{extension}</PillMeta>;
  const name = linkName(children, link, link.refId) ?? "Artifact";

  if (standalone) {
    return (
      <AppLink href={link.path} onClick={onClick} data-testid="artifact-link-block" className={blockClassName(row)}>
        <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{name}</span>
        {badge}
        <span className="ml-auto shrink-0 pl-2 text-xs font-medium text-muted-foreground tabular-nums">{link.refId}</span>
      </AppLink>
    );
  }

  return (
    <AppLink href={link.path} onClick={onClick} data-testid="artifact-link-chip" className={chipClassName}>
      <FileText aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-medium">{name}</span>
      {badge}
    </AppLink>
  );
}

/** Opens the in-app PR reader; the state comes from the `state=` snapshot. */
export function PullRequestLink({ link, title, children }: { link: PullRequestLinkTarget; title?: string; children?: ReactNode }) {
  const { standalone, row } = useContext(LayoutContext);
  const { state } = parseSnapshot(title);
  const presentation = state && getThreadPullRequestPresentation(state);
  const Icon = presentation ? presentation.icon : GitPullRequest;
  const iconClassName = cn("shrink-0", presentation ? presentation.colorClass : "text-muted-foreground");
  const ref = `#${link.number}`;
  const refLabel = <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{ref}</span>;
  const name = linkName(children, link, ref);

  if (standalone) {
    return (
      <AppLink href={link.path} data-testid="pull-request-link-block" className={blockClassName(row)}>
        <Icon aria-hidden="true" className={cn("size-4", iconClassName)} />
        {refLabel}
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {presentation && <span className="shrink-0 text-xs text-muted-foreground">{presentation.stateLabel}</span>}
      </AppLink>
    );
  }

  return (
    <AppLink href={link.path} data-testid="pull-request-link-chip" className={chipClassName}>
      <span title={presentation?.stateLabel} className="flex shrink-0">
        <Icon aria-hidden="true" className={cn("size-3.5", iconClassName)} />
        {presentation && <span className="sr-only">{presentation.stateLabel}</span>}
      </span>
      {refLabel}
      {name && <span className="min-w-0 truncate font-medium">{name}</span>}
    </AppLink>
  );
}
