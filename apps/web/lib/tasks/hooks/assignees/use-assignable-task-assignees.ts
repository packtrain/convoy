"use client";

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { taskAssigneeToKey } from "@/lib/tasks/assignees";
import type { TaskAssigneeDetails, TaskAssigneeInput } from "@/lib/tasks/types";

type AssignableUsers = FunctionReturnType<typeof api.projects.members.listAssignable>;
type ProjectAgents = FunctionReturnType<typeof api.agents.projectAgents.listByProject>;
type CurrentUser = FunctionReturnType<typeof api.users.core.current>;

export type AssignableTaskAssigneeOption =
  | {
      type: "user";
      value: { type: "user"; userId: Id<"users"> };
      details: Extract<TaskAssigneeDetails, { type: "user" }>;
      label: string;
      subtitle?: string;
      isCurrentUser: boolean;
      role?: string;
    }
  | {
      type: "projectAgent";
      value: { type: "projectAgent"; projectAgentId: Id<"projectAgents"> };
      details: Extract<TaskAssigneeDetails, { type: "projectAgent" }>;
      label: string;
      subtitle?: string;
      category?: string;
    };

export type AssignableTaskAssigneeSection = {
  label: "Agents" | "People";
  options: AssignableTaskAssigneeOption[];
};

export type AssignableTaskAssigneeDirectory = {
  projectId?: Id<"projects">;
  users: Extract<AssignableTaskAssigneeOption, { type: "user" }>[];
  projectAgents: Extract<AssignableTaskAssigneeOption, { type: "projectAgent" }>[];
  options: AssignableTaskAssigneeOption[];
  sections: AssignableTaskAssigneeSection[];
  isLoading: boolean;
  currentUserId?: Id<"users">;
  findOption: (assignee: TaskAssigneeInput | undefined) => AssignableTaskAssigneeOption | null;
};

const AssignableTaskAssigneesContext =
  createContext<AssignableTaskAssigneeDirectory | null>(null);

function userToOption(
  user: AssignableUsers[number],
  currentUser: CurrentUser | undefined
): Extract<AssignableTaskAssigneeOption, { type: "user" }> {
  return {
    type: "user",
    value: { type: "user", userId: user._id },
    details: {
      type: "user",
      userId: user._id,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
    },
    label: user.name,
    isCurrentUser: user._id === currentUser?._id,
    role: user.role,
  };
}

function projectAgentToOption(
  agent: ProjectAgents[number]
): Extract<AssignableTaskAssigneeOption, { type: "projectAgent" }> {
  return {
    type: "projectAgent",
    value: { type: "projectAgent", projectAgentId: agent._id },
    details: {
      type: "projectAgent",
      projectAgentId: agent._id,
      name: agent.name,
      appearance: agent.appearance,
      isDeleted: agent.isDeleted,
    },
    label: agent.name,
    subtitle: agent.description,
    category: agent.category,
  };
}

function useAssignableTaskAssigneesSource(
  projectId?: Id<"projects">,
  enabled = true
): AssignableTaskAssigneeDirectory {
  const assignableUsers = useQuery(
    api.projects.members.listAssignable,
    enabled && projectId ? { projectId } : "skip"
  );
  const projectAgents = useQuery(
    api.agents.projectAgents.listByProject,
    enabled && projectId ? { projectId } : "skip"
  );
  const currentUser = useQuery(api.users.core.current, enabled ? {} : "skip");

  const users = useMemo(
    () => (assignableUsers ?? []).map((user) => userToOption(user, currentUser)),
    [assignableUsers, currentUser]
  );
  const agentOptions = useMemo(
    () => (projectAgents ?? []).map(projectAgentToOption),
    [projectAgents]
  );
  const options = useMemo(
    () => [...agentOptions, ...users],
    [agentOptions, users]
  );
  const sections = useMemo<AssignableTaskAssigneeSection[]>(
    () => [
      { label: "Agents", options: agentOptions },
      { label: "People", options: users },
    ],
    [agentOptions, users]
  );

  const findOption = useMemo(() => {
    const byKey = new Map<string, AssignableTaskAssigneeOption>();
    for (const option of options) {
      const key = taskAssigneeToKey(option.value);
      if (!key) continue;
      byKey.set(key, option);
    }
    return (assignee: TaskAssigneeInput | undefined) => {
      const key = taskAssigneeToKey(assignee);
      return key ? byKey.get(key) ?? null : null;
    };
  }, [options]);

  return {
    projectId,
    users,
    projectAgents: agentOptions,
    options,
    sections,
    isLoading:
      projectId !== undefined &&
      (assignableUsers === undefined ||
        projectAgents === undefined ||
        currentUser === undefined),
    currentUserId: currentUser?._id,
    findOption,
  };
}

export function AssignableTaskAssigneesProvider({
  projectId,
  children,
}: {
  projectId?: Id<"projects">;
  children: ReactNode;
}) {
  const directory = useAssignableTaskAssigneesSource(projectId);

  return createElement(
    AssignableTaskAssigneesContext.Provider,
    { value: directory },
    children
  );
}

export function useAssignableTaskAssignees(
  projectId?: Id<"projects">
): AssignableTaskAssigneeDirectory {
  const context = useContext(AssignableTaskAssigneesContext);
  const hasMatchingContext = context?.projectId === projectId;
  const standalone = useAssignableTaskAssigneesSource(projectId, !hasMatchingContext);
  return hasMatchingContext && context ? context : standalone;
}
