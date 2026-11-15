/**
 * Crypto utilities for API key management.
 * Uses Web Crypto API available in Convex runtime.
 */

/**
 * Hash an API key using SHA-256.
 * Returns hex-encoded hash for storage.
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a new API key.
 * Format: sk_user_{32 random URL-safe base64 chars}
 */
export function generateApiKey(): string {
  const randomBytes = new Uint8Array(24); // 24 bytes = 32 base64 chars
  crypto.getRandomValues(randomBytes);
  const base64 = btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `sk_user_${base64}`;
}

/**
 * Extract the prefix from an API key for display.
 * Returns first 16 chars: "sk_user_" + 8 random chars
 */
export function getKeyPrefix(apiKey: string): string {
  return apiKey.substring(0, 16);
}

/** A key without `expiresAt` never expires. */
export function isApiKeyExpired(key: { expiresAt?: number }, now = Date.now()): boolean {
  return key.expiresAt !== undefined && key.expiresAt <= now;
}
