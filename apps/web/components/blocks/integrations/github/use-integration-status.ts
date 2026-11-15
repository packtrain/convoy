import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type IntegrationStatus = NonNullable<FunctionReturnType<typeof api.integrations.github.core.get>>;
type Repository = IntegrationStatus["connections"][number]["repository"];

export function useIntegrationStatus(projectId: Id<"projects"> | undefined, setupId?: string) {
  return useQuery(api.integrations.github.core.get, projectId ? { projectId, setupId } : "skip");
}

/** The repository's sync error as a sentence that takes one trailing period. */
export function syncErrorText(repository: Repository): string {
  return (repository.error ?? "Sync failed").replace(/\.+$/, "");
}

export function repositoryCount(count: number): string {
  return `${count} ${count === 1 ? "repository" : "repositories"}`;
}

/** The index row's badge. */
export function githubSummary(status: IntegrationStatus): string {
  if (!status.configured) return "Not set up";
  const active = status.connections.filter((connection) => connection.status === "active").length;
  if (active) return `${repositoryCount(active)} connected`;
  return status.connections.length ? "Disconnected" : "Not connected";
}
