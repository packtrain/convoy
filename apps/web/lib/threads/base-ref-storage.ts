import { isRecord } from "@/lib/type-guards";
import { readLocalString, writeLocalJson } from "@/lib/browser/local-storage";

export interface ScannedRef {
  name: string;
  isCurrent: boolean;
  remoteOnly: boolean;
}

export function parseScannedRefs(resultJson: string | undefined): ScannedRef[] {
  if (!resultJson) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(resultJson);
    if (!isRecord(parsed) || !Array.isArray(parsed.refs)) {
      return [];
    }
    return parsed.refs.filter(
      (ref): ref is ScannedRef => isRecord(ref) && typeof ref.name === "string" && typeof ref.isCurrent === "boolean"
    );
  } catch {
    return [];
  }
}

// Last completed scan per profile+path, persisted so a fresh page load
// renders the branch list instantly while a background rescan refreshes it.
const refsInMemory = new Map<string, ScannedRef[]>();

const REFS_CACHE_PREFIX = "convoy.base-ref-refs";

function refsCacheKey(profileId: string, pathId: string): string {
  return `${REFS_CACHE_PREFIX}:${profileId}:${pathId}`;
}

export function loadPersistedRefs(profileId: string, pathId: string): ScannedRef[] | null {
  const key = refsCacheKey(profileId, pathId);
  const current = refsInMemory.get(key);
  if (current) {
    return current;
  }
  const raw = readLocalString(key);
  return raw ? parseScannedRefs(raw) : null;
}

export function persistRefs(profileId: string, pathId: string, refs: ScannedRef[]): void {
  const key = refsCacheKey(profileId, pathId);
  refsInMemory.set(key, refs);
  writeLocalJson(key, { refs });
}
