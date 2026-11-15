"use client";

import { evaluate } from "@mdx-js/mdx";
import { directiveFromMarkdown } from "mdast-util-directive";
import { highlightMarkFromMarkdown } from "mdast-util-highlight-mark";
import { highlightMark } from "micromark-extension-highlight-mark";
import { directive } from "micromark-extension-directive";
import dynamic from "next/dynamic";
import { ArrowLeft, CircleDot, FileCode2 } from "lucide-react";
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";

import { MdxEditorBlockTypeMenuPreview } from "./mdx-editor-block-type-menu-preview";
import { extractMdxHeadings, MdxTableOfContents } from "@/components/mdx-editor";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppLink, appRoute } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/errors";

type RemarkDataBag = {
  fromMarkdownExtensions?: unknown[];
  micromarkExtensions?: unknown[];
};

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  [key: string]: unknown;
};

function remarkHighlightSupport(this: unknown) {
  const data = (this as { data: () => RemarkDataBag }).data();
  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = []);
  const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = []);

  micromarkExtensions.push(highlightMark());
  fromMarkdownExtensions.push(highlightMarkFromMarkdown);
}

function remarkDirectiveSupport(this: unknown) {
  const data = (this as { data: () => RemarkDataBag }).data();
  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = []);
  const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = []);

  micromarkExtensions.push(directive());
  fromMarkdownExtensions.push(directiveFromMarkdown);
}

function remarkHighlightToMark() {
  return (tree: MarkdownNode) => {
    transformHighlightNodes(tree);
  };
}

function transformHighlightNodes(node: MarkdownNode) {
  if (!node.children) {
    return;
  }

  node.children = node.children.map((child) => {
    transformHighlightNodes(child);

    if (child.type !== "highlight") {
      return child;
    }

    return {
      type: "mdxJsxTextElement",
      name: "mark",
      attributes: [],
      children: child.children ?? [],
      data: {
        _mdxExplicitJsx: false,
      },
    };
  });
}

const ADMONITION_TYPES = new Set<AdmonitionType>(["note", "tip", "info", "caution", "danger"]);

function isInlineTocPosition(value: string): value is InlineTocPosition {
  return value === "left" || value === "right";
}

function remarkAdmonitionToPreview() {
  return (tree: MarkdownNode) => {
    transformAdmonitionNodes(tree);
  };
}

function transformAdmonitionNodes(node: MarkdownNode) {
  if (!node.children) {
    return;
  }

  node.children = node.children.map((child) => {
    transformAdmonitionNodes(child);

    if (child.type !== "containerDirective" || typeof child.name !== "string") {
      return child;
    }

    if (!ADMONITION_TYPES.has(child.name as AdmonitionType)) {
      return child;
    }

    const type = child.name as AdmonitionType;
    const { icon } = ADMONITION_META[type];

    return createMdxElement("div", ["ui-playground-admonition", `ui-playground-admonition--${type}`], [
      createMdxElement("div", ["ui-playground-admonition__icon"], [{ type: "text", value: icon }]),
      createMdxElement("div", ["ui-playground-admonition__body"], [
        createMdxElement("div", ["ui-playground-admonition__content"], child.children ?? []),
      ]),
    ]);
  });
}

function createMdxElement(name: string, classNames: string[], children: MarkdownNode[]): MarkdownNode {
  return {
    type: "mdxJsxFlowElement",
    name,
    attributes: [
      {
        type: "mdxJsxAttribute",
        name: "className",
        value: classNames.join(" "),
      },
    ],
    children,
    data: {
      _mdxExplicitJsx: false,
    },
  };
}

const INITIAL_MARKDOWN = `# Notes from the field

This playground is wired to **MDXEditor** so we can validate authoring flows before integrating anything into the main product.

## What to try

- Turn this paragraph into a heading
- Add a second list item in source mode
- Use the new top-bar buttons for inline code and fenced code blocks
- Insert a table, edit its cells, and inspect the serialized GFM source
- Try ==highlighting a phrase== from the toolbar
- Switch to diff mode to compare against the baseline

### Formatting details

Use **bold text**, links, lists, and block quotes to verify that serialized MDX still reads cleanly.

> Good playgrounds make failure obvious without making iteration slow.

### Table rendering

| Surface | Rendering | Editing |
| :--- | :---: | ---: |
| Playground | Live preview | Enabled |
| Artifact editor | Shared renderer | Enabled |

### Admonitions

:::tip
Admonitions now work in the editor and preview. Try changing this one in rich-text mode or insert a new note from the toolbar.
:::

### Code blocks

~~~ts
const previewStatus = "ready";
~~~

Read more at [mdxeditor.dev](https://mdxeditor.dev/).
`;

