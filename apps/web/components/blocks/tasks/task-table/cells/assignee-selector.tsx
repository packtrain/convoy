"use client";

import { useRef, useState } from "react";
import { Bot, Check, ChevronDown, Plus, User, UserPlus, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentAvatar } from "@/components/blocks/agents/agent-avatar";
import { SearchablePicker, type SearchablePickerItemComponent } from "@/components/custom/searchable-picker";
import { getSearchablePickerItemProps } from "@/components/custom/searchable-picker-keyboard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  displayNameForTaskAssignee,
  type TaskAssigneeChange,
  taskAssigneeOptionToChange,
  taskAssigneeToKey,
  CLEAR_DELEGATION_CHANGE,
} from "@/lib/tasks/assignees";
import {
  useAssignableTaskAssignees,
  type AssignableTaskAssigneeOption,
  type AssignableTaskAssigneeSection,
} from "@/lib/tasks/hooks/use-assignable-task-assignees";
import { useTaskFieldMenuTrigger } from "@/lib/tasks/hooks/use-task-field-menu";
import type {
  TaskAssigneeDetails,
  TaskDelegatedAgentDetails,
  TaskUserAssigneeDetails,
} from "@/lib/tasks/types";
import { cn, getInitials } from "@/lib/utils";
import { EmptyValue } from "../badges";

