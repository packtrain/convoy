"use client";

import { useEffect, useRef, useState } from "react";

import {
  MDXEditor,
  AdmonitionDirectiveDescriptor,
  type IconKey,
  codeBlockPlugin,
  codeMirrorPlugin,
  directivesPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
} from "@mdxeditor/editor";
import { Check, Copy, ExternalLink, Link2Off, Pencil, X } from "lucide-react";

import { codeBlockLanguages, createCodeBlockEditorDescriptor } from "./code-block-editor";
import { kitToolbarPlugin } from "./toolbar";
import { cn } from "./lib/utils";

export type MdxEditorKitProps = {
  value: string;
  onChange: (value: string) => void;
  baselineMarkdown?: string;
  className?: string;
  theme?: "light" | "dark";
  showDiffMode?: boolean;
};

function renderMdxIcon(name: IconKey) {
  switch (name) {
    case "open_in_new":
      return <ExternalLink className="size-4" />;
    case "edit":
      return <Pencil className="size-4" />;
    case "content_copy":
      return <Copy className="size-4" />;
    case "check":
      return <Check className="size-4" />;
    case "link_off":
      return <Link2Off className="size-4" />;
    case "close":
      return <X className="size-4" />;
    default:
      return <span className="block size-4" aria-hidden="true" />;
  }
}

export function MdxEditorKit({
  value,
  onChange,
  baselineMarkdown,
  className,
  theme = "dark",
  showDiffMode = true,
}: MdxEditorKitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [overlayContainer, setOverlayContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const element = rootRef.current;

    if (!element) {
      return;
    }

    setOverlayContainer(element);

    const handleClick = (event: MouseEvent) => {
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }

      if (!(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest<HTMLAnchorElement>(".mdxeditor a[href]");

      if (!anchor || !element.contains(anchor)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.open(anchor.href, "_blank", "noopener,noreferrer");
    };

    element.addEventListener("click", handleClick, true);

    return () => {
      element.removeEventListener("click", handleClick, true);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn(
        "mdx-editor-kit",
        theme === "light" ? "mdx-editor-kit--light" : "mdx-editor-kit--dark",
        className
      )}
    >
      <MDXEditor
        className="bg-card"
        contentEditableClassName="mdx-editor-kit__content text-base leading-[1.7] text-foreground [&_p]:my-0 [&_p+*]:mt-4 [&_h1]:mt-0 [&_h1]:text-[2rem] [&_h1]:font-semibold [&_h1]:leading-[1.08] [&_h1]:tracking-[-0.03em] [&_h1+*]:mt-4 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h2]:leading-[1.12] [&_h2]:tracking-[-0.03em] [&_h2+*]:mt-3 [&_h3]:text-[1.2rem] [&_h3]:font-semibold [&_h3]:leading-[1.18] [&_h3]:tracking-[-0.03em] [&_h3+*]:mt-3 [&_h4]:text-[1.05rem] [&_h4]:font-semibold [&_h4]:leading-[1.24] [&_h4]:tracking-[-0.01em] [&_h4+*]:mt-2 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-l-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote_p]:m-0 [&_mark]:rounded-[0.2em] [&_mark]:bg-highlight [&_mark]:px-[0.12em] [&_mark]:text-inherit"
        iconComponentFor={renderMdxIcon}
        markdown={value}
        onChange={onChange}
        overlayContainer={overlayContainer}
        plugins={[
          directivesPlugin({
            directiveDescriptors: [AdmonitionDirectiveDescriptor],
          }),
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          linkPlugin(),
          linkDialogPlugin({
            showLinkTitleField: false,
          }),
          markdownShortcutPlugin(),
          codeBlockPlugin({
            codeBlockEditorDescriptors: [createCodeBlockEditorDescriptor()],
            defaultCodeBlockLanguage: "txt",
          }),
          codeMirrorPlugin({
            codeBlockLanguages,
          }),
          diffSourcePlugin({
            diffMarkdown: baselineMarkdown ?? value,
            viewMode: "rich-text",
          }),
          kitToolbarPlugin({
            showDiffMode,
          }),
        ]}
      />
    </div>
  );
}
