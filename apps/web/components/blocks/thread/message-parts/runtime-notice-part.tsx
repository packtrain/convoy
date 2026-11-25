"use client";

import {
  AlertTriangle,
  Crosshair,
  Gauge,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { AppLink, appRoute, href, useRouteParams } from "@/lib/navigation";
import type { RuntimeNoticePart as RuntimeNoticePartModel } from "@/lib/cli-stream-ui";
import { formatJsonString } from "@/lib/cli-stream-ui/runtime-notices";
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

export function RuntimeNoticePart({ part }: RuntimeNoticePartProps) {
  if (part.code === "worktree-setup-unapproved") {
    return <WorktreeSetupUnapprovedNotice part={part} />;
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