const CONTAINED_SCROLL_MARKDOWN = `# Contained editor notes

This second editor is rendered inside a fixed-height scroll container. Its table of contents uses the same reusable component with an explicit scroll container ref.

## Planning

Use the outline to jump between sections while only this editor panel scrolls.

### Scope

- Keep the reusable editor kit independent from the playground page.
- Let the caller decide whether the scroll target is the window or an element.
- Keep hash URLs stable for both page-level and contained examples.

## Drafting

Longer documents need local navigation even when they are embedded in a task panel, modal, or side-by-side layout.

### Working notes

The active heading is calculated relative to the scroll container, so it should not depend on the page scroll position.

:::info
The same markdown features still render in this contained example.
:::

## Review

Clicking a heading in the outline updates the URL hash and scrolls the editor panel to the matching section.

### Follow-up

This path is the one to promote into production surfaces that constrain editor height.

~~~ts
const scrollTarget = "container";
~~~

## Shipping

This final section confirms that later headings remain reachable inside the scroll container.
`;

const DynamicMdxEditor = dynamic(
  () => import("@/components/mdx-editor").then((mod) => mod.MdxEditor),
  {
    ssr: false,
    loading: () => <p className="m-0 text-muted-foreground">Loading the editor bundle...</p>,
  }
);

type PreviewComponent = React.ComponentType<Record<string, never>>;
type AdmonitionType = "note" | "tip" | "info" | "caution" | "danger";
type InlineTocPosition = "left" | "right";

type PreviewState = {
  Component: PreviewComponent | null;
  error: string | null;
  isPending: boolean;
};

const ADMONITION_META: Record<AdmonitionType, { icon: string; title: string }> = {
  note: { icon: "i", title: "Note" },
  tip: { icon: "✦", title: "Tip" },
  info: { icon: "i", title: "Info" },
  caution: { icon: "!", title: "Caution" },
  danger: { icon: "×", title: "Danger" },
};

