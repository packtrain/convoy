import { AgentAvatar } from "@/components/blocks/agents/agent-avatar";
import { cn } from "@/lib/utils";

export interface ThreadAgentChipAgent {
  name: string;
  color: string;
  isDeleted: boolean;
}

/**
 * Agent attribution chip for bound threads (OS-1138): initials avatar in the
 * agent's color plus the agent name. The backend resolves deleted agents to
 * the "Deleted agent" placeholder (`isDeleted: true`), rendered dimmed here.
 * Compact mode shows only the avatar (name in the tooltip) for dense rows.
 * The agent's prompt is never rendered anywhere in the thread.
 */
export function ThreadAgentChip({
  agent,
  compact = false,
  className,
}: {
  agent: ThreadAgentChipAgent;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        agent.isDeleted && "opacity-60",
        className
      )}
      title={agent.name}
    >
      <AgentAvatar name={agent.name} color={agent.color} size="xs" className="size-4 shrink-0" />
      {compact ? (
        <span className="sr-only">{agent.name}</span>
      ) : (
        <span
          className={cn(
            "min-w-0 truncate text-xs text-muted-foreground",
            agent.isDeleted && "italic"
          )}
        >
          {agent.name}
        </span>
      )}
    </span>
  );
}
