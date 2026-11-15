import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import {
  consumePendingAssigneeDetails,
  resolveOptimisticAssigneeSplit,
  type PendingAssigneeSplitDetails,
} from "./optimistic-assignees";

const agentDetails = {
  type: "projectAgent" as const,
  projectAgentId: "agent-1" as Id<"projectAgents">,
  name: "Planner",
  appearance: { color: "#3b82f6" },
  isDeleted: false,
};

describe("optimistic-assignees", () => {
  test("builds fallback owner details from a raw assigneeId", () => {
    expect(
      resolveOptimisticAssigneeSplit({
        assigneeId: "user-1" as Id<"users">,
      })
    ).toEqual({
      assignee: {
        type: "user",
        userId: "user-1",
        name: null,
        avatarUrl: null,
      },
    });
  });

  test("clears both sides from null args", () => {
    expect(
      resolveOptimisticAssigneeSplit({
        assigneeId: null,
        delegatedToAgentId: null,
      })
    ).toEqual({
      assignee: null,
      delegatedToAgent: null,
    });
  });

  test("does not invent delegated-agent details without queued display data", () => {
    expect(
      resolveOptimisticAssigneeSplit({
        delegatedToAgentId: "agent-1" as Id<"projectAgents">,
      })
    ).toEqual({});
  });

  test("consumes pending details exactly once", () => {
    const details: PendingAssigneeSplitDetails = { delegatedToAgent: agentDetails };
    const pendingDetails = new Map<string, PendingAssigneeSplitDetails>([["task-1", details]]);

    expect(consumePendingAssigneeDetails(pendingDetails, "task-1")).toBe(details);
    expect(consumePendingAssigneeDetails(pendingDetails, "task-1")).toBeUndefined();
  });

  test("prefers queued pending details over fallback arg details", () => {
    const ownerDetails = {
      type: "user" as const,
      userId: "user-2" as Id<"users">,
      name: "Alex",
      avatarUrl: null,
    };

    expect(
      resolveOptimisticAssigneeSplit({
        pendingDetails: { assignee: ownerDetails, delegatedToAgent: agentDetails },
        assigneeId: "user-1" as Id<"users">,
        delegatedToAgentId: "agent-9" as Id<"projectAgents">,
      })
    ).toEqual({
      assignee: ownerDetails,
      delegatedToAgent: agentDetails,
    });
  });
});
