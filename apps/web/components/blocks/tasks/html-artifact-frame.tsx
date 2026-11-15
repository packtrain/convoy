"use client";

import { useMemo, useSyncExternalStore, type CSSProperties, type Ref } from "react";
import { cn } from "@/lib/utils";

/** The host-head script posts the page height under this type. */
export const HOST_HEIGHT_MESSAGE = "convoy:inline-html:height";

/** Same file `next/font` ships; served with CORS so the opaque-origin frame can load it. */
const FONT_PATH = "/fonts/inter-latin-v20.woff2";

/** Must match the token table in `plugins/convoy/skills/convoy/references/inline-html.md`. */
const THEME_TOKENS = [
  "foreground",
  "muted-foreground",
  "card",
  "card-foreground",
  "muted",
  "secondary",
  "secondary-foreground",
  "accent",
  "accent-foreground",
  "popover",
  "popover-foreground",
  "border",
  "input",
  "ring",
  "primary",
  "primary-foreground",
  "destructive",
  "danger-soft",
  "highlight",
  "code-surface",
  "code-foreground",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "radius",
];

/** Reports the page's own height (not the viewport's) and opens links in a new tab. */
const FRAME_SCRIPT = `(() => {
  const post = () => parent.postMessage({ type: "${HOST_HEIGHT_MESSAGE}", height: document.documentElement.getBoundingClientRect().height }, "*");
  new ResizeObserver(post).observe(document.documentElement);
  addEventListener("load", post);
  addEventListener("click", (event) => {
    const link = event.target instanceof Element && event.target.closest("a[href]");
    if (link) { link.target = "_blank"; link.rel = "noopener"; }
  }, true);
})();`;

/** next-themes flips the root's class and `color-scheme` style. */
function subscribeToRootTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  return () => observer.disconnect();
}

/** The frame's head for the current theme: tokens, base sheet, font, and the frame script. */
function readHostHead(): string {
  const root = getComputedStyle(document.documentElement);
  const tokens = THEME_TOKENS.map((name) => `--${name}:${root.getPropertyValue(`--${name}`).trim()};`).join("");
  // `color-scheme` must equal the app's, or the browser paints the frame opaque.
  return (
    `<style>@font-face{font-family:"Inter";src:url("${window.location.origin}${FONT_PATH}") format("woff2");font-weight:100 900;font-display:swap}` +
    `:root{color-scheme:${root.colorScheme || "normal"};${tokens}` +
    `--font-sans:"Inter",system-ui,sans-serif;--font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}` +
    `html,body{background:transparent}body{margin:0;display:flow-root;color:var(--foreground);font:14px/1.5 var(--font-sans)}</style>` +
    `<script>${FRAME_SCRIPT}</script>`
  );
}

/** After the doctype, so the page keeps standards mode; the parser hoists it into `<head>` and page styles override it. */
function withHostHead(html: string, head: string): string {
  return html.replace(/^\s*(<!doctype[^>]*>)?/i, (doctype) => doctype.trim() + head);
}

/** `html` with the host head inserted, rebuilt on theme change. Spec: docs/specs/cli-message-attachments.md#inline-html-os-2220. */
export function useHostHeadHtml(html: string | null): string | null {
  const hostHead = useSyncExternalStore(subscribeToRootTheme, readHostHead, () => "");
  return useMemo(() => (html === null ? null : withHostHead(html, hostHead)), [html, hostHead]);
}

/**
 * Read-only sandboxed renderer for html artifacts. `allow-same-origin` is
 * deliberately omitted so artifact scripts run in an opaque origin and can
 * never reach app cookies/storage. `allowPopups` lets links open a new tab.
 */
export function HtmlArtifactFrame({
  html,
  title,
  className,
  style,
  allowPopups = false,
  ref,
}: {
  html: string;
  title: string;
  className?: string;
  style?: CSSProperties;
  allowPopups?: boolean;
  ref?: Ref<HTMLIFrameElement>;
}) {
  return (
    <iframe
      ref={ref}
      srcDoc={html}
      sandbox={allowPopups ? "allow-scripts allow-popups allow-popups-to-escape-sandbox" : "allow-scripts"}
      title={title}
      style={style}
      className={cn("size-full border-0 bg-background", className)}
    />
  );
}
