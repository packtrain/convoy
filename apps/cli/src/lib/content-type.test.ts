import { describe, expect, test } from "vitest";
import { getContentType } from "./content-type.js";

describe("getContentType", () => {
  test.each([
    ["run.log", "text/plain"],
    ["config.yaml", "text/yaml"],
    ["config.yml", "text/yaml"],
    ["fix.diff", "text/x-diff"],
    ["fix.patch", "text/x-diff"],
    ["index.ts", "text/plain"],
    ["App.tsx", "text/plain"],
    ["script.py", "text/x-python"],
    ["setup.sh", "text/x-shellscript"],
    ["NOTES.MD", "text/markdown"],
  ])("%s is %s so the web app can preview it", (file, expected) => {
    expect(getContentType(file)).toBe(expected);
  });

  test("unknown extensions stay binary", () => {
    expect(getContentType("blob.bin")).toBe("application/octet-stream");
  });
});
