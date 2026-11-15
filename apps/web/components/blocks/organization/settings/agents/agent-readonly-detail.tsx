import { ArrowLeft } from "lucide-react";

import { AgentAvatar } from "@/components/blocks/agents/agent-avatar";
import {
  UNCATEGORIZED_CATEGORY,
  getAgentCategory,
  type AgentListItem,
} from "@/components/blocks/agents/agent-list-utils";
import { SettingsReadonlyMarkdown } from "@/components/blocks/settings-catalog/settings-readonly-markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface AgentReadonlyDetailProps {
  agent: AgentListItem;
  onBack: () => void;
}

export function AgentReadonlyDetail({ agent, onBack }: AgentReadonlyDetailProps) {
  const category = getAgentCategory(agent);
  const prompt = agent.prompt?.trim();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" />
        Back
      </Button>

      <header className="flex items-start gap-4">
        <AgentAvatar
          name={agent.name}
          color={agent.appearance.color}
          size="xl"
          className="mt-1"
        />
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {agent.name}
            </h1>
            <Badge variant="outline" shape="rounded">
              {category || UNCATEGORIZED_CATEGORY}
            </Badge>
          </div>
          {agent.description ? (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {agent.description}
            </p>
          ) : null}
        </div>
      </header>

      {prompt ? (
        <section className="rounded-lg border border-border bg-background p-5">
          <SettingsReadonlyMarkdown value={prompt} />
        </section>
      ) : null}
    </div>
  );
}
