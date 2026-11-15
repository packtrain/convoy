import { decodeCharacterReferences } from "./normalize-markdown";

export type MdxTocHeading = {
  id: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  line: number;
};

type ExtractMdxHeadingsOptions = {
  idPrefix?: string;
};

type FenceState = {
  marker: "`" | "~";
  length: number;
};

const atxHeadingPattern = /^ {0,3}(#{1,6})(?:[\t ]+|$)(.*)$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})/;

export function extractMdxHeadings(
  markdown: string,
  { idPrefix = "mdx-heading" }: ExtractMdxHeadingsOptions = {}
): MdxTocHeading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: MdxTocHeading[] = [];
  const slugCounts = new Map<string, number>();
  let fence: FenceState | null = null;

  lines.forEach((line, index) => {
    const fenceMatch = line.match(fencePattern);

    if (fence) {
      if (fenceMatch && closesFence(fenceMatch[1] ?? "", fence)) {
        fence = null;
      }

      return;
    }

    if (fenceMatch) {
      const markerRun = fenceMatch[1] ?? "";
      fence = {
        marker: markerRun[0] as "`" | "~",
        length: markerRun.length,
      };
      return;
    }

    const headingMatch = line.match(atxHeadingPattern);

    if (!headingMatch) {
      return;
    }

    const marker = headingMatch[1] ?? "";
    const rawTitle = headingMatch[2] ?? "";
    const title = normalizeHeadingTitle(rawTitle);

    if (!title) {
      return;
    }

    const slug = uniqueSlug(slugify(title), slugCounts);

    headings.push({
      id: `${idPrefix}-${slug}`,
      depth: marker.length as MdxTocHeading["depth"],
      title,
      line: index + 1,
    });
  });

  return headings;
}

function closesFence(markerRun: string, fence: FenceState) {
  return markerRun[0] === fence.marker && markerRun.length >= fence.length;
}

function normalizeHeadingTitle(rawTitle: string) {
  return decodeCharacterReferences(
    rawTitle
      .replace(/[\t ]+#{1,}[\t ]*$/, "")
      .trim()
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/\\([\\`*_[\]{}()#+.!-])/g, "$1")
      .replace(/[*_~]/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "heading";
}

function uniqueSlug(slug: string, counts: Map<string, number>) {
  const count = counts.get(slug) ?? 0;
  counts.set(slug, count + 1);

  if (count === 0) {
    return slug;
  }

  return `${slug}-${count + 1}`;
}
