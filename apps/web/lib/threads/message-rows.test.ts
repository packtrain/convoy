import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import {
  canBranchFromReply,
  forkDividerAnchor,
  findLatestRowMessage,
  findLatestRowUserMessage,
  isInlineSteeredMessage,
} from "./message-rows";

const id = (value: string) => value as Id<"cliMessages">;

const USER_1 = { _id: id("user-1"), role: "user" as const };
const ASSISTANT_1 = { _id: id("assistant-1"), role: "assistant" as const };
const STEER_1 = { _id: id("steer-1"), role: "user" as const, steeredAt: 1 };
const STEER_2 = { _id: id("steer-2"), role: "user" as const, steeredAt: 2 };

describe("isInlineSteeredMessage", () => {
  test("only a user message with a steer stamp renders inline", () => {
    expect(isInlineSteeredMessage({ role: "user", steeredAt: 1 })).toBe(true);
    expect(isInlineSteeredMessage({ role: "user" })).toBe(false);
    // An assistant message is never a steer, stamp or not.
    expect(isInlineSteeredMessage({ role: "assistant", steeredAt: 1 })).toBe(false);
  });
});

describe("findLatestRowMessage", () => {
  test("returns the newest message when nothing was steered", () => {
    expect(findLatestRowMessage([USER_1, ASSISTANT_1])?._id).toBe("assistant-1");
  });

  test("skips a steer stored after the run it steered into", () => {
    // The real shape of a steered turn: the user typed mid-stream, so their
    // message is newer than the assistant message it was injected into — but
    // it renders inside that assistant turn, which stays the last visible row.
    expect(findLatestRowMessage([USER_1, ASSISTANT_1, STEER_1])?._id).toBe("assistant-1");
  });

  test("skips consecutive steers", () => {
    expect(findLatestRowMessage([ASSISTANT_1, STEER_1, STEER_2])?._id).toBe("assistant-1");
  });

  test("is undefined for an empty thread and for steers only", () => {
    expect(findLatestRowMessage([])).toBeUndefined();
    expect(findLatestRowMessage([STEER_1])).toBeUndefined();
  });
});

describe("findLatestRowUserMessage", () => {
  test("returns the newest user message when nothing was steered", () => {
    expect(findLatestRowUserMessage([USER_1, ASSISTANT_1])?._id).toBe("user-1");
  });

  test("falls back past a steer to the newest editable bubble", () => {
    // Without this the Edit action keys to the steer, which renders no bubble,
    // so it appears on nothing at all.
    expect(findLatestRowUserMessage([USER_1, ASSISTANT_1, STEER_1])?._id).toBe("user-1");
  });

  test("is undefined when every user message was steered", () => {
    expect(findLatestRowUserMessage([ASSISTANT_1, STEER_1])).toBeUndefined();
  });
});

describe("forkDividerAnchor", () => {
  const rows = [
    { _id: "u1" as Id<"cliMessages">, role: "user" as const, runId: "run-copied" },
    { _id: "a1" as Id<"cliMessages">, role: "assistant" as const, runId: "run-copied" },
    { _id: "u2" as Id<"cliMessages">, role: "user" as const, runId: "run-own" },
  ];

  test("anchors below the copied run's last row", () => {
    expect(forkDividerAnchor(rows, "run-copied")).toBe("a1");
  });

  test("has no anchor once the copied run was rewritten", () => {
    expect(forkDividerAnchor(rows, "run-gone")).toBeNull();
  });

  test("has no anchor for a fork recorded without a run id, even beside unstamped rows", () => {
    expect(forkDividerAnchor([...rows, { _id: "queued" as Id<"cliMessages">, role: "user" as const }], undefined)).toBeNull();
  });
});

describe("canBranchFromReply", () => {
  const finished = { status: "completed" as const, cliContext: { continuationId: "s" } };

  test("Claude Code needs only a finished reply with a session", () => {
    expect(canBranchFromReply({ cliType: "claude-code", ...finished })).toBe(true);
  });

  test("Codex also needs the reply's turn id (OS-2073)", () => {
    expect(canBranchFromReply({ cliType: "codex", ...finished })).toBe(false);
    expect(canBranchFromReply({ cliType: "codex", status: "completed", cliContext: { continuationId: "t", turnId: "turn-1" } })).toBe(true);
  });

  test("other runtimes stay disabled", () => {
    expect(canBranchFromReply({ cliType: "cursor", status: "completed", cliContext: { continuationId: "c", turnId: "x" } })).toBe(false);
  });
});
