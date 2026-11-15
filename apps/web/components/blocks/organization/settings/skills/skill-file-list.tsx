"use client";

import { FileText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { SkillFileDialog } from "./skill-file-dialog";
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
import { EmptyState } from "@/components/custom/empty-state";
import { SettingsTwoColumnSection } from "@/components/custom/settings-layout";
import { Button } from "@/components/ui/button";
import type { SkillFile } from "@/convex/lib/contracts/skills";

/**
 * The Skill's draft file set. Every change is local until the page is saved, so
 * this holds no query and no mutation (docs/specs/skills.md#create-and-edit-ui).
 * Managers only: members read files through `SkillReadonlyDetail`.
 */
export function SkillFileList({
  files,
  disabled = false,
  onChange,
}: {
  files: SkillFile[];
  disabled?: boolean;
  onChange: (files: SkillFile[]) => void;
}) {
  // `null` closed; `{ file: null }` is the add dialog.
  const [editing, setEditing] = useState<{ file: SkillFile | null } | null>(null);
  const [pathToDelete, setPathToDelete] = useState<string | null>(null);

  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const editingPath = editing?.file?.path ?? null;

  function handleSave(saved: SkillFile) {
    // Files are identified by their original path, so an edit replaces in place
    // and a rename does not leave the old entry behind.
    onChange(editingPath === null ? [...files, saved] : files.map((file) => (file.path === editingPath ? saved : file)));
    setEditing(null);
  }

  return (
    <SettingsTwoColumnSection title="Files" description="Additional files an agent can read on demand. Folders live in the path.">
      <div className="grid gap-3" data-testid="skill-file-list">
        {sorted.length > 0 ? (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
              {sorted.map((file) => (
                <li key={file.path} className="flex items-center gap-3 px-4 py-2.5">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm hover:underline"
                    disabled={disabled}
                    onClick={() => setEditing({ file })}
                  >
                    {file.path}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${file.path}`}
                    disabled={disabled}
                    onClick={() => setPathToDelete(file.path)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="settings"
              className="justify-self-start"
              disabled={disabled}
              onClick={() => setEditing({ file: null })}
            >
              <Plus className="size-4" />
              Add file
            </Button>
          </>
        ) : (
          <EmptyState
            icon={FileText}
            title="No additional files"
            description="Additional files an agent reads on demand."
            action={
              <Button type="button" variant="secondary" disabled={disabled} onClick={() => setEditing({ file: null })}>
                <Plus className="size-4" />
                Add file
              </Button>
            }
          />
        )}
      </div>

      <AlertDialog open={pathToDelete !== null} onOpenChange={(open) => (open ? null : setPathToDelete(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>{pathToDelete ? `Delete ${pathToDelete}?` : "Delete this file?"}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onChange(files.filter((file) => file.path !== pathToDelete));
                setPathToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editing ? (
        <SkillFileDialog
          key={editingPath ?? "new-file"}
          file={editing.file}
          takenPaths={files.filter((file) => file.path !== editingPath).map((file) => file.path)}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </SettingsTwoColumnSection>
  );
}
