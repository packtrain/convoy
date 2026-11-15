import { ConvexError } from "convex/values";
import { errors } from "../../errors";
import { THREAD_TITLE_MAX_LENGTH } from "../../../../lib/threads/constants";
import { slashCommandDisplayText } from "../../../lib/slashCommands/composer";

export function normalizeChatTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1) {
    throw new ConvexError(errors.TITLE_REQUIRED);
  }
  if (trimmed.length > THREAD_TITLE_MAX_LENGTH) {
    throw new ConvexError(errors.titleTooLong(THREAD_TITLE_MAX_LENGTH));
  }
  return trimmed;
}

/** Derive a stored thread title from a seed string: first non-empty line, trimmed and truncated. */
export function deriveTitleFromSeed(seed: string): string {
  const firstLine =
    slashCommandDisplayText(seed)
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  if (firstLine.length <= THREAD_TITLE_MAX_LENGTH) {
    return firstLine;
  }
  // Truncate at a word boundary if possible
  const truncated = firstLine.slice(0, THREAD_TITLE_MAX_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > THREAD_TITLE_MAX_LENGTH * 0.6) {
    return truncated.slice(0, lastSpace) + "…";
  }
  return truncated.slice(0, THREAD_TITLE_MAX_LENGTH - 1) + "…";
}

const FORK_TAB_TITLE_PREFIX = "Forked from: ";

/** A fork opened as a tab: "Forked from: <title>", not stacked on a fork of a fork. */
export function deriveForkTabTitle(sourceTitle: string): string {
  return sourceTitle.startsWith(FORK_TAB_TITLE_PREFIX) ? sourceTitle : deriveTitleFromSeed(FORK_TAB_TITLE_PREFIX + sourceTitle);
}

/** Normalize display snapshots from the composer scan or a CLI execution report. */
export function normalizeExecutionBranch(branch: string | undefined): string | undefined {
  const trimmed = branch?.trim();
  return trimmed && trimmed.length <= 256 ? trimmed : undefined;
}
