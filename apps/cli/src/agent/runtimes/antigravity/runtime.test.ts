import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withRunAttachmentInstructions } from "../agent-instructions.js";
import type { RuntimeResolvedAttachment } from "../contracts.js";
import { antigravityRuntime } from "./runtime.js";

describe("antigravityRuntime", () => {
  let dir: string;
  const file = (name: string, bytes: number | string, contentType: string): RuntimeResolvedAttachment => {
    const localPath = join(dir, name);
    writeFileSync(localPath, typeof bytes === "string" ? bytes : Buffer.alloc(bytes));
    return {
      storageId: name,
      fileName: name,
      contentType,
      localPath,
      inlineImage: antigravityRuntime.isInlineImageAttachment(contentType),
    };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "convoy-agy-runtime-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("inlines the four image types agy accepts", () => {
    for (const type of ["image/bmp", "image/jpeg", "image/PNG", "image/webp"]) {
      expect(antigravityRuntime.isInlineImageAttachment(type)).toBe(true);
    }
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", "text/plain"]) {
      expect(antigravityRuntime.isInlineImageAttachment(type)).toBe(false);
    }
  });

  it("delivers a solo runtime command raw, without the run envelope", async () => {
    expect(
      await antigravityRuntime.prepareRunExecution({
        messages: [{ id: "m1", createdAt: 1, contentText: " /compact ", runtimeCommand: true, attachments: [] }],
      })
    ).toEqual({ prompt: "/compact", rawRuntimeCommand: true, inputFormat: "prompt" });
  });

  it("sends images as labeled image blocks and keeps every other file a path reference", async () => {
    const image = file("red.png", "png-bytes", "image/png");
    const notes = file("notes.txt", "hello", "text/plain");
    const prepared = await antigravityRuntime.prepareRunExecution({
      messages: [{ id: "m1", createdAt: 1, contentText: "What is in this image?", attachments: [image, notes] }],
    });

    expect(prepared.bootstrapInput).toEqual([
      { type: "text", text: 'user-message-1 attachment: "red.png" (image/png)' },
      { type: "image", mimeType: "image/png", data: Buffer.from("png-bytes").toString("base64") },
    ]);
    expect(prepared.prompt).toContain(`- notes.txt (text/plain): ${notes.localPath}`);
    expect(prepared.prompt).not.toContain(image.localPath);
  });

  it("keeps image blocks whole through the per-run attach instructions, which go in the text prompt", async () => {
    // The thread processor runs every normal run through this helper before the runner.
    const prepared = await antigravityRuntime.prepareRunExecution({
      messages: [{ id: "m1", createdAt: 1, contentText: "look", attachments: [file("red.png", "png-bytes", "image/png")] }],
    });
    const withAttach = withRunAttachmentInstructions(prepared, { threadId: "t1", messageId: "msg", sessionId: "ses" });
    expect(withAttach.bootstrapInput).toEqual(prepared.bootstrapInput);
    expect(withAttach.prompt).toContain("convoy threads attach t1");
  });

  it("falls back to a path reference over 10 MiB per image or 50 MiB in total", async () => {
    const big = file("big.png", 10 * 1024 * 1024 + 1, "image/png");
    const fits = Array.from({ length: 6 }, (_, index) => file(`shot-${index}.jpeg`, 9 * 1024 * 1024, "image/jpeg"));
    const prepared = await antigravityRuntime.prepareRunExecution({
      messages: [{ id: "m1", createdAt: 1, contentText: "look", attachments: [big, ...fits] }],
    });

    const inlined = (prepared.bootstrapInput ?? []).filter((block) => (block as { type: string }).type === "image");
    expect(inlined).toHaveLength(5);
    expect(prepared.prompt).toContain(big.localPath);
    expect(prepared.prompt).toContain(fits[5]!.localPath);
    expect(prepared.prompt).not.toContain(fits[4]!.localPath);
  });
});
