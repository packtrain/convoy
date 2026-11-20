"use client";

import { useState } from "react";
import { Bot, CheckIcon, ChevronDown } from "lucide-react";
import { AgentAvatar } from "@/components/blocks/agents/agent-avatar";
import { sortAgentsByName } from "@/components/blocks/agents/agent-list-utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ThreadAgentSelectorAgent {
  _id: string;
  name: string;
  appearance: { color: string };
}

interface ThreadAgentSelectorProps {
  agents: ThreadAgentSelectorAgent[];
  /** Selected Project agent id; undefined = "Default" (no Project agent). */
  value: string | undefined;
  onChange: (projectAgentId: string | undefined) => void;
  disabled?: boolean;
  /**
   * Assignment automation (OS-1138): the agent is fixed by the flow — render
   * the bound agent normally (no muted disabled styling) but never open the
   * menu or fire onChange. Same pattern as the locked attached task.
   */
  locked?: boolean;
}

const DEFAULT_AGENT_LABEL = "Default";
const UNKNOWN_AGENT_LABEL = "Unknown agent";

/**
 * Agent selector for new-thread composers (OS-1138): "Default" plus the project's active
 * Project agents. Selection binds the agent to the created thread; an automation config
 * also defaults the other pills (in the draft flow, not here). Never renders on
 * follow-up composers — the binding is immutable after creation — and hides when the
 * project has no active agents and nothing is selected. A value naming a deleted agent
 * keeps the selector ("Unknown agent") so it stays clearable.
 */
export function ThreadAgentSelector({
  agents,
  value,
  onChange,
  disabled = false,
  locked = false,
}: ThreadAgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const interactive = !disabled && !locked;

  if (agents.length === 0 && value === undefined) {
    return null;
  }

  const sortedAgents = sortAgentsByName(agents);
  const selectedAgent = value
    ? agents.find((agent) => agent._id === value)
    : undefined;
  const triggerLabel = selectedAgent?.name ?? (value !== undefined ? UNKNOWN_AGENT_LABEL : DEFAULT_AGENT_LABEL);

  return (
    <DropdownMenu
      // Non-modal like the other composer selectors: a modal menu sets
      // pointer-events:none on body, which breaks tap-outside dismissal and
      // hit-testing when the composer is hosted inside a vaul drawer.
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!interactive) return;
        setOpen(nextOpen);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "min-w-0 shrink gap-2",
            interactive ? "cursor-pointer" : "cursor-default",
            disabled && "text-muted-foreground/80"
          )}
          aria-disabled={disabled || locked}
          aria-label={`Agent: ${triggerLabel}`}
          title={triggerLabel}
        >
          {selectedAgent ? (
            <AgentAvatar
              name={selectedAgent.name}
              color={selectedAgent.appearance.color}
              size="xs"
              className="size-4"
            />
          ) : (
            <Bot className="size-4 text-muted-foreground" />
          )}
          {/* Icon-only in a narrow composer bar; the title/aria-label carry the value. */}
          <span className={cn("hidden min-w-0 max-w-32 truncate @2xl/composer-bar:inline", !selectedAgent && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          {!locked && <ChevronDown className="hidden size-3 opacity-50 @2xl/composer-bar:block" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-56 overflow-y-auto">
        <DropdownMenuItem
          onClick={() => {
            if (!interactive) return;
            onChange(undefined);
            setOpen(false);
          }}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-muted-foreground" />
              <span>{DEFAULT_AGENT_LABEL}</span>
            </div>
            {value === undefined && <CheckIcon className="size-4" />}
          </div>
        </DropdownMenuItem>
        {sortedAgents.map((agent) => (
          <DropdownMenuItem
            key={agent._id}
            onClick={() => {
              if (!interactive) return;
              onChange(agent._id);
              setOpen(false);
            }}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <AgentAvatar
                  name={agent.name}
                  color={agent.appearance.color}
                  size="xs"
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 truncate">{agent.name}</span>
              </div>
              {selectedAgent?._id === agent._id && (
                <CheckIcon className="size-4 shrink-0" />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