export function MdxEditorPlayground() {
  const [markdown, setMarkdown] = useState(INITIAL_MARKDOWN);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [inlineTocPosition, setInlineTocPosition] = useState<InlineTocPosition>("left");
  const deferredMarkdown = useDeferredValue(markdown);
  const [containedMarkdown, setContainedMarkdown] = useState(CONTAINED_SCROLL_MARKDOWN);
  const deferredContainedMarkdown = useDeferredValue(containedMarkdown);
  const containedTocHeadings = useMemo(
    () =>
      extractMdxHeadings(deferredContainedMarkdown, {
        idPrefix: "contained-mdx-heading",
      }),
    [deferredContainedMarkdown]
  );
  const containedEditorRootRef = useRef<HTMLDivElement>(null);
  const containedScrollRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const pendingMarkdownRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({
    Component: null,
    error: null,
    isPending: true,
  });

  const handleEditorChange = useCallback((value: string) => {
    if (!hasMountedRef.current) {
      pendingMarkdownRef.current = value;
      return;
    }

    setMarkdown(value);
  }, []);

  useEffect(() => {
    hasMountedRef.current = true;

    if (pendingMarkdownRef.current !== null) {
      setMarkdown(pendingMarkdownRef.current);
      pendingMarkdownRef.current = null;
    }

    return () => {
      hasMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      setTheme(root.classList.contains("light") ? "light" : "dark");
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, {
      attributeFilter: ["class"],
      attributes: true,
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let isCurrent = true;
    const isDevelopment = process.env.NODE_ENV === "development";
    const runtime = isDevelopment ? jsxDevRuntime : jsxRuntime;

    startTransition(() => {
      setPreview((current) => ({
        ...current,
        error: null,
        isPending: true,
      }));
    });

    void evaluate(deferredMarkdown, {
      ...runtime,
      development: isDevelopment,
      remarkPlugins: [
        remarkGfm,
        remarkDirectiveSupport,
        remarkHighlightSupport,
        remarkAdmonitionToPreview,
        remarkHighlightToMark,
      ],
    })
      .then((module) => {
        if (!isCurrent) {
          return;
        }

        const Component = module.default as PreviewComponent;

        startTransition(() => {
          setPreview({
            Component,
            error: null,
            isPending: false,
          });
        });
      })
      .catch((error: unknown) => {
        if (!isCurrent) {
          return;
        }

        const message = getErrorMessage(error, "Preview failed to render.");

        startTransition(() => {
          setPreview({
            Component: null,
            error: message,
            isPending: false,
          });
        });
      });

    return () => {
      isCurrent = false;
    };
  }, [deferredMarkdown]);

  const PreviewComponent = preview.Component;

  return (
    <main className="min-h-screen px-[18px] pb-16 pt-7 max-[640px]:px-3">
      <div className="mx-auto grid max-w-[1440px] gap-[22px]">
        <header className="flex flex-wrap items-end justify-between gap-[18px] rounded-[28px] border border-border bg-card px-[30px] py-7 shadow-[var(--shadow-elevated)] backdrop-blur-[16px]">
          <div>
            <p className="mb-[10px] text-[0.76rem] font-bold uppercase tracking-[0.16em] text-primary">
              Convoy UI Playground
            </p>
            <h1 className="m-0 text-[clamp(2rem,4.8vw,3.25rem)] leading-[0.98]">
              MDX editor, live preview, raw source.
            </h1>
            <p className="mt-3 max-w-[58ch] leading-[1.65] text-muted-foreground">
              This route is intentionally self-contained: the editor runs client-side only, source stays
              local to the page, and preview compilation failures surface inline without interrupting
              editing.
            </p>
          </div>

          <AppLink
            href={appRoute.playground()}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-3 font-semibold text-foreground"
          >
            <ArrowLeft className="size-4" />
            Browse demos
          </AppLink>
        </header>

        <section className="grid items-start gap-[22px] 2xl:[grid-template-columns:minmax(0,1.35fr)_minmax(360px,0.85fr)]">
          <div className="min-w-0">
            <article className="min-w-0 overflow-hidden rounded-[28px] border border-border bg-card shadow-[var(--shadow-elevated)]">
              <div className="border-b border-border bg-muted px-[22px] pb-4 pt-[18px]">
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex size-8 items-center justify-center rounded-2xl bg-muted text-primary">
                    <FileCode2 className="size-4" />
                  </span>
                  <h2 className="m-0 text-base">Editor</h2>
                </div>
                <p className="m-0 leading-[1.55] text-muted-foreground">
                  Rich-text authoring with markdown shortcuts, links, lists, headings, quotes, inline
                  code, fenced code blocks, tables, and source/diff mode.
                </p>
              </div>
              <DynamicMdxEditor
                baselineMarkdown={INITIAL_MARKDOWN}
                value={markdown}
                onChange={handleEditorChange}
                theme={theme}
                inlineTableOfContents={{
                  title: "Editor outline",
                  position: inlineTocPosition,
                }}
              />
            </article>
          </div>

          <div className="grid gap-[22px]">
            <article className="min-w-0 overflow-hidden rounded-[28px] border border-border bg-card shadow-[var(--shadow-elevated)]">
              <div className="border-b border-border bg-muted px-[22px] pb-4 pt-[18px]">
                <h2 className="m-0 text-base">Rendered preview</h2>
                <p className="mt-2 leading-[1.55] text-muted-foreground">
                  Preview is generated from the current markdown value so source mode and visual mode stay
                  in sync.
                </p>
              </div>
              <div className="px-6 pb-[30px] pt-[22px] max-[640px]:px-[18px]">
                <div className="mb-4 flex flex-wrap items-center gap-[10px] text-[0.94rem] text-muted-foreground">
                  <CircleDot className="size-[10px] fill-current text-primary" />
                  {preview.isPending ? "Refreshing preview..." : "Preview is up to date"}
                </div>

                {preview.error ? (
                  <div className="rounded-[14px] border border-destructive/20 bg-danger-soft px-4 py-[14px] text-destructive">
                    Preview rendering failed. Keep editing in the left panel and fix the source when ready.
                    <br />
                    <br />
                    {preview.error}
                  </div>
                ) : PreviewComponent ? (
                  <div className="text-foreground leading-[1.72] [&_a]:text-primary [&_blockquote]:my-[1.2rem] [&_blockquote]:border-l-4 [&_blockquote]:border-l-accent [&_blockquote]:py-[0.2rem] [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:text-[0.95em] [&_h1]:leading-[1.08] [&_h1]:tracking-[-0.03em] [&_h2]:leading-[1.08] [&_h2]:tracking-[-0.03em] [&_h3]:leading-[1.08] [&_h3]:tracking-[-0.03em] [&_h4]:leading-[1.12] [&_h4]:tracking-[-0.01em] [&_mark]:rounded-[0.2em] [&_mark]:bg-highlight [&_mark]:px-[0.12em] [&_pre]:overflow-x-auto [&_pre]:rounded-[14px] [&_pre]:bg-code-surface [&_pre]:px-4 [&_pre]:py-[14px] [&_pre]:text-code-foreground [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold">
                    <PreviewComponent />
                  </div>
                ) : (
                  <p className="m-0 text-muted-foreground">Preparing preview...</p>
                )}
              </div>
            </article>

            <article className="min-w-0 overflow-hidden rounded-[28px] border border-border bg-card shadow-[var(--shadow-elevated)]">
              <div className="border-b border-border bg-muted px-[22px] pb-4 pt-[18px]">
                <h2 className="m-0 text-base">Raw MDX source</h2>
                <p className="mt-2 leading-[1.55] text-muted-foreground">
                  This is the live serialized value coming directly from the editor state.
                </p>
              </div>
              <pre className="m-0 overflow-x-auto bg-code-surface px-6 py-[22px] text-[0.92rem] leading-[1.65] text-code-foreground max-[640px]:px-[18px]">
                <code>{markdown}</code>
              </pre>
            </article>

            <article className="min-w-0 overflow-hidden rounded-[28px] border border-border bg-card shadow-[var(--shadow-elevated)]">
              <div className="border-b border-border bg-muted px-[22px] pb-4 pt-[18px]">
                <h2 className="m-0 text-base">Block Type Menu Preview</h2>
                <p className="mt-2 leading-[1.55] text-muted-foreground">
                  Persistent copy of the heading/paragraph dropdown so you can inspect row alignment.
                </p>
              </div>
              <div className="px-6 py-[22px] max-[640px]:px-[18px]">
                <MdxEditorBlockTypeMenuPreview />
              </div>
            </article>
          </div>
        </section>

        <section className="grid gap-[18px] rounded-[28px] border border-border bg-card p-5 shadow-[var(--shadow-elevated)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="m-0 text-base">Contained scroll editor</h2>
              <p className="mt-2 max-w-[72ch] leading-[1.55] text-muted-foreground">
                This example constrains the editor to a fixed-height scroll container while the table of
                contents stays outside that scroll area.
              </p>
            </div>

            <Tabs
              value={inlineTocPosition}
              onValueChange={(value) => {
                if (isInlineTocPosition(value)) {
                  setInlineTocPosition(value);
                }
              }}
              className="gap-0"
            >
              <TabsList aria-label="Inline ToC position">
                <TabsTrigger value="left">Left</TabsTrigger>
                <TabsTrigger value="right">Right</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid min-w-0 items-start gap-[18px] lg:[grid-template-columns:minmax(190px,240px)_minmax(0,1fr)]">
            <MdxTableOfContents
              headings={containedTocHeadings}
              editorRootRef={containedEditorRootRef}
              scrollContainerRef={containedScrollRef}
              topOffset={20}
              title="Contained ToC"
              className="lg:top-4"
            />

            <div
              ref={containedScrollRef}
              className="max-h-[540px] min-w-0 overflow-y-auto rounded-[22px] border border-border bg-background"
            >
              <div ref={containedEditorRootRef}>
                <DynamicMdxEditor
                  baselineMarkdown={CONTAINED_SCROLL_MARKDOWN}
                  value={containedMarkdown}
                  onChange={setContainedMarkdown}
                  theme={theme}
                  inlineTableOfContents={{
                    idPrefix: "contained-mdx-heading",
                    scrollContainerRef: containedScrollRef,
                    title: "Contained editor outline",
                    position: inlineTocPosition,
                    topOffset: 20,
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
