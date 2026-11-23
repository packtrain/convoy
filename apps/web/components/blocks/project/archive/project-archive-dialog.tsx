"use client";

import { useState } from "react";
import { useMutation } from "convex/react";

import { ConfirmDialog } from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";

export type ArchivableProject = Pick<Doc<"projects">, "_id" | "name" | "isArchived">;

/** Confirms flipping `project.isArchived`. Spec: docs/specs/project-archive.md */
export function ProjectArchiveDialog({
  project,
  onClose,
}: {
  project: ArchivableProject | null;
  onClose: () => void;
}) {
  const setArchived = useMutation(api.projects.core.setArchived);
  const [isBusy, setIsBusy] = useState(false);
  // `project` is the caller's snapshot, so the copy doesn't flip mid-mutation.
  const archiving = !project?.isArchived;
  const label = archiving ? "Archive project" : "Unarchive project";

  async function handleConfirm() {
    if (!project) {
      return;
    }
    setIsBusy(true);
    try {
      await setArchived({ id: project._id, isArchived: archiving });
      onClose();
    } catch (error) {
      showConvexErrorToast(error, `Failed to ${archiving ? "archive" : "unarchive"} project`);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={project !== null}
      onClose={onClose}
      title={label}
      description={
        archiving
          ? `"${project?.name}" will be hidden from the sidebar and project pickers. Its tasks, threads, and links keep working, and you can unarchive it at any time.`
          : `"${project?.name}" will show in the sidebar and project pickers again.`
      }
      busy={isBusy}
      confirm={{ label, onClick: handleConfirm, autoCloseOnClick: false }}
      cancel={{ label: "Cancel" }}
    />
  );
}
