"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Check, ChevronDown, Plus, Workflow } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ModelSelectorDropdown,
  ModelSelectorDropdownContent,
  ModelSelectorDropdownEmpty,
  ModelSelectorDropdownGroup,
  ModelSelectorDropdownInput,
  ModelSelectorDropdownItem,
  ModelSelectorDropdownList,
  ModelSelectorDropdownName,
  ModelSelectorDropdownTrigger,
} from "@/components/ai-elements/model-selector-dropdown";
import { Button } from "@/components/ui/button";
import { appRoute, useNavigation } from "@/lib/navigation";
import type { ComposerWorkflowSelection } from "@/lib/threads/hooks/use-workflow-run-composer";
import { cn } from "@/lib/utils";

interface WorkflowSelectorProps {
  projectId: Id<"projects">;
  organizationSlug: string;
  projectAlias: string;
  value: ComposerWorkflowSelection | null;
  onChange: (workflow: ComposerWorkflowSelection | null) => void;
  disabled?: boolean;
}

/**
 * Workflow picker for new-thread composers (docs/specs/workflows.md → Start):
 * branch-selector styling with a search input on top. Selecting a workflow
 * arms the composer to start a run; the checked row (or "No workflow")
 * deselects back to a plain thread.
 */
export function WorkflowSelector({
  projectId,
  organizationSlug,
  projectAlias,
  value,
  onChange,
  disabled = false,
}: WorkflowSelectorProps) {
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  // Subscribed while mounted (like agents), so reopening doesn't refetch.
  const workflows = useQuery(api.workflows.core.listByProject, { projectId });

  const closeWith = (next: ComposerWorkflowSelection | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <ModelSelectorDropdown modal={false} open={open} onOpenChange={(nextOpen) => !disabled && setOpen(nextOpen)}>
      <ModelSelectorDropdownTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "min-w-0 shrink gap-1.5",
            !disabled && "cursor-pointer",
            disabled && "cursor-default text-muted-foreground/80"
          )}
          aria-disabled={disabled}
          aria-label={`Workflow: ${value?.name ?? "none"}`}
          title={`Workflow: ${value?.name ?? "none"}`}
        >
          <Workflow
            className={cn("size-3.5 shrink-0", value ? !value.color && "text-info" : "opacity-70")}
            style={value?.color ? { color: value.color } : undefined}
          />
          {/* Icon-only in a narrow composer bar; the title/aria-label carry the value. */}
          <span className={cn("hidden min-w-0 max-w-32 truncate @2xl/composer-bar:inline", !value && "text-muted-foreground")}>
            {value?.name ?? "Workflow"}
          </span>
          <ChevronDown className="hidden size-3 opacity-50 @2xl/composer-bar:block" />
        </Button>
      </ModelSelectorDropdownTrigger>
      <ModelSelectorDropdownContent>
        <ModelSelectorDropdownInput placeholder="Search workflows..." />
        {/* pt-1 matches the input's gap from the popover top (Command p-1 + wrapper p-1). */}
        <ModelSelectorDropdownList className="pt-1">
          <ModelSelectorDropdownEmpty>
            {workflows === undefined ? "Loading…" : workflows.length === 0 ? "No workflows yet." : "Nothing found."}
          </ModelSelectorDropdownEmpty>
          <ModelSelectorDropdownGroup>
            {value ? (
              <ModelSelectorDropdownItem value="no workflow" onSelect={() => closeWith(null)}>
                <Workflow className="size-3.5 shrink-0 opacity-70" />
                <ModelSelectorDropdownName className="text-muted-foreground">No workflow</ModelSelectorDropdownName>
              </ModelSelectorDropdownItem>
            ) : null}
            {(workflows ?? []).map((workflow) => (
              <ModelSelectorDropdownItem
                key={workflow._id}
                value={`${workflow.name} ${workflow._id}`}
                onSelect={() =>
                  closeWith(
                    value?._id === workflow._id ? null : { _id: workflow._id, name: workflow.name, color: workflow.color }
                  )
                }
                data-checked={value?._id === workflow._id ? true : undefined}
              >
                <Workflow
                  className={cn("size-3.5 shrink-0", !workflow.color && "opacity-70")}
                  style={workflow.color ? { color: workflow.color } : undefined}
                />
                <ModelSelectorDropdownName>{workflow.name}</ModelSelectorDropdownName>
                {value?._id === workflow._id ? (
                  <span data-slot="command-shortcut" className="ml-auto flex shrink-0 items-center">
                    <Check className="size-3.5" />
                  </span>
                ) : null}
              </ModelSelectorDropdownItem>
            ))}
          </ModelSelectorDropdownGroup>
        </ModelSelectorDropdownList>
        {/* -mx-1 cancels the Command padding so the divider spans edge to edge. */}
        <div className="-mx-1 mt-1 border-t border-border px-2 pb-1 pt-2">
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
            onClick={() => {
              setOpen(false);
              navigation.push(appRoute.projectWorkflowNew(organizationSlug, projectAlias));
            }}
          >
            <Plus className="size-4 text-muted-foreground" />
            New workflow…
          </button>
        </div>
      </ModelSelectorDropdownContent>
    </ModelSelectorDropdown>
  );
}
