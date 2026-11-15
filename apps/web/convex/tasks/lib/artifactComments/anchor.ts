/**
 * Server-side anchor derivation for agent-created comments: agents provide the
 * exact snippet (and optionally which occurrence), the server builds the full
 * dual anchor (text + surrounding context + offset hints) from the artifact's
 * markdown source. Mirrors the shape captured client-side from rendered text.
 */

import type { ArtifactCommentAnchor } from "./validators";

const CONTEXT_LEN = 40;

export function deriveArtifactCommentAnchor(
  content: string,
  text: string,
  occurrence: number
): ArtifactCommentAnchor | null {
  if (text.length === 0 || occurrence < 1) {
    return null;
  }

  let index = -1;
  for (let i = 0; i < occurrence; i++) {
    index = content.indexOf(text, index + 1);
    if (index === -1) {
      return null;
    }
  }

  const end = index + text.length;
  return {
    text,
    prefix: content.slice(Math.max(0, index - CONTEXT_LEN), index),
    suffix: content.slice(end, end + CONTEXT_LEN),
    startOffset: index,
    endOffset: end,
  };
}
