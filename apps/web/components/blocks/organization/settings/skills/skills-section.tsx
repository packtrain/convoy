"use client";

import { ChevronDown, Library, Sparkles, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { toast } from "sonner";

import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Empty, EmptyState } from "@/components/custom/empty-state";
import { SearchInput } from "@/components/custom/search-input";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SettingsCatalogCategoryNav } from "@/components/blocks/settings-catalog/settings-catalog-category-nav";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { SettingsCatalogRow } from "@/components/blocks/settings-catalog/settings-catalog-row";
import { SettingsCatalogSectionSkeleton } from "@/components/blocks/settings-catalog/settings-catalog-skeletons";
import { SettingsCatalogUpdateHint } from "@/components/blocks/settings-catalog/settings-catalog-update-hint";
import { SettingsCatalogVersionBadge } from "@/components/blocks/settings-catalog/settings-catalog-version-badge";
import {
  ALL_CATEGORY,
  UNCATEGORIZED_CATEGORY,
  filterCatalogItems,
  getCatalogCategoriesFromCounts,
  getCatalogItemCategory,
} from "@/components/blocks/settings-catalog/settings-catalog-list-utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrgPermission, ProjectPermission, hasOrgPermission, hasProjectPermission } from "@/lib/authz/permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { AppLink, appRoute } from "@/lib/navigation";
import { SkillSourceLink } from "./skill-source";
import { SkillTemplateDialog, type SkillTemplateItem } from "./skill-template-dialog";

const SKILLS_PAGE_SIZE = 50;

/** What an installed copy came from, and whether its template has moved on (OS-1781). */
interface TemplateState {
  installedVersion: number;
  availableVersion?: number;
  locallyEdited: boolean;
}

/** Organization Skills are templates; a project Skill versions only itself. */
function versionLabel(skill: { scope: "organization" | "project"; version: number }, template?: TemplateState): string {
  if (template) {
    return template.locallyEdited
      ? `Edited in this project since installing v${template.installedVersion}`
      : `Installed from organization template v${template.installedVersion}`;
  }

  return skill.scope === "project" ? `Skill v${skill.version}` : `Organization template v${skill.version}`;
}

/**
 * A refresh always overwrites the copy, so it is always confirmed first
 * (docs/specs/skills.md#versioning-and-refresh).
 */
function refreshDialogTitle(template?: TemplateState): string {
  if (template?.availableVersion === undefined) {
    return "Reset to the organization version?";
  }

  return template.locallyEdited ? "Overwrite local changes?" : `Update to v${template.availableVersion}?`;
}

