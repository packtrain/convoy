"use client";

import { Bot, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import { ALL_CATEGORY, UNCATEGORIZED_CATEGORY, filterAgents, getAgentCategories } from "@/components/blocks/agents/agent-list-utils";
import { ProjectAgentListFrame, ProjectAgentRow } from "@/components/blocks/project/settings/project-agent-list";
import { SettingsCatalogCategoryNav } from "@/components/blocks/settings-catalog/settings-catalog-category-nav";
import { Empty, EmptyState } from "@/components/custom/empty-state";
import { SearchInput } from "@/components/custom/search-input";
import { Button } from "@/components/ui/button";
import { SettingsCatalogSectionSkeleton } from "@/components/blocks/settings-catalog/settings-catalog-skeletons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrgPermission, hasOrgPermission } from "@/lib/authz/permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { AppLink, appRoute } from "@/lib/navigation";

export function AgentsSection({ organizationId, organizationSlug }: { organizationId: Id<"organizations">; organizationSlug: string }) {
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY);
  const [search, setSearch] = useState("");
  const [agentToDelete, setAgentToDelete] = useState<Id<"agents"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const agents = useQuery(api.agents.core.listByOrganization, {
    organizationId,
  });
  const myRole = useQuery(api.organizations.members.getMyRole, {
    organizationId,
  });
  const deleteAgent = useMutation(api.agents.core.deleteAgent);

  const canManage = hasOrgPermission(myRole, OrgPermission.AGENTS_MANAGE);
  const isLoading = agents === undefined || myRole === undefined;
  const listItems = useMemo(() => agents ?? [], [agents]);
  const categories = useMemo(() => getAgentCategories(listItems), [listItems]);
  const hasAgents = listItems.length > 0;
  const hasCategorySidebar = categories.some((category) => category.name !== ALL_CATEGORY && category.name !== UNCATEGORIZED_CATEGORY);
  const activeCategory = categories.some((category) => category.name === selectedCategory) ? selectedCategory : ALL_CATEGORY;
  const visibleAgents = useMemo(
    () =>
      filterAgents(listItems, {
        category: activeCategory,
        search,
      }),
    [activeCategory, listItems, search]
  );
  const selectedAgentToDelete = listItems.find((agent) => agent._id === agentToDelete) ?? null;



  async function handleDelete() {
    if (!agentToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteAgent({ agentId: agentToDelete });
      setAgentToDelete(null);
    } catch (error) {
      showConvexErrorToast(error, "Could not delete agent");
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return <SettingsCatalogSectionSkeleton label="Loading agents" variant="agent" />;
  }

  return (
    <section
      className="flex flex-1 flex-col space-y-5"
      data-testid="agents-section"
      data-organization-id={organizationId}
      data-organization-slug={organizationSlug}
    >
      {!hasAgents ? (
        <EmptyState
          fill
          icon={Bot}
          title="No agents yet"
          description="Create organization agent templates for reusable project agents."
          action={
            canManage ? (
              <Button variant="secondary" asChild>
                <AppLink href={appRoute.organizationAgentNew(organizationSlug)}>
                  <Plus className="size-4" />
                  Create agent
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
              placeholder="Search agents"
              aria-label="Search agents"
              className="sm:max-w-sm"
            />
            {canManage ? (
              <Button variant="outline" size="settings" asChild className="sm:self-start">
                <AppLink href={appRoute.organizationAgentNew(organizationSlug)}>
                  <Plus className="size-4" />
                  New agent
                </AppLink>
              </Button>
            ) : null}
          </div>

          <div className={hasCategorySidebar ? "grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]" : "grid gap-5"}>
            {hasCategorySidebar ? (
              <SettingsCatalogCategoryNav
                ariaLabel="Agent categories"
                categories={categories}
                selectedCategory={activeCategory}
                onSelectCategory={setSelectedCategory}
              />
            ) : null}

            <div className="min-w-0">
              {visibleAgents.length > 0 ? (
                <ProjectAgentListFrame>
                  {visibleAgents.map((agent) => (
                    <ProjectAgentRow
                      key={agent._id}
                      agent={agent}
                      templateState={{ templateVersion: agent.version }}
                      actionsAriaLabel="Agent actions"
                      showActionsMenu={canManage}
                      href={appRoute.organizationAgentDetail(organizationSlug, agent._id)}
                      onDelete={canManage ? () => setAgentToDelete(agent._id) : undefined}
                    />
                  ))}
                </ProjectAgentListFrame>
              ) : (
                <Empty variant="dashed">No agents match this search.</Empty>
              )}
            </div>
          </div>
        </>
      )}
      <SettingsCatalogDeleteDialog
        title="Delete agent?"
        description={`Delete ${selectedAgentToDelete?.name ?? "this agent"}? Existing copied project agents will remain unchanged.`}
        open={agentToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAgentToDelete(null);
          }
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </section>
  );
}
