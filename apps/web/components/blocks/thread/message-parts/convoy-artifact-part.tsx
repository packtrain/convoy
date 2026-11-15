"use client";

import {
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
// FileText everywhere for artifacts: the panel header, the task artifacts
// section, and the thread sidebar's artifact tab this links to.
import { FileText } from "lucide-react";
import { PatchDiff } from "@pierre/diffs/react";
import { MessageResponse } from "@/components/ai-elements/message";
import { buildReplacementPatch } from "@/lib/ai-tools/file-change-tool";
import type {
  ConvoyArtifactSummary,
  ConvoyArtifactToolPayload,
} from "@/lib/ai-tools/convoy-artifact-tool";
import {
  AppLink,
  appRoute,
  href,
  shouldHandleInPlaceNavigation,
  useRouteParams,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { openTaskInPlace, useTaskRefHref } from "./convoy-task-reader-part";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ToolSurface } from "./components/tool-surface";
import { useDiffTheme } from "@/lib/threads/hooks/use-diff-theme";

interface ConvoyArtifactPartProps {
  payload: ConvoyArtifactToolPayload;
  onDebug?: () => void;
  /** Opens the artifact in the host's sidebar instead of navigating (OS-1569). */
  onOpenArtifact?: (artifactId: string) => void;
  /** Opens the task in the host's sidebar instead of navigating (OS-1762). */
  onOpenTask?: (refId: string) => void;
}

function buildTitle(payload: ConvoyArtifactToolPayload): string {
  return [
    payload.action,
    payload.artifactName ? `“${payload.artifactName}”` : undefined,
    payload.taskRef ? `on ${payload.taskRef}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function useProjectParams() {
  const params = useRouteParams<{
    organizationSlug?: string;
    projectAlias?: string;
  }>();
  const organizationSlug = params?.organizationSlug;
  const projectAlias = params?.projectAlias;
  if (!organizationSlug || !projectAlias) return null;
  return { organizationSlug, projectAlias };
}

/**
 * Opens the artifact in place on a plain left click. The `href` stays the real
 * page URL, so ⌘/ctrl-click, middle click and "copy link address" are untouched.
 */
function openArtifactInPlace(
  event: ReactMouseEvent<HTMLAnchorElement>,
  artifactId: string,
  onOpenArtifact?: (artifactId: string) => void
) {
  if (!onOpenArtifact || !shouldHandleInPlaceNavigation(event)) {
    return;
  }
  event.preventDefault();
  onOpenArtifact(artifactId);
}

const TITLE_LINK_CLASS =
  "underline-offset-2 hover:text-foreground hover:underline";

/** The " on OS-1711" segment; the ref opens the task in the sidebar (OS-1762). */
function TaskRefSegment({
  refId,
  onOpenTask,
}: {
  refId: string;
  onOpenTask?: (refId: string) => void;
}) {
  const taskHref = useTaskRefHref(refId);
  if (!taskHref) return <> on {refId}</>;

  return (
    <>
      {" on "}
      <AppLink
        href={taskHref}
        onClick={(event) => {
          // Keeps the click from toggling the collapsible around it.
          event.stopPropagation();
          openTaskInPlace(event, refId, onOpenTask);
        }}
        className={TITLE_LINK_CLASS}
      >
        {refId}
      </AppLink>
    </>
  );
}

/** Title with the "artifact “name”" segment linked to the artifact page. */
function ArtifactTitle({
  payload,
  onOpenArtifact,
  onOpenTask,
}: {
  payload: ConvoyArtifactToolPayload;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenTask?: (refId: string) => void;
}) {
  const projectParams = useProjectParams();
  // Actions are "<Verb> artifact(s)" — link the noun (+ quoted name).
  const splitAt = payload.action.lastIndexOf(" ");
  const verb = payload.action.slice(0, splitAt);
  const noun = payload.action.slice(splitAt + 1);
  const nameSegment = payload.artifactName
    ? ` “${payload.artifactName}”`
    : "";
  const artifactId = payload.artifactId;

  return (
    <span className="truncate whitespace-nowrap">
      {verb}{" "}
      {artifactId && projectParams ? (
        <AppLink
          href={href(
            appRoute.projectArtifact(
              projectParams.organizationSlug,
              projectParams.projectAlias,
              artifactId
            )
          )}
          onClick={(event) => {
            // Keeps the click from toggling the collapsible around it.
            event.stopPropagation();
            openArtifactInPlace(event, artifactId, onOpenArtifact);
          }}
          className={TITLE_LINK_CLASS}
        >
          {noun}
          {nameSegment}
        </AppLink>
      ) : (
        `${noun}${nameSegment}`
      )}
      {payload.taskRef ? (
        <TaskRefSegment refId={payload.taskRef} onOpenTask={onOpenTask} />
      ) : null}
    </span>
  );
}

function ArtifactRow({
  artifact,
  onOpenArtifact,
}: {
  artifact: ConvoyArtifactSummary;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const projectParams = useProjectParams();
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {artifact.name}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {artifact.contentType}
      </span>
    </>
  );

  const artifactId = artifact.id;
  if (!artifactId || !projectParams) {
    return <div className="flex min-w-0 items-center gap-2">{content}</div>;
  }

  return (
    <AppLink
      href={href(
        appRoute.projectArtifact(
          projectParams.organizationSlug,
          projectParams.projectAlias,
          artifactId
        )
      )}
      onClick={(event) => openArtifactInPlace(event, artifactId, onOpenArtifact)}
      className="flex min-w-0 cursor-pointer items-center gap-2 [&>span:first-child]:hover:underline [&>span:first-child]:hover:underline-offset-2"
    >
      {content}
    </AppLink>
  );
}

function ArtifactContent({ payload }: { payload: ConvoyArtifactToolPayload }) {
  if (!payload.content) return null;

  if (payload.contentType === "html") {
    return (
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
        {payload.content}
      </pre>
    );
  }

  return (
    <MessageResponse
      className={cn(
        "text-sm leading-6",
        "[&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:text-sm [&_h3]:font-semibold [&_li]:text-sm [&_p]:text-sm"
      )}
    >
      {payload.content}
    </MessageResponse>
  );
}

function ReplacementDiff({ payload }: { payload: ConvoyArtifactToolPayload }) {
  const patch = useMemo(
    () =>
      buildReplacementPatch(
        payload.artifactName ?? "artifact",
        payload.oldString ?? "",
        payload.newString ?? ""
      ),
    [payload.artifactName, payload.oldString, payload.newString]
  );
  const diffTheme = useDiffTheme();

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <PatchDiff
        patch={patch}
        options={{
          ...diffTheme,
          diffStyle: "unified",
          disableFileHeader: true,
          overflow: "scroll",
        }}
      />
    </div>
  );
}

/**
 * A plain function, not a component: the caller drops the expander entirely
 * when this is null, and an element would be truthy even when it renders
 * nothing.
 */
function renderCompletedBody(
  payload: ConvoyArtifactToolPayload,
  onOpenArtifact?: (artifactId: string) => void
): ReactNode {
  if (payload.kind === "replace_in_task_artifact") {
    return (
      <>
        {payload.replaceError ? (
          <p className="text-xs text-destructive">{payload.replaceError}</p>
        ) : null}
        <ReplacementDiff payload={payload} />
      </>
    );
  }

  if (payload.kind === "list_task_artifacts") {
    if (!payload.artifacts?.length) {
      return <p className="text-xs text-muted-foreground">No artifacts</p>;
    }
    return (
      <>
        {payload.artifacts.map((artifact) => (
          <ArtifactRow
            key={artifact.id ?? artifact.name}
            artifact={artifact}
            onOpenArtifact={onOpenArtifact}
          />
        ))}
      </>
    );
  }

  if (payload.content) {
    return <ArtifactContent payload={payload} />;
  }

  // Deletes and content-less results: the header row says it all (OS-1712).
  return null;
}

export function ConvoyArtifactPart({
  payload,
  onDebug,
  onOpenArtifact,
  onOpenTask,
}: ConvoyArtifactPartProps) {
  const artifactCount = payload.artifacts?.length;
  // The row's icon carries pending and failed states; only a replacement keeps
  // a body of its own then — the attempted change (OS-1769).
  const body =
    payload.state !== "output-available"
      ? payload.kind === "replace_in_task_artifact"
        ? <ReplacementDiff payload={payload} />
        : null
      : renderCompletedBody(payload, onOpenArtifact);

  return (
    <CollapsibleToolPart
      icon={FileText}
      title={buildTitle(payload)}
      titleNode={
        <ArtifactTitle
          payload={payload}
          onOpenArtifact={onOpenArtifact}
          onOpenTask={onOpenTask}
        />
      }
      trailing={
        <>
          {artifactCount !== undefined ? (
            <span className="shrink-0 text-xs text-muted-foreground/70">
              {artifactCount} {artifactCount === 1 ? "artifact" : "artifacts"}
            </span>
          ) : null}
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 text-xs text-muted-foreground">
            {payload.server}
          </span>
        </>
      }
      state={payload.state}
      errorText={payload.errorText}
      onDebug={onDebug}
      hasBody={Boolean(body)}
      renderChildren={() => (
        <ToolSurface className="flex flex-col gap-1.5">{body}</ToolSurface>
      )}
    />
  );
}
