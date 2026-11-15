import { getFilenameFromPath } from "@/lib/path-display";

const KNOWN_SINGULAR_LABELS: Record<string, string> = {
  files: "file",
  lines: "line",
  matches: "match",
};

function formatCountLabel(count: number, label: string) {
  if (count !== 1) {
    return label;
  }

  return KNOWN_SINGULAR_LABELS[label] ?? label;
}

interface BuildSearchTitleOptions {
  verb: string;
  pattern: string;
  path?: string;
  glob?: string;
  resultCount?: number;
  resultLabel?: string;
}

export function buildSearchTitle({
  verb,
  pattern,
  path,
  glob,
  resultCount,
  resultLabel,
}: BuildSearchTitleOptions): string {
  const target = path
    ? ` in ${getFilenameFromPath(path)}`
    : glob
      ? ` in ${glob}`
      : "";
  const count =
    resultCount !== undefined && resultLabel
      ? ` · ${resultCount} ${formatCountLabel(resultCount, resultLabel)}`
      : "";

  return `${verb} "${pattern}"${target}${count}`;
}
