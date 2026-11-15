import { AgentAvatar } from "./agent-avatar";
import { deriveAgentCardPreview, getAgentCategory, type AgentListItem } from "./agent-list-utils";
import { SettingsCatalogCard } from "@/components/blocks/settings-catalog/settings-catalog-card";
import type { RouteTarget } from "@/lib/navigation";

interface AgentCardProps {
  agent: AgentListItem;
  href: RouteTarget | string;
}

export function AgentCard({ agent, href }: AgentCardProps) {
  const preview = deriveAgentCardPreview(agent);
  const category = getAgentCategory(agent);

  return (
    <SettingsCatalogCard
      href={href}
      ariaLabel={`Open ${agent.name}`}
      title={agent.name}
      metadata={category}
      preview={preview}
      leading={<AgentAvatar name={agent.name} color={agent.appearance.color} size="md" />}
    />
  );
}
