import type { PreviewRuntime } from "../runtime-icons";

export type PreviewFile = {
  path: string;
  start: number;
  /** Unified diff lines: "+" added, "-" removed, " " context. */
  lines: string[];
  note?: string;
};

export const pullRequest = {
  number: 128,
  title: "Retry failed webhook deliveries",
  author: "alex",
  base: "main",
  head: "fix/webhook-retries",
  sha: "4f2a91c",
  task: { id: "NS-142", title: "Retry failed webhook deliveries" },
  description: "Failed deliveries now retry with exponential backoff, up to five attempts. The delivery history shows each attempt.",
};

export const prChecks = [
  { label: "Regression test covers retries", status: "passed", note: "retry.test.ts fails on main and passes on this branch." },
  { label: "Extra database requests", status: "warning", note: "Each retry reads the endpoint once more. Acceptable at five attempts." },
  { label: "Performance impact", status: "passed", outdated: true, note: "Reported on 9c03e7b, before the last commit." },
  { label: "Architecture changes", status: "pending", note: "No result reported yet." },
] as const;

export const githubChecks = [
  { name: "build", time: "1m 12s" },
  { name: "lint", time: "38s" },
  { name: "test", time: "2m 04s" },
];

export const commits = [
  { sha: "4f2a91c", message: "fix: cap retries at five attempts", ago: "2 hours ago" },
  { sha: "9c03e7b", message: "feat: show each delivery attempt", ago: "5 hours ago" },
  { sha: "1d8b6f0", message: "feat: retry failed webhook deliveries", ago: "6 hours ago" },
];

export const threads: { title: string; runtime: PreviewRuntime; ago: string; unread?: boolean }[] = [
  { title: "Write a review guide for this pull request", runtime: "claude-code", ago: "2h", unread: true },
  { title: "Run all checks for this pull request", runtime: "codex", ago: "3h" },
  { title: "Should 429 honour Retry-After?", runtime: "claude-code", ago: "4h" },
];

const retry: PreviewFile = {
  path: "convex/webhooks/retry.ts",
  start: 1,
  note: "The backoff and the stop rule live here.",
  lines: [
    ' import { internalMutation } from "../_generated/server";',
    " ",
    "-const RETRY_DELAY_MS = 60_000;",
    "+const MAX_ATTEMPTS = 5;",
    "+const BASE_DELAY_MS = 60_000;",
    " ",
    "+export function nextRetryDelay(attempt: number, status: number) {",
    "+  if (attempt >= MAX_ATTEMPTS) return null;",
    "+  if (status >= 400 && status < 500 && status !== 429) return null;",
    "+  return BASE_DELAY_MS * 2 ** (attempt - 1);",
    "+}",
  ],
};

const retryTest: PreviewFile = {
  path: "convex/webhooks/retry.test.ts",
  start: 1,
  lines: [
    '+import { expect, test } from "vitest";',
    '+import { nextRetryDelay } from "./retry";',
    "+",
    '+test("doubles the delay after each attempt", () => {',
    "+  expect(nextRetryDelay(1, 500)).toBe(60_000);",
    "+  expect(nextRetryDelay(3, 500)).toBe(240_000);",
    "+});",
    "+",
    '+test("stops after five attempts or a client error", () => {',
    "+  expect(nextRetryDelay(5, 500)).toBeNull();",
    "+  expect(nextRetryDelay(1, 404)).toBeNull();",
    "+});",
  ],
};

const deliveryRow: PreviewFile = {
  path: "app/webhooks/delivery-row.tsx",
  start: 12,
  note: "Only file with UI changes.",
  lines: [
    " export function DeliveryRow({ attempt }: { attempt: Attempt }) {",
    "   return (",
    '     <li className="flex items-center gap-2">',
    "-      <StatusBadge status={attempt.status} />",
    "+      <StatusBadge status={attempt.status} code={attempt.statusCode} />",
    '+      <span className="text-muted-foreground">Attempt {attempt.number}</span>',
    "+      {attempt.nextRetryAt && <RelativeTime value={attempt.nextRetryAt} />}",
    "     </li>",
  ],
};

export const chapters = [
  {
    title: "Retry schedule",
    body: "Failed deliveries retry after 1, 2, 4 and 8 minutes and stop after the fifth attempt. Check that a 4xx response other than 429 stops retrying straight away.",
    files: [retry, retryTest],
    question: "Should 429 responses honour the Retry-After header?",
  },
  {
    title: "Delivery history",
    body: "Each attempt gets its own row in the delivery history, with the status code and the time of the next retry.",
    callout: "A failing endpoint now adds five rows per delivery; confirm the history should not group them.",
    files: [deliveryRow],
  },
];

export const files = chapters.flatMap(chapter => chapter.files);
