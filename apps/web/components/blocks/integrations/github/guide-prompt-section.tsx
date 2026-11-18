"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { SettingsSectionHeader } from "@/components/custom/settings-layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GUIDE_PROMPT_MAX } from "@/convex/lib/contracts/github";
import { hasProjectPermission, ProjectPermission } from "@/lib/authz/permissions";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { DEFAULT_GUIDE_INSTRUCTIONS } from "./guide-prompt";

const TITLE = "Guide prompt";
const DESCRIPTION = "How agents write pull request Guides in this project. Convoy always adds the pull request, the checkout, and the format.";
const READ_ONLY_REASON = "Only project admins can change the Guide prompt";

/** The project's Guide prompt, shown as the built-in instructions until an admin changes it (docs/specs/github-integration.md → Prompt). */
export function GuidePromptSection({ projectId }: { projectId: Id<"projects"> | undefined }) {
  const stored = useQuery(api.integrations.github.guides.getPrompt, projectId ? { projectId } : "skip");
  const { myRole } = useProjectPermissions(projectId ?? null);
  const setPrompt = useMutation(api.integrations.github.guides.setPrompt);
  // The admin's unsaved text; null shows what is stored.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!projectId || stored === undefined || myRole === undefined) {
    return (
      <section aria-label="Loading the Guide prompt" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-64 w-full rounded-md" />
        <div className="flex justify-end gap-2">
          <Skeleton className="h-8 w-44 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </section>
    );
  }
  const canEdit = hasProjectPermission(myRole, ProjectPermission.PROJECT_UPDATE);
  const saved = stored ?? DEFAULT_GUIDE_INSTRUCTIONS;
  const value = draft ?? saved;
  const save = async (prompt: string | null, done: string) => {
    const sent = draft;
    setSaving(true);
    try {
      await setPrompt({ projectId, prompt });
      // Text typed while the save was pending stays a draft.
      setDraft((current) => (current === sent ? null : current));
      toast.success(done);
    } catch (error) {
      showConvexErrorToast(error, "Could not save the Guide prompt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <SettingsSectionHeader title={TITLE} description={DESCRIPTION} />
      <Textarea
        aria-label={TITLE}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        readOnly={!canEdit}
        title={canEdit ? undefined : READ_ONLY_REASON}
        maxLength={GUIDE_PROMPT_MAX}
        rows={12}
        className="font-mono text-xs"
      />
      {/* Named for the prompt, since the page has other settings that save on their own. */}
      {canEdit ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={saving || (stored === null && draft === null)} onClick={() => void save(null, "Guide prompt reset to default")}>
            Restore default prompt
          </Button>
          <Button
            disabled={saving || draft === null || draft.trim() === saved.trim()}
            // Saving the built-in text as is keeps the project on the default, and its later changes.
            onClick={() => void save(value.trim() === DEFAULT_GUIDE_INSTRUCTIONS ? null : value, "Guide prompt saved")}
          >
            Save prompt
          </Button>
        </div>
      ) : null}
    </section>
  );
}
