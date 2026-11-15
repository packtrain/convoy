"use client";

import type { ComponentType } from "react";
import { format } from "date-fns";
import { StatusBadge, PriorityIcon } from "@/components/blocks/tasks/task-table/badges";
import { isTaskStatus } from "@/lib/tasks/status-policy";
import {
  Plus,
  Trash2,
  RotateCcw,
  Archive,
  ArchiveRestore,
  User,
  Bot,
  Calendar,
  FileText,
  Type,
  GitBranch,
  ListTree,
  ArrowRight,
  Paperclip,
  Tag,
  Tags,
} from "lucide-react";
import { TaskTypeGlyph } from "@/components/blocks/tasks/task-ref-with-type";
import { EXTERNAL_LINK_PRESENTATION } from "@/lib/tasks/external-link-presentation";
import { getBuiltInTaskTypeByKey } from "@/lib/tasks/task-types";
import type { ActivityLog } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/**
 * Event types that exist only as history and render as nothing.
 *
 * `comment_added` is retired: the merged timeline renders the comment itself. The write
 * site is gone but historical rows remain, and they are deliberately not filtered
 * server-side — a read-time filter would break the pagination cursor.
 */
const RETIRED_ACTIVITY_EVENT_TYPES = new Set<ActivityLog["eventType"]>(["comment_added"]);

/** False for rows that render as nothing, so hosts can skip their chrome too. */
export function isRenderableActivity(activity: ActivityLog): boolean {
  return !RETIRED_ACTIVITY_EVENT_TYPES.has(activity.eventType);
}

/** Shared size for every event glyph, inline or in the timeline's rail gutter. */
const GLYPH = "h-3.5 w-3.5";

/**
 * One event's copy, with its glyph kept separate from its text.
 *
 * The two hosts place the glyph differently: the avatar-attributed rows render it inline
 * at the head of the sentence, the timeline's rail puts it in a gutter. The wording must
 * have exactly one home — the playground prototype reimplemented every string as seed
 * data, and two copies drift.
 *
 * `icon` is null for value-change events whose glyph is the value itself (status,
 * priority, type); the rail substitutes one, see `getActivityRailIcon`.
 */
export interface ActivityDescriptor {
  icon: React.ReactNode | null;
  text: React.ReactNode;
}

function ActivityStatusValue({ status }: { status: string }) {
  if (isTaskStatus(status)) {
    return <StatusBadge status={status} />;
  }

  return (
    <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground">
      {status}
    </span>
  );
}

/**
 * The one catalog of event copy. Every surface that words a task activity row
 * goes through here — see `ActivityDescriptor` for why the glyph is separate.
 */
