"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  MDXEditor,
  AdmonitionDirectiveDescriptor,
  type IconKey,
  type MDXEditorMethods,
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
  tablePlugin,
  thematicBreakPlugin,
} from "@mdxeditor/editor";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Check,
  Copy,
  ExternalLink,
  Link2Off,
  MoreHorizontal,
  Pencil,
  PinOff,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";

import { useIsMobile } from "@/hooks/browser/use-mobile";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

import { codeBlockLanguages, createCodeBlockEditorDescriptor } from "./code-block-editor";
import {
  MdxInlineTableOfContents,
  type MdxInlineTableOfContentsProps,
} from "./inline-table-of-contents";
import { MdxTableOfContents } from "./table-of-contents";
import {
  MdxMobileTableOfContentsProvider,
  MdxMobileTableOfContentsToolbarAction,
} from "./mobile-table-of-contents";
import { kitToolbarPlugin } from "./toolbar";
import { extractMdxHeadings } from "./lib/extract-mdx-headings";
import {
  denormalizeMarkdownFromMdxEditor,
  normalizeMarkdownForMdxEditor,
} from "./lib/normalize-markdown";
import { cn } from "@/lib/utils";

export type MdxEditorInlineTableOfContentsOptions = Omit<
  MdxInlineTableOfContentsProps,
  "editorRootRef" | "headings"
> & {
  idPrefix?: string;
};

export type MdxEditorKitProps = {
  value: string;
  onChange: (value: string) => void;
  baselineMarkdown?: string;
  className?: string;
  /** Defaults to the resolved app theme. */
  theme?: "light" | "dark";
  showDiffMode?: boolean;
  stickyToolbar?: boolean;
  toolbar?: boolean;
  inlineTableOfContents?: boolean | MdxEditorInlineTableOfContentsOptions;
  density?: "default" | "compact";
  contentPadding?: "default" | "spacious";
  // "narrow" caps rich-text content at a readable measure and centers it
  // (source mode always stays full width); "default" fills the host.
  contentWidth?: "default" | "narrow";
  disabled?: boolean;
};

const tocPinnedStorageKey = "convoy.mdx-editor.toc-pinned";

function readStoredTocPinned() {
  return readLocalString(tocPinnedStorageKey) === "true";
}

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
    case "add_row":
    case "add_column":
      return <Plus className="size-4" />;
    case "more_horiz":
      return <MoreHorizontal className="size-4" />;
    case "delete_small":
      return <Trash2 className="size-4" />;
    case "insert_row_above":
      return <BetweenHorizontalStart className="size-4" />;
    case "insert_row_below":
      return <BetweenHorizontalEnd className="size-4" />;
    case "insert_col_left":
      return <BetweenVerticalStart className="size-4" />;
    case "insert_col_right":
      return <BetweenVerticalEnd className="size-4" />;
    case "format_align_left":
      return <AlignLeft className="size-4" />;
    case "format_align_center":
      return <AlignCenter className="size-4" />;
    case "format_align_right":
      return <AlignRight className="size-4" />;
    default:
      return <span className="block size-4" aria-hidden="true" />;
  }
}

