"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Archive, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/dialog";
import { SettingsDangerRow } from "@/components/custom/settings-layout";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";

/** Spec: docs/specs/project-settings.md#danger-zone */
export function DangerZoneSection({
  project,
  organizationId,
  organizationSlug,
}: {
  project: Pick<Doc<"projects">, "_id" | "name"> | null;
  organizationId: Id<"organizations"> | null;
  organizationSlug: string;
}) {
  const navigation = useNavigation();
  const deleteProject = useMutation(api.projects.core.remove);
  const { canDeleteProject } = useProjectPermissions(
    project?._id ?? null,
    organizationId
  );
  // Held so the dialog keeps its copy after the deleted project's query turns null.
  const [projectToDelete, setProjectToDelete] = useState<typeof project>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    if (!projectToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteProject({ id: projectToDelete._id });
      // Replace, so Back does not return to the deleted project's settings.
      navigation.replace(appRoute.organization(organizationSlug));
    } catch (error) {
      showConvexErrorToast(error, "Failed to delete project");
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsDangerRow
        icon={<Archive />}
        title="Archive project"
        description="Hide this project from the sidebar. You can restore it later."
        action={
          <Button variant="outline" size="sm" disabled>
            Archive
          </Button>
        }
        disabledReason="Project archiving will be available in a future update."
      />
      <SettingsDangerRow
        icon={<Trash2 />}
        title="Delete project"
        description="Permanently delete this project and all its data."
        action={
          <Button
            variant="destructive"
            size="sm"
            disabled={!project || !canDeleteProject}
            onClick={() => setProjectToDelete(project)}
          >
            Delete
          </Button>
        }
      />

      <ConfirmDialog
        open={projectToDelete !== null}
        onClose={() => setProjectToDelete(null)}
        title="Delete project"
        description={`Are you sure you want to delete "${projectToDelete?.name}"? This action cannot be undone.`}
        busy={isDeleting}
        confirm={{
          label: "Delete project",
          variant: "destructive",
          onClick: handleDelete,
          autoCloseOnClick: false,
        }}
        cancel={{ label: "Cancel" }}
      />
    </div>
  );
}
