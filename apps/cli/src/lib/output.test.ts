import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { addOutputOptions, resolveOutputMode, printOutput } from "./output.js";

describe("output helpers", () => {
  it("defaults to text", () => {
    expect(resolveOutputMode({})).toBe("text");
  });

  it("supports --json alias", () => {
    expect(resolveOutputMode({ json: true })).toBe("json");
  });

  it("supports explicit output mode", () => {
    expect(resolveOutputMode({ output: "json" })).toBe("json");
    expect(resolveOutputMode({ output: "text" })).toBe("text");
  });

  it("registers Commander choices for output mode", () => {
    const command = addOutputOptions(new Command("test"));
    const option = command.options.find((candidate) => candidate.long === "--output");

    expect(option?.argChoices).toEqual(["text", "json"]);
  });

  it("rejects invalid mode", () => {
    expect(() => resolveOutputMode({ output: "yaml" as never })).toThrow(
      /Invalid output mode/
    );
  });

  it("renders text output through callback", () => {
    const callback = vi.fn();
    printOutput("text", { hello: "world" }, callback);
    expect(callback).toHaveBeenCalledWith({ hello: "world" });
  });

  it("renders json output without calling text callback", () => {
    const callback = vi.fn();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    printOutput("json", { hello: "world" }, callback);

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({ hello: "world" }, null, 2)
    );
    expect(callback).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
