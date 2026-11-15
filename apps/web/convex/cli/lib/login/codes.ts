/**
 * User-code generation for the /device fallback path. Unambiguous alphabet
 * (no 0/O/1/I/L, no vowels to avoid words): 27 chars × 8 positions ≈ 38 bits,
 * plenty for a 10-minute, auth-gated, attempt-limited lookup.
 */
const USER_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";
const USER_CODE_LENGTH = 8;

/** Generate a canonical user code, e.g. "WDJB-MJHT". */
export function generateUserCode(): string {
  const chars: string[] = [];
  while (chars.length < USER_CODE_LENGTH) {
    const bytes = new Uint8Array(USER_CODE_LENGTH * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // Rejection sampling keeps the distribution unbiased.
      if (byte < USER_CODE_ALPHABET.length * Math.floor(256 / USER_CODE_ALPHABET.length)) {
        chars.push(USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]);
        if (chars.length === USER_CODE_LENGTH) break;
      }
    }
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/**
 * Normalize user input to the canonical dash-grouped form. Returns null when
 * the input cannot be a valid code (wrong length after cleanup).
 */
export function normalizeUserCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== USER_CODE_LENGTH) return null;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}
