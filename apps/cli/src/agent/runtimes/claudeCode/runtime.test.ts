import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeCodeRuntime } from "./runtime.js";

describe("claudeCodeRuntime.prepareRunExecution", () => {
  it("routes usage to a control request with no prompt", async () => {
    expect(await claudeCodeRuntime.prepareRunExecution({ messages: [{
      id: "one", createdAt: 1, contentText: "/usage", runtimeCommand: true, attachments: [],
    }] })).toEqual({ prompt: "", inputFormat: "prompt", runtimeCommand: { command: "usage" } });
  });

  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      })
    );
    tempDirs.length = 0;
  });

  it("pairs quoted image names with bytes within each batched message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "convoy-claude-labels-"));
    tempDirs.push(dir);
    const first = join(dir, "first.png");
    const second = join(dir, "second.png");
    writeFileSync(first, "first-bytes");
    writeFileSync(second, "second-bytes");
    const name = 'before "screen"\n.png';
    const result = await claudeCodeRuntime.prepareRunExecution({ messages: [
      { id: "one", createdAt: 1000, contentText: "first", attachments: [
        { storageId: "one", fileName: name, contentType: "image/png", localPath: first, inlineImage: true },
        { storageId: "doc", fileName: "notes.pdf", contentType: "application/pdf", localPath: "/tmp/notes.pdf", inlineImage: false },
      ] },
      { id: "two", createdAt: 2000, contentText: "second", attachments: [
        { storageId: "two", fileName: name, contentType: "image/png", localPath: second, inlineImage: true },
        { storageId: "svg", fileName: "diagram.svg", contentType: "image/svg+xml", localPath: "/tmp/diagram.svg", inlineImage: false },
      ] },
    ] });
    const blocks = (result.bootstrapInput as Array<{ message: { content: Array<{ type: string; text?: string; source?: { data: string } }> } }>)[0].message.content;
    const images = blocks.flatMap((block, index) => block.type === "image" ? [index] : []);
    expect(images).toHaveLength(2);
    for (const [index, position] of images.entries()) {
      expect(blocks[position - 1]).toEqual({ type: "text", text: `attachment: ${JSON.stringify(name)} (image/png)` });
      expect(blocks[position].source?.data).toBe(Buffer.from(index === 0 ? "first-bytes" : "second-bytes").toString("base64"));
      expect(blocks[position - 2].text).toContain(`id: ${index === 0 ? "one" : "two"}`);
    }
    expect(blocks[images[0] - 2].text).toContain("notes.pdf");
    expect(blocks[images[1] - 2].text).toContain("diagram.svg");
  });

  it("adds task(convoy) marker to prompt text when taskRef is present", async () => {
    const result = await claudeCodeRuntime.prepareRunExecution({
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          taskRef: "OS-123",
          contentText: "Investigate this",
          attachments: [],
        },
      ],
    });

    expect(result.inputFormat).toBe("prompt");
    expect(result.prompt).toContain("task(convoy): OS-123");
    expect(result.prompt).toContain("content:\nInvestigate this");
  });

  it("delivers a solo runtime command raw (no run envelope)", async () => {
    const result = await claudeCodeRuntime.prepareRunExecution({
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          contentText: "/compact keep the API design decisions",
          runtimeCommand: true,
          attachments: [],
        },
      ],
    });

    expect(result.inputFormat).toBe("prompt");
    expect(result.prompt).toBe("/compact keep the API design decisions");
    expect(result.bootstrapInput).toBeUndefined();
  });

  it("keeps the run envelope when a command flag rides a multi-message run", async () => {
    const result = await claudeCodeRuntime.prepareRunExecution({
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          contentText: "prose",
          attachments: [],
        },
        {
          id: "msg_2",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 1),
          contentText: "/compact",
          runtimeCommand: true,
          attachments: [],
        },
      ],
    });

    expect(result.prompt).toContain("Convoy user messages for this run:");
  });

  it("omits task marker when no taskRef is present", async () => {
    const result = await claudeCodeRuntime.prepareRunExecution({
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          contentText: "Investigate this",
          attachments: [],
        },
      ],
    });

    expect(result.prompt).not.toContain("task(convoy):");
  });

  it("adds task marker to the stream-json bootstrap text block", async () => {
    const dir = mkdtempSync(join(tmpdir(), "convoy-claude-runtime-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "screenshot.png");
    writeFileSync(imagePath, "image-bytes");

    const result = await claudeCodeRuntime.prepareRunExecution({
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          taskRef: "OS-123",
          contentText: "Please inspect",
          attachments: [
            {
              storageId: "storage_1",
              fileName: "screenshot.png",
              contentType: "image/png",
              localPath: imagePath,
              inlineImage: true,
            },
          ],
        },
      ],
    });

    expect(result.inputFormat).toBe("stream-json");
    const bootstrapInput = result.bootstrapInput as
      | Array<{ type: string; message?: { content?: Array<{ type: string; text?: string }> } }>
      | undefined;
    const content = bootstrapInput?.[0]?.message?.content ?? [];
    const textBlock = content.find(
      (block) => block.type === "text" && block.text?.includes("id: msg_1")
    );

    expect(textBlock?.text).toContain("task(convoy): OS-123");
    expect(textBlock?.text).toContain("content:\nPlease inspect");
    const imageIndex = content.findIndex(block => block.type === "image");
    expect(content[imageIndex - 1]).toEqual({ type: "text", text: 'attachment: "screenshot.png" (image/png)' });
  });
});

describe("claudeCodeRuntime.signalsVcsStateChange", () => {
  it("flags vcs_state_changed and code_change_published system chunks", () => {
    expect(
      claudeCodeRuntime.signalsVcsStateChange?.({
        type: "system",
        data: JSON.stringify({ type: "system", subtype: "vcs_state_changed", kind: "commit" }),
      })
    ).toBe(true);
    expect(
      claudeCodeRuntime.signalsVcsStateChange?.({
        type: "system",
        data: JSON.stringify({ type: "system", subtype: "code_change_published", url: "https://example.com/pull/1" }),
      })
    ).toBe(true);
  });

  it("ignores other system subtypes, non-system chunks, and bad JSON", () => {
    expect(
      claudeCodeRuntime.signalsVcsStateChange?.({
        type: "system",
        data: JSON.stringify({ type: "system", subtype: "status" }),
      })
    ).toBe(false);
    expect(
      claudeCodeRuntime.signalsVcsStateChange?.({ type: "assistant", data: "{}" })
    ).toBe(false);
    expect(
      claudeCodeRuntime.signalsVcsStateChange?.({ type: "system", data: "not json" })
    ).toBe(false);
  });
});