export function describeActivity(activity: ActivityLog): ActivityDescriptor {
  const { eventType, changeDetails } = activity;

  switch (eventType) {
    case "created":
      return { icon: <Plus className={GLYPH} />, text: "created this task" };

    case "status_changed":
      if (changeDetails?.type === "status") {
        return {
          // The status badges below are the glyph; a duplicate icon would say
          // nothing the values don't.
          icon: null,
          text: (
            <>
              changed status from
              <ActivityStatusValue status={changeDetails.oldValue ?? "Unknown"} />
              <ArrowRight className="h-3 w-3" />
              <ActivityStatusValue status={changeDetails.newValue} />
            </>
          ),
        };
      }
      break;

    case "priority_changed":
      if (changeDetails?.type === "priority") {
        return {
          icon: null,
          text: (
            <>
              changed priority from
              <span className="inline-flex items-center gap-1 text-foreground">
                <PriorityIcon priority={changeDetails.oldValue!} />
                {changeDetails.oldValue}
              </span>
              <ArrowRight className="h-3 w-3" />
              <span className="inline-flex items-center gap-1 text-foreground">
                <PriorityIcon priority={changeDetails.newValue} />
                {changeDetails.newValue}
              </span>
            </>
          ),
        };
      }
      break;

    case "assignee_changed":
      if (changeDetails?.type === "assignee") {
        const hasRenderableOldAssignee =
          changeDetails.oldUserName !== undefined ||
          changeDetails.oldAssignee?.name !== undefined ||
          !changeDetails.oldUserId;
        // Fall back to the typed activity values so historical agent-assignment
        // rows (pre-OS-1335) render the agent name instead of "No assignee".
        const oldName = changeDetails.oldUserName ?? changeDetails.oldAssignee?.name ?? "No assignee";
        const newName =
          changeDetails.newUserName ??
          changeDetails.newAssignee?.name ??
          (changeDetails.newUserId ? "Assigned user" : "No assignee");
        if (!hasRenderableOldAssignee) {
          return {
            icon: <User className={GLYPH} />,
            text: (
              <>
                changed assignee to <span className="text-foreground">{newName}</span>
              </>
            ),
          };
        }

        return {
          icon: <User className={GLYPH} />,
          text: (
            <>
              changed assignee from <span className="text-foreground">{oldName}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="text-foreground">{newName}</span>
            </>
          ),
        };
      }
      break;

    case "delegation_changed":
      if (changeDetails?.type === "delegation") {
        const oldAgent = changeDetails.oldAgentName;
        const newAgent = changeDetails.newAgentName;
        if (!newAgent) {
          return {
            icon: <Bot className={GLYPH} />,
            text: (
              <>
                removed delegation{oldAgent ? <> from <span className="text-foreground">{oldAgent}</span></> : null}
              </>
            ),
          };
        }
        if (!oldAgent) {
          return {
            icon: <Bot className={GLYPH} />,
            text: (
              <>
                delegated to <span className="text-foreground">{newAgent}</span>
              </>
            ),
          };
        }
        return {
          icon: <Bot className={GLYPH} />,
          text: (
            <>
              changed delegation from <span className="text-foreground">{oldAgent}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="text-foreground">{newAgent}</span>
            </>
          ),
        };
      }
      break;

    case "list_changed":
      if (changeDetails?.type === "list") {
        const oldList =
          changeDetails.oldListName ??
          (changeDetails.oldListId ? "removed list" : "Inbox");
        const newList =
          changeDetails.newListName ??
          (changeDetails.newListSystem === "backlog" ? "Backlog" : "Inbox");
        return {
          icon: <ListTree className={GLYPH} />,
          text: (
            <>
              moved from <span className="text-foreground">{oldList}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="text-foreground">{newList}</span>
            </>
          ),
        };
      }
      break;

    case "label_changed":
      if (changeDetails?.type === "label") {
        // Names/colors are denormalized in the log, so history renders even
        // after the label itself is deleted.
        const oldLabel = changeDetails.oldLabelName;
        const newLabel = changeDetails.newLabelName;
        if (!oldLabel && newLabel) {
          return {
            icon: <Tag className={GLYPH} />,
            text: (
              <>
                set label to <ActivityLabelValue name={newLabel} color={changeDetails.newLabelColor} />
              </>
            ),
          };
        }
        if (oldLabel && !newLabel) {
          return {
            icon: <Tag className={GLYPH} />,
            text: (
              <>
                removed label <ActivityLabelValue name={oldLabel} color={changeDetails.oldLabelColor} />
              </>
            ),
          };
        }
        if (oldLabel && newLabel) {
          return {
            icon: <Tag className={GLYPH} />,
            text: (
              <>
                changed label from <ActivityLabelValue name={oldLabel} color={changeDetails.oldLabelColor} />
                <ArrowRight className="h-3 w-3" />
                <ActivityLabelValue name={newLabel} color={changeDetails.newLabelColor} />
              </>
            ),
          };
        }
      }
      break;

    case "parent_changed":
      if (changeDetails?.type === "parent") {
        const oldParent = changeDetails.oldParentName ?? "top-level";
        const newParent = changeDetails.newParentName ?? "top-level";
        return {
          icon: <GitBranch className={GLYPH} />,
          text: (
            <>
              moved from <span className="text-foreground">{oldParent}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="text-foreground">{newParent}</span>
            </>
          ),
        };
      }
      break;

    case "due_date_changed":
      if (changeDetails?.type === "due_date") {
        const formatDate = (ts: number | undefined) =>
          ts ? format(new Date(ts), "MMM d, yyyy") : "none";
        return {
          icon: <Calendar className={GLYPH} />,
          text: (
            <>
              changed due date from <span className="text-foreground">{formatDate(changeDetails.oldValue)}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="text-foreground">{formatDate(changeDetails.newValue)}</span>
            </>
          ),
        };
      }
      break;

    case "name_edited":
      return { icon: <Type className={GLYPH} />, text: "updated the name" };

    case "description_edited":
      return { icon: <FileText className={GLYPH} />, text: "updated the description" };

    case "deleted":
      return { icon: <Trash2 className={GLYPH} />, text: "deleted this task" };

    case "restored":
      return { icon: <RotateCcw className={GLYPH} />, text: "restored this task" };

    case "archived":
      return { icon: <Archive className={GLYPH} />, text: "archived this task" };

    case "unarchived":
      // Not plain "restored this task" — `restored` already owns that copy for
      // soft-delete restores.
      return {
        icon: <ArchiveRestore className={GLYPH} />,
        text: "restored this task from the archive",
      };

    case "tags_changed":
      if (changeDetails?.type === "tags") {
        return {
          icon: <Tags className={GLYPH} />,
          text: <ActivityTagsValue added={changeDetails.added} removed={changeDetails.removed} />,
        };
      }
      break;

    case "type_changed":
      if (changeDetails?.type === "task_type") {
        return {
          icon: null,
          text: (
            <>
              changed type from
              <ActivityTaskTypeValue typeKey={changeDetails.oldKey} name={changeDetails.oldName} />
              <ArrowRight className="h-3 w-3" />
              <ActivityTaskTypeValue typeKey={changeDetails.newKey} name={changeDetails.newName} />
            </>
          ),
        };
      }
      break;

    case "external_link_changed":
      if (changeDetails?.type === "external_link") {
        const { icon: LinkIcon, color, noun } = EXTERNAL_LINK_PRESENTATION[changeDetails.kind];
        const label = (
          <span className="min-w-0 truncate font-medium text-foreground">{changeDetails.label}</span>
        );
        return {
          icon: <LinkIcon className={cn(GLYPH, color)} />,
          text: (
            <>
              {changeDetails.op} {noun}{" "}
              {changeDetails.url && changeDetails.op !== "removed" ? (
                <a
                  href={changeDetails.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate hover:underline"
                >
                  {label}
                </a>
              ) : (
                label
              )}
            </>
          ),
        };
      }
      break;

    case "thread_attached":
      if (changeDetails?.type === "thread") {
        return {
          icon: <Bot className={GLYPH} />,
          text: (
            <>
              attached thread <span className="min-w-0 truncate font-medium text-foreground">{changeDetails.threadTitle}</span>
            </>
          ),
        };
      }
      break;

    // Retired: see RETIRED_ACTIVITY_EVENT_TYPES. Historical rows render as
    // nothing rather than duplicating the comment they point at.
    case "comment_added":
      return { icon: null, text: null };

    case "attachment_added":
      return describeNamedResourceEvent({
        changeDetails,
        eventType: "attachment",
        verb: "added",
        singularLabel: "an attachment",
        Icon: Paperclip,
      });

    case "attachment_removed":
      return describeNamedResourceEvent({
        changeDetails,
        eventType: "attachment",
        verb: "removed",
        singularLabel: "an attachment",
        Icon: Paperclip,
      });

    case "artifact_added":
      return describeNamedResourceEvent({
        changeDetails,
        eventType: "artifact",
        verb: "added",
        singularLabel: "an artifact",
        Icon: FileText,
      });

    case "artifact_updated":
      return describeNamedResourceEvent({
        changeDetails,
        eventType: "artifact",
        verb: "updated",
        singularLabel: "an artifact",
        Icon: FileText,
      });

    case "artifact_removed":
      return describeNamedResourceEvent({
        changeDetails,
        eventType: "artifact",
        verb: "removed",
        singularLabel: "an artifact",
        Icon: FileText,
      });
  }

  // An event the catalog has no case for — a backend type added without a
  // frontend case, or details that don't match their event (OS-1455).
  return { icon: null, text: "performed an action" };
}

function ActivityTagChip({ tag, prefix }: { tag: string; prefix?: string }) {
  return (
    <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground">
      {prefix}
      {tag}
    </span>
  );
}

/** One row for a whole tag edit: `+`/`−` prefixes only when both sides changed. */
function ActivityTagsValue({ added, removed }: { added: string[]; removed: string[] }) {
  const isSwap = added.length > 0 && removed.length > 0;
  const copy = isSwap
    ? "changed tags"
    : added.length > 0
      ? `added ${added.length === 1 ? "tag" : "tags"}`
      : `removed ${removed.length === 1 ? "tag" : "tags"}`;

  // No leading glyph here: the descriptor owns it (`describeActivity`), so the
  // rail can hoist it into its gutter.
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      {copy}
      {added.map((tag) => (
        <ActivityTagChip key={`+${tag}`} tag={tag} prefix={isSwap ? "+" : undefined} />
      ))}
      {removed.map((tag) => (
        <ActivityTagChip key={`-${tag}`} tag={tag} prefix={isSwap ? "−" : undefined} />
      ))}
    </span>
  );
}

