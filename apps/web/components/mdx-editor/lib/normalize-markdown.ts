// MDXEditor always parses with the MDX JSX extension, which has no autolinks:
// every `<...>` outside code has to be escaped. See docs/specs/ui-playground-mdx-editor.md.
export function normalizeMarkdownForMdxEditor(markdown: string) {
  return transformProseMarkdown(markdown, normalizeInlineMarkdown);
}

export function denormalizeMarkdownFromMdxEditor(markdown: string) {
  return transformProseMarkdown(markdown, denormalizeInlineMarkdown);
}

function transformProseMarkdown(markdown: string, transformInline: (value: string) => string) {
  const lines = markdown.split(/(\r?\n)/);
  let inFence = false;
  let fenceMarker: string | null = null;

  return lines
    .map((line) => {
      if (line === "\n" || line === "\r\n") {
        return line;
      }

      const fenceMatch = /^( {0,3})(`{3,}|~{3,})/.exec(line);

      if (fenceMatch) {
        const marker = fenceMatch[2];

        if (!inFence) {
          inFence = true;
          fenceMarker = marker[0];
          return line;
        }

        if (marker[0] === fenceMarker) {
          inFence = false;
          fenceMarker = null;
        }

        return line;
      }

      if (inFence) {
        return line;
      }

      if (isBlockDirectiveLine(line)) {
        return line;
      }

      return transformInline(line);
    })
    .join("");
}

function normalizeInlineMarkdown(markdown: string) {
  let result = "";
  let index = 0;

  while (index < markdown.length) {
    if (markdown[index] === "`") {
      const tickRun = readBacktickRun(markdown, index);
      const closingIndex = markdown.indexOf(tickRun, index + tickRun.length);

      if (closingIndex === -1) {
        result += tickRun;
        index += tickRun.length;
        continue;
      }

      result += markdown.slice(index, closingIndex + tickRun.length);
      index = closingIndex + tickRun.length;
      continue;
    }

    if (markdown[index] === "<") {
      if (markdown[index - 1] === "\\") {
        result += "<";
        index += 1;
        continue;
      }

      const closingIndex = markdown.indexOf(">", index + 1);

      if (closingIndex === -1) {
        result += "\\<";
        index += 1;
        continue;
      }

      result += `\\${markdown.slice(index, closingIndex + 1)}`;
      index = closingIndex + 1;
      continue;
    }

    if (markdown[index - 1] !== "\\" && startsProseTextDirective(markdown, index)) {
      result += "\\:";
      index += 1;
      continue;
    }

    result += markdown[index];
    index += 1;
  }

  return result;
}

function denormalizeInlineMarkdown(markdown: string) {
  let result = "";
  // Prose is decoded, code is not: a `&amp;` inside code is author-typed text.
  let prose = "";
  let index = 0;

  while (index < markdown.length) {
    if (markdown[index] === "`") {
      const tickRun = readBacktickRun(markdown, index);
      const closingIndex = markdown.indexOf(tickRun, index + tickRun.length);

      if (closingIndex === -1) {
        prose += tickRun;
        index += tickRun.length;
        continue;
      }

      result += decodeCharacterReferences(prose);
      prose = "";
      result += markdown.slice(index, closingIndex + tickRun.length);
      index = closingIndex + tickRun.length;
      continue;
    }

    if (markdown[index] === "\\" && markdown[index + 1] === "<") {
      const closingIndex = markdown.indexOf(">", index + 2);

      if (closingIndex === -1) {
        prose += "<";
        index += 2;
        continue;
      }

      prose += markdown.slice(index + 1, closingIndex + 1);
      index = closingIndex + 1;
      continue;
    }

    if (markdown[index] === "\\" && startsProseTextDirective(markdown, index + 1)) {
      prose += ":";
      index += 2;
      continue;
    }

    prose += markdown[index];
    index += 1;
  }

  return result + decodeCharacterReferences(prose);
}

// MDXEditor serializes prose characters as HTML entities (`&` becomes `&amp;`, a
// trailing space becomes `&#x20;`); decode them so no entity residue is stored.
export function decodeCharacterReferences(value: string) {
  return value
    .replace(/&#x([0-9a-f]{1,6});/gi, (match, hex: string) =>
      decodeCodePoint(parseInt(hex, 16), match)
    )
    .replace(/&#(\d{1,7});/g, (match, dec: string) =>
      decodeCodePoint(parseInt(dec, 10), match)
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function decodeCodePoint(code: number, fallback: string) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

function isBlockDirectiveLine(line: string) {
  return /^( {0,3}):{2,}(?:[A-Za-z][A-Za-z0-9_-]*\b|\s*$)/.test(line);
}

function startsProseTextDirective(markdown: string, colonIndex: number) {
  return (
    markdown[colonIndex] === ":" &&
    /^[A-Za-z][A-Za-z0-9_-]*/.test(markdown.slice(colonIndex + 1))
  );
}

function readBacktickRun(markdown: string, startIndex: number) {
  let endIndex = startIndex;

  while (markdown[endIndex] === "`") {
    endIndex += 1;
  }

  return markdown.slice(startIndex, endIndex);
}