export function MdxEditor({
  value,
  onChange,
  baselineMarkdown,
  className,
  theme,
  showDiffMode = true,
  stickyToolbar = false,
  toolbar = true,
  inlineTableOfContents = false,
  density = "default",
  contentPadding = "default",
  contentWidth = "default",
  disabled = false,
}: MdxEditorKitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { resolvedTheme } = useTheme();
  const editorTheme = theme ?? (resolvedTheme === "light" ? "light" : "dark");
  const [overlayContainer, setOverlayContainer] = useState<HTMLElement | null>(null);
  const [isTocPinned, setIsTocPinned] = useState(readStoredTocPinned);

  const setTocPinned = (pinned: boolean) => {
    setIsTocPinned(pinned);
    // Storage may be unavailable (private mode) — the pin just won't persist.
    writeLocalString(tocPinnedStorageKey, String(pinned));
  };
  const normalizedValue = useMemo(() => normalizeMarkdownForMdxEditor(value), [value]);
  const editorRef = useRef<MDXEditorMethods>(null);
  const lastAppliedMarkdownRef = useRef(normalizedValue);
  const normalizedBaselineMarkdown = useMemo(
    () =>
      baselineMarkdown ? normalizeMarkdownForMdxEditor(baselineMarkdown) : normalizedValue,
    [baselineMarkdown, normalizedValue]
  );
  const inlineTocOptions =
    typeof inlineTableOfContents === "object" ? inlineTableOfContents : undefined;
  const inlineTocIdPrefix = inlineTocOptions?.idPrefix;
  const inlineTocPosition = inlineTocOptions?.position ?? "left";
  const inlineTocHeadings = useMemo(
    () =>
      inlineTableOfContents
        ? extractMdxHeadings(normalizedValue, { idPrefix: inlineTocIdPrefix })
        : [],
    [inlineTableOfContents, normalizedValue, inlineTocIdPrefix]
  );
  const showPinnedToc = Boolean(inlineTableOfContents) && isTocPinned && !isMobile;
  const showInlineToc = Boolean(inlineTableOfContents) && !isTocPinned && !isMobile;
  const showMobileToc = Boolean(inlineTableOfContents) && isMobile;
  const mobileTocContextValue = useMemo(
    () =>
      inlineTableOfContents
        ? {
            headings: inlineTocHeadings,
            editorRootRef: rootRef,
            scrollContainerRef: inlineTocOptions?.scrollContainerRef,
            topOffset: inlineTocOptions?.topOffset,
            title: inlineTocOptions?.title,
            updateHash: inlineTocOptions?.updateHash,
          }
        : null,
    [
      inlineTableOfContents,
      inlineTocHeadings,
      inlineTocOptions?.scrollContainerRef,
      inlineTocOptions?.title,
      inlineTocOptions?.topOffset,
      inlineTocOptions?.updateHash,
    ]
  );
  const [pinnedTocHeaderHeight, setPinnedTocHeaderHeight] = useState(41);

  useEffect(() => {
    const root = rootRef.current;

    if (!showPinnedToc || !root) {
      return;
    }

    // The toolbar is rendered asynchronously by the MDXEditor toolbar plugin,
    // so wait for it to appear before syncing the pinned ToC header height.
    let resizeObserver: ResizeObserver | null = null;

    const observeToolbar = () => {
      const toolbarElement = root.querySelector(".mdx-editor-kit__toolbar");

      if (!toolbarElement) {
        return false;
      }

      const syncHeight = () =>
        setPinnedTocHeaderHeight(Math.round(toolbarElement.getBoundingClientRect().height));

      syncHeight();
      resizeObserver = new ResizeObserver(syncHeight);
      resizeObserver.observe(toolbarElement);
      return true;
    };

    if (observeToolbar()) {
      return () => resizeObserver?.disconnect();
    }

    const mutationObserver = new MutationObserver(() => {
      if (observeToolbar()) {
        mutationObserver.disconnect();
      }
    });
    mutationObserver.observe(root, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, [showPinnedToc]);

  useEffect(() => {
    if (lastAppliedMarkdownRef.current === normalizedValue) {
      return;
    }

    editorRef.current?.setMarkdown(normalizedValue);
    lastAppliedMarkdownRef.current = normalizedValue;
  }, [normalizedValue]);

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
      data-density={density}
      data-content-padding={contentPadding === "spacious" ? "spacious" : undefined}
      data-content-width={contentWidth === "narrow" ? "narrow" : undefined}
      data-inline-toc={showInlineToc ? "true" : undefined}
      data-inline-toc-position={showInlineToc ? inlineTocPosition : undefined}
      data-mobile-toc={showMobileToc ? "true" : undefined}
      aria-disabled={disabled}
      className={cn(
        "mdx-editor-kit relative flex flex-col",
        editorTheme === "light" ? "mdx-editor-kit--light" : "mdx-editor-kit--dark",
        className
      )}
    >
      <div
        className={cn(
          "min-h-0 flex-1 flex flex-col",
          showPinnedToc && "md:flex-row"
        )}
      >
        {showInlineToc && (
          <MdxInlineTableOfContents
            headings={inlineTocHeadings}
            editorRootRef={rootRef}
            scrollContainerRef={inlineTocOptions?.scrollContainerRef}
            className={inlineTocOptions?.className}
            position={inlineTocPosition}
            topOffset={inlineTocOptions?.topOffset}
            title={inlineTocOptions?.title}
            updateHash={inlineTocOptions?.updateHash}
            onPin={() => setTocPinned(true)}
          />
        )}

        {showPinnedToc && (
          <div className="hidden w-60 shrink-0 border-r border-border md:block">
            <MdxTableOfContents
              headings={inlineTocHeadings}
              editorRootRef={rootRef}
              scrollContainerRef={inlineTocOptions?.scrollContainerRef}
              topOffset={inlineTocOptions?.topOffset}
              title={inlineTocOptions?.title}
              updateHash={inlineTocOptions?.updateHash}
              className="rounded-none border-none bg-transparent shadow-none lg:top-0"
              headerClassName="bg-card px-3 py-0"
              headerStyle={{ height: pinnedTocHeaderHeight }}
              action={
                <button
                  type="button"
                  aria-label="Unpin table of contents"
                  title="Unpin table of contents"
                  className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setTocPinned(false)}
                >
                  <PinOff className="size-4" />
                </button>
              }
            />
          </div>
        )}

        <MdxMobileTableOfContentsProvider value={mobileTocContextValue}>
        <MDXEditor
          ref={editorRef}
          className={cn(
            "bg-card",
            disabled && "pointer-events-none select-none opacity-80"
          )}
          contentEditableClassName={cn(
            "mdx-editor-kit__content text-base leading-[1.7] text-foreground [&_p]:my-0 [&_p+*]:mt-4 [&_h1]:mt-0 [&_h1]:text-[2rem] [&_h1]:font-semibold [&_h1]:leading-[1.08] [&_h1]:tracking-[-0.03em] [&_h1+*]:mt-4 [&_h1+p]:mt-4 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h2]:leading-[1.12] [&_h2]:tracking-[-0.03em] [&_h2+*]:mt-3 [&_h2+p]:mt-3 [&_h3]:text-[1.2rem] [&_h3]:font-semibold [&_h3]:leading-[1.18] [&_h3]:tracking-[-0.03em] [&_h3+*]:mt-3 [&_h3+p]:mt-3 [&_h4]:text-[1.05rem] [&_h4]:font-semibold [&_h4]:leading-[1.24] [&_h4]:tracking-[-0.01em] [&_h4+*]:mt-2 [&_h4+p]:mt-2 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-l-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote_p]:m-0 [&_mark]:rounded-[0.2em] [&_mark]:bg-highlight [&_mark]:px-[0.12em] [&_mark]:text-inherit"
          )}
          iconComponentFor={renderMdxIcon}
          markdown={normalizedValue}
          onChange={(markdown, initialMarkdownNormalize) => {
            const publishedMarkdown = initialMarkdownNormalize
              ? value
              : denormalizeMarkdownFromMdxEditor(markdown);
            lastAppliedMarkdownRef.current = normalizeMarkdownForMdxEditor(publishedMarkdown);
            onChange(publishedMarkdown);
          }}
          overlayContainer={overlayContainer}
          plugins={[
            directivesPlugin({
              directiveDescriptors: [AdmonitionDirectiveDescriptor],
            }),
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            tablePlugin(),
            thematicBreakPlugin(),
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
              diffMarkdown: normalizedBaselineMarkdown,
              viewMode: "rich-text",
            }),
            ...(toolbar
              ? [
                  kitToolbarPlugin({
                    showDiffMode,
                    stickyToolbar,
                    mobileTableOfContents: <MdxMobileTableOfContentsToolbarAction />,
                  }),
                ]
              : []),
          ]}
        />
        </MdxMobileTableOfContentsProvider>
      </div>
    </div>
  );
}

export type MdxEditorProps = MdxEditorKitProps;
