import { describe, expect, test } from "vitest";

import {
  buildHandoffDraftText,
  buildHandoffMarkdown,
  buildThreadMarkdown,
  threadMarkdownFileName,
  type ThreadExportEnvelope,
} from "@/lib/threads/markdown-export";
import type { CliUiPart } from "@/lib/cli-stream-ui";

const EXPORTED_AT = Date.UTC(2026, 7, 14, 15, 31);

function envelope(overrides: Partial<ThreadExportEnvelope> & { _id: string }): ThreadExportEnvelope {
  return {
    role: "assistant",
    createdAt: Date.UTC(2026, 7, 14, 15, 30),
    ...overrides,
  };
}

function textParts(...texts: string[]): { parts: CliUiPart[] } {
  return { parts: texts.map((text) => ({ type: "text", text })) };
}

function build(input: Partial<Parameters<typeof buildThreadMarkdown>[0]>) {
  return buildThreadMarkdown({
    title: "Make the thread content printable",
    cliLabel: "Claude Code",
    exportedAt: EXPORTED_AT,
    hasUnreachableHistory: false,
    envelopes: [],
    partsByMessageId: new Map(),
    userTextById: new Map(),
    ...input,
  });
}

describe("buildThreadMarkdown", () => {
  test("renders turns as bold author lines between rules, not headings", () => {
    const markdown = build({
      taskRef: "OS-1748",
      envelopes: [
        envelope({ _id: "u1", role: "user", createdAt: Date.UTC(2026, 7, 14, 15, 20) }),
        envelope({ _id: "a1", createdAt: Date.UTC(2026, 7, 14, 15, 22) }),
      ],
      userTextById: new Map([["u1", "make it printable"]]),
      partsByMessageId: new Map([["a1", textParts("## Done\n\nCommitted on `main`.")]]),
    });

    expect(markdown).toBe(
      [
        "# Make the thread content printable",
        "",
        "`OS-1748` · Claude Code · 2 messages · exported 2026-08-14 15:31 UTC",
        "",
        "---",
        "",
        "**You** · 2026-08-14 15:20",
        "",
        "make it printable",
        "",
        "---",
        "",
        "**Claude Code** · 2026-08-14 15:22",
        "",
        "## Done",
        "",
        "Committed on `main`.",
        "",
      ].join("\n")
    );
    // The body keeps its own headings; no turn header competes with them.
    expect(markdown).not.toContain("## Claude Code");
  });

  test("keeps text parts only and drops tool, reasoning and empty turns", () => {
    const markdown = build({
      envelopes: [envelope({ _id: "a1" }), envelope({ _id: "a2" })],
      partsByMessageId: new Map([
        [
          "a1",
          {
            parts: [
              { type: "reasoning", text: "thinking about it" },
              { type: "text", text: "First." },
              { type: "dynamic-tool", toolName: "Bash", toolCallId: "t1", state: "input-available", input: {} },
              { type: "text", text: "Second." },
            ] as CliUiPart[],
          },
        ],
        ["a2", { parts: [{ type: "dynamic-tool", toolName: "Bash", toolCallId: "t2", state: "input-available", input: {} }] as CliUiPart[] }],
      ]),
    });

    expect(markdown).toContain("First.\n\nSecond.");
    expect(markdown).not.toContain("thinking about it");
    expect(markdown).not.toContain("Bash");
    // a2 produced only a tool call, so it contributes no turn at all.
    expect(markdown.match(/\*\*Claude Code\*\*/g)).toHaveLength(1);
    expect(markdown).toContain("1 message ·");
  });

  test("labels another agent's message and lists attachments", () => {
    const markdown = build({
      envelopes: [
        envelope({
          _id: "u1",
          role: "user",
          sentBy: { kind: "thread", threadId: "t9" },
          attachments: [{ fileName: "screenshot.png", fileSize: 219_136 }],
        }),
      ],
      userTextById: new Map([["u1", "see the screenshot"]]),
    });

    expect(markdown).toContain("**Another agent** · 2026-08-14 15:30");
    expect(markdown).toContain("Attachments: `screenshot.png` (214 KB)");
  });

  test("lists an agent reply's attachments, including an attachment-only reply (OS-2091)", () => {
    const markdown = build({
      envelopes: [
        envelope({ _id: "a1", attachments: [{ fileName: "report.txt", fileSize: 2048 }] }),
        envelope({ _id: "a2", attachments: [{ fileName: "shot.png", fileSize: 4096 }] }),
      ],
      partsByMessageId: new Map([["a1", textParts("Here is the report.")]]),
    });

    expect(markdown).toContain("Here is the report.\n\nAttachments: `report.txt` (2 KB)");
    expect(markdown).toContain("Attachments: `shot.png` (4 KB)");
    expect(markdown.match(/\*\*Claude Code\*\*/g)).toHaveLength(2);
  });

  test("renders a failed run's error so the turn is not silently empty", () => {
    const markdown = build({
      envelopes: [envelope({ _id: "a1", status: "failed", errorMessage: "session died" })],
    });

    expect(markdown).toContain("_Run failed: session died_");
  });

  test("notes history the loaded window cannot reach", () => {
    const markdown = build({
      hasUnreachableHistory: true,
      envelopes: [envelope({ _id: "a1" })],
      partsByMessageId: new Map([["a1", textParts("hi")]]),
    });

    expect(markdown).toContain(
      "> Earlier messages are outside the loaded window and were not exported."
    );
  });

  test("omits the task ref and CLI label when the thread has neither", () => {
    const markdown = build({
      cliLabel: undefined,
      envelopes: [envelope({ _id: "a1" })],
      partsByMessageId: new Map([["a1", textParts("hi")]]),
    });

    expect(markdown).toContain("1 message · exported 2026-08-14 15:31 UTC");
    expect(markdown).not.toContain("·  ·");
  });
});