export function SkillsSection({
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
  const [skillToDelete, setSkillToDelete] = useState<Id<"skills"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [skillToRefresh, setSkillToRefresh] = useState<Id<"skills"> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  // The nav needs every category, which the loaded pages cannot know.
  const categoryCounts = useQuery(api.skills.core.listCategories, projectId ? { organizationId, projectId } : { organizationId });
  const categories = useMemo(() => getCatalogCategoriesFromCounts(categoryCounts ?? []), [categoryCounts]);
  const activeCategory = categories.some((category) => category.name === selectedCategory) ? selectedCategory : ALL_CATEGORY;
  const categoryFilter =
    activeCategory === ALL_CATEGORY ? undefined : activeCategory === UNCATEGORIZED_CATEGORY ? null : activeCategory;
  const {
    results: listItems,
    status: listStatus,
    loadMore,
  } = usePaginatedQuery(
    api.skills.core.list,
    {
      organizationId,
      ...(projectId ? { projectId } : {}),
      ...(categoryFilter !== undefined ? { category: categoryFilter } : {}),
    },
    { initialNumItems: SKILLS_PAGE_SIZE }
  );
  const orgRole = useQuery(api.organizations.members.getMyRole, projectId ? "skip" : { organizationId });
  const projectRole = useQuery(api.projects.members.getMyRole, projectId ? { projectId } : "skip");
  const deleteSkill = useMutation(api.skills.core.deleteSkill);
  const copyFromSkill = useMutation(api.skills.core.copyFromSkill);
  const replaceFromSkill = useMutation(api.skills.core.replaceFromSkill);

  const canManage = projectId
    ? hasProjectPermission(projectRole, ProjectPermission.SKILLS_MANAGE)
    : hasOrgPermission(orgRole, OrgPermission.SKILLS_MANAGE);
  // Managers also need the catalog for the install list and the update hints on
  // installed copies; a viewer never sees a template.
  const organizationSkills = useQuery(
    api.skills.core.listByOrganization,
    projectId && canManage ? { organizationId } : "skip"
  );
  const isLoading = categoryCounts === undefined || (projectId ? projectRole === undefined : orgRole === undefined);
  const newSkillHref =
    projectId && projectAlias ? appRoute.projectSkillNew(organizationSlug, projectAlias) : appRoute.organizationSkillNew(organizationSlug);
  // The category counts cover every Skill in scope; the loaded pages may not.
  const hasSkills = categories[0].count > 0;
  const hasCategorySidebar = categories.some((category) => category.name !== ALL_CATEGORY && category.name !== UNCATEGORIZED_CATEGORY);
  const visibleSkills = useMemo(
    () =>
      // The category filter already ran on the server; search stays client-side
      // over the loaded pages (docs/specs/skills.md#organization-settings-ui).
      filterCatalogItems(listItems, {
        category: ALL_CATEGORY,
        search,
        // Rows read as `/name`, so searching that way finds them.
        searchText: (skill) =>
          [skill.name, `/${skill.name}`, skill.description, getCatalogItemCategory(skill)].filter(Boolean).join(" ").toLowerCase(),
        sortKey: (skill) => skill.name,
      }),
    [listItems, search]
  );
  const selectedSkillToDelete = listItems.find((skill) => skill._id === skillToDelete) ?? null;
  const selectedSkillToRefresh = listItems.find((skill) => skill._id === skillToRefresh) ?? null;
  const templateVersions = useMemo(
    () => new Map((organizationSkills ?? []).map((skill) => [skill._id, skill.version])),
    [organizationSkills]
  );
  // Installed templates stay listed and marked, not filtered out; a second copy
  // under the same name would collide with the first, so they lose the Install
  // action rather than the row.
  // ponytail: installed-state comes from the loaded pages only, so past ~50
  // project Skills a copy on an unloaded page shows Install and the duplicate is
  // caught by the mutation's toast instead. Full-list check if that stings.
  const templateItems = useMemo((): SkillTemplateItem[] => {
    const installedNames = new Set(listItems.map((skill) => skill.normalizedName));

    return (organizationSkills ?? []).map((template) => {
      const copy = listItems.find((skill) => skill.sourceSkillId === template._id);
      const canUpdate = copy !== undefined && copy.installedVersion !== undefined && template.version > copy.installedVersion;

      return {
        _id: template._id,
        name: template.name,
        description: template.description,
        version: template.version,
        isInstalled: copy !== undefined || installedNames.has(template.normalizedName),
        ...(canUpdate && copy ? { updatableCopyId: copy._id } : {}),
      };
    });
  }, [listItems, organizationSkills]);

  /** Template state for an installed copy, or none for a Skill authored in the project. */
  function templateStateFor(skill: (typeof listItems)[number]): TemplateState | undefined {
    if (!skill.sourceSkillId || skill.installedVersion === undefined) {
      return undefined;
    }

    const installedVersion = skill.installedVersion;
    const templateVersion = templateVersions.get(skill.sourceSkillId);

    return {
      installedVersion,
      availableVersion: templateVersion !== undefined && templateVersion > installedVersion ? templateVersion : undefined,
      locallyEdited: skill.locallyEdited === true,
    };
  }

  const refreshTemplate = selectedSkillToRefresh ? templateStateFor(selectedSkillToRefresh) : undefined;

  function skillHref(skillId: Id<"skills">) {
    return projectId && projectAlias
      ? appRoute.projectSkillDetail(organizationSlug, projectAlias, skillId)
      : appRoute.organizationSkillDetail(organizationSlug, skillId);
  }

  async function handleDelete() {
    if (!skillToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSkill({ skillId: skillToDelete });
      setSkillToDelete(null);
    } catch (error) {
      showConvexErrorToast(error, "Could not delete skill");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleInstall(skillId: Id<"skills">) {
    if (!projectId) {
      return;
    }

    setIsInstalling(true);
    try {
      // The dialog stays open so several templates can be installed one after another.
      await copyFromSkill({ projectId, skillId });
      toast.success("Skill installed into this project");
    } catch (error) {
      showConvexErrorToast(error, "Could not install skill");
    } finally {
      setIsInstalling(false);
    }
  }

  async function refreshFromTemplate(skill: (typeof listItems)[number]) {
    setIsRefreshing(true);
    try {
      // The dialog is the consent, so the mutation is always told to overwrite.
      await replaceFromSkill({ skillId: skill._id, overwriteLocalEdits: true });
      setSkillToRefresh(null);
      const version = templateStateFor(skill)?.availableVersion;
      toast.success(version === undefined ? `/${skill.name} reset to its template` : `/${skill.name} updated to v${version}`);
    } catch (error) {
      showConvexErrorToast(error, "Could not update the skill from its template");
    } finally {
      setIsRefreshing(false);
    }
  }

  if (isLoading) {
    return <SettingsCatalogSectionSkeleton label="Loading skills" variant="prompt" />;
  }

  return (
    <section
      className="flex flex-1 flex-col space-y-5"
      data-testid="skills-section"
      data-organization-id={organizationId}
      data-organization-slug={organizationSlug}
    >
      {!hasSkills ? (
        <EmptyState
          fill
          icon={Sparkles}
          title="No skills yet"
          description="Create reusable, multi-file instruction bundles for your agents."
          actionClassName="flex flex-wrap justify-center gap-2"
          action={
            canManage ? (
              <>
                <Button variant="secondary" asChild>
                  <AppLink href={newSkillHref}>
                    <Plus className="size-4" />
                    Create skill
                  </AppLink>
                </Button>
                {templateItems.length > 0 ? (
                  <Button type="button" variant="secondary" onClick={() => setTemplateOpen(true)}>
                    <Library className="size-4" />
                    Install org skill
                  </Button>
                ) : null}
              </>
            ) : null
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search skills"
              aria-label="Search skills"
              className="sm:max-w-sm"
            />
            {canManage ? (
              <ButtonGroup className="shrink-0 sm:self-start">
                <Button variant="outline" size="settings" asChild>
                  <AppLink href={newSkillHref}>
                    <Plus className="size-4" />
                    New skill
                  </AppLink>
                </Button>
                {templateItems.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="settings" className="px-2" aria-label="More skill creation options">
                        <ChevronDown className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onSelect={() => setTemplateOpen(true)}>
                        <Library className="size-4" />
                        Install org skill
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </ButtonGroup>
            ) : null}
          </div>

          <div className={hasCategorySidebar ? "grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]" : "grid gap-5"}>
            {hasCategorySidebar ? (
              <SettingsCatalogCategoryNav
                ariaLabel="Skill categories"
                categories={categories}
                selectedCategory={activeCategory}
                onSelectCategory={setSelectedCategory}
              />
            ) : null}

            <div className="min-w-0">
              {visibleSkills.length > 0 ? (
                <SettingsCatalogListFrame>
                  {visibleSkills.map((skill) => {
                    const template = templateStateFor(skill);

                    return (
                      <SettingsCatalogRow
                        key={skill._id}
                        title={`/${skill.name}`}
                        // Em dash keeps rows a uniform height when a Skill has no description.
                        preview={skill.description || "—"}
                        category={skill.category}
                        versionBadge={
                          <>
                            {template?.availableVersion === undefined ? null : (
                              <SettingsCatalogUpdateHint version={template.availableVersion} />
                            )}
                            <SettingsCatalogVersionBadge
                              version={template ? template.installedVersion : skill.version}
                              label={versionLabel(skill, template)}
                              diverged={template?.locallyEdited === true}
                            />
                          </>
                        }
                        // Straight to the copied version, without opening the editor first.
                        titleTrailing={skill.source ? <SkillSourceLink source={skill.source} /> : undefined}
                        actionsLabel="Skill actions"
                        href={skillHref(skill._id)}
                        onDelete={canManage ? () => setSkillToDelete(skill._id) : undefined}
                        // A clean copy that is already current has nothing to fetch and
                        // nothing to reset, so it gets no action.
                        onRefresh={
                          canManage && template && (template.availableVersion !== undefined || template.locallyEdited)
                            ? () => setSkillToRefresh(skill._id)
                            : undefined
                        }
                        refreshLabel={template?.availableVersion === undefined ? "Reset" : "Update"}
                      />
                    );
                  })}
                  {listStatus === "CanLoadMore" || listStatus === "LoadingMore" ? (
                    <button
                      type="button"
                      disabled={listStatus === "LoadingMore"}
                      onClick={() => loadMore(SKILLS_PAGE_SIZE)}
                      className="flex w-full cursor-pointer items-center justify-center px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    >
                      {listStatus === "LoadingMore" ? "Loading…" : "Load more"}
                    </button>
                  ) : null}
                </SettingsCatalogListFrame>
              ) : listStatus === "LoadingFirstPage" ? null : (
                <Empty variant="dashed">No skills match this search.</Empty>
              )}
            </div>
          </div>
        </>
      )}
      {canManage && projectId ? (
        <SkillTemplateDialog
          open={templateOpen}
          onOpenChange={setTemplateOpen}
          skills={templateItems}
          isInstalling={isInstalling}
          onInstall={handleInstall}
          onUpdate={setSkillToRefresh}
        />
      ) : null}
      <SettingsCatalogDeleteDialog
        title="Delete skill?"
        description={selectedSkillToDelete ? `Delete /${selectedSkillToDelete.name}?` : "Delete this skill?"}
        open={skillToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSkillToDelete(null);
          }
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
      <AlertDialog
        open={selectedSkillToRefresh !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSkillToRefresh(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{refreshDialogTitle(refreshTemplate)}</AlertDialogTitle>
            <AlertDialogDescription>
              {refreshTemplate?.locallyEdited ? `/${selectedSkillToRefresh?.name} was edited in this project. ` : ""}
              Its files, name, description and category are replaced with the organization template
              {refreshTemplate?.availableVersion === undefined ? "" : ` v${refreshTemplate.availableVersion}`}, and this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRefreshing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRefreshing}
              onClick={(event) => {
                event.preventDefault();
                if (selectedSkillToRefresh) {
                  void refreshFromTemplate(selectedSkillToRefresh);
                }
              }}
            >
              {refreshTemplate?.availableVersion === undefined ? "Reset" : "Update"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
