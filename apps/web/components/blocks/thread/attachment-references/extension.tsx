"use client";

import { useContext } from "react";
import { mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Spinner } from "@/components/custom/spinner";
import { cn } from "@/lib/utils";
import { usePromptInputAttachments } from "@/components/ai-elements/prompt-input";
import { PromptInputFileMention } from "../prompt-input-file-mention-extension";
import { AttachmentStatusContext } from "./provider";
import { serializeAttachmentReference } from "@/lib/threads/message-attachments";
import { isPreviewableImageAttachment } from "@/lib/tasks/files";
import { AttachmentReferencePreview } from "./preview";

function Reference({ node }: NodeViewProps) {
  const { files } = usePromptInputAttachments();
  const pending = useContext(AttachmentStatusContext);
  if (node.attrs.kind !== "attachment") {
    return (
      <NodeViewWrapper as="span" data-file-mention={node.attrs.path} contentEditable={false}>
        @{node.attrs.path}
      </NodeViewWrapper>
    );
  }
  const file = files.find((file) => file.id === node.attrs.attachmentId);
  const upload = pending.find((item) => item.filePartId === node.attrs.attachmentId);
  const state = !file ? "unavailable" : (upload?.status ?? "uploading");
  const description =
    state === "unavailable"
      ? "Attachment unavailable"
      : state === "error"
        ? (upload?.error ?? "Upload failed")
        : state === "uploading"
          ? "Uploading attachment"
          : "Attachment uploaded";
  const canPreview = !!file?.url && isPreviewableImageAttachment(file.mediaType, file.url);
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-attachment-reference={node.attrs.attachmentId}
      data-attachment-state={state}
      title={canPreview && state !== "error" ? undefined : description}
      aria-label={`${node.attrs.path}: ${description}`}
      className={cn(
        "mx-0.5 inline-flex items-center gap-1 rounded bg-muted px-1 align-baseline font-medium",
        state === "unavailable" ? "text-muted-foreground opacity-60" : state === "error" ? "text-destructive" : "text-info"
      )}
    >
      {state === "uploading" ? <Spinner /> : null}
      <AttachmentReferencePreview file={file} openOnClick>
        {canPreview ? (
          <button
            type="button"
            className="cursor-zoom-in rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onMouseDown={(event) => event.preventDefault()}
          >
            #{node.attrs.path}
          </button>
        ) : (
          <span>#{node.attrs.path}</span>
        )}
      </AttachmentReferencePreview>
    </NodeViewWrapper>
  );
}

/** Local identity and live status; the message contract stays plain text. */
export const AttachmentFileMention = PromptInputFileMention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: { default: "file", parseHTML: (element) => element.getAttribute("data-mention-kind") ?? "file" },
      attachmentId: { default: null, parseHTML: (element) => element.getAttribute("data-attachment-id") },
    };
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-file-mention": node.attrs.path,
        "data-mention-kind": node.attrs.kind,
        "data-attachment-id": node.attrs.attachmentId,
      }),
      node.attrs.kind === "attachment" ? serializeAttachmentReference(node.attrs.path) : `@${node.attrs.path}`,
    ];
  },
  renderText({ node }) {
    return node.attrs.kind === "attachment" ? serializeAttachmentReference(node.attrs.path) : `@${node.attrs.path}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(Reference);
  },
});
