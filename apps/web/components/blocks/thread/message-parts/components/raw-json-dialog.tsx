"use client";

import { useState, type ReactNode } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type RawJsonDialogSection = {
  title: string;
  description?: string;
  json: string;
};

interface RawJsonDialogProps {
  /** Eagerly provided sections (computed on every render). */
  sections?: RawJsonDialogSection[];
  /** Lazy sections — only called when the dialog opens. Avoids eager JSON.stringify. */
  lazySections?: () => RawJsonDialogSection[];
  iconOnly?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
}

export function RawJsonDialog({
  sections,
  lazySections,
  iconOnly = false,
  open,
  onOpenChange,
  trigger,
}: RawJsonDialogProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const currentOpen = open ?? internalOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const displaySections = currentOpen && lazySections
    ? lazySections()
    : sections ?? [];
  if (!sections && !lazySections) {
    return null;
  }

  const dialogTrigger = trigger ?? (isControlled
    ? null
    : iconOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label="View raw JSON"
        >
          <Braces className="size-3.5" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="w-fit" aria-label="View raw JSON">
          <Braces className="size-3.5" />
          View raw JSON
        </Button>
      ));

  return (
    <Dialog open={currentOpen} onOpenChange={handleOpenChange}>
      {dialogTrigger ? <DialogTrigger asChild>{dialogTrigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Raw JSON</DialogTitle>
          <DialogDescription>
            Compare converted output and raw stream payloads.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {displaySections.map((section) => (
            <div key={section.title} className="space-y-1">
              <h3 className="text-xs font-medium text-foreground">{section.title}</h3>
              {section.description && (
                <p className="text-xs text-muted-foreground">{section.description}</p>
              )}
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs text-foreground">
                <code>{section.json}</code>
              </pre>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
