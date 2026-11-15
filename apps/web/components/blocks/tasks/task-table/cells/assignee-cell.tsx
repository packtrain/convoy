import type { Id } from "@/convex/_generated/dataModel";
import type { TaskAssigneeChange } from "@/lib/tasks/assignees";
import type { TaskDelegatedAgentDetails, TaskUserAssigneeDetails } from "@/lib/tasks/types";
import { AssigneeSelector } from "./assignee-selector";

interface AssigneeCellProps {
  assignee: TaskUserAssigneeDetails;
  delegatedToAgent: TaskDelegatedAgentDetails;
  projectId?: Id<"projects">;
  onAssigneeChange: (change: TaskAssigneeChange) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  isEditable?: boolean;
}

/**
 * Assignee cell for table rows. Shows the split assignment: delegated agent in
 * front (executor), human owner behind.
 * Responsive rendering is handled by AssigneeSelector via CSS container queries.
 */
export function AssigneeCell({
  assignee,
  delegatedToAgent,
  projectId,
  onAssigneeChange,
  onInviteClick,
  onAddAgentClick,
  isEditable,
}: AssigneeCellProps) {
  return (
    <AssigneeSelector
      assignee={assignee}
      delegatedToAgent={delegatedToAgent}
      projectId={projectId}
      onAssigneeChange={onAssigneeChange}
      onInviteClick={onInviteClick}
      onAddAgentClick={onAddAgentClick}
      variant="cell"
      isEditable={isEditable}
    />
  );
}
