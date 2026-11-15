"use client";

import { Plus, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { SearchInput } from "@/components/custom/search-input";
import { Empty, EmptyState } from "@/components/custom/empty-state";
import { Button } from "@/components/ui/button";
import { SettingsCatalogCategoryNav } from "@/components/blocks/settings-catalog/settings-catalog-category-nav";
import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { SettingsCatalogRow } from "@/components/blocks/settings-catalog/settings-catalog-row";
import { SettingsCatalogSectionSkeleton } from "@/components/blocks/settings-catalog/settings-catalog-skeletons";
import {
  ALL_CATEGORY,
  UNCATEGORIZED_CATEGORY,
  filterCatalogItems,
  getCatalogCategories,
} from "@/components/blocks/settings-catalog/settings-catalog-list-utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";
import { AppLink, appRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface WorkflowsSectionProps {
  projectId: Id<"projects"> | null;
  organizationSlug: string;
  projectAlias: string;
  canManage: boolean;
}

export function WorkflowsSection({ projectId, organizationSlug, projectAlias, canManage }: WorkflowsSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY);
  const [search, setSearch] = useState("");
  const [deleteWorkflowId, setDeleteWorkflowId] = useState<Id<"workflows"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const workflows = useQuery(api.workflows.core.listByProject, projectId ? { projectId } : "skip");
  const removeWorkflow = useMutation(api.workflows.core.remove);

  const workflowItems = useMemo(() => workflows ?? [], [workflows]);
  const categories = useMemo(() => getCatalogCategories(workflowItems), [workflowItems]);
  const hasCategorySidebar = categories.some(
    (category) => category.name !== ALL_CATEGORY && category.name !== UNCATEGORIZED_CATEGORY
  );
  const activeCategory = categories.some((category) => category.name === selectedCategory)
    ? selectedCategory
    : ALL_CATEGORY;
  const visibleWorkflows = useMemo(
    () =>
      filterCatalogItems(workflowItems, {
        category: activeCategory,
        search,
        searchText: (workflow) => `${workflow.name} ${workflow.description ?? ""} ${workflow.category ?? ""}`.toLowerCase(),
        sortKey: (workflow) => workflow.name.toLowerCase(),
      }),
    [activeCategory, workflowItems, search]
  );
  const deletingWorkflow = workflowItems.find((workflow) => workflow._id === deleteWorkflowId) ?? null;
  const newWorkflowHref = appRoute.projectWorkflowNew(organizationSlug, projectAlias);

  async function handleDelete() {
    if (!deleteWorkflowId) {
      return;
    }

    setIsDeleting(true);
    try {
      await removeWorkflow({ workflowId: deleteWorkflowId });
      setDeleteWorkflowId(null);
    } catch (error) {
      showConvexErrorToast(error, "Could not delete workflow");
    } finally {
      setIsDeleting(false);
    }
  }

  if (workflows === undefined) {
    return <SettingsCatalogSectionSkeleton label="Loading workflows" variant="prompt" />;
  }

  return (
    <section className="flex flex-1 flex-col space-y-5" data-testid="workflows-section">
      {workflowItems.length === 0 ? (
        <EmptyState
          fill
          icon={Workflow}
          title="No workflows yet"
          description={
            canManage
              ? "Create a workflow to orchestrate multi-step agent runs."
              : "No workflows have been added yet."
          }
          action={
            canManage ? (
              <Button variant="secondary" asChild>
                <AppLink href={newWorkflowHref}>
                  <Plus className="size-4" />
                  Create workflow
                </AppLink>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search workflows"
              aria-label="Search workflows"
              className="sm:max-w-sm"
            />
            {canManage ? (
              <Button variant="outline" size="settings" asChild className="sm:self-start">
                <AppLink href={newWorkflowHref}>
                  <Plus className="size-4" />
                  New workflow
                </AppLink>
              </Button>
            ) : null}
          </div>

          <div className={hasCategorySidebar ? "grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]" : "grid gap-5"}>
            {hasCategorySidebar ? (
              <SettingsCatalogCategoryNav
                ariaLabel="Workflow categories"
                categories={categories}
                selectedCategory={activeCategory}
                onSelectCategory={setSelectedCategory}
              />
            ) : null}

            <div className="min-w-0">
              {visibleWorkflows.length > 0 ? (
                <SettingsCatalogListFrame>
                  {visibleWorkflows.map((workflow) => (
                    <SettingsCatalogRow
                      key={workflow._id}
                      title={workflow.name}
                      titleLeading={
                        <Workflow
                          aria-hidden
                          className={cn("size-4", !workflow.color && "text-muted-foreground")}
                          style={workflow.color ? { color: workflow.color } : undefined}
                        />
                      }
                      preview={workflow.description || "—"}
                      category={workflow.category}
                      actionsLabel="Workflow actions"
                      href={appRoute.projectWorkflowDetail(organizationSlug, projectAlias, workflow._id)}
                      onDelete={canManage ? () => setDeleteWorkflowId(workflow._id) : undefined}
                    />
                  ))}
                </SettingsCatalogListFrame>
              ) : (
                <Empty variant="dashed">No workflows match this search.</Empty>
              )}
            </div>
          </div>
        </>
      )}
      <SettingsCatalogDeleteDialog
        title="Delete workflow?"
        description={`Delete ${deletingWorkflow?.name ?? "this workflow"}? This cannot be undone.`}
        open={deleteWorkflowId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteWorkflowId(null);
          }
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </section>
  );
}
