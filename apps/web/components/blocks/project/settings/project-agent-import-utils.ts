import type { ProjectAgentListItem } from "@/components/blocks/agents/agent-list-utils";

export interface AgentImportConflict<TAgent extends { name: string }> {
  agent: TAgent;
  projectAgent: ProjectAgentListItem;
}

export function normalizeAgentNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function generateImportedAgentName(
  name: string,
  date: Date,
  index: number
): string {
  const timestamp = [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    "-",
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
  ].join("");
  const suffix = index === 0 ? timestamp : `${timestamp}-${index + 1}`;

  return `${name} ${suffix}`;
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

export function getImportConflicts<TAgent extends { name: string }>(
  selectedAgents: TAgent[],
  projectAgents: ProjectAgentListItem[]
): AgentImportConflict<TAgent>[] {
  const projectAgentByName = new Map(
    projectAgents.map((projectAgent) => [
      normalizeAgentNameKey(projectAgent.name),
      projectAgent,
    ])
  );

  return selectedAgents.flatMap((agent) => {
    const projectAgent = projectAgentByName.get(normalizeAgentNameKey(agent.name));
    return projectAgent ? [{ agent, projectAgent }] : [];
  });
}
