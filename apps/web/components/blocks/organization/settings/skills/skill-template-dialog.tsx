"use client";

import { ArrowDownToLine, CircleFadingArrowUp } from "lucide-react";
import { useMemo, useState } from "react";

import { SearchInput } from "@/components/custom/search-input";
import { Empty } from "@/components/custom/empty-state";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { SettingsCatalogVersionBadge } from "@/components/blocks/settings-catalog/settings-catalog-version-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { SkillPreviewDialog } from "./skill-preview-dialog";

/** An organization Skill offered to a project, with what the project already has of it. */
export interface SkillTemplateItem {
  _id: Id<"skills">;
  name: string;
  description?: string;
  version: number;
  isInstalled: boolean;
  /** The installed copy, only when its template is ahead of it. */
  updatableCopyId?: Id<"skills">;
}

/**
 * Organization templates behind the `New skill` group. Installing copies the Skill
 * (docs/specs/skills.md#scope-and-install-model). Installed templates stay listed,
 * dimmed, so the dialog reads as the organization catalog rather than a shrinking
 * to-do list — and it stays open, so several can be installed in a row.
 */
export function SkillTemplateDialog({
  open,
  onOpenChange,
  skills,
  isInstalling,
  onInstall,
  onUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: SkillTemplateItem[];
  isInstalling: boolean;
  onInstall: (skillId: Id<"skills">) => void;
  onUpdate: (projectSkillId: Id<"skills">) => void;
}) {
  const [search, setSearch] = useState("");
  const [previewSkill, setPreviewSkill] = useState<SkillTemplateItem | null>(null);
  const visibleSkills = useMemo(() => {
    // Rows read as `/name`, so searching that way finds them.
    const query = search.trim().toLowerCase();

    return skills
      .filter((skill) => [skill.name, `/${skill.name}`, skill.description].join(" ").toLowerCase().includes(query))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [skills, search]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setSearch("");
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="flex h-[min(90vh,720px)] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-4 py-4 pr-12">
          <DialogTitle>Install org skill</DialogTitle>
          <DialogDescription>Installing copies the skill into this project. The copy is yours to edit.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search organization skills"
            aria-label="Search organization skills"
            className="shrink-0"
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleSkills.length > 0 ? (
              <SettingsCatalogListFrame>
                {visibleSkills.map((skill) => {
                  const updatableCopyId = skill.updatableCopyId;

                  return (
                    <div key={skill._id} className={cn("flex w-full items-center gap-3 p-4", skill.isInstalled && "opacity-60")}>
                      <button
                        type="button"
                        className="min-w-0 flex-1 cursor-pointer space-y-1 text-left"
                        onClick={() => setPreviewSkill(skill)}
                      >
                        <h3 className="truncate text-sm font-medium">/{skill.name}</h3>
                        {/* Em dash keeps rows a uniform height when a Skill has no description. */}
                        <p className="truncate text-xs text-muted-foreground">{skill.description || "—"}</p>
                      </button>
                      {skill.isInstalled ? <Badge variant="outline">Installed</Badge> : null}
                      <SettingsCatalogVersionBadge version={skill.version} label={`Organization template v${skill.version}`} />
                      {updatableCopyId ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon-sm"
                          aria-label={`Update ${skill.name} to v${skill.version}`}
                          className="shrink-0 text-muted-foreground"
                          onClick={() => onUpdate(updatableCopyId)}
                        >
                          <CircleFadingArrowUp className="size-4" />
                        </Button>
                      ) : skill.isInstalled ? null : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon-sm"
                          aria-label={`Install ${skill.name}`}
                          className="shrink-0 text-muted-foreground"
                          disabled={isInstalling}
                          onClick={() => onInstall(skill._id)}
                        >
                          <ArrowDownToLine className="size-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </SettingsCatalogListFrame>
            ) : (
              <Empty variant="dashed">
                {skills.length === 0 ? "This organization has no skills yet." : "No skills match this search."}
              </Empty>
            )}
          </div>
        </div>
      </DialogContent>
      {previewSkill ? (
        <SkillPreviewDialog
          skillId={previewSkill._id}
          name={previewSkill.name}
          description={previewSkill.description}
          isInstalled={previewSkill.isInstalled}
          isInstalling={isInstalling}
          onInstall={onInstall}
          onClose={() => setPreviewSkill(null)}
        />
      ) : null}
    </Dialog>
  );
}
