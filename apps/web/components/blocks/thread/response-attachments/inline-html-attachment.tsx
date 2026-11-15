"use client";

import { useEffect, useRef, useState } from "react";
import { HOST_HEIGHT_MESSAGE, HtmlArtifactFrame, useHostHeadHtml } from "@/components/blocks/tasks/html-artifact-frame";
import { Skeleton } from "@/components/ui/skeleton";

const PLACEHOLDER_HEIGHT = 240;
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 4000;

type ReadState = { url: string; text: string } | { url: string; failed: true };

/**
 * An agent's `--inline` html page (OS-2220), expanded in the reply and sized to its content.
 * Downloading is the file card's job. Spec: docs/specs/cli-message-attachments.md#inline-html-os-2220.
 */
export function InlineHtmlAttachment({ url, fileName }: { url: string; fileName: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [read, setRead] = useState<ReadState | null>(null);
  const [height, setHeight] = useState(PLACEHOLDER_HEIGHT);
  const current = read?.url === url ? read : null;
  const srcDoc = useHostHeadHtml(current && "text" in current ? current.text : null);

  useEffect(() => {
    let active = true;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(
        (body) => active && setRead({ url, text: body }),
        (error: unknown) => {
          console.warn("Failed to load inline html attachment", error);
          if (active) setRead({ url, failed: true });
        }
      );
    return () => {
      active = false;
    };
  }, [url]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (data?.type !== HOST_HEIGHT_MESSAGE || typeof data.height !== "number" || !Number.isFinite(data.height)) return;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // The file card below still offers the file.
  if (current && "failed" in current) return null;

  return (
    <figure data-attachment-name={fileName} className="mt-4 flex w-full flex-col gap-1 self-stretch">
      <figcaption className="min-w-0 truncate text-xs text-muted-foreground">{fileName}</figcaption>
      {srcDoc === null ? (
        <Skeleton className="w-full" style={{ height: PLACEHOLDER_HEIGHT }} />
      ) : (
        <HtmlArtifactFrame
          ref={frameRef}
          html={srcDoc}
          title={fileName}
          allowPopups
          className="block h-auto w-full bg-transparent"
          style={{ height }}
        />
      )}
    </figure>
  );
}
