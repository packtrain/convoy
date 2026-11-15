import { expect, test, vi } from "vitest";
import stringWidth from "string-width";
import { displayLines } from "./formatters.js";

vi.mock("string-width", async importOriginal => {
  const actual = await importOriginal<typeof import("string-width")>();
  return { default: vi.fn(actual.default) };
});

test("mixed Unicode uses width calculation only for non-ASCII graphemes", () => {
  const eventJson = JSON.stringify({ text: "a".repeat(10000) + "你好👩‍💻" });
  const lines = displayLines([{ order: 0, eventJson, bytes: Buffer.byteLength(eventJson), length: eventJson.length, truncated: false, fidelity: "stored" }], 80);
  expect(lines.join("")).toBe(eventJson);
  expect(stringWidth).toHaveBeenCalledTimes(3);
});

test("separates events with one empty line without separating their wrapped rows", () => {
  const event = (order: number, eventJson: string) => ({ order, eventJson, bytes: Buffer.byteLength(eventJson), length: eventJson.length, truncated: false as const, fidelity: "stored" });
  const first = event(0, '{"a":1}');
  const second = event(1, '{"b":"你好"}');
  const oversized = { ...event(2, ""), nextOffset: 0 };
  const last = event(3, '{"c":3}');
  expect(displayLines([first, second, oversized, last], 5)).toEqual([
    ...displayLines([first], 5), "",
    ...displayLines([second], 5), "",
    ...displayLines([oversized], 5), "",
    ...displayLines([last], 5),
  ]);
});
