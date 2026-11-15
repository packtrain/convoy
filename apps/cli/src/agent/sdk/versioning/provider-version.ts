export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

const VERSION_REGEX = /(\d+)\.(\d+)\.(\d+)/;

export function normalizeProviderVersion(raw: string | undefined): string {
  if (!raw) return "0.0.0";
  const match = raw.match(VERSION_REGEX);
  if (!match) return "0.0.0";
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function parseVersion(value: string): ParsedVersion {
  const normalized = normalizeProviderVersion(value);
  const [major, minor, patch] = normalized.split(".").map(Number);
  return { major, minor, patch };
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function satisfiesVersionRange(version: string, range: string): boolean {
  if (range === "*" || range.trim() === "") return true;

  const normalizedVersion = normalizeProviderVersion(version);
  if (range.startsWith(">=")) {
    const min = normalizeProviderVersion(range.slice(2));
    return compareVersions(normalizedVersion, min) >= 0;
  }

  if (range.startsWith("^")) {
    const base = parseVersion(range.slice(1));
    const candidate = parseVersion(normalizedVersion);
    if (candidate.major !== base.major) return false;
    return compareVersions(normalizedVersion, `${base.major}.${base.minor}.${base.patch}`) >= 0;
  }

  return normalizedVersion === normalizeProviderVersion(range);
}
