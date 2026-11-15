import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("./environments-preview.module.css", import.meta.url), "utf8");
const page = await readFile(new URL("../../../app/page.tsx", import.meta.url), "utf8");

test("selected environment and status text have internal breathing room", () => {
  const selected = css.match(/\.sidebar > \.selected\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(selected, /padding:\s*\d+(?:px)?\s+[1-9]\d*px/, "selected row needs horizontal padding");
  const status = css.match(/\.status\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(status, /padding:\s*[1-9]\d*px\s+\d+px/, "status bar needs vertical padding");
});

test("inline TUI command inherits the surrounding paragraph font", () => {
  assert.match(page, /Use <code className="\[font:inherit\]">convoy tui<\/code>/);
});

test("sidebar highlight reaches both edges while chevrons stay aligned", () => {
  const sidebar = css.match(/\.sidebar\s*\{([^}]+)\}/)?.[1] ?? "";
  const selected = css.match(/\.sidebar > \.selected\s*\{([^}]+)\}/)?.[1] ?? "";
  const inset = Number(sidebar.match(/padding:\s*\d+px\s+(\d+)px/)?.[1]);
  const margin = Number(selected.match(/margin-inline:\s*(-?\d+)px/)?.[1]);
  const padding = Number(selected.match(/padding:\s*0\s+(\d+)px/)?.[1]);
  assert.equal(margin, -inset, "highlight must cancel the sidebar inset on both edges");
  assert.equal(margin + padding, 0, "selected chevron must align with Local");
});

test("status bar spacing follows the text instead of terminal line leading", () => {
  const status = css.match(/\.status\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(status, /line-height:\s*1\s*;/, "status must not inherit the terminal's 1.65 line height");
  const label = css.match(/\.status > span\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(label, /text-box:\s*trim-both cap alphabetic/, "trim font space above capitals and below the baseline");
});
