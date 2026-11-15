"use client";

import { ArrowLeft, FileText } from "lucide-react";
import { useState } from "react";

import { SettingsReadonlyMarkdown } from "@/components/blocks/settings-catalog/settings-readonly-markdown";
import { getCatalogItemCategory } from "@/components/blocks/settings-catalog/settings-catalog-list-utils";
import { DialogFooter, TitledDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SkillFile } from "@/convex/lib/contracts/skills";

export function SkillReadonlyDetail({
  skill,
  onBack,
}: {
  skill: { name: string; description?: string; category?: string; skillMd: string; files: SkillFile[] };
  onBack: () => void;
}) {
  const [openFile, setOpenFile] = useState<SkillFile | null>(null);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" />
        Back
      </Button>

      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">/{skill.name}</h1>
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <span>{getCatalogItemCategory(skill)}</span>
        </div>
        {skill.description ? <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{skill.description}</p> : null}
      </header>

      <section className="rounded-lg border border-border bg-background p-5">
        <SettingsReadonlyMarkdown value={skill.skillMd} />
      </section>

      {skill.files.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Files</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
            {skill.files.map((file) => (
              <li key={file.path} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline"
                  onClick={() => setOpenFile(file)}
                >
                  {file.path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {openFile ? <SkillFileReadonlyDialog file={openFile} onClose={() => setOpenFile(null)} /> : null}
    </div>
  );
}

/** Members may read every file of a Skill, so paths open rendered content. */
function SkillFileReadonlyDialog({ file, onClose }: { file: SkillFile; onClose: () => void }) {
  return (
    <TitledDialog open title={file.path} description={`Contents of ${file.path}.`} descriptionClassName="sr-only" size="5xl" onClose={onClose}>
      <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-background p-5">
        <SettingsReadonlyMarkdown value={file.content} />
      </div>

      <DialogFooter className="mt-0">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </TitledDialog>
  );
}