interface AssigneeSelectorProps {
  /** Current human owner (display + selected state). */
  assignee?: TaskUserAssigneeDetails;
  /** Current delegated agent executor (display + selected state). */
  delegatedToAgent?: TaskDelegatedAgentDetails;
  projectId?: Id<"projects">;
  onAssigneeChange: (change: TaskAssigneeChange) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  variant?: "default" | "cell" | "icon" | "compact";
  trigger?: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  disabled?: boolean;
  isEditable?: boolean;
  /** Controlled open state, so a shortcut can open the picker. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function UserAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  return (
    <Avatar className="size-5">
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      <AvatarFallback className="text-[10px]">{getInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

function UnassignedIcon() {
  return (
    <span className="flex size-5 items-center justify-center">
      <User className="size-4 text-muted-foreground" />
    </span>
  );
}

export function TaskAssigneeAvatar({
  assignee,
  className,
}: {
  assignee: TaskAssigneeDetails;
  className?: string;
}) {
  if (!assignee) return <UnassignedIcon />;
  if (assignee.type === "projectAgent") {
    return (
      <AgentAvatar
        name={assignee.name}
        color={assignee.appearance.color}
        size="xs"
        className={className}
      />
    );
  }
  return (
    <UserAvatar
      name={assignee.name ?? "Unknown assignee"}
      avatarUrl={assignee.avatarUrl}
    />
  );
}

/**
 * Combined split-assignment avatar: when a task is delegated AND owned, the
 * agent renders in front (it executes) with the owner peeking out behind.
 */
function TaskAssigneeSplitAvatar({
  assignee,
  delegatedToAgent,
  className,
}: {
  assignee: TaskUserAssigneeDetails;
  delegatedToAgent: TaskDelegatedAgentDetails;
  className?: string;
}) {
  if (delegatedToAgent && assignee) {
    return (
      <span className={cn("flex items-center", className)}>
        <span aria-hidden className="-mr-2">
          <TaskAssigneeAvatar assignee={assignee} />
        </span>
        <TaskAssigneeAvatar
          assignee={delegatedToAgent}
          className="relative z-10 ring-2 ring-background"
        />
      </span>
    );
  }
  return <TaskAssigneeAvatar assignee={delegatedToAgent ?? assignee} className={className} />;
}

/** Executor-first display name: the delegated agent, else the owner. */
function displayNameForAssigneeSplit(
  assignee: TaskUserAssigneeDetails,
  delegatedToAgent: TaskDelegatedAgentDetails
): string {
  if (delegatedToAgent && assignee) {
    return `${delegatedToAgent.name} · ${displayNameForTaskAssignee(assignee)}`;
  }
  return displayNameForTaskAssignee(delegatedToAgent ?? assignee);
}

function CompactAssigneeDisplay({
  assignee,
  delegatedToAgent,
}: {
  assignee: TaskUserAssigneeDetails;
  delegatedToAgent: TaskDelegatedAgentDetails;
}) {
  const label = `Assignee: ${displayNameForAssigneeSplit(assignee, delegatedToAgent)}`;

  return (
    <span title={label} className={!assignee && !delegatedToAgent ? "text-muted-foreground/40" : undefined}>
      <TaskAssigneeSplitAvatar assignee={assignee} delegatedToAgent={delegatedToAgent} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function TaskAssigneeOptionRow({
  option,
  isSelected,
}: {
  option: AssignableTaskAssigneeOption;
  isSelected: boolean;
}) {
  return (
    <>
      <TaskAssigneeAvatar assignee={option.details} />
      <span className="flex-1 truncate">{option.label}</span>
      {option.type === "user" && option.isCurrentUser ? (
        <span className="text-xs text-muted-foreground">(you)</span>
      ) : null}
      {isSelected ? (
        <>
          <Check className="size-4 shrink-0" />
          <span className="sr-only">Selected</span>
        </>
      ) : null}
    </>
  );
}

function TaskAssigneeOptionSection({
  section,
  assignee,
  delegatedToAgent,
  onSelect,
  onInviteClick,
  onAddAgentClick,
  Item,
}: {
  section: AssignableTaskAssigneeSection;
  assignee: TaskUserAssigneeDetails;
  delegatedToAgent: TaskDelegatedAgentDetails;
  onSelect: (change: TaskAssigneeChange) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  Item: SearchablePickerItemComponent;
}) {
  const isAgentSection = section.label === "Agents";
  const addActionLabel = isAgentSection ? "Add an agent" : "Invite teammates";
  const addAction = isAgentSection ? onAddAgentClick : onInviteClick;

  const isOptionSelected = (option: AssignableTaskAssigneeOption): boolean => {
    if (option.details?.type === "user") {
      return option.details.userId === assignee?.userId;
    }
    if (option.details?.type === "projectAgent") {
      return option.details.projectAgentId === delegatedToAgent?.projectAgentId;
    }
    return false;
  };

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
        <span>{section.label}</span>
        <button
          type="button"
          aria-label={addActionLabel}
          title={addActionLabel}
          disabled={!addAction}
          className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-default disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            addAction?.();
          }}
        >
          <Plus className="size-3.5" />
        </button>
      </DropdownMenuLabel>
      {section.options.length === 0 ? (
        <Item
          disabled={!addAction}
          {...getSearchablePickerItemProps(Boolean(addAction))}
          className={!addAction ? "text-muted-foreground" : ""}
          onClick={(e) => {
            e.stopPropagation();
            addAction?.();
          }}
        >
          {isAgentSection ? (
            <Bot className="size-4 text-muted-foreground" />
          ) : (
            <UserPlus className="size-4 text-muted-foreground" />
          )}
          <span>{addActionLabel}</span>
        </Item>
      ) : null}
      {section.options.map((option) => {
        const isSelected = isOptionSelected(option);
        return (
          <Item
            key={taskAssigneeToKey(option.value)}
            data-checked={isSelected || undefined}
            {...getSearchablePickerItemProps(true)}
            onClick={(e) => {
              e.stopPropagation();
              // Clicking the already-delegated agent clears the delegation
              // (the explicit deselect); owner selection just re-emits.
              if (isSelected && option.details?.type === "projectAgent") {
                onSelect(CLEAR_DELEGATION_CHANGE);
                return;
              }
              onSelect(taskAssigneeOptionToChange(option.details));
            }}
          >
            <TaskAssigneeOptionRow option={option} isSelected={isSelected} />
          </Item>
        );
      })}
    </>
  );
}

