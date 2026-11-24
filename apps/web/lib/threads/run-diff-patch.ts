import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import { isRecord } from "@/lib/type-guards";

/**
 * Path from a `diff --git a/X b/X` header. With `--no-renames` both sides are
 * the same path, so a path with spaces still splits unambiguously.
 */
function headerPath(part: string): string | undefined {
  if (part.startsWith("diff --cc ")) {
    return part.slice("diff --cc ".length, part.indexOf("\n")) || undefined;
  }
  const header = part.slice("diff --git ".length, part.indexOf("\n"));
  const length = (header.length - "a/ b/".length) / 2;
  if (!Number.isInteger(length) || length <= 0 || !header.startsWith("a/")) {
    return undefined;
  }
  const source = header.slice(2, 2 + length);
  return header.slice(5 + length) === source ? source : undefined;
}

/**
 * Split a whole-run git patch into per-file chunks keyed by path. Paths come
 * from the `+++ b/` header (or `--- a/` for deletions), which is unambiguous
 * for paths with spaces; sections without content lines (empty files, mode
 * flips, binaries) fall back to the `diff --git` header. ponytail: exotic
 * paths git quotes (tabs, newlines) won't match and are dropped.
 */
export function splitRunPatch(patch: string): Map<string, string> {
  const sections = new Map<string, string>();
  // `diff --cc`: a merge commit's combined diff (OS-2534).
  for (const part of patch.split(/^(?=diff --(?:git|cc) )/m)) {
    if (!part.startsWith("diff --git ") && !part.startsWith("diff --cc ")) {
      continue;
    }
    const path =
      part.match(/^\+\+\+ b\/(.+)$/m)?.[1] ??
      part.match(/^--- a\/(.+)$/m)?.[1] ??
      headerPath(part);
    if (path) {
      sections.set(path, part);
    }
  }
  return sections;
}

export interface FileOpResult {
  text: string;
  truncated: boolean;
}

/** `resultJson` of a readFile/diffFile/worktreeChanges op → its text, or null when malformed. */
export function parseFileOpResult(resultJson: string | undefined, field: "patch" | "content"): FileOpResult | null {
  if (!resultJson) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(resultJson);
    if (!isRecord(parsed)) {
      return null;
    }
    const text = parsed[field];
    if (typeof text !== "string") {
      return null;
    }
    return { text, truncated: parsed.truncated === true };
  } catch {
    return null;
  }
}

/**
 * Derive a `diffSummary.files`-shaped list from split patch sections, for
 * ranges that have no stored summary (the cumulative "All changes" view,
 * OS-1158). Kind comes from the `new file mode` / `deleted file mode`
 * headers, ±counts from the patch lines themselves.
 */
export function parseRunPatchFiles(sections: Map<string, string>): CliRunDiffFile[] {
  const files: CliRunDiffFile[] = [];
  for (const [path, section] of sections) {
    const binary = /^(Binary files |GIT binary patch)/m.test(section);
    const kind = /^new file mode /m.test(section)
      ? ("added" as const)
      : /^deleted file mode /m.test(section)
        ? ("deleted" as const)
        : ("modified" as const);
    let additions = 0;
    let deletions = 0;
    // A combined diff has one marker column per parent: `@@@` means two (OS-2534).
    const columns = Math.max(1, (section.match(/^(@+) /m)?.[1].length ?? 2) - 1);
    if (!binary) {
      // Header lines come before the first hunk; inside one, `+++x` is content.
      let inHunk = false;
      for (const line of section.split("\n")) {
        if (line.startsWith("@@")) {
          inHunk = true;
          continue;
        }
        if (!inHunk) {
          continue;
        }
        const markers = line.slice(0, columns);
        if (markers.includes("+")) {
          additions++;
        } else if (markers.includes("-")) {
          deletions++;
        }
      }
    }
    files.push({ path, kind, additions, deletions, ...(binary ? { binary } : {}) });
  }
  return files;
}
