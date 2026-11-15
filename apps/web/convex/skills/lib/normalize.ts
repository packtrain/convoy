import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import type { SkillFile, SkillSource } from "./validators";

export const MIN_SKILL_NAME_LENGTH = 2;
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 500;
export const MAX_SKILL_CATEGORY_LENGTH = 80;
export const MAX_SKILL_PATH_LENGTH = 200;
export const MAX_SKILL_SOURCE_URL_LENGTH = 500;
export const MAX_SKILL_SOURCE_REF_LENGTH = 200;
export const MAX_SKILL_FILES = 50;
export const MAX_SKILL_FILE_BYTES = 256 * 1024;
export const MAX_SKILL_TOTAL_BYTES = 1024 * 1024;

/** Reserved entry point: always present, edited through the Skill itself. */
export const SKILL_MAIN_FILE_PATH = "SKILL.md";

// One optional `author:` style namespace prefix, so a ported set can carry its
// origin in the name (docs/specs/skills.md#name-rules).
const SKILL_NAME_PATTERN = /^[a-z0-9-]+(?::[a-z0-9-]+)?$/;
// 40 hex for a SHA-1 repository, 64 for SHA-256; a short SHA is what a human pastes.
const SKILL_COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const DOT_ONLY_SEGMENT_PATTERN = /^\.+$/;

export function normalizeSkillName(input: string): string {
  const normalized = input.trim().toLowerCase();

  ensure(normalized).notEq("", errors.SKILL_NAME_REQUIRED);
  ensure(normalized.length).between(MIN_SKILL_NAME_LENGTH, MAX_SKILL_NAME_LENGTH, errors.SKILL_NAME_LENGTH);
  ensure(normalized).regex(SKILL_NAME_PATTERN, errors.SKILL_NAME_FORMAT);

  return normalized;
}

/**
 * Read-path counterparts: an agent's guess is a question, so a name or a path no
 * stored row could hold has to miss the lookup rather than throw
 * (docs/specs/skills.md#v1--mcp). Stored values are already canonical, so the same
 * canonicalization is all a lookup needs — and nothing is written, so the write
 * path keeps its guards, the traversal one included.
 */
export function skillNameLookupKey(input: string): string {
  return input.trim().toLowerCase();
}

export function skillPathLookupKey(input: string): string {
  return input.trim();
}

export function normalizeSkillDescription(input: string | null | undefined): string | undefined {
  const normalized = input?.trim();
  if (!normalized) {
    return undefined;
  }

  ensure(normalized.length).lte(MAX_SKILL_DESCRIPTION_LENGTH, errors.SKILL_DESCRIPTION_LENGTH);

  return normalized;
}

export function normalizeSkillCategory(input: string | null | undefined): string | undefined {
  const normalized = input?.trim();
  if (!normalized) {
    return undefined;
  }

  ensure(normalized.length).lte(MAX_SKILL_CATEGORY_LENGTH, errors.SKILL_CATEGORY_LENGTH);

  return normalized;
}

/**
 * Paths are a trust boundary — V2 turns them into filesystem writes, so a
 * traversal string accepted here becomes an arbitrary file write later.
 */
export function normalizeSkillPath(input: string): string {
  const normalized = input.trim();

  ensure(normalized).notEq("", errors.SKILL_PATH_REQUIRED);
  ensure(normalized.length).lte(MAX_SKILL_PATH_LENGTH, errors.SKILL_PATH_LENGTH);
  ensure(!normalized.includes("\\") && !normalized.startsWith("/")).isTrue(errors.SKILL_PATH_FORMAT);
  // Control characters included: NUL is the classic truncation bypass for the
  // filesystem write this path becomes in V2.
  ensure(!CONTROL_CHARACTER_PATTERN.test(normalized)).isTrue(errors.SKILL_PATH_FORMAT);
  ensure(normalized.split("/").every((segment) => segment !== "" && !DOT_ONLY_SEGMENT_PATTERN.test(segment))).isTrue(
    errors.SKILL_PATH_FORMAT
  );

  return normalized;
}

/**
 * Git provenance: where a Skill was copied from, so a later check can compare
 * against upstream (docs/specs/skills.md#git-sources). Every field is optional and a
 * blank one is dropped, so a source with nothing left in it is no source at all.
 * Optional is not unchecked: a recorded commit must still look like a commit, or it
 * cannot answer "which version is this".
 */