/** Search + assignee sections. Hosts pass `itemAs` to render inside their own menu. */
export function AssigneePickerContent({
  projectId,
  assignee,
  delegatedToAgent,
  onSelect,
  onInviteClick,
  onAddAgentClick,
  itemAs,
}: {
  projectId?: Id<"projects">;
  assignee: TaskUserAssigneeDetails;
  delegatedToAgent: TaskDelegatedAgentDetails;
  onSelect: (change: TaskAssigneeChange) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  itemAs?: SearchablePickerItemComponent;
}) {
  const Item = itemAs ?? DropdownMenuItem;
  const directory = useAssignableTaskAssignees(projectId);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSections = directory.sections
    .map((section) => ({
      ...section,
      options: section.options.filter((option) =>
        option.label.toLocaleLowerCase().includes(normalizedQuery)
      ),
    }))
    .filter(
      (section) =>
        normalizedQuery.length === 0 || section.options.length > 0
    );
  const showUnassigned =
    normalizedQuery.length === 0 || "no assignee".includes(normalizedQuery);
  const clearDelegationLabel = delegatedToAgent
    ? `Clear delegation (${delegatedToAgent.name})`
    : "";
  const showClearDelegation =
    Boolean(delegatedToAgent) &&
    (normalizedQuery.length === 0 ||
      clearDelegationLabel.toLocaleLowerCase().includes(normalizedQuery));
  const hasSearchResults =
    showUnassigned ||
    showClearDelegation ||
    filteredSections.some((section) => section.options.length > 0);

  return (
    <SearchablePicker
      query={query}
      onQueryChange={setQuery}
      placeholder="Search assignees..."
      clearLabel="Clear assignee search"
    >
      {showUnassigned ? (
        <Item
          {...getSearchablePickerItemProps(true)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect({
              assigneeId: null,
              assigneeDetails: null,
            });
          }}
        >
          <User className="size-4 text-muted-foreground" />
          <span>No assignee</span>
        </Item>
      ) : null}
      {showClearDelegation ? (
        <Item
          {...getSearchablePickerItemProps(true)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(CLEAR_DELEGATION_CHANGE);
          }}
        >
          <X className="size-4 text-muted-foreground" />
          <span className="truncate">{clearDelegationLabel}</span>
        </Item>
      ) : null}

      {filteredSections.map((section) => (
        <TaskAssigneeOptionSection
          key={section.label}
          section={section}
          assignee={assignee}
          delegatedToAgent={delegatedToAgent}
          onSelect={onSelect}
          onInviteClick={onInviteClick}
          onAddAgentClick={onAddAgentClick}
          Item={Item}
        />
      ))}
      {!hasSearchResults ? (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">
          No assignees found
        </div>
      ) : null}
    </SearchablePicker>
  );
}

export function AssigneeSelector(props: AssigneeSelectorProps) {
  if (props.variant === "compact" && props.isEditable === false) {
    return (
      <CompactAssigneeDisplay
        assignee={props.assignee ?? null}
        delegatedToAgent={props.delegatedToAgent ?? null}
      />
    );
  }

  return <QueryBackedAssigneeSelector {...props} />;
}

