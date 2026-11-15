"use client";

import { useState } from "react";
import {
  Braces,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { TaskNoticeGroupPart as TaskNoticeGroupPartModel } from "@/lib/cli-stream-ui";
import { Spinner } from "@/components/custom/spinner";
import { formatDurationMs } from "@/lib/format-duration-ms";
import {
  buildTaskNoticeGroupChildToolParts,
  summarizeTaskNoticeGroup,
} from "@/lib/cli-stream-ui/runtime-notices";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import {
  renderDynamicToolPartElement,
  type CliUiPartRenderContext,
} from "./lib/part-renderer-registry";
import { ToolSurface } from "./components/tool-surface";

interface TaskNoticeGroupPartProps {
  part: TaskNoticeGroupPartModel;
  context: CliUiPartRenderContext;
}

function getTaskGroupToolUseId(part: TaskNoticeGroupPartModel): string | undefined {
  if (part.parentToolUseId) {
    return part.parentToolUseId;
  }

  const separatorIndex = part.groupKey.indexOf("::");
  if (separatorIndex === -1) {
    return undefined;
  }

  const toolUseId = part.groupKey.slice(separatorIndex + 2);
  return toolUseId.length > 0 ? toolUseId : undefined;
}

function getTaskStatusVisual(status: string): {
  icon?: LucideIcon;
  iconNode?: ReactNode;
  iconClassName?: string;
} {
  switch (status) {
    case "completed":
      return { icon: CheckCircle2, iconClassName: "text-success" };
    case "failed":
    case "killed":
      return { icon: CircleAlert, iconClassName: "text-destructive" };
    case "started":
    case "in progress":
    case "running":
      return {
        iconNode: <Spinner className="size-3.5 shrink-0" />,
      };
    case "pending":
      return { icon: CircleDashed, iconClassName: "text-muted-foreground" };
    default:
      return { icon: CircleDashed, iconClassName: "text-muted-foreground" };
  }
}

export function TaskNoticeGroupPart({
  part,
  context,
}: TaskNoticeGroupPartProps) {
  const [rawOpen, setRawOpen] = useState(false);
  const summary = summarizeTaskNoticeGroup(part);
  const childToolParts = buildTaskNoticeGroupChildToolParts(part.childToolEvents);
  const childTaskGroups = part.childTaskNoticeGroups ?? [];
  const childTaskGroupByToolUseId = new Map(
    childTaskGroups
      .map((group) => [getTaskGroupToolUseId(group), group] as const)
      .filter(
        (
          entry
        ): entry is readonly [string, TaskNoticeGroupPartModel] => entry[0] !== undefined
      )
  );
  const { icon, iconNode, iconClassName } = getTaskStatusVisual(summary.status);

  const handleCopyDebugInfo = async () => {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(summary.debugJson);
  };

  return (
    <CollapsibleToolPart
      icon={icon}
      iconNode={iconNode}
      iconClassName={iconClassName}
      title={`${summary.title} (${summary.status}${
        summary.isBackgrounded ? ", backgrounded" : ""
      })`}
      onDebug={() => {
        void handleCopyDebugInfo();
      }}
      renderChildren={() => (
        <ToolSurface className="space-y-4">
          {summary.prompt ? (
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Prompt
              </div>
              <div className="text-sm text-foreground">{summary.prompt}</div>
            </div>
          ) : null}
          {summary.totalTokens !== undefined ||
          summary.toolUses !== undefined ||
          summary.durationMs !== undefined ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Total tokens
                </div>
                <div className="text-sm text-foreground">
                  {summary.totalTokens ?? "—"}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Tool uses
                </div>
                <div className="text-sm text-foreground">
                  {summary.toolUses ?? "—"}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Duration
                </div>
                <div className="text-sm text-foreground">
                  {formatDurationMs(summary.durationMs) ?? "—"}
                </div>
              </div>
            </div>
          ) : null}
          {summary.error ? (
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Error
              </div>
              <div className="text-sm text-destructive">{summary.error}</div>
            </div>
          ) : null}
          {summary.outputFile ? (
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Output file
              </div>
              <div className="text-sm text-foreground">{summary.outputFile}</div>
            </div>
          ) : null}
          {childToolParts.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Tool calls
              </div>
              <div className="space-y-2">
                {(() => {
                  const renderedNestedToolUseIds = new Set<string>();
                  const entries = childToolParts.map((childPart, childIndex) => {
                    const nestedTaskGroup = childTaskGroupByToolUseId.get(
                      childPart.toolCallId
                    );
                    if (nestedTaskGroup) {
                      renderedNestedToolUseIds.add(childPart.toolCallId);
                      return (
                        <div key={`task-group-${childPart.toolCallId}`} className="min-w-0">
                          <TaskNoticeGroupPart
                            part={nestedTaskGroup}
                            context={{ ...context, partIndex: childIndex }}
                          />
                        </div>
                      );
                    }

                    return (
                      <div key={childPart.toolCallId} className="min-w-0">
                        {renderDynamicToolPartElement(childPart, {
                          ...context,
                          partIndex: childIndex,
                        })}
                      </div>
                    );
                  });

                  for (const childTaskGroup of childTaskGroups) {
                    const toolUseId = getTaskGroupToolUseId(childTaskGroup);
                    if (!toolUseId || renderedNestedToolUseIds.has(toolUseId)) {
                      continue;
                    }

                    entries.push(
                      <div key={`task-group-${toolUseId}`} className="min-w-0">
                        <TaskNoticeGroupPart
                          part={childTaskGroup}
                          context={context}
                        />
                      </div>
                    );
                  }

                  return entries;
                })()}
              </div>
            </div>
          ) : childTaskGroups.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Tool calls
              </div>
              <div className="space-y-2">
                {childTaskGroups.map((childTaskGroup) => (
                  <div
                    key={`task-group-${getTaskGroupToolUseId(childTaskGroup) ?? childTaskGroup.groupKey}`}
                    className="min-w-0"
                  >
                    <TaskNoticeGroupPart part={childTaskGroup} context={context} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 w-full cursor-pointer items-center justify-start gap-2 text-left text-sm text-muted-foreground hover:text-foreground"
                aria-label={`${rawOpen ? "Hide" : "Show"} raw data`}
              >
                <Braces className="size-3.5 shrink-0" />
                <span className="truncate whitespace-nowrap">{rawOpen ? "Hide" : "Show"} raw data</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs text-foreground">
                <code>{summary.debugJson}</code>
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </ToolSurface>
      )}
    />
  );
}
