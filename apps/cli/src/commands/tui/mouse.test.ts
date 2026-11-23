import { expect, it } from "vitest";
import { mouseParser } from "./mouse.js";

it("buffers an SGR report split across chunks and converts to 0-based cells", () => {
  const parse = mouseParser();
  expect(parse("\u001b[<0;1")).toEqual([]);
  expect(parse("2;5M")).toEqual([{ kind: "press", button: 0, x: 11, y: 4 }]);
  expect(parse("\u001b")).toEqual([]);
  expect(parse("[<0;2;3M")).toEqual([{ kind: "press", button: 0, x: 1, y: 2 }]);
});

it("tells wheel from a left click, by button code 64/65 and not % 4", () => {
  expect(mouseParser()("\u001b[<64;3;4M\u001b[<65;3;4M\u001b[<0;3;4M")).toEqual([
    { kind: "wheel", delta: -1, x: 2, y: 3 }, { kind: "wheel", delta: 1, x: 2, y: 3 }, { kind: "press", button: 0, x: 2, y: 3 }]);
});

it("reports releases and drops drags and horizontal wheel", () => {
  expect(mouseParser()("\u001b[<0;3;4m\u001b[<32;5;4M\u001b[<66;3;4M\u001b[<2;3;4M")).toEqual([
    { kind: "release", button: 0, x: 2, y: 3 }, { kind: "press", button: 2, x: 2, y: 3 }]);
});

it("passes over non-mouse bytes, including a lone Escape and arrow keys", () => {
  const parse = mouseParser();
  expect(parse("jk\r\u001b[A")).toEqual([]);
  expect(parse("\u001b")).toEqual([]);
  expect(parse("[B")).toEqual([]);
  expect(parse("x\u001b[<0;1;1My")).toEqual([{ kind: "press", button: 0, x: 0, y: 0 }]);
});
