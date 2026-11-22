/**
 * Truncate to `maxChars` code units without splitting a surrogate pair, so an
 * emoji at the cap can't ship as a lone surrogate. Short input is returned
 * unchanged, so callers can compare lengths to detect a cut.
 */
export function clampChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const lastCode = value.charCodeAt(maxChars - 1);
  const isHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return value.slice(0, isHighSurrogate ? maxChars - 1 : maxChars);
}

export function countStringOccurrences(content: string, searchString: string): number {
  let count = 0;
  let index = content.indexOf(searchString);

  while (index !== -1) {
    count += 1;
    index = content.indexOf(searchString, index + searchString.length);
  }

  return count;
}

/**
 * True for a single path segment: no separators, control characters, `.`/`..`,
 * and at most 255 characters. Attachment file names must pass this (OS-1902).
 */
export function isSafeFileName(fileName: string): boolean {
  return /^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]{1,255}$/.test(fileName);
}

/** The one form we store and match email addresses in: trimmed, lowercase, NFC (as Convex Auth matches them). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase().normalize("NFC");
}
