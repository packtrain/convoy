import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

const STORAGE_KEY_PREFIX = "convoy.last-project:";

function buildKey(orgSlug: string): string {
  return `${STORAGE_KEY_PREFIX}${orgSlug}`;
}

export function getLastProjectAlias(orgSlug: string): string | null {
  return readLocalString(buildKey(orgSlug));
}

export function setLastProjectAlias(
  orgSlug: string,
  projectAlias: string
): void {
  writeLocalString(buildKey(orgSlug), projectAlias);
}
