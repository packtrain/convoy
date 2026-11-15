"use client";

import { useState } from "react";

import dynamic from "next/dynamic";
import { Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormControl, FormLabel } from "@/components/ui/form";
import { cn } from "@/lib/utils";

const MdxEditor = dynamic(
  () => import("@/components/mdx-editor").then((mod) => mod.MdxEditor),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3 p-3" aria-label="Loading editor">
        <Skeleton className="h-8 w-64 max-w-full rounded-sm" />
        <Skeleton className="h-4 w-full rounded-sm" />
        <Skeleton className="h-4 w-5/6 rounded-sm" />
      </div>
    ),
  }
);

export const boundedPromptEditorClassName =
  "h-full min-h-0 overflow-hidden [&_.mdx-editor-kit__content]:!min-h-0 [&_.mdxeditor]:overflow-hidden [&_.mdxeditor-rich-text-editor]:overflow-y-auto [&_.mdxeditor-source-editor]:min-h-0 [&_.mdxeditor-source-editor]:flex-1 [&_.mdxeditor-source-editor]:overflow-y-auto";

interface PromptContentEditorProps {
  value: string;
  disabled?: boolean;
  className?: string;
  editorClassName?: string;
  onChange: (value: string) => void;
}

export function PromptContentEditor({
  value,
  disabled = false,
  className,
  editorClassName,
  onChange,
}: PromptContentEditorProps) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-background",
        disabled && "opacity-80",
        className
      )}
    >
      <MdxEditor
        value={value}
        onChange={onChange}
        showDiffMode={false}
        stickyToolbar
        density="compact"
        disabled={disabled}
        className={cn("flex-1", editorClassName)}
      />
    </div>
  );
}

interface SettingsPromptEditorProps {
  label: string;
  dialogTitle?: string;
  wideViewAriaLabel?: string;
  value: string;
  disabled: boolean;
  className?: string;
  editorClassName?: string;
  onChange: (value: string) => void;
}

export function SettingsPromptEditor({
  label,
  dialogTitle = "Prompt",
  wideViewAriaLabel = "Open prompt editor wide view",
  value,
  disabled,
  className,
  editorClassName,
  onChange,
}: SettingsPromptEditorProps) {
  // Render a single MDX editor instance at a time: inline while collapsed, in the
  // dialog while expanded. Avoids mounting two editors and syncing them by ref.
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <FormLabel>{label}</FormLabel>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={wideViewAriaLabel}
              className="size-7 text-muted-foreground"
            >
              <Maximize2 className="size-3.5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="flex h-[90vh] w-[min(1200px,calc(100vw-2rem))] max-w-[min(1200px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-2rem))]">
            <DialogHeader className="border-b border-border px-4 py-3 pr-12">
              <DialogTitle>{dialogTitle}</DialogTitle>
            </DialogHeader>
            <div className="flex min-h-0 flex-1">
              <PromptContentEditor
                value={value}
                disabled={disabled}
                onChange={onChange}
                className="min-h-0 flex-1 rounded-none border-0"
                editorClassName={boundedPromptEditorClassName}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <FormControl>
        {open ? (
          // Placeholder keeps layout stable while the single editor instance lives
          // in the wide dialog.
          <div
            aria-hidden
            className={cn(
              "rounded-lg border border-border bg-muted/30",
              className
            )}
          />
        ) : (
          <PromptContentEditor
            value={value}
            disabled={disabled}
            onChange={onChange}
            className={className}
            editorClassName={editorClassName}
          />
        )}
      </FormControl>
    </>
  );
}
