import { docs } from "collections/server";
import { type InferPageType, loader } from "fumadocs-core/source";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Code,
  Compass,
  LayoutGrid,
  Rocket,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { createElement } from "react";
import { docsContentRoute, docsRoute } from "./shared";

const iconMap: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  code: Code,
  compass: Compass,
  "layout-grid": LayoutGrid,
  rocket: Rocket,
  sparkles: Sparkles,
  terminal: Terminal,
  wrench: Wrench,
};

function resolveDocIcon(icon?: string) {
  if (!icon) return undefined;

  const Icon = iconMap[icon];
  if (!Icon) return undefined;

  return createElement(Icon, {
    className: "size-4 text-fd-muted-foreground/90",
    strokeWidth: 2.1,
  });
}

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
  icon: resolveDocIcon,
  pageTree: {
    transformers: [
      {
        file(node, filePath) {
          const file = filePath ? this.storage.read(filePath) : undefined;
          if (file?.format === "page" && file.data.sidebarTitle) {
            node.name = file.data.sidebarTitle;
          }
          return node;
        },
      },
    ],
  },
});

export function getPageMarkdownUrl(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, "content.md"];

  return {
    segments,
    url: `${docsContentRoute}/${segments.join("/")}`,
  };
}

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText("processed");

  return `# ${page.data.title} (${page.url})

${processed}`;
}