function ActivityTaskTypeValue({ typeKey, name }: { typeKey?: string; name?: string }) {
  // Denormalized name wins; keys that are no longer built-in render as text.
  const builtIn = typeKey ? getBuiltInTaskTypeByKey(typeKey) : null;
  return (
    <span className="inline-flex items-center gap-1 text-foreground">
      {builtIn && <TaskTypeGlyph taskType={builtIn} sizeClassName="size-3.5" />}
      {name ?? builtIn?.name ?? typeKey ?? "Unknown"}
    </span>
  );
}

function ActivityLabelValue({ name, color }: { name: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-foreground">
      {color && <span className="size-2 rounded-full" style={{ backgroundColor: color }} />}
      {name}
    </span>
  );
}

function describeNamedResourceEvent({
  changeDetails,
  eventType,
  verb,
  singularLabel,
  Icon,
}: {
  changeDetails: ActivityLog["changeDetails"];
  eventType: "attachment" | "artifact";
  verb: "added" | "updated" | "removed";
  singularLabel: string;
  Icon: ComponentType<{ className?: string }>;
}): ActivityDescriptor {
  const icon = <Icon className={GLYPH} />;
  if (changeDetails?.type === eventType) {
    return {
      icon,
      text: (
        <>
          {verb} {eventType}{" "}
          <span className="font-medium text-foreground">&quot;{changeDetails.fileName}&quot;</span>
        </>
      ),
    };
  }
  return { icon, text: `${verb} ${singularLabel}` };
}
