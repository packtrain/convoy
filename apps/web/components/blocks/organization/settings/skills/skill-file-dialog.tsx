"use client";

import { useState } from "react";

import { PromptContentEditor, boundedPromptEditorClassName } from "@/components/blocks/settings-catalog/settings-prompt-editor";
import { DialogFooter, TitledDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SkillFile } from "@/convex/lib/contracts/skills";

/** A path has to end in a file name — `references/` names a folder. */
function fileNameOf(path: string): string {
  return path.trim().split("/").pop() ?? "";
}

/**
 * Editor for one file of the Skill's draft set — `file: null` adds a new one.
 * Nothing is written here: saving hands the file back to the page's form, which
 * writes the whole set (docs/specs/skills.md#create-and-edit-ui).
 */
export function SkillFileDialog({
  file,
  takenPaths,
  onSave,
  onClose,
}: {
  file: SkillFile | null;
  /** Paths of the other draft files, so a collision is caught before saving. */
  takenPaths: string[];
  onSave: (file: SkillFile) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SkillFile>(file ?? { path: "", content: "" });
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const path = draft.path.trim();

    if (fileNameOf(path) === "") {
      setError("Include a file name in the path, like references/fields.md");
      return;
    }
    if (takenPaths.includes(path)) {
      setError("A file with this path already exists in this skill");
      return;
    }

    onSave({ path, content: draft.content });
  }

  return (
    <TitledDialog
      open
      title={file === null ? "Create file" : "Edit file"}
      description="Path and content for one skill file."
      descriptionClassName="sr-only"
      size="5xl"
      onClose={onClose}
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <label htmlFor="skill-file-path" className="text-sm font-medium leading-none">
            Path
          </label>
          <Input
            id="skill-file-path"
            value={draft.path}
            onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))}
            placeholder="references/fields.md"
          />
        </div>

        <div className="grid gap-2">
          <span id="skill-file-content-label" className="text-sm font-medium leading-none">
            Content
          </span>
          <div aria-labelledby="skill-file-content-label">
            <PromptContentEditor
              value={draft.content}
              onChange={(value) => setDraft((current) => ({ ...current, content: value }))}
              className="h-[60vh]"
              editorClassName={boundedPromptEditorClassName}
            />
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <DialogFooter className="mt-0">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave}>
          Done
        </Button>
      </DialogFooter>
    </TitledDialog>
  );
}
