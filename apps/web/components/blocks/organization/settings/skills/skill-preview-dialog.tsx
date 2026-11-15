"use client";

import { ArrowDownToLine, FileText } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";

import { SettingsReadonlyMarkdown } from "@/components/blocks/settings-catalog/settings-readonly-markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

/**
 * ponytail: character count instead of measuring the rendered height — a wrong
 * guess only skips the clamp, so upgrade to a ResizeObserver (comment-item.tsx)
 * if the cut lands wrong.
 */
const COLLAPSED_MARKDOWN_CHARS = 600;

/**
 * Read `SKILL.md` and the bundle's file names before installing a template
 * (docs/specs/skills.md#project-settings-ui). Long markdown is cut and expands on
 * click, the way a long task comment does.
 */
export function SkillPreviewDialog({
  skillId,
  name,
  description,
  isInstalled,
  isInstalling,
  onInstall,
  onClose,
}: {
  skillId: Id<"skills">;
  name: string;
  description?: string;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: (skillId: Id<"skills">) => void;
  onClose: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const skill = useQuery(api.skills.core.get, { skillId });
  const isCut = !isExpanded && (skill?.skillMd.length ?? 0) > COLLAPSED_MARKDOWN_CHARS;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {/* Height follows the content up to the viewport: the markdown editor fills
          whatever height it is given, so a fixed one leaves a tall empty box. */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>/{name}</DialogTitle>
          <DialogDescription>{description || "No description."}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto">
          {skill === undefined ? (
            <Skeleton className="h-40 w-full" aria-label="Loading skill" />
          ) : skill === null ? (
            <p className="text-sm text-muted-foreground">This skill is no longer available.</p>
          ) : (
            <>
              <div
                className={cn(
                  "overflow-hidden rounded-lg border border-border",
                  isCut && "group/expand relative max-h-[50vh] cursor-pointer"
                )}
                role={isCut ? "button" : undefined}
                tabIndex={isCut ? 0 : undefined}
                aria-label={isCut ? "Expand SKILL.md" : undefined}
                onClick={isCut ? () => setIsExpanded(true) : undefined}
                onKeyDown={
                  isCut
                    ? (event) => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          setIsExpanded(true);
                        }
                      }
                    : undefined
                }
              >
                <SettingsReadonlyMarkdown value={skill.skillMd} />
                {isCut ? (
                  <>
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-background"
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center opacity-0 transition-opacity group-hover/expand:opacity-100 group-focus-visible/expand:opacity-100">
                      <span className="rounded-full border border-border bg-background/90 px-3 py-1 text-xs shadow-xs">
                        Click to expand
                      </span>
                    </div>
                  </>
                ) : null}
              </div>

              {skill.files.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Files</h3>
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {skill.files.map((file) => (
                      <li key={file.path} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{file.path}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {isInstalled ? (
            <Button type="button" disabled>
              Installed
            </Button>
          ) : (
            <Button
              type="button"
              disabled={isInstalling}
              onClick={() => {
                onInstall(skillId);
                onClose();
              }}
            >
              <ArrowDownToLine className="size-4" />
              Install
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
