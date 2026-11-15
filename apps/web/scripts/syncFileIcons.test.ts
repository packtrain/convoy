import { existsSync } from "node:fs";
import { join } from "node:path";
import { getIconForOpenFolder } from "vscode-icons-js";
import { describe, expect, test } from "vitest";
import { FILE_ICONS_DIR, referencedIcons } from "./syncFileIcons";

describe("syncFileIcons", () => {
  test("every icon vscode-icons-js can name is vendored", () => {
    const missing = [...referencedIcons()].filter((name) => !existsSync(join(FILE_ICONS_DIR, name)));
    expect(missing).toEqual([]);
    expect(existsSync(join(FILE_ICONS_DIR, "LICENSE"))).toBe(true);
  });

  test("named folders have their opened icon too", () => {
    expect(referencedIcons()).toContain(getIconForOpenFolder("cli"));
  });
});
