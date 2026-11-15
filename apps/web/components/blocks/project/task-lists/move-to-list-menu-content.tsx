"use client";

import { type ComponentType, type ReactNode, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { createPersistedTaskListKey } from "@/convex/lib/contracts/taskListKeys";
import { Archive, ChevronLeft, CircleDashed } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskSection } from "@/convex/tasks/lib/validators";
import { ActionButton } from "@/components/custom/action-button";
import {
  getSearchablePickerItemProps,
  handleSearchablePickerKeyDown,
} from "@/components/custom/searchable-picker-keyboard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  BACKLOG_SYSTEM_LIST,
  isBacklogListRef,
} from "@/lib/task-lists/system-lists";
import { DropdownSearchInput } from "@/components/custom/dropdown-search-input";
import { TaskListIdentity } from "./task-list-identity";
import {
  filterSystemRows,
  matchesTaskListMenuQuery,
  resolveDefaultTaskList,
} from "./task-list-menu-model";
import type { TaskListItem } from "./task-list-types";
import {
  useActiveTaskListResults,
  type TaskListResultsController,
} from "./use-task-list-results";

type MenuItemComponent = ComponentType<{
  children: ReactNode;
  onClick?: (event: React.MouseEvent) => void;
  /** Radix menu items close on select unless this prevents default. */
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  className?: string;
  "data-searchable-picker-item"?: string;
}>;

type ProjectSection = TaskSection & { listKey: string };
/** `sectionId` is the optional destination section (OS-2137); omitted = No section. */
export type MoveToListHandler = (
  listRef: string,
  sectionId?: Id<"taskSections">
) => void;

interface MoveToListMenuContentProps {
  projectId?: Id<"projects">;
  resultsController?: TaskListResultsController;
  selectedListRef?: string | null;
  autoFocusSearch?: boolean;
  /** Moves at once to No section, for callers that ignore `sectionId`. */
  skipSections?: boolean;
  onMoveToList: MoveToListHandler;
  onAfterSelect?: () => void;
  Item?: MenuItemComponent;
  itemClassName?: string;
}

function ListRowButton({
  list,
  disabled,
  onSelect,
}: {
  list: TaskListItem;
  disabled?: boolean;
  onSelect: (list: TaskListItem) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      {...getSearchablePickerItemProps(!disabled)}
      className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) {
          onSelect(list);
        }
      }}
    >
      <TaskListIdentity list={list} size="compact" />
    </button>
  );
}

function SystemRowButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      {...getSearchablePickerItemProps(!disabled)}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm",
        disabled
          ? "cursor-not-allowed text-muted-foreground opacity-60"
          : "cursor-pointer hover:bg-accent hover:text-accent-foreground"
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function MoveToListMenuContent({
  projectId,
  resultsController,
  selectedListRef = null,
  autoFocusSearch = false,
  skipSections = false,
  onMoveToList,
  onAfterSelect,
  Item,
  itemClassName,
}: MoveToListMenuContentProps) {
  const localResults = useActiveTaskListResults(
    resultsController ? undefined : projectId
  );
  const data = resultsController ?? localResults;
  const pickerRef = useRef<HTMLDivElement>(null);
  const normalizedSelectedListRef = selectedListRef?.trim().toUpperCase() ?? null;
  const defaultList = resolveDefaultTaskList(data.results);
  const visibleProjectLists = data.results.filter((list) => !list.isDefault);
  const normalizedQuery = data.query.trim().toLocaleLowerCase();
  const shouldShowDefaultRow =
    defaultList !== null && matchesTaskListMenuQuery(defaultList, normalizedQuery);
  const systemLists = [
    {
      key: BACKLOG_SYSTEM_LIST.key,
      label: BACKLOG_SYSTEM_LIST.name,
      icon: <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />,
    },
    {
      key: "archived",
      label: "Archived",
      icon: <Archive className="size-3.5 shrink-0 text-muted-foreground" />,
    },
  ];
  const filteredSystemLists = filterSystemRows(systemLists, normalizedQuery);
  const emptyMessage = data.query.trim()
    ? `"${data.query.trim()}" does not exist`
    : "No lists found";

  // One project-wide read while the menu is open, so a List without sections moves on first click.
  const projectSections = useQuery(
    api.tasks.sections.listByProject,
    projectId && !skipSections ? { projectId } : "skip"
  );
  // Until sections load, a List can't tell whether it needs the section step.
  const sectionsLoading =
    !skipSections && projectId !== undefined && projectSections === undefined;
  const [pending, setPending] = useState<{
    listRef: string;
    name: string;
    sections: ProjectSection[];
  } | null>(null);
  const sectionsOf = (listKey: string) =>
    (projectSections ?? []).filter((section) => section.listKey === listKey);
  const keepOpenFor = (listKey: string) => (event: Event) => {
    if (sectionsOf(listKey).length > 0) event.preventDefault();
  };
  const chooseList = (listRef: string, name: string, listKey: string) => {
    const sections = sectionsOf(listKey);
    if (sections.length > 0) {
      setPending({ listRef, name, sections });
      return;
    }
    onMoveToList(listRef);
    onAfterSelect?.();
  };
  const handleSelect = (list: TaskListItem) =>
    chooseList(list.ref, list.name, createPersistedTaskListKey(list._id));
  const renderListTarget = (list: TaskListItem) => {
    const disabled = normalizedSelectedListRef === list.ref || sectionsLoading;
    return Item ? (
      <Item
        key={list._id}
        className={itemClassName}
        disabled={disabled}
        {...getSearchablePickerItemProps(!disabled)}
        onSelect={keepOpenFor(createPersistedTaskListKey(list._id))}
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) {
            handleSelect(list);
          }
        }}
      >
        <TaskListIdentity list={list} size="compact" />
      </Item>
    ) : (
      <ListRowButton
        key={list._id}
        list={list}
        disabled={disabled}
        onSelect={handleSelect}
      />
    );
  };
  const renderDisabledSystemTarget = ({
    key,
    label,
    icon,
  }: {
    key: string;
    label: string;
    icon: ReactNode;
  }) =>
    Item ? (
      <Item key={key} className={itemClassName} disabled>
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
      </Item>
    ) : (
      <SystemRowButton key={key} disabled>
        {icon}
        <span className="truncate">{label}</span>
      </SystemRowButton>
    );
  const chooseBacklog = () =>
    chooseList(
      BACKLOG_SYSTEM_LIST.ref,
      BACKLOG_SYSTEM_LIST.name,
      BACKLOG_SYSTEM_LIST.listKey
    );
  const renderBack = (name: string) => {
    const content = (
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <ChevronLeft className="size-3.5 shrink-0" />
        <span className="truncate">Section in {name}</span>
      </span>
    );
    const back = () => setPending(null);
    return Item ? (
      <Item
        className={itemClassName}
        {...getSearchablePickerItemProps(true)}
        onSelect={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          back();
        }}
      >
        {content}
      </Item>
    ) : (
      <SystemRowButton onClick={back}>{content}</SystemRowButton>
    );
  };
  const renderSectionTarget = (section: ProjectSection | null) => {
    const select = () => {
      if (!pending) return;
      onMoveToList(pending.listRef, section?._id);
      onAfterSelect?.();
    };
    const content = (
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full border border-border"
          style={{ backgroundColor: section?.color ?? undefined }}
        />
        <span className="truncate">{section?.name ?? "No section"}</span>
      </span>
    );
    return Item ? (
      <Item
        key={section?._id ?? "none"}
        className={itemClassName}
        {...getSearchablePickerItemProps(true)}
        onClick={(event) => {
          event.stopPropagation();
          select();
        }}
      >
        {content}
      </Item>
    ) : (
      <SystemRowButton key={section?._id ?? "none"} onClick={select}>
        {content}
      </SystemRowButton>
    );
  };
  const renderBacklogTarget = () => {
    const disabled =
      isBacklogListRef(normalizedSelectedListRef) || sectionsLoading;
    const content = (
      <span className="flex min-w-0 items-center gap-2">
        <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{BACKLOG_SYSTEM_LIST.name}</span>
      </span>
    );

    return Item ? (
      <Item
        key={BACKLOG_SYSTEM_LIST.key}
        className={itemClassName}
        disabled={disabled}
        {...getSearchablePickerItemProps(!disabled)}
        onSelect={keepOpenFor(BACKLOG_SYSTEM_LIST.listKey)}
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) {
            chooseBacklog();
          }
        }}
      >
        {content}
      </Item>
    ) : (
      <SystemRowButton
        key={BACKLOG_SYSTEM_LIST.key}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            chooseBacklog();
          }
        }}
      >
        {content}
      </SystemRowButton>
    );
  };
  const hasSystemRows = shouldShowDefaultRow || filteredSystemLists.length > 0;
  const hasPersistedRows = visibleProjectLists.length > 0;
  const hasRows = hasSystemRows || hasPersistedRows;

  return (
    <div
      ref={pickerRef}
      className="w-56"
      onClick={(event) => event.stopPropagation()}
      onKeyDownCapture={(event) => {
        if (handleSearchablePickerKeyDown(event, pickerRef.current)) {
          return;
        }
        if (event.key !== "Escape" && event.key !== "ArrowLeft") {
          event.stopPropagation();
        }
      }}
    >
      {pending ? (
        <div className="space-y-1 p-1">
          {renderBack(pending.name)}
          {[null, ...pending.sections].map(renderSectionTarget)}
        </div>
      ) : (
        <>
          <DropdownSearchInput
            value={data.query}
            onChange={(event) => data.setQuery(event.target.value)}
            placeholder="Search lists..."
            autoFocus={autoFocusSearch}
            clearLabel="Clear list search"
            onClear={data.resetQuery}
            showClearButton={data.query.length > 0}
          />

          <div className="max-h-56 overflow-y-auto p-1 pt-0">
            {data.isLoading ? (
              <div className="space-y-1 px-1 py-1">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex h-7 items-center gap-2 rounded-md px-1"
                  >
                    <Skeleton className="size-4 shrink-0 rounded-full" />
                    <Skeleton className="h-3 flex-1 rounded-sm" />
                  </div>
                ))}
              </div>
            ) : !hasRows ? (
              <div className="px-2 py-1 text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              <div className="space-y-1">
                {shouldShowDefaultRow ? renderListTarget(defaultList) : null}
                {filteredSystemLists.map((systemList) =>
                  systemList.key === "backlog"
                    ? renderBacklogTarget()
                    : renderDisabledSystemTarget(systemList)
                )}
                {hasSystemRows && hasPersistedRows ? (
                  <div
                    className={cn("h-px bg-border", Item ? "mx-1" : "mx-2")}
                  />
                ) : null}
                {visibleProjectLists.map(renderListTarget)}
              </div>
            )}
          </div>

          {data.hasMore ? (
            <div className="border-t border-border p-1">
              <ActionButton
                type="button"
                variant="ghost"
                size="sm"
                className="w-full cursor-pointer"
                busy={data.isLoadingMore}
                onClick={(event) => {
                  event.stopPropagation();
                  data.loadMore();
                }}
                showIcon={false}
              >
                Load more
              </ActionButton>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
