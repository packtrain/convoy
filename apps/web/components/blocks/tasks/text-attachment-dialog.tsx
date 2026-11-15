"use client";

import { Code, Download as DownloadIcon, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { HtmlArtifactFrame, useHostHeadHtml } from "@/components/blocks/tasks/html-artifact-frame";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isMarkdownContentType } from "@/lib/tasks/files";

export interface TextAttachmentPreview {
  fileName: string;
  url: string;
  contentType: string;
  onDownload: () => void;
}

/** Square icon segments; the active one is a borderless raised tile in both themes. */
const SEGMENT_CLASS =
  "aspect-square h-full flex-none cursor-pointer rounded-md p-0 text-foreground/70 dark:text-foreground/70 data-active:border-transparent data-active:bg-background data-active:shadow-sm dark:data-active:border-transparent dark:data-active:bg-accent";

type ReadState = { url: string; text: string } | { url: string; failed: true };

/** Reads a text attachment once and shows it: markdown and html rendered with a source toggle, anything else as-is. */
export function TextAttachmentDialog({ preview, onClose }: { preview: TextAttachmentPreview; onClose: () => void }) {
  const { url, fileName, contentType, onDownload } = preview;
  const [read, setRead] = useState<ReadState | null>(null);
  const [showSource, setShowSource] = useState(false);
  const current = read?.url === url ? read : null;
  const isHtml = contentType.startsWith("text/html");
  const isMarkdown = isMarkdownContentType(contentType);
  const previewHtml = useHostHeadHtml(isHtml && current && "text" in current ? current.text : null);

  useEffect(() => {
    let active = true;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(
        (text) => active && setRead({ url, text }),
        (error: unknown) => {
          console.warn("Failed to load text attachment", error);
          if (active) setRead({ url, failed: true });
        }
      );
    return () => {
      active = false;
    };
  }, [url]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="truncate">{fileName}</DialogTitle>
          <DialogDescription className="sr-only">File preview</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {current === null ? (
            <Skeleton className="h-40 w-full" aria-label="Loading preview" />
          ) : "failed" in current ? (
            <p className="text-sm text-muted-foreground">Couldn&apos;t load the preview. Download the file instead.</p>
          ) : previewHtml !== null && !showSource ? (
            <HtmlArtifactFrame html={previewHtml} title={fileName} allowPopups className="block bg-transparent" style={{ height: "65vh" }} />
          ) : isMarkdown && !showSource ? (
            <MessageResponse className="text-sm leading-6">{current.text}</MessageResponse>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs text-foreground">
              {current.text}
            </pre>
          )}
        </div>
        <DialogFooter className="shrink-0">
          {(isHtml || isMarkdown) && (
            <Tabs value={showSource ? "source" : "preview"} onValueChange={(value) => setShowSource(value === "source")} className="sm:mr-auto">
              <TabsList className="h-8 gap-0.5 rounded-lg border p-0.5 group-data-horizontal/tabs:h-8 dark:bg-background">
                <TabsTrigger value="preview" aria-label="Preview" title="Preview" className={SEGMENT_CLASS}>
                  <Eye />
                </TabsTrigger>
                <TabsTrigger value="source" aria-label="Source" title="Source" className={SEGMENT_CLASS}>
                  <Code />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={onDownload}>
            <DownloadIcon className="size-4" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
