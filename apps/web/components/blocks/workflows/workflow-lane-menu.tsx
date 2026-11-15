"use client";

import { useEffect, useRef } from "react";
import { Bot, CheckIcon, Trash2, Zap } from "lucide-react";
import { CliTypeSelector } from "@/components/blocks/thread/cli-type-selector";
import type { ThreadAgentSelectorAgent } from "@/components/blocks/thread/thread-agent-selector";
import { sortAgentsByName } from "@/components/blocks/agents/agent-list-utils";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { Id } from "@/convex/_generated/dataModel";
import type { LaneDefinition, LaneRuntimeDefaults } from "@/convex/lib/contracts/workflowDefinition";
import { DEFAULT_FALLBACK_CLI_TYPE, getCliModes } from "@/lib/cli-runtime-ui/registry";
import { useComposerRuntimeOverrides } from "@/lib/threads/hooks/use-composer-runtime-overrides";
import { laneEffectiveCliType } from "@/lib/workflows/draft";

/** What the lane menu's runtime picks emit; the grid maps it onto the draft. */
export type LaneRuntimeSelection = { type: "parallel" } | { type: "single"; defaults: LaneRuntimeDefaults };

/** Keeps the menu open: it is a settings surface, closed by outside click or Delete. */
const stayOpen = (event: Event) => event.preventDefault();

/**
 * The lane header's one dropdown: "Parallel" first, the composer's CLI/model
 * menu, then a single lane's mode and Project-agent submenus and Delete.
 * Picking a runtime or model makes the lane single with those defaults pinned;
 * picking Parallel drops them (workflow-data-schema.md → Lane and override
 * rules). Everything but Delete keeps the menu open.
 */
export function WorkflowLaneMenu({
  lane,
  projectAgents,
  disabled,
  onSelect,
  onDelete,
}: {
  lane: LaneDefinition;
  projectAgents: ThreadAgentSelectorAgent[];
  disabled?: boolean;
  onSelect: (selection: LaneRuntimeSelection) => void;
  /** Omit for read-only grids; the Delete item disappears with it. */
  onDelete?: () => void;
}) {
  const isParallel = lane.type === "parallel";
  const defaults = isParallel ? undefined : lane.defaults;
  // Several picks can land before the lane prop re-renders (a cross-runtime
  // model pick, or successive picks in the open menu); the ref keeps the last
  // emission as the base for the next (the selector hook's own ref pattern).
  const pendingDefaults = useRef<LaneRuntimeDefaults | undefined>(undefined);
  useEffect(() => {
    pendingDefaults.current = undefined;
  });
  const selectSingle = (patch: Partial<LaneRuntimeDefaults>) => {
    const merged = { ...(pendingDefaults.current ?? defaults), ...patch };
    const next = { ...merged, cliType: merged.cliType ?? DEFAULT_FALLBACK_CLI_TYPE };
    pendingDefaults.current = next;
    onSelect({ type: "single", defaults: next });
  };
  const runtimeSelectors = useComposerRuntimeOverrides(defaults ?? {}, selectSingle);

  const modes = getCliModes(laneEffectiveCliType(lane));
  const currentMode = modes.find((mode) => mode.value === lane.defaults?.mode) ?? modes[0];
  const selectedAgent = projectAgents.find((agent) => agent._id === lane.defaults?.projectAgentId);

  return (
    <CliTypeSelector
      // No runtime reads as selected while the lane is Parallel.
      value={isParallel ? undefined : runtimeSelectors.cliType}
      onChange={runtimeSelectors.onCliTypeChange ?? (() => {})}
      cliModel={runtimeSelectors.cliModel}
      cliEffort={runtimeSelectors.cliEffort}
      onCliModelChange={runtimeSelectors.onCliModelChange}
      onCliEffortChange={runtimeSelectors.onCliEffortChange}
      disabled={disabled}
      keepOpenOnSelect
      triggerAriaLabel={`Lane ${lane.name} settings`}
      triggerContent={
        isParallel ? (
          <>
            <Zap className="size-4" />
            <span>Parallel</span>
          </>
        ) : undefined
      }
      leadingItems={
        <>
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={disabled}
            onSelect={stayOpen}
            onClick={() => onSelect({ type: "parallel" })}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Zap className="size-4" />
                <span>Parallel</span>
              </div>
              {isParallel ? <CheckIcon className="size-4" /> : null}
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      }
      trailingItems={
        <>
          {/* Mode and agent are single-lane defaults; a Parallel lane stores none. */}
          {!isParallel && currentMode ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                {/* The trigger is the current selection itself. */}
                <DropdownMenuSubTrigger className="cursor-pointer">
                  <div className="flex w-full min-w-0 items-center gap-2">
                    <currentMode.icon className="size-4 shrink-0" />
                    <span className="min-w-0 truncate">{currentMode.label}</span>
                  </div>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="max-h-[70vh] w-48 overflow-y-auto">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Mode</DropdownMenuLabel>
                    {modes.map((mode) => (
                      <DropdownMenuItem
                        key={mode.value}
                        className="cursor-pointer"
                        disabled={disabled}
                        onSelect={stayOpen}
                        onClick={() => selectSingle({ mode: mode.value })}
                      >
                        <mode.icon className="size-4" />
                        <span>{mode.label}</span>
                        {mode.value === currentMode.value ? <CheckIcon className="ml-auto size-4" /> : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </>
          ) : null}
          {/* A stored id with no active agents left (last agent deleted) must stay clearable. */}
          {!isParallel && (projectAgents.length > 0 || lane.defaults?.projectAgentId !== undefined) ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <div className="flex w-full min-w-0 items-center gap-2">
                  {selectedAgent ? (
                    <>
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: selectedAgent.appearance.color }} />
                      <span className="min-w-0 truncate">{selectedAgent.name}</span>
                    </>
                  ) : (
                    <>
                      <Bot className="size-4 shrink-0" />
                      <span>{lane.defaults?.projectAgentId !== undefined ? "Unknown agent" : "Default"}</span>
                    </>
                  )}
                </div>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="max-h-[70vh] w-48 overflow-y-auto">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Agent</DropdownMenuLabel>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    disabled={disabled}
                    onSelect={stayOpen}
                    onClick={() => selectSingle({ projectAgentId: undefined })}
                  >
                    <Bot className="size-4" />
                    <span>Default</span>
                    {lane.defaults?.projectAgentId === undefined ? <CheckIcon className="ml-auto size-4" /> : null}
                  </DropdownMenuItem>
                  {sortAgentsByName(projectAgents).map((agent) => (
                    <DropdownMenuItem
                      key={agent._id}
                      className="cursor-pointer"
                      disabled={disabled}
                      onSelect={stayOpen}
                      onClick={() => selectSingle({ projectAgentId: agent._id as Id<"projectAgents"> })}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: agent.appearance.color }} />
                      <span className="min-w-0 truncate">{agent.name}</span>
                      {lane.defaults?.projectAgentId === agent._id ? <CheckIcon className="ml-auto size-4" /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ) : null}
          {onDelete ? (
            <>
              <DropdownMenuSeparator />
              {/* Delete is the one item that closes the menu (no stayOpen). */}
              <DropdownMenuItem variant="destructive" className="cursor-pointer" disabled={disabled} onClick={onDelete}>
                <Trash2 className="size-4" />
                <span>Delete lane</span>
              </DropdownMenuItem>
            </>
          ) : null}
        </>
      }
    />
  );
}
