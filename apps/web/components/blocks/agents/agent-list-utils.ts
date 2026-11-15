import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import {
  ALL_CATEGORY,
  UNCATEGORIZED_CATEGORY,
  filterCatalogItems,
  getCatalogCategories,
  getCatalogItemCategory,
  markdownToPlainText,
  stripMatchingFirstMarkdownHeading,
  type SettingsCatalogCategory,
} from "@/components/blocks/settings-catalog/settings-catalog-list-utils";

export { ALL_CATEGORY, UNCATEGORIZED_CATEGORY };

export type OrganizationAgentListItem = FunctionReturnType<
  typeof api.agents.core.listByOrganization
>[number];

export type ProjectAgentListItem = FunctionReturnType<
  typeof api.agents.projectAgents.listByProject
>[number];

type AgentSharedListFields =
  | "_id"
  | "name"
  | "description"
  | "prompt"
  | "category"
  | "appearance";

export type AgentListItem =
  | Pick<OrganizationAgentListItem, AgentSharedListFields>
  | Pick<ProjectAgentListItem, AgentSharedListFields | "sourceAgentId">;

export type AgentCategory = SettingsCatalogCategory;

export function getAgentCategory(
  agent: Pick<AgentListItem, "category">
): string {
  return getCatalogItemCategory(agent);
}

export function deriveAgentCardPreview(
  agent: Pick<AgentListItem, "name" | "description" | "prompt">
): string {
  const description = agent.description?.trim();
  if (description) {
    return description;
  }

  return markdownToPlainText(
    stripMatchingFirstMarkdownHeading(agent.prompt ?? "", agent.name)
  );
}

export function getAgentCategories(agents: AgentListItem[]): AgentCategory[] {
  return getCatalogCategories(agents);
}

export function sortAgentsByName<TAgent extends Pick<AgentListItem, "name">>(
  agents: TAgent[]
): TAgent[] {
  return [...agents].sort((a, b) => a.name.localeCompare(b.name));
}

function searchTextForAgent(agent: AgentListItem): string {
  return [
    agent.name,
    agent.description,
    getAgentCategory(agent),
    deriveAgentCardPreview(agent),
    markdownToPlainText(agent.prompt ?? ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterAgents<TAgent extends AgentListItem>(
  agents: TAgent[],
  args: { category: string; search: string }
): TAgent[] {
  return filterCatalogItems(agents, {
    ...args,
    searchText: searchTextForAgent,
    sortKey: (agent) => agent.name,
  });
}
