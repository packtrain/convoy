"use client";

import { useState } from "react";
import { Archive } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProjectArchiveDialog, type ArchivableProject } from "./project-archive-dialog";

/** Marks an archived project's page; renders nothing for an active one. */
export function ArchivedProjectBanner({
  project,
  canUnarchive,
}: {
  project: ArchivableProject;
  canUnarchive: boolean;
}) {
  const [confirming, setConfirming] = useState<ArchivableProject | null>(null);

  if (!project.isArchived) {
    return null;
  }

  return (
    <div className="px-4 pt-2">
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
      >
        <Archive aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1">This project is archived.</span>
        {canUnarchive ? (
          <Button variant="outline" size="sm" onClick={() => setConfirming(project)}>
            Unarchive
          </Button>
        ) : null}
      </div>
      <ProjectArchiveDialog project={confirming} onClose={() => setConfirming(null)} />
    </div>
  );
}
