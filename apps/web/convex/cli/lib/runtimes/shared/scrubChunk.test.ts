import { describe, expect, test } from "vitest";
import { scrubOversizedChunkData } from "./scrubChunk";

describe("scrubOversizedChunkData (OS-1521)", () => {
  const MAX = 100_000;

  test("tool_result with a base64 image is scrubbed to fit", () => {
    const data = scrubOversizedChunkData(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: "a".repeat(400_000),
                  },
                },
              ],
            },
          ],
        },
        tool_use_result: {
          type: "image",
          file: { base64: "b".repeat(400_000), filePath: "/tmp/shot.png" },
        },
        session_id: "sess-1",
      }),
      MAX
    );

    expect(data).not.toBeNull();
    expect(data!.length).toBeLessThanOrEqual(MAX);
    const parsed = JSON.parse(data!) as {
      message: {
        content: Array<{
          tool_use_id: string;
          content: Array<{ source: { media_type: string; data: string } }>;
        }>;
      };
      tool_use_result: { file: { base64: string; filePath: string } };
      session_id: string;
    };
    const source = parsed.message.content[0].content[0].source;
    expect(source.data).toBe("");
    expect(source.media_type).toBe("image/png");
    // The tool_use_result copy has no type:"base64" block; the key-based rule
    // must catch it (review #3).
    expect(parsed.tool_use_result.file.base64).toBe("");
    expect(parsed.tool_use_result.file.filePath).toBe("/tmp/shot.png");
    expect(parsed.message.content[0].tool_use_id).toBe("toolu_1");
    expect(parsed.session_id).toBe("sess-1");
  });

  test("a barely-over chunk keeps most of a large string (widest rung wins)", () => {
    const data = scrubOversizedChunkData(
      JSON.stringify({ output: "y".repeat(99_000), extra: "z".repeat(2_000) }),
      MAX
    );

    expect(data).not.toBeNull();
    expect(data!.length).toBeLessThanOrEqual(MAX);
    const parsed = JSON.parse(data!) as { output: string; extra: string };
    // The widest cap rung that fits wins; a flat /4 cap would leave 25k.
    expect(parsed.output.length).toBeGreaterThan(80_000);
    expect(parsed.output).toContain("[truncated");
    expect(parsed.extra).toBe("z".repeat(2_000));
  });

  test("many medium strings that cannot be scrubbed under budget return null", () => {
    const data = scrubOversizedChunkData(
      JSON.stringify({
        blocks: Array.from({ length: 10 }, () => "m".repeat(20_000)),
      }),
      MAX
    );

    expect(data).toBeNull();
  });

  test("huge text payload is clamped to valid JSON", () => {
    const data = scrubOversizedChunkData(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_2",
              content: "x".repeat(300_000),
            },
          ],
        },
        tool_use_result: { file: { content: "x".repeat(300_000) } },
      }),
      MAX
    );

    expect(data).not.toBeNull();
    expect(data!.length).toBeLessThanOrEqual(MAX);
    const parsed = JSON.parse(data!) as {
      message: { content: Array<{ tool_use_id: string; content: string }> };
    };
    const clamped = parsed.message.content[0].content;
    expect(clamped.startsWith("xxx")).toBe(true);
    expect(clamped).toContain("[truncated");
    expect(parsed.message.content[0].tool_use_id).toBe("toolu_2");
  });

  test("non-JSON data returns null (raw truncation fallback)", () => {
    expect(scrubOversizedChunkData("x".repeat(200_000), MAX)).toBeNull();
  });
});
