"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Crosshair,
  Gauge,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { AppLink, appRoute, href, useRouteParams } from "@/lib/navigation";
import type { RuntimeNoticePart as RuntimeNoticePartModel } from "@/lib/cli-stream-ui";
import { formatJsonString, parseNoticePayload } from "@/lib/cli-stream-ui/runtime-notices";
import { getThreadPullRequestPresentation } from "@/lib/threads/pull-request";
import { cn } from "@/lib/utils";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ToolSurface } from "./components/tool-surface";

interface RuntimeNoticePartProps {
  part: RuntimeNoticePartModel;
}

function getNoticeIcon(part: RuntimeNoticePartModel): {
  icon: LucideIcon;
  iconClassName?: string;
} {
  if (part.code === "claude-api-retry") {
    return { icon: RefreshCw };
  }

  if (part.code === "usage-limit") {
    return { icon: Gauge };
  }

  if (part.code.startsWith("goal-")) {
    return { icon: Crosshair };
  }

  return { icon: AlertTriangle };
}

/** `a `b` c` with the backticked spans as `<code>`, as the CLI writes repo keys. */
function InlineCode({ text }: { text: string }) {
  return text.split("`").map((piece, index) =>
    index % 2 === 1 ? (
      <code key={index} className="font-mono text-foreground">
        {piece}
      </code>
    ) : (
      piece
    )
  );
}

/** The CLI's unapproved-setup notice (docs/specs/cli-worktrees.md#worktree-setup-scripts); approval happens in settings. */
function WorktreeSetupUnapprovedNotice({ part }: RuntimeNoticePartProps) {
  const params = useRouteParams<{ organizationSlug?: string; projectAlias?: string }>();
  const link = params?.organizationSlug && params.projectAlias
    ? href(appRoute.projectSettings(params.organizationSlug, params.projectAlias, "worktrees"))
    : null;
  return (
    <CollapsibleToolPart
      icon={AlertTriangle}
      title={`${part.title}: ${part.message}`}
      // Wraps instead of truncating, so a narrow thread still shows the repo.
      titleNode={
        <span className="min-w-0">
          {part.title}: <InlineCode text={part.message} />
        </span>
      }
      hasBody={false}
      trailing={
        link ? (
          <AppLink href={link} className="shrink-0 underline underline-offset-2 hover:text-foreground">
            Review script
          </AppLink>
        ) : null
      }
    />
  );
}

const OPEN_PR = getThreadPullRequestPresentation("open");
const str = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** Claude's `code_change_published`, from the event alone (docs/specs/cli-sdk-integration.md). */
function CodeChangePublishedNotice({ payload }: { payload: Record<string, unknown> }) {
  const url = str(payload.url);
  const repo = str(payload.repo);
  const identifier = str(payload.identifier);
  const branch = str(payload.branch);
  return (
    <div className="flex w-full min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <OPEN_PR.icon aria-hidden="true" className={cn("size-3.5 shrink-0", OPEN_PR.colorClass)} />
      <span className="shrink-0">{payload.action === "created" ? "Opened" : "Published"} pull request</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 text-foreground no-underline hover:bg-muted"
      >
        <span className="min-w-0 truncate font-medium">{repo ?? url}</span>
        {identifier && <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">#{identifier}</span>}
        <ArrowUpRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      </a>
      {branch && (
        <span className="hidden min-w-0 items-center gap-1 font-mono text-xs sm:inline-flex">
          <GitBranch aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      )}
    </div>
  );
}

export function RuntimeNoticePart({ part }: RuntimeNoticePartProps) {
  if (part.code === "worktree-setup-unapproved") {
    return <WorktreeSetupUnapprovedNotice part={part} />;
  }

  if (part.code === "claude-code-change-published") {
    const { payload } = parseNoticePayload(part);
    if (payload && str(payload.url)) return <CodeChangePublishedNotice payload={payload} />;
  }

  if (part.code === "context-compaction") {
    return (
      <Marker variant="separator" className="my-2 text-xs">
        <MarkerContent>
          {part.pending ? (
            <Shimmer as="span">{part.message}</Shimmer>
          ) : (
            part.message
          )}
        </MarkerContent>
      </Marker>
    );
  }

  const detailsJson = part.detailsJson ? formatJsonString(part.detailsJson) : undefined;
  const debugJson = part.debugJson ?? detailsJson;
  const renderedJson = detailsJson ?? (part.debugJson ? formatJsonString(part.debugJson) : undefined);
  const { icon, iconClassName } = getNoticeIcon(part);

  const handleCopyDebugInfo = async () => {
    if (!debugJson || !navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(debugJson);
  };

  return (
    <CollapsibleToolPart
      icon={icon}
      iconClassName={iconClassName}
      title={`${part.title}: ${part.message}`}
      onDebug={debugJson ? () => void handleCopyDebugInfo() : undefined}
      renderChildren={() =>
        renderedJson ? (
          <ToolSurface>
            <pre className="overflow-x-auto font-mono text-xs text-foreground">
              <code>{renderedJson}</code>
            </pre>
          </ToolSurface>
        ) : null
      }
    />
  );
}
