/**
 * Shared `localStorage` access (OS-1560), so the SSR guard and the fail-soft try/catch
 * (quota, private mode, security policies) live in one place instead of per module.
 *
 * Persistence is always a nicety: reads fall back to `null`/`undefined` and writes
 * report failure instead of throwing.
 */

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    // Reading the property itself throws under some security policies.
    return null;
  }
}

/** Stored value, or `null` when unset or storage is unavailable. */
export function readLocalString(key: string): string | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** `true` when the value was persisted, `false` when storage refused it. */
export function writeLocalString(key: string, value: string): boolean {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** `true` when the key was removed (or was already absent). */
export function removeLocalValue(key: string): boolean {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parsed JSON payload, or `undefined` when the key is unset, storage is
 * unavailable, or the stored text is not valid JSON. Returns `unknown` on
 * purpose — callers narrow persisted payloads with their own type guards.
 */
export function readLocalJson(key: string): unknown {
  const raw = readLocalString(key);
  if (raw === null) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** `true` when the value was serialized and persisted. */
export function writeLocalJson(key: string, value: unknown): boolean {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    // Cyclic or otherwise unserializable payloads fail like any storage error.
    return false;
  }

  if (serialized === undefined) {
    return false;
  }

  return writeLocalString(key, serialized);
}
