import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";

export const MIN_SLASH_COMMAND_KEY_LENGTH = 2;
export const MAX_SLASH_COMMAND_KEY_LENGTH = 40;
export const MAX_SLASH_COMMAND_DESCRIPTION_LENGTH = 500;
export const MAX_SLASH_COMMAND_CATEGORY_LENGTH = 80;
export const MAX_SLASH_COMMAND_CONTENT_LENGTH = 100_000;

const SLASH_COMMAND_KEY_PATTERN = /^[a-z0-9:-]+$/;

export function normalizeSlashCommandKey(input: string): string {
  const trimmed = input.trim();
  const withoutLeadingSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const normalized = withoutLeadingSlash.toLowerCase();

  ensure(normalized).notEq("", errors.SLASH_COMMAND_KEY_REQUIRED);
  ensure(normalized.length).between(MIN_SLASH_COMMAND_KEY_LENGTH, MAX_SLASH_COMMAND_KEY_LENGTH, errors.SLASH_COMMAND_KEY_LENGTH);
  ensure(normalized).regex(SLASH_COMMAND_KEY_PATTERN, errors.SLASH_COMMAND_KEY_FORMAT);

  return normalized;
}

export function normalizeSlashCommandDescription(input: string | null | undefined): string | undefined {
  const normalized = input?.trim();
  if (!normalized) {
    return undefined;
  }

  ensure(normalized.length).lte(MAX_SLASH_COMMAND_DESCRIPTION_LENGTH, errors.SLASH_COMMAND_DESCRIPTION_LENGTH);

  return normalized;
}

export function normalizeSlashCommandCategory(input: string | null | undefined): string | undefined {
  const normalized = input?.trim();
  if (!normalized) {
    return undefined;
  }

  ensure(normalized.length).lte(MAX_SLASH_COMMAND_CATEGORY_LENGTH, errors.SLASH_COMMAND_CATEGORY_LENGTH);

  return normalized;
}

export function normalizeSlashCommandContent(input: string): string {
  const normalized = input.trim();

  ensure(normalized).notEq("", errors.SLASH_COMMAND_CONTENT_REQUIRED);
  ensure(normalized.length).lte(MAX_SLASH_COMMAND_CONTENT_LENGTH, errors.SLASH_COMMAND_CONTENT_LENGTH);

  return normalized;
}
