"use client";

import * as React from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ArrowLeft, Bell, Check, CheckCheck, CircleDot, ListFilter } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AppLink, appRoute } from "@/lib/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/custom/empty-state";
import { Spinner } from "@/components/custom/spinner";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { StatusBadge } from "@/components/blocks/tasks/task-table/badges";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { isCliType, renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { assertNever } from "@/lib/type-guards";
import { readNotificationsUnreadOnly, writeNotificationsUnreadOnly } from "@/lib/notifications/filter-storage";
import { groupForNotificationType } from "@/lib/notifications/preference-groups";
import type { Id } from "@/convex/_generated/dataModel";
import { useNotificationPreferences } from "@/lib/notifications/hooks/use-notification-preferences";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

type NotificationFeedItem = FunctionReturnType<typeof api.notifications.core.list>["page"][number];

function notificationVerb(item: NotificationFeedItem): React.ReactNode {
  switch (item.type) {
    case "task.created":
      return "created";
    case "task.status_changed":
      return item.snapshot.newStatus ? (
        <>
          moved to <StatusBadge status={item.snapshot.newStatus} className="align-middle" />
        </>
      ) : (
        "changed status of"
      );
    case "task.completed":
      return item.snapshot.newStatus === "Canceled" ? "canceled" : "completed";
    case "task.assignee_changed":
      return "reassigned";
    case "task.deleted":
      return "deleted";
    case "task.archived":
      return "archived";
    case "task.comment_added":
      return "commented on";
    case "thread.completed":
      return "finished";
    case "thread.failed":
      return "failed";
    case "thread.waiting_input":
      return "is waiting for your input";
    default:
      return assertNever(item.type);
  }
}

/**
 * Notifications inbox panel rendered in the sidebar subpage slot
 * (docs/specs/notifications.md). Header mirrors the settings subpage: back
 * button + title, plus mark-all-read and an all/unread filter. Rows link to
 * the task (closing the panel); read state changes only through the explicit
 * hover toolbar (mark read/unread) or mark-all — never as a click side effect.
 */
export function NotificationsSubpage({
  organizationId,
  onBack,
  dismissalBoundaryId,
}: {
  organizationId: Id<"organizations">;
  onBack: () => void;
  dismissalBoundaryId?: string;
}) {
  const [unreadOnly, setUnreadOnly] = React.useState(readNotificationsUnreadOnly);
  const changeUnreadOnly = (next: boolean) => {
    setUnreadOnly(next);
    writeNotificationsUnreadOnly(next);
  };
  const unreadCount = useQuery(api.notifications.core.unreadCount, { organizationId }) ?? 0;
  const markAllAsRead = useMutation(api.notifications.core.markAllAsRead);
  const { results, status, loadMore } = usePaginatedQuery(
    api.notifications.core.list,
    { organizationId, unreadOnly },
    { initialNumItems: PAGE_SIZE }
  );
  // One subscription for the whole list; rows receive it as a prop instead of
  // each instantiating the hook (and its optimistic-update closure) per row.
  const preferences = useNotificationPreferences();

  return (
    <>
      <SidebarHeader className="gap-3 px-4 py-3">
        <div className="flex h-7 items-center gap-2">
          <button
            type="button"
            aria-label="Back from notifications"
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring"
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <h2 className="flex-1 truncate text-sm font-semibold text-sidebar-foreground">Notifications</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Mark all as read"
            title="Mark all as read"
            disabled={unreadCount === 0}
            className="cursor-pointer text-sidebar-foreground/72"
            onClick={() => void markAllAsRead({ organizationId })}
          >
            <CheckCheck className="size-3.5" />
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Filter notifications"
                title="Filter"
                className={cn(
                  "cursor-pointer text-sidebar-foreground/72",
                  unreadOnly && "bg-sidebar-accent text-sidebar-accent-foreground"
                )}
              >
                <ListFilter className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-notifications-boundary={dismissalBoundaryId} align="end" className="min-w-40">
              <DropdownMenuRadioGroup value={unreadOnly ? "unread" : "all"} onValueChange={(value) => changeUnreadOnly(value === "unread")}>
                <DropdownMenuRadioItem value="all" className="cursor-pointer whitespace-nowrap">
                  Unread &amp; read
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="unread" className="cursor-pointer whitespace-nowrap">
                  Unread
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {status === "LoadingFirstPage" ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            fill
            icon={Bell}
            title={unreadOnly ? "You're all caught up" : "No notifications yet"}
            description="Activity on your tasks and threads will appear here."
          />
        ) : (
          <div className="flex flex-col">
            {results.map((item) => (
              <NotificationRow key={item._id} item={item} onNavigate={onBack} preferences={preferences} dismissalBoundaryId={dismissalBoundaryId} />
            ))}
            {status === "CanLoadMore" && (
              <Button
                variant="ghost"
                size="sm"
                className="mx-4 my-2 cursor-pointer text-muted-foreground"
                onClick={() => loadMore(PAGE_SIZE)}
              >
                Show more
              </Button>
            )}
            {status === "LoadingMore" && (
              <div className="flex justify-center py-2">
                <Spinner className="size-4 text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </SidebarContent>
    </>
  );
}

type NotificationPreferencesApi = ReturnType<typeof useNotificationPreferences>;

function NotificationRow({
  item,
  onNavigate,
  preferences,
  dismissalBoundaryId,
}: {
  item: NotificationFeedItem;
  onNavigate: () => void;
  preferences: NotificationPreferencesApi;
  dismissalBoundaryId?: string;
}) {
  const markRead = useMutation(api.notifications.core.markRead);
  const markUnread = useMutation(api.notifications.core.markUnread);
  const actorName = item.snapshot.actorName;
  // Absent when the recipient lost access to the project: no link, and the
  // snapshot content is replaced by a "No access" placeholder.
  const href =
    item.orgSlug === undefined || item.projectAlias === undefined
      ? null
      : item.subject.kind === "thread"
        ? appRoute.projectThreadDetail(item.orgSlug, item.projectAlias, item.subject.id)
        : item.snapshot.taskRef !== undefined
          ? appRoute.projectTask(item.orgSlug, item.projectAlias, item.snapshot.taskRef)
          : null;

  // Thread rows show the CLI runtime icon as the avatar — that alone marks
  // the actor as an agent.
  const cliIcon =
    item.subject.kind === "thread" && isCliType(item.snapshot.threadCliType)
      ? renderCliIcon(item.snapshot.threadCliType, "size-4")
      : null;

  const content = (
    <>
      <Avatar size="sm" className="mt-0.5">
        {item.actorAvatarUrl ? <AvatarImage src={item.actorAvatarUrl} alt="" /> : null}
        <AvatarFallback>{cliIcon ?? (actorName ?? "?").charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        {/* Line 1: actor (truncates) + time/unread. Line 2: verb (wraps —
            it is the "what happened", possibly with a status pill). */}
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground">
            {actorName ?? "Someone"}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {formatRelativeTime(item._creationTime)}
            {!item.read && <span aria-label="Unread" className="size-2 rounded-full bg-blue-400" />}
          </span>
        </div>
        {/* Failure rows must not read as routine — the verb carries the alarm color. */}
        <div className={cn("mt-0.5 text-sm", item.type === "thread.failed" ? "text-destructive" : "text-muted-foreground")}>
          {notificationVerb(item)}
        </div>
        {href === null ? (
          <p className="mt-0.5 text-sm italic text-muted-foreground">No access</p>
        ) : item.subject.kind === "thread" ? (
          <div className="mt-1 min-w-0 text-sm">
            <div className="truncate font-medium text-sidebar-foreground">{item.snapshot.threadTitle}</div>
            {item.snapshot.threadMessage !== undefined && (
              <p className="mt-0.5 line-clamp-2 text-muted-foreground">{item.snapshot.threadMessage}</p>
            )}
          </div>
        ) : (
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-medium text-sidebar-foreground">
            <TaskRefWithType
              refId={item.snapshot.taskRef ?? ""}
              taskType={resolveTaskTypeSummary(item.snapshot.taskTypeKey)}
              typeVariant="icon"
              className="shrink-0"
              refClassName="text-xs text-muted-foreground"
              refInteractive={false}
            />
            <span className="truncate">{item.snapshot.taskTitle}</span>
          </div>
        )}
      </div>
    </>
  );

  // Unread failure rows get a faint destructive wash (plus the red verb) so
  // they can't scan as routine; hover deepens the same tint instead of
  // switching to the neutral accent. Marking the row read drops the wash.
  const failedUnread = item.type === "thread.failed" && !item.read;
  const rowClassName = cn(
    "flex gap-2.5 border-b border-sidebar-border/50 px-4 py-3",
    failedUnread && "bg-destructive/5"
  );
  const hoverClassName = failedUnread
    ? "group-hover/notification:bg-destructive/10"
    : "group-hover/notification:bg-sidebar-accent";

  return (
    // The hover toolbar is a SIBLING of the row link, never a child: next/link
    // navigates on any React-bubbled click — including clicks inside the
    // portalled settings menu — regardless of DOM containment, so keeping the
    // toolbar out of the anchor is the only reliable guard.
    <div className="group/notification relative">
      {href === null ? (
        <div className={rowClassName}>{content}</div>
      ) : (
        // group-hover, not hover: the toolbar is a sibling overlaying the
        // link, so plain hover: would drop the highlight while over it.
        <AppLink href={href} className={cn(rowClassName, "cursor-pointer", hoverClassName)} onClick={onNavigate}>
          {content}
        </AppLink>
      )}
      {/* Hover toolbar: the ONLY way a single row changes read state.
          Always visible on touch (pointer-coarse) — there is no hover there. */}
      <div className="absolute right-2 top-2 flex rounded-md border border-sidebar-border bg-sidebar opacity-0 transition-opacity focus-within:opacity-100 group-hover/notification:opacity-100 pointer-coarse:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={item.read ? "Mark as unread" : "Mark as read"}
          title={item.read ? "Mark as unread" : "Mark as read"}
          className="cursor-pointer text-sidebar-foreground/72"
          onClick={() => void (item.read ? markUnread({ id: item._id }) : markRead({ id: item._id }))}
        >
          {item.read ? <CircleDot className="size-3.5" /> : <Check className="size-3.5" />}
        </Button>
        <NotificationSettingsMenu type={item.type} preferences={preferences} dismissalBoundaryId={dismissalBoundaryId} />
      </div>
    </div>
  );
}

/**
 * Per-row notification settings (Notion-style): a dropdown listing the row's
 * whole group with per-type in-app toggles. Items keep the menu open so
 * several types can be flipped in one visit.
 */
function NotificationSettingsMenu({
  type,
  preferences,
  dismissalBoundaryId,
}: {
  type: NotificationFeedItem["type"];
  preferences: NotificationPreferencesApi;
  dismissalBoundaryId?: string;
}) {
  const { loading, isEnabled, setChannel } = preferences;
  const group = groupForNotificationType(type);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Notification settings"
          title="Notification settings"
          className="cursor-pointer text-sidebar-foreground/72"
        >
          <Bell className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-notifications-boundary={dismissalBoundaryId} align="end" className="min-w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {group.label} notifications
        </DropdownMenuLabel>
        {group.types.map((entry) => (
          <DropdownMenuCheckboxItem
            key={entry.type}
            className="cursor-pointer"
            checked={isEnabled(entry.type, "inApp")}
            disabled={loading}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(next) => void setChannel([entry.type], "inApp", next)}
          >
            {entry.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
