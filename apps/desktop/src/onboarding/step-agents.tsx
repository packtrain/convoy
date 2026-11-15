import { SectionHeader } from "@/components/section-header";
import { AgentsManager } from "@/components/agents-manager";

export function StepAgents({ onReadyCountChange }: { onReadyCountChange: (count: number) => void }) {
  return (
    <div className="flex w-full max-w-[460px] flex-col">
      <SectionHeader
        title="Install coding agents"
        description="Convoy dispatches work to agent CLIs on this Mac. At least one signed-in agent is required."
      />
      <AgentsManager onReadyCountChange={onReadyCountChange} />
    </div>
  );
}
