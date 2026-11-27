import type { Doc } from "../../_generated/dataModel";
import type { SearchableTask } from "./validators";

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function buildTaskSearchText(
  projectAlias: string,
  task: SearchableTask
): string {
  const normalizedAlias = projectAlias.trim().toUpperCase();
  const tokens = [
    `${normalizedAlias}-${task.refNumber}`,
    String(task.refNumber),
    task.name,
    task.description ?? "",
    task.tags.join(" "),
  ];
  return normalizeWhitespace(tokens.join(" ")).toLowerCase();
}

export function stripInternalTaskFields(task: Doc<"tasks">) {
  const {
    searchText: _searchText,
    taskTypeKey: _taskTypeKey,
    listKey: _listKey,
    assigneeId: _assigneeId,
    delegatedToAgentId: _delegatedToAgentId,
    agentThreadWork: _legacyAgentThreadWork,
    ...taskWithoutInternalFields
  } = task;
  void _searchText;
  void _taskTypeKey;
  void _listKey;
  void _assigneeId;
  void _delegatedToAgentId;
  void _legacyAgentThreadWork;
  return taskWithoutInternalFields;
}
