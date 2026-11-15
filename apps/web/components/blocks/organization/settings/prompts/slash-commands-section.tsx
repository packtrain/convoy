"use client";

import { FileText, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import {
  ALL_CATEGORY,
  UNCATEGORIZED_CATEGORY,
  deriveSlashCommandCardPreview,
  filterSlashCommands,
  getSlashCommandCategories,
  getSlashCommandDisplayKey,
} from "./slash-command-list-utils";
import { Empty, EmptyState } from "@/components/custom/empty-state";
import { SearchInput } from "@/components/custom/search-input";
import { Button } from "@/components/ui/button";
import { SettingsCatalogCategoryNav } from "@/components/blocks/settings-catalog/settings-catalog-category-nav";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import { SettingsCatalogRow } from "@/components/blocks/settings-catalog/settings-catalog-row";
import { SettingsCatalogSectionSkeleton } from "@/components/blocks/settings-catalog/settings-catalog-skeletons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrgPermission, ProjectPermission, hasOrgPermission, hasProjectPermission } from "@/lib/authz/permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { AppLink, appRoute } from "@/lib/navigation";

export function SlashCommandsSection({
  organizationId,
  organizationSlug,
  projectId,
  projectAlias,
}: {
  organizationId: Id<"organizations">;
  organizationSlug: string;
  projectId?: Id<"projects">;
  projectAlias?: string;
}) {
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY);
  const [search, setSearch] = useState("");
  const [commandToDelete, setCommandToDelete] = useState<Id<"slashCommands"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const commands = useQuery(
    projectId ? api.slashCommands.core.listByProject : api.slashCommands.core.listByOrganization,
    projectId ? { projectId } : { organizationId }
  );
  const orgRole = useQuery(api.organizations.members.getMyRole, projectId ? "skip" : { organizationId });
  const projectRole = useQuery(api.projects.members.getMyRole, projectId ? { projectId } : "skip");

  const canManage = projectId
    ? hasProjectPermission(projectRole, ProjectPermission.SLASH_COMMANDS_MANAGE)
    : hasOrgPermission(orgRole, OrgPermission.SLASH_COMMANDS_MANAGE);
  const deleteSlashCommand = useMutation(api.slashCommands.core.deleteSlashCommand);
  const isLoading = commands === undefined || (projectId ? projectRole === undefined : orgRole === undefined);
  const categories = useMemo(() => getSlashCommandCategories(commands ?? []), [commands]);
  const hasPrompts = (commands?.length ?? 0) > 0;
  const hasCategorySidebar = categories.some((category) => category.name !== ALL_CATEGORY && category.name !== UNCATEGORIZED_CATEGORY);
  const activeCategory = categories.some((category) => category.name === selectedCategory) ? selectedCategory : ALL_CATEGORY;
  const visibleCommands = useMemo(
    () =>
      filterSlashCommands(commands ?? [], {
        category: activeCategory,
        search,
      }),
    [activeCategory, commands, search]
  );
  const selectedCommandToDelete = commands?.find((command) => command._id === commandToDelete) ?? null;

  function commandHref(commandId: Id<"slashCommands">) {
    return projectId && projectAlias
      ? appRoute.projectPromptDetail(organizationSlug, projectAlias, commandId)
      : appRoute.organizationPromptDetail(organizationSlug, commandId);
  }

  const newPromptHref =
    projectId && projectAlias
      ? appRoute.projectPromptNew(organizationSlug, projectAlias)
      : appRoute.organizationPromptNew(organizationSlug);

  async function handleDelete() {
    if (!commandToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSlashCommand({ slashCommandId: commandToDelete });
      setCommandToDelete(null);
    } catch (error) {
      showConvexErrorToast(error, "Could not delete slash command");
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return <SettingsCatalogSectionSkeleton label="Loading prompts" variant="prompt" />;
  }

  return (
    <section
      className="flex flex-1 flex-col space-y-5"
      data-testid="slash-commands-section"
      data-organization-id={organizationId}
      data-organization-slug={organizationSlug}
    >
      {!hasPrompts ? (
        <EmptyState
          fill
          icon={FileText}
          title="No prompts yet"
          description="Create reusable prompts for common slash-command workflows."
          action={
            canManage ? (
              <Button variant="secondary" asChild>
                <AppLink href={newPromptHref}>
                  <Plus className="size-4" />
                  Create prompt
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
              placeholder="Search prompts"
              aria-label="Search prompts"
              className="sm:max-w-sm"
            />
            {canManage ? (
              <Button variant="outline" size="settings" asChild className="sm:self-start">
                <AppLink href={newPromptHref}>
                  <Plus className="size-4" />
                  New prompt
                </AppLink>
              </Button>
            ) : null}
          </div>

          <div className={hasCategorySidebar ? "grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]" : "grid gap-5"}>
            {hasCategorySidebar ? (
              <SettingsCatalogCategoryNav
                ariaLabel="Prompt categories"
                categories={categories}
                selectedCategory={activeCategory}
                onSelectCategory={setSelectedCategory}
              />
            ) : null}

            <div className="min-w-0">
              {visibleCommands.length > 0 ? (
                <SettingsCatalogListFrame>
                  {visibleCommands.map((command) => (
                    <SettingsCatalogRow
                      key={command._id}
                      title={getSlashCommandDisplayKey(command.key)}
                      titleClassName="text-info"
                      preview={deriveSlashCommandCardPreview(command)}
                      category={command.category}
                      actionsLabel="Prompt actions"
                      href={commandHref(command._id)}
                      onDelete={canManage ? () => setCommandToDelete(command._id) : undefined}
                    />
                  ))}
                </SettingsCatalogListFrame>
              ) : (
                <Empty variant="dashed">No prompts match this search.</Empty>
              )}
            </div>
          </div>
        </>
      )}
      <SettingsCatalogDeleteDialog
        title="Delete slash command?"
        description={
          selectedCommandToDelete
            ? `Delete ${getSlashCommandDisplayKey(selectedCommandToDelete.key)}?`
            : "Delete this slash command?"
        }
        open={commandToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCommandToDelete(null);
          }
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </section>
  );
}
