import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));
vi.mock("@inquirer/prompts", async (importActual) => ({
  ...await importActual<typeof import("@inquirer/prompts")>(), input: vi.fn(), password: vi.fn(), select: mockSelect,
}));

import { Separator } from "@inquirer/prompts";
import { promptAuthMethod, promptProjectSelect, promptUnmatchedFolder } from "./prompts.js";

afterEach(() => mockSelect.mockReset());

describe("setup selects stop at the ends of the list", () => {
  it.each([
    ["project", () => promptProjectSelect([{ _id: "p1", name: "Demo", alias: "DM", organizationName: "Acme" }], true)],
    ["auth method", () => promptAuthMethod()],
    ["unmatched folder", () => promptUnmatchedFolder([])],
  ])("%s select does not wrap around", async (_name, prompt) => {
    await prompt();
    expect(mockSelect).toHaveBeenCalledWith(expect.objectContaining({ loop: false }));
  });
});

describe("project select create option", () => {
  it("comes first, separated from the organization groups", async () => {
    await promptProjectSelect([{ _id: "p1", name: "Demo", alias: "DM", organizationName: "Acme" }], true);
    const { choices } = mockSelect.mock.calls[0][0];
    expect(choices[0]).toMatchObject({ value: "__create__" });
    expect(choices[1]).toBeInstanceOf(Separator);
    expect(choices[2].name).toContain("Acme");
  });

  it("is omitted with its separator when creation is not allowed", async () => {
    await promptProjectSelect([{ _id: "p1", name: "Demo", alias: "DM", organizationName: "Acme" }]);
    const { choices } = mockSelect.mock.calls[0][0];
    expect(choices[0].name).toContain("Acme");
    expect(choices.some((c: unknown) => c instanceof Separator)).toBe(false);
  });
});
