// Pure text re-anchoring for artifact-comment highlights (OS-1019).
//
// A comment stores the snippet plus surrounding context and a coarse offset hint (see
// `artifactComments.anchor` in convex/schema.ts and ADR 0005); this re-finds it in the
// *current* text. Degrades so comments survive edits and detach only when the snippet is
// gone entirely:
//
//   1. context needle (prefix+text+suffix) near the hint  — disambiguates duplicates
//   2. context needle anywhere                            — survives large shifts
//   3. bare text near the hint                            — context changed, text survived
//   4. bare text anywhere                                 — last resort
//   5. null                                               — detached

export interface CommentAnchor {
  /** The selected snippet, copied verbatim at creation. */
  text: string;
  /** ~40 chars of leading context captured at creation. */
  prefix: string;
  /** ~40 chars of trailing context captured at creation. */
  suffix: string;
  /** Rendered-text offset where the snippet started at creation (a hint only). */
  startOffset: number;
}

export interface LocatedRange {
  start: number;
  end: number;
}

const WINDOW = 500;

/** indexOf within [hint-WINDOW, hint+WINDOW], else -1. */
function searchNear(content: string, needle: string, hint: number): number {
  if (!needle) return -1;
  const from = Math.max(0, hint - WINDOW);
  const idx = content.indexOf(needle, from);
  return idx !== -1 && idx <= hint + WINDOW ? idx : -1;
}

export function locateAnchor(content: string, anchor: CommentAnchor): LocatedRange | null {
  const { text, prefix, suffix, startOffset } = anchor;
  if (!text) return null;

  // Context-wrapped needle first (disambiguates duplicate snippets), then the
  // bare snippet (context changed but the text survived). Each tries the
  // hint window before falling back to a global search.
  const candidates: Array<[needle: string, textStart: number]> = [
    [prefix + text + suffix, prefix.length],
    [text, 0],
  ];

  for (const [needle, textStart] of candidates) {
    let idx = searchNear(content, needle, startOffset - textStart);
    if (idx === -1) idx = content.indexOf(needle);
    if (idx === -1) continue;
    const start = idx + textStart;
    return { start, end: start + text.length };
  }

  // Snippet gone → detached.
  return null;
}

/**
 * 1-based line range of the anchor's snippet within `content` (e.g. the
 * artifact's markdown source), or null when the snippet can't be found —
 * anchors capture rendered text, so formatted snippets may not match source.
 */
export function locateAnchorLines(
  content: string,
  anchor: CommentAnchor
): { start: number; end: number } | null {
  const range = locateAnchor(content, anchor);
  if (!range) return null;
  const lineAt = (offset: number) =>
    content.slice(0, offset).split("\n").length;
  return { start: lineAt(range.start), end: lineAt(Math.max(range.start, range.end - 1)) };
}
