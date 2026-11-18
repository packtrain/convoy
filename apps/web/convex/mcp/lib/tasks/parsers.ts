import type { Id, TableNames } from "../../../_generated/dataModel";
import { is } from "@/lib/type-guards";
import type { AssigneeIdInput } from "../../../tasks/lib/validators";
import { should, throwInvalidParams } from "../should";
import { ALL_TASK_STATUSES, isTaskStatus } from "@/lib/tasks/status-policy";
import type { Status as TaskStatus } from "@/lib/tasks/status";
import {
  TASK_EXTERNAL_LINK_KINDS,
  isTaskExternalLinkKind,
  type TaskExternalLinkInput,
} from "@/lib/tasks/external-links";

export type SearchTaskFilters = {
  status?: TaskStatus;
  assigneeId?: AssigneeIdInput;
  delegatedToAgentId?: Id<"projectAgents"> | null;
};

export type TaskAssigneeSplitParams = {
  assigneeId?: AssigneeIdInput;
  delegatedToAgentId?: Id<"projectAgents"> | null;
};

function parseNullableIdValue<Table extends TableNames>(value: unknown, label: string): Id<Table> | null {
  if (value === null) return null;
  if (!is.string(value) || value.length === 0) {
    throwInvalidParams(`${label} must be a non-empty string or null`);
  }
  return value as Id<Table>;
}

export function rejectRemovedTaskAssigneeParam(args: Record<string, unknown>, key = "assignee") {
  if (args[key] !== undefined) {
    throwInvalidParams(`${key} is no longer supported; use assigneeId (user) and/or delegatedToAgentId (agent)`);
  }
}

/** Parse the split assignment params (OS-1335): assigneeId = human owner, delegatedToAgentId = agent executor. */
export function parseTaskAssigneeSplitArgs(args: Record<string, unknown>): TaskAssigneeSplitParams {
  rejectRemovedTaskAssigneeParam(args);
  const result: TaskAssigneeSplitParams = {};
  if (args.assigneeId !== undefined) {
    result.assigneeId = parseNullableIdValue<"users">(args.assigneeId, "assigneeId");
  }
  if (args.delegatedToAgentId !== undefined) {
    result.delegatedToAgentId = parseNullableIdValue<"projectAgents">(args.delegatedToAgentId, "delegatedToAgentId");
  }
  return result;
}

export function parseSearchTaskFilters(
  args: Record<string, unknown>,
  key: string
): SearchTaskFilters | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const obj = should.beRecord(value, key);

  const filters: SearchTaskFilters = {};

  if (obj.status !== undefined) {
    if (!isTaskStatus(obj.status)) {
      throwInvalidParams(`${key}.status must be one of: ${ALL_TASK_STATUSES.join(", ")}`);
    }
    filters.status = obj.status;
  }

  if (obj.assignee !== undefined) {
    throwInvalidParams(
      `${key}.assignee is no longer supported; use ${key}.assigneeId (user) and/or ${key}.delegatedToAgentId (agent)`
    );
  }

  if (obj.assigneeId !== undefined) {
    filters.assigneeId = parseNullableIdValue<"users">(obj.assigneeId, `${key}.assigneeId`);
  }

  if (obj.delegatedToAgentId !== undefined) {
    filters.delegatedToAgentId = parseNullableIdValue<"projectAgents">(
      obj.delegatedToAgentId,
      `${key}.delegatedToAgentId`
    );
  }

  if (Object.keys(filters).length === 0) return undefined;
  return filters;
}

/**
 * Narrows an untrusted `link` arg into the external-link input union so the
 * Convex mutation's args validator never sees a malformed shape. Per-kind
 * required fields are enforced here; content rules (sha/url formats, lengths)
 * stay in the tasks domain.
 */
export function parseExternalLinkInput(
  args: Record<string, unknown>,
  key: string
): TaskExternalLinkInput | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const link = should.beRecord(value, key);

  const requiredText = (field: string): string => {
    const fieldValue = link[field];
    if (!is.string(fieldValue) || fieldValue.length === 0) {
      throwInvalidParams(
        `${key}.${field} is required and must be a non-empty string`
      );
    }
    return fieldValue;
  };
  const optionalText = (field: string): string | undefined => {
    const fieldValue = link[field];
    if (fieldValue === undefined || fieldValue === null) return undefined;
    if (!is.string(fieldValue)) {
      throwInvalidParams(`${key}.${field} must be a string`);
    }
    return fieldValue;
  };

  const kind = requiredText("kind");
  if (!isTaskExternalLinkKind(kind)) {
    throwInvalidParams(
      `${key}.kind must be one of: ${TASK_EXTERNAL_LINK_KINDS.join(", ")}`
    );
  }

  switch (kind) {
    case "commit": {
      const sha = requiredText("sha");
      const title = optionalText("title");
      const repo = optionalText("repo");
      const branch = optionalText("branch");
      const url = optionalText("url");
      return {
        kind,
        sha,
        ...(title !== undefined && { title }),
        ...(repo !== undefined && { repo }),
        ...(branch !== undefined && { branch }),
        ...(url !== undefined && { url }),
      };
    }
    case "branch": {
      const name = requiredText("name");
      const repo = optionalText("repo");
      const url = optionalText("url");
      return {
        kind,
        name,
        ...(repo !== undefined && { repo }),
        ...(url !== undefined && { url }),
      };
    }
    case "pull_request": {
      const url = requiredText("url");
      const title = optionalText("title");
      const identifier = optionalText("identifier");
      const repo = optionalText("repo");
      const branch = optionalText("branch");
      return {
        kind,
        url,
        ...(title !== undefined && { title }),
        ...(identifier !== undefined && { identifier }),
        ...(repo !== undefined && { repo }),
        ...(branch !== undefined && { branch }),
      };
    }
    case "url": {
      const url = requiredText("url");
      const title = optionalText("title");
      return {
        kind,
        url,
        ...(title !== undefined && { title }),
      };
    }
  }
}
