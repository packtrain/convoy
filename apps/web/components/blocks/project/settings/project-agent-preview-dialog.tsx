"use client";

import { ArrowDownToLine } from "lucide-react";
import { useState } from "react";

import { SettingsReadonlyMarkdown } from "@/components/blocks/settings-catalog/settings-readonly-markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

/**
 * ponytail: character count instead of measuring the rendered height, matching
 * skill-preview-dialog.tsx — a wrong guess only skips the clamp.
 */
const COLLAPSED_PROMPT_CHARS = 600;

/**
 * Read a template's prompt before installing it (docs/specs/agents.md#ui-placement).
 * Long prompts are cut and expand on click, the way a long task comment does. An
 * Agent is a single prompt, so there is no file list below it.
 */
export function ProjectAgentPreviewDialog({
  agentId,
  name,
  description,
  prompt,
  isInstalled,
  isInstalling,
  onInstall,
  onClose,
}: {
  agentId: Id<"agents">;
  name: string;
  description?: string;
  prompt?: string;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: (agentId: Id<"agents">) => void;
  onClose: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const body = prompt?.trim() ?? "";
  const isCut = !isExpanded && body.length > COLLAPSED_PROMPT_CHARS;

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
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>{description || "No description."}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {body ? (
            <div
              className={cn("overflow-hidden rounded-lg border border-border", isCut && "group/expand relative max-h-[50vh] cursor-pointer")}
              role={isCut ? "button" : undefined}
              tabIndex={isCut ? 0 : undefined}
              aria-label={isCut ? "Expand prompt" : undefined}
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
              <SettingsReadonlyMarkdown value={body} />
              {isCut ? (
                <>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-background"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center opacity-0 transition-opacity group-hover/expand:opacity-100 group-focus-visible/expand:opacity-100">
                    <span className="rounded-full border border-border bg-background/90 px-3 py-1 text-xs shadow-xs">Click to expand</span>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This template has no prompt.</p>
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
                onInstall(agentId);
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
