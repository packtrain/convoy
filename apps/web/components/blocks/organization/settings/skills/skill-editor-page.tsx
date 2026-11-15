"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import { SkillForm, type SkillFormValues } from "./skill-form";
import { SkillReadonlyDetail } from "./skill-readonly-detail";
import { skillSourceFromFields } from "./skill-source";
import { SettingsPageContainer, SettingsPageHeader } from "@/components/custom/settings-layout";
import { NotFoundState } from "@/components/blocks/not-found-state";
import { Button } from "@/components/ui/button";
import { SettingsCatalogEditorSkeleton } from "@/components/blocks/settings-catalog/settings-catalog-skeletons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrgPermission, ProjectPermission, hasOrgPermission, hasProjectPermission } from "@/lib/authz/permissions";
import { appRoute, useNavigation } from "@/lib/navigation";
import { useCurrentOrgProject } from "@/lib/routing/current-org-project-context";
import { showConvexErrorToast } from "@/lib/errors";

type SkillEditorPageProps = ({ mode: "create" } | { mode: "detail"; skillId: string }) & {
  scope?: "organization" | "project";
};

const CREATE_INITIAL_VALUES: SkillFormValues = {
  name: "",
  description: "",
  category: "",
  content: "",
  files: [],
};

const PAGE_CLASS_NAME = "flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12";

export function SkillEditorPage(props: SkillEditorPageProps) {
  const navigation = useNavigation();
  const { organizationId, organizationSlug, projectAlias } = useCurrentOrgProject();
  const scope = props.scope ?? "organization";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const project = useQuery(
    api.projects.core.getByAlias,
    scope === "project" && projectAlias ? { organizationId, alias: projectAlias } : "skip"
  );
  const projectId = project?._id;
  const orgRole = useQuery(api.organizations.members.getMyRole, scope === "organization" ? { organizationId } : "skip");
  const projectRole = useQuery(api.projects.members.getMyRole, projectId ? { projectId } : "skip");
  const skillId = props.mode === "detail" ? (props.skillId as Id<"skills">) : null;
  const skill = useQuery(api.skills.core.get, skillId ? { skillId } : "skip");
  const createSkill = useMutation(api.skills.core.createInOrganization);
  const createProjectSkill = useMutation(api.skills.core.createInProject);
  const updateSkill = useMutation(api.skills.core.update);
  const deleteSkill = useMutation(api.skills.core.deleteSkill);

  const canManage =
    scope === "project"
      ? hasProjectPermission(projectRole, ProjectPermission.SKILLS_MANAGE)
      : hasOrgPermission(orgRole, OrgPermission.SKILLS_MANAGE);
  const backTarget =
    scope === "project" && projectAlias
      ? appRoute.projectSettings(organizationSlug, projectAlias, "skills")
      : appRoute.organizationSkills(organizationSlug);
  // A Skill of the other scope is out of this route's reach, so it reads as missing.
  const scopedSkill = skill && skill.scope === scope && (scope !== "project" || skill.projectId === projectId) ? skill : null;
  const initialValues = useMemo<SkillFormValues>(() => {
    if (props.mode === "create" || !scopedSkill) {
      return CREATE_INITIAL_VALUES;
    }

    return {
      name: scopedSkill.name,
      description: scopedSkill.description ?? "",
      category: scopedSkill.category ?? "",
      content: scopedSkill.skillMd,
      files: scopedSkill.files,
      source: scopedSkill.source,
    };
  }, [props.mode, scopedSkill]);

  function goBack() {
    navigation.push(backTarget);
  }

  async function handleCreate(values: SkillFormValues) {
    if (scope === "project" && !projectId) {
      return;
    }

    setIsSubmitting(true);
    try {
      const source = skillSourceFromFields(values.source);
      const skillInput = {
        name: values.name,
        description: values.description?.trim() || undefined,
        category: values.category?.trim() || undefined,
        content: values.content,
        files: values.files,
        // A create has nothing to clear, so an empty Metadata section sends nothing.
        ...(source && { source }),
      };
      if (scope === "project" && projectId) {
        await createProjectSkill({ projectId, ...skillInput });
      } else {
        await createSkill({ organizationId, ...skillInput });
      }
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not save skill");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdate(values: SkillFormValues) {
    if (!skillId) {
      return;
    }

    setIsSubmitting(true);
    try {
      await updateSkill({
        skillId,
        name: values.name,
        description: values.description?.trim() || null,
        category: values.category?.trim() || null,
        content: values.content,
        files: values.files,
        // Emptying the Metadata section clears the stored provenance.
        source: skillSourceFromFields(values.source),
      });
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not save skill");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!skillId) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSkill({ skillId });
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not delete skill");
    } finally {
      setIsDeleting(false);
    }
  }

  const isLoading =
    (scope === "project" ? project === undefined || (projectId && projectRole === undefined) : orgRole === undefined) ||
    (props.mode === "detail" && skill === undefined);

  if (isLoading) {
    return (
      <main className={PAGE_CLASS_NAME}>
        <SettingsCatalogEditorSkeleton label="Loading skill" />
      </main>
    );
  }

  if (props.mode === "create" && !canManage) {
    return (
      <main className={PAGE_CLASS_NAME}>
        <SettingsPageContainer className="space-y-4 rounded-lg border border-border p-6">
          <h1 className="text-xl font-semibold">Skills</h1>
          <p className="text-sm text-muted-foreground">You do not have permission to create skills.</p>
          <Button type="button" variant="outline" onClick={goBack}>
            Back
          </Button>
        </SettingsPageContainer>
      </main>
    );
  }

  if (props.mode === "detail" && !scopedSkill) {
    return (
      <main className={PAGE_CLASS_NAME}>
        <NotFoundState
          title="Skill not found"
          action={
            <Button type="button" variant="outline" onClick={goBack}>
              Back
            </Button>
          }
        />
      </main>
    );
  }

  if (scopedSkill && !canManage) {
    return (
      <main className={PAGE_CLASS_NAME} data-testid="skill-editor-page" data-mode="detail" data-skill-id={scopedSkill._id}>
        <SkillReadonlyDetail skill={scopedSkill} onBack={goBack} />
      </main>
    );
  }

  return (
    <main
      className={PAGE_CLASS_NAME}
      data-testid="skill-editor-page"
      data-mode={props.mode}
      data-skill-id={props.mode === "detail" ? props.skillId : undefined}
    >
      <SettingsPageContainer className="flex flex-1 flex-col gap-6">
        <SettingsPageHeader
          title={props.mode === "create" ? "New skill" : "Edit skill"}
          backLink={{ href: backTarget, label: "Back to skills" }}
        />
        <SkillForm
          mode={props.mode === "create" ? "create" : "edit"}
          // Seeded per Skill: the query can re-emit while the page is open, and
          // re-seeding mid-edit would discard unsaved work.
          resetKey={scopedSkill?._id ?? "create"}
          initialValues={initialValues}
          canManage={canManage}
          isSubmitting={isSubmitting}
          onSubmit={props.mode === "create" ? handleCreate : handleUpdate}
          onCancel={goBack}
          onDelete={props.mode === "detail" ? () => setDeleteOpen(true) : undefined}
        />
      </SettingsPageContainer>
      {scopedSkill ? (
        <SettingsCatalogDeleteDialog
          title="Delete skill?"
          description={`Delete /${scopedSkill.name}?`}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
        />
      ) : null}
    </main>
  );
}
