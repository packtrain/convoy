import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockCheckbox } = vi.hoisted(() => ({ mockSelect: vi.fn(), mockCheckbox: vi.fn() }));
vi.mock("@inquirer/prompts", () => ({ select: mockSelect, checkbox: mockCheckbox }));

import { resolveClaudeMethods, resolveScope, resolveSkillTargets } from "./prompts.js";

afterEach(() => { mockSelect.mockReset(); mockCheckbox.mockReset(); });

describe("init prompts stop at the ends of the list", () => {
  it.each([
    ["scope", () => resolveScope(undefined), mockSelect],
    ["CLI targets", () => resolveSkillTargets(undefined), mockCheckbox],
    ["Claude methods", () => resolveClaudeMethods(undefined), mockCheckbox],
  ])("%s prompt does not wrap around", async (_name, prompt, mock) => {
    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      await prompt();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
    }
    expect(mock).toHaveBeenCalledWith(expect.objectContaining({ loop: false }));
  });
});
