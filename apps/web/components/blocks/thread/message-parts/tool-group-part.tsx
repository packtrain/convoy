"use client";

import { Wrench } from "lucide-react";
import {
  countToolParts,
  type ToolGroup,
  type ToolGroupPartItem,
} from "@/lib/threads/group-consecutive-tool-parts";
import { formatWorkedForLabel } from "@/lib/threads/tool-group";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import {
  renderCliUiMessagePart,
  type CliUiPartRenderContext,
} from "./lib/part-renderer-registry";

function toolCallsLabel(n: number): string {
  return n === 1 ? "1 tool call" : `${n} tool calls`;
}

function itemKey(part: ToolGroupPartItem, index: number): string {
  return part.type === "dynamic-tool"
    ? part.toolCallId
    : `reasoning-${index}`;
}

interface ToolGroupPartProps {
  group: ToolGroup;
  /** The group is still running: render its parts live instead of collapsing. */
  isLive: boolean;
  /** Group wall-clock span; undefined when it cannot be derived. */
  durationMs?: number;
  context: CliUiPartRenderContext;
}

export function ToolGroupPart({
  group,
  isLive,
  durationMs,
  context,
}: ToolGroupPartProps) {
  const { parts } = group;

  const renderParts = () => (
    <div className="flex w-full flex-col gap-3">
      {parts.map((part, index) => (
        <div key={itemKey(part, index)} className="min-w-0">
          {renderCliUiMessagePart({
            part,
            context: { ...context, partIndex: index },
          })}
        </div>
      ))}
    </div>
  );

  if (isLive) {
    return renderParts();
  }

  return (
    <CollapsibleToolPart
      icon={Wrench}
      // Without timings (legacy chunks, interrupted calls) the count is all
      // there is to say about the group.
      title={
        durationMs === undefined
          ? toolCallsLabel(countToolParts(parts))
          : formatWorkedForLabel(durationMs)
      }
      // The body is a list of parts, so it sits on the same rhythm as the gap
      // between them rather than hugging the trigger row.
      contentClassName="mt-3"
      renderChildren={renderParts}
    />
  );
}