describe("threadMarkdownFileName", () => {
  test("slugifies the title and stamps the export date", () => {
    expect(threadMarkdownFileName("Make the thread   printable!", EXPORTED_AT)).toBe(
      "thread-make-the-thread-printable-2026-08-14.md"
    );
  });

  test("falls back when the title has nothing sluggable", () => {
    expect(threadMarkdownFileName("  ***  ", EXPORTED_AT)).toBe("thread-2026-08-14.md");
  });
});

describe("buildHandoffMarkdown", () => {
  const FULL = "handoff-x-2026-08-14-full.md";
  const big = (label: string) => `${label} ${"x".repeat(400)}`;

  function handoff(replyCount: number, byteCap: number) {
    const envelopes: ThreadExportEnvelope[] = [];
    const userTextById = new Map<string, string>();
    const partsByMessageId = new Map<string, { parts: CliUiPart[] }>();
    for (let index = 1; index <= replyCount; index += 1) {
      envelopes.push(envelope({ _id: `u${index}`, role: "user" }), envelope({ _id: `a${index}` }));
      userTextById.set(`u${index}`, big(`ask ${index}`));
      partsByMessageId.set(`a${index}`, textParts(big(`reply ${index}`)));
    }
    return buildHandoffMarkdown({
      title: "T",
      cliLabel: "Codex",
      exportedAt: EXPORTED_AT,
      hasUnreachableHistory: false,
      envelopes,
      userTextById,
      partsByMessageId,
      fullFileName: FULL,
      byteCap,
    });
  }

  test("ships one id-tagged file when it fits", () => {
    const { capped, full } = handoff(3, 64_000);

    expect(full).toBeNull();
    expect(capped).toContain("**Codex** · 2026-08-14 15:30 · message a2");
    expect(capped).toContain("reply 2");
  });

  test("stubs middle replies oldest first, keeping every ask and the first and last reply", () => {
    // Room for everything but about two replies.
    const all = handoff(5, 1_000_000).capped;
    const { capped, full } = handoff(5, new TextEncoder().encode(all).length - 500);

    expect(full).toBe(all);
    for (let index = 1; index <= 5; index += 1) expect(capped).toContain(`ask ${index}`);
    expect(capped).toContain("reply 1");
    expect(capped).toContain("reply 5");
    expect(capped).not.toContain("reply 2");
    expect(capped).not.toContain("reply 3");
    expect(capped).toContain("reply 4");
    expect(capped).toContain(`_Reply omitted (453 B). Search ${FULL} for "message a2"._`);
  });

  test("ships over the cap when only kept turns remain", () => {
    const { capped, full } = handoff(5, 10);

    expect(full).not.toBeNull();
    expect(capped).toContain("reply 1");
    expect(capped).toContain("reply 5");
    expect(capped).not.toContain("reply 4");
  });

  test("leaves a reply smaller than its stub alone", () => {
    const { capped, full } = buildHandoffMarkdown({
      title: "T",
      cliLabel: "Codex",
      exportedAt: EXPORTED_AT,
      hasUnreachableHistory: false,
      envelopes: ["u1", "a1", "u2", "a2", "u3", "a3"].map((id) =>
        envelope({ _id: id, role: id.startsWith("u") ? "user" : "assistant" })
      ),
      // The size is in an ask, which is never cut; every reply is short.
      userTextById: new Map([["u1", "x".repeat(2_000)], ["u2", "ok"], ["u3", "ok"]]),
      partsByMessageId: new Map([["a1", textParts("Done.")], ["a2", textParts("Done.")], ["a3", textParts("Done.")]]),
      fullFileName: FULL,
      byteCap: 1_000,
    });

    expect(full).toBeNull();
    expect(capped).not.toContain("Reply omitted");
  });

  test("never stubs with fewer than three replies", () => {
    const { capped, full } = handoff(2, 10);

    expect(full).toBeNull();
    expect(capped).toContain("reply 2");
  });
});

describe("buildHandoffDraftText", () => {
  const base = {
    title: "Fix login",
    threadUrl: "https://app.convoy.build/o/acme/app/threads/t1",
    cliLabel: "Codex",
    replyAt: Date.UTC(2026, 7, 14, 15, 30),
  };

  test("names the source thread, its CLI and the reply time", () => {
    expect(buildHandoffDraftText(base)).toBe(
      'Continue the work from the attached handoff. It holds the conversation from the thread "Fix login" ' +
        "(https://app.convoy.build/o/acme/app/threads/t1), run by Codex, through 2026-08-14 15:30 UTC. " +
        "Tool calls, tool output and reasoning are left out. Read the files you need from the working directory."
    );
  });

  test("points at the full file when replies were omitted", () => {
    expect(buildHandoffDraftText({ ...base, fullFileName: "handoff-fix-login-2026-08-14-full.md" })).toMatch(
      /look them up in handoff-fix-login-2026-08-14-full\.md\.$/
    );
  });
});