function QueryBackedAssigneeSelector({
  assignee = null,
  delegatedToAgent = null,
  projectId,
  onAssigneeChange,
  onInviteClick,
  onAddAgentClick,
  variant = "default",
  trigger,
  align = "start",
  side,
  sideOffset,
  disabled,
  isEditable = true,
  open: controlledOpen,
  onOpenChange,
}: AssigneeSelectorProps) {
  const directory = useAssignableTaskAssignees(projectId);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isMenuOpen = controlledOpen ?? uncontrolledOpen;
  const setIsMenuOpen = (open: boolean) => {
    setUncontrolledOpen(open);
    onOpenChange?.(open);
  };
  const [isHoverCardOpen, setIsHoverCardOpen] = useState(false);
  // After the menu closes with the pointer still on the trigger, Radix
  // re-queues a hover-card open; suppress it until the pointer leaves.
  const suppressHoverUntilLeaveRef = useRef(false);
  const isTriggerDisabled = disabled || !isEditable;
  // Losing write access (role change) closes a menu that was already open.
  if (isTriggerDisabled && isMenuOpen) {
    setIsMenuOpen(false);
  }

  const handleMenuOpenChange = (open: boolean) => {
    setIsMenuOpen(open);
    setIsHoverCardOpen(false);
    if (!open) {
      suppressHoverUntilLeaveRef.current = true;
    }
  };
  const fieldTriggerProps = useTaskFieldMenuTrigger({
    open: isMenuOpen,
    onOpenChange: handleMenuOpenChange,
  });

  // Prefer live directory details (fresh name/avatar/color) over the possibly
  // stale display details handed in by the row.
  const ownerOption = assignee ? directory.findOption({ type: "user", userId: assignee.userId }) : null;
  const displayOwner = ownerOption?.details?.type === "user" ? ownerOption.details : assignee;
  const agentOption = delegatedToAgent
    ? directory.findOption({ type: "projectAgent", projectAgentId: delegatedToAgent.projectAgentId })
    : null;
  const displayAgent = agentOption?.details?.type === "projectAgent" ? agentOption.details : delegatedToAgent;

  const displayName = displayNameForAssigneeSplit(displayOwner, displayAgent);
  const hasAnyAssignment = displayOwner !== null || displayAgent !== null;

  const handleAssigneeChange = (change: TaskAssigneeChange) => {
    if (isTriggerDisabled) return;
    onAssigneeChange(change);
  };

  const avatarOrIcon = <TaskAssigneeSplitAvatar assignee={displayOwner} delegatedToAgent={displayAgent} />;
  const isCell = variant === "cell";
  const isIcon = variant === "icon";
  const isCompact = variant === "compact";

  let defaultTrigger: React.ReactNode;
  if (isCompact) {
    const label = `Assignee: ${displayName}`;
    const compactContent = (
      <>
        {avatarOrIcon}
        <span className="sr-only">{label}</span>
      </>
    );

    if (!isEditable) {
      return (
        <span title={label} className={!hasAnyAssignment ? "text-muted-foreground/40" : undefined}>
          {compactContent}
        </span>
      );
    }

    defaultTrigger = (
      <button
        type="button"
        className="cursor-pointer text-muted-foreground hover:text-foreground"
        title={label}
        onClick={(e) => e.stopPropagation()}
      >
        {compactContent}
      </button>
    );
  } else if (isIcon) {
    defaultTrigger = (
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"
        aria-label="Assignee"
        onClick={(e) => e.stopPropagation()}
      >
        <User className="size-4" />
        <ChevronDown className="size-3" />
      </button>
    );
  } else if (isCell) {
    // Avatar-only; the name lives in the hover card and the accessible label.
    defaultTrigger = (
      <button
        type="button"
        className="flex h-9 w-full cursor-pointer items-center justify-center focus:outline-none disabled:cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {hasAnyAssignment ? avatarOrIcon : <EmptyValue />}
        <span className="sr-only">{`Assignee: ${hasAnyAssignment ? displayName : "No assignee"}`}</span>
      </button>
    );
  } else {
    defaultTrigger = (
      <button
        type="button"
        className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {avatarOrIcon}
        <span className={hasAnyAssignment ? "text-foreground" : "text-muted-foreground"}>
          {hasAnyAssignment ? displayName : "No assignee"}
        </span>
      </button>
    );
  }

  const dropdownTrigger = (
    <DropdownMenuTrigger
      asChild
      disabled={isTriggerDisabled}
      {...(isTriggerDisabled ? {} : fieldTriggerProps)}
    >
      {trigger ?? defaultTrigger}
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu
      deferMount={variant === "cell"}
      modal={false}
      open={isMenuOpen}
      onOpenChange={handleMenuOpenChange}
    >
      {hasAnyAssignment ? (
        <HoverCard
          openDelay={500}
          closeDelay={100}
          open={isHoverCardOpen && !isMenuOpen}
          onOpenChange={(open) => {
            if (open && suppressHoverUntilLeaveRef.current) return;
            setIsHoverCardOpen(open);
          }}
        >
          <HoverCardTrigger
            asChild
            onPointerLeave={() => {
              suppressHoverUntilLeaveRef.current = false;
            }}
          >
            {dropdownTrigger}
          </HoverCardTrigger>
          <HoverCardContent side="bottom" align="start" className="w-auto min-w-52 p-2">
            <div className="flex flex-col gap-1.5">
              {displayAgent ? (
                <div className="flex items-center gap-2">
                  <TaskAssigneeAvatar assignee={displayAgent} />
                  <span className="truncate text-sm">{displayNameForTaskAssignee(displayAgent)}</span>
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">Agent</span>
                </div>
              ) : null}
              {displayOwner ? (
                <div className="flex items-center gap-2">
                  <TaskAssigneeAvatar assignee={displayOwner} />
                  <span className="truncate text-sm">{displayNameForTaskAssignee(displayOwner)}</span>
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">Owner</span>
                </div>
              ) : null}
            </div>
          </HoverCardContent>
        </HoverCard>
      ) : (
        dropdownTrigger
      )}
      <DropdownMenuContent align={align} side={side} sideOffset={sideOffset} className="w-64 p-0">
        <AssigneePickerContent
          projectId={projectId}
          assignee={displayOwner}
          delegatedToAgent={displayAgent}
          onSelect={handleAssigneeChange}
          onInviteClick={onInviteClick}
          onAddAgentClick={onAddAgentClick}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