export function normalizeSkillSource(input: SkillSource | null | undefined): SkillSource | undefined {
  if (!input) {
    return undefined;
  }

  const repoUrl = input.repoUrl?.trim();
  if (repoUrl) {
    ensure(repoUrl.length <= MAX_SKILL_SOURCE_URL_LENGTH && !CONTROL_CHARACTER_PATTERN.test(repoUrl)).isTrue(
      errors.SKILL_SOURCE_REPO_URL_INVALID
    );
  }

  const commitSha = input.commitSha?.trim().toLowerCase();
  if (commitSha) {
    ensure(commitSha).regex(SKILL_COMMIT_SHA_PATTERN, errors.SKILL_SOURCE_COMMIT_FORMAT);
  }

  const ref = input.ref?.trim();
  if (ref) {
    ensure(ref.length <= MAX_SKILL_SOURCE_REF_LENGTH && !CONTROL_CHARACTER_PATTERN.test(ref)).isTrue(errors.SKILL_SOURCE_REF_INVALID);
  }
  const subpath = input.subpath?.trim();

  const source: SkillSource = {
    ...(repoUrl && { repoUrl }),
    ...(commitSha && { commitSha }),
    ...(ref && { ref }),
    // A subpath is a directory inside the repository, so it takes the file-path
    // rules: V2 joins it onto a real filesystem write.
    ...(subpath && { subpath: normalizeSkillPath(subpath) }),
  };

  return Object.keys(source).length > 0 ? source : undefined;
}

/** `SKILL.md` content: must not be blank, stored verbatim (docs/specs/skills.md#frontmatter). */
export function normalizeSkillContent(input: string): string {
  ensure(input.trim()).notEq("", errors.SKILL_CONTENT_REQUIRED);

  return normalizeSkillFileContent(input);
}

/** Any other file's content: stored verbatim, byte-capped. */
export function normalizeSkillFileContent(input: string): string {
  ensure(skillByteLength(input)).lte(MAX_SKILL_FILE_BYTES, errors.SKILL_FILE_BYTES);

  return input;
}

export function skillByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

/**
 * Checks a partial edit's size before its result is built: growth is occurrence
 * count times `newString`, which is unbounded, so materializing first turns a cap
 * breach into a resource error instead of `SKILL_FILE_BYTES`. The committed set is
 * still validated as a whole (docs/specs/skills.md#caps).
 */
export function ensureSkillReplacementFits(content: string, oldString: string, newString: string, occurrences: number): void {
  const projected = skillByteLength(content) + occurrences * (skillByteLength(newString) - skillByteLength(oldString));

  ensure(projected).lte(MAX_SKILL_FILE_BYTES, errors.SKILL_FILE_BYTES);
}

/** Additional files only — `SKILL.md` is the Skill's own body, not a set member. */
function normalizeAdditionalSkillPath(input: string): string {
  const path = normalizeSkillPath(input);
  ensure(path).notEq(SKILL_MAIN_FILE_PATH, errors.SKILL_PATH_RESERVED);

  return path;
}

/**
 * The whole file set one save writes: `SKILL.md` first, then the additional
 * files. Caps bind the set, never one file alone (docs/specs/skills.md#caps).
 */
export function normalizeSkillFileSet(content: string, additional: SkillFile[]): SkillFile[] {
  const files: SkillFile[] = [
    { path: SKILL_MAIN_FILE_PATH, content: normalizeSkillContent(content) },
    ...additional.map((file) => ({
      path: normalizeAdditionalSkillPath(file.path),
      content: normalizeSkillFileContent(file.content),
    })),
  ];

  ensure(files.length).lte(MAX_SKILL_FILES, errors.SKILL_FILE_COUNT);
  ensure(new Set(files.map((file) => file.path)).size).eq(files.length, errors.SKILL_PATH_DUPLICATE);
  ensure(files.reduce((total, file) => total + skillByteLength(file.content), 0)).lte(
    MAX_SKILL_TOTAL_BYTES,
    errors.SKILL_TOTAL_BYTES
  );

  return files;
}
