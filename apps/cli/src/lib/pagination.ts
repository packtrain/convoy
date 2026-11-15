import chalk from "chalk";
import { Command } from "commander";
import type { OutputMode } from "./output.js";
import { printOutput } from "./output.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface PaginationOptions {
  limit?: string | number;
  cursor?: string;
}

export interface CursorPageResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
}

export function addPaginationOptions<T extends Command>(cmd: T): T {
  return cmd
    .option("--limit <n>", `Page size from 1 to ${MAX_PAGE_SIZE}`)
    .option("--cursor <cursor>", "Opaque pagination cursor") as T;
}

export function parsePageSize(value: string | number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }

  const numeric =
    typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_PAGE_SIZE) {
    throw new Error(
      `Invalid limit "${String(value)}". Valid values: 1-${MAX_PAGE_SIZE}.`
    );
  }

  return numeric;
}

export function parsePaginationCursor(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const cursor = value.trim();
  if (cursor.length === 0) {
    throw new Error("Cursor must be a non-empty string.");
  }

  return cursor;
}

export function shellQuote(value: string): string {
  const escaped = value.split("'").join(`'"'"'`);
  return `'${escaped}'`;
}

export function printPaginatedOutput<T>(
  outputMode: OutputMode,
  value: CursorPageResult<T>,
  renderText: (value: CursorPageResult<T>) => void,
  nextCommand: string
): void {
  printOutput(outputMode, value, (result) => {
    renderText(result);

    if (result.isDone) {
      return;
    }

    console.log(chalk.dim(`Next cursor: ${result.continueCursor}`));
    console.log(chalk.dim(`Next page: ${nextCommand}`));
    console.log();
  });
}
