export interface ParsedTaskCreateTitle {
  name: string;
  tags: string[];
  taskTypeKey?: string;
}

const TRAILING_TAG_TOKEN_PATTERN = /^#[^\s#]+$/;
const TASK_TYPE_TAGS = {
  bug: "bug",
  chore: "chore",
  epic: "epic",
  feat: "feature",
  feature: "feature",
  idea: "idea",
  inv: "investigation",
  investigate: "investigation",
  investigation: "investigation",
} as const;

export function sanitizeTaskTitleInputForCreate(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

export function normalizeTaskTitleForCreate(value: string): string {
  return sanitizeTaskTitleInputForCreate(value).trim().replace(/\s+/g, " ");
}

/** "# Name" in the top-level add row names a new section (OS-2137); else null. */
export function parseSectionTitleForCreate(value: string): string | null {
  const match = /^#\s+(\S.*)$/.exec(normalizeTaskTitleForCreate(value));
  return match ? match[1] : null;
}

function hasTag(tags: string[], candidate: string): boolean {
  const normalizedCandidate = candidate.toLocaleLowerCase();
  return tags.some((tag) => tag.toLocaleLowerCase() === normalizedCandidate);
}

function resolveTaskTypeTag(tag: string): string | undefined {
  const normalizedTag = tag.toLocaleLowerCase();
  return TASK_TYPE_TAGS[normalizedTag as keyof typeof TASK_TYPE_TAGS];
}

export function parseTaskTitleForCreate(value: string): ParsedTaskCreateTitle {
  const normalizedTitle = normalizeTaskTitleForCreate(value);
  if (normalizedTitle.length === 0) {
    return { name: "", tags: [] };
  }

  const tokens = normalizedTitle.split(" ");
  const trailingTags: string[] = [];
  let splitIndex = tokens.length;

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!TRAILING_TAG_TOKEN_PATTERN.test(token)) {
      break;
    }

    trailingTags.unshift(token.slice(1));
    splitIndex = index;
  }

  if (trailingTags.length === 0) {
    return {
      name: normalizedTitle,
      tags: [],
    };
  }

  const strippedName = tokens.slice(0, splitIndex).join(" ").trim();
  if (strippedName.length === 0) {
    return {
      name: normalizedTitle,
      tags: [],
    };
  }

  let taskTypeKey: string | undefined;
  const regularTags: string[] = [];

  for (const tag of trailingTags) {
    const tagTaskTypeKey = resolveTaskTypeTag(tag);
    if (tagTaskTypeKey) {
      taskTypeKey = tagTaskTypeKey;
      continue;
    }
    regularTags.push(tag);
  }

  const dedupedTags = regularTags.reduce<string[]>((result, tag) => {
    if (!hasTag(result, tag)) {
      result.push(tag);
    }
    return result;
  }, []);

  return {
    name: strippedName,
    tags: dedupedTags,
    ...(taskTypeKey && { taskTypeKey }),
  };
}
