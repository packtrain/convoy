import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockRunUpdate } = vi.hoisted(() => ({ mockSelect: vi.fn(), mockRunUpdate: vi.fn() }));

vi.mock("@inquirer/prompts", () => ({ select: mockSelect }));
vi.mock("./command.js", () => ({ runUpdate: mockRunUpdate }));

import { canPromptForUpdate, offerUpdate, UPDATE_PROMPT_TIMEOUT_MS } from "./prompts.js";

function setTty(stdin: boolean, stdout: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
}

// Rejects the way @inquirer/core does once the context signal aborts.
function selectUntilAborted() {
  mockSelect.mockImplementation((_config: unknown, context: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      context.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("Prompt was aborted"), { name: "AbortPromptError" }));
      });
    }));
}

const stdinTty = process.stdin.isTTY;
const stdoutTty = process.stdout.isTTY;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("CI", "");
});

afterEach(() => {
  setTty(stdinTty, stdoutTty);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mockSelect.mockReset();
  mockRunUpdate.mockReset();
});

describe("canPromptForUpdate", () => {
  it("prompts only when both stdin and stdout are terminals", () => {
    setTty(true, true);
    expect(canPromptForUpdate({})).toBe(true);
    setTty(false, true);
    expect(canPromptForUpdate({})).toBe(false);
    setTty(true, false);
    expect(canPromptForUpdate({})).toBe(false);
  });

  it("never prompts for supervised, worker, replay, or CI runs", () => {
    setTty(true, true);
    expect(canPromptForUpdate({ jsonEvents: true })).toBe(false);
    expect(canPromptForUpdate({ nonInteractive: true })).toBe(false);
    expect(canPromptForUpdate({ streamFile: "/tmp/run.jsonl" })).toBe(false);
    vi.stubEnv("CI", "true");
    expect(canPromptForUpdate({})).toBe(false);
  });
});

describe("offerUpdate", () => {
  it("runs the update and reports success", async () => {
    mockSelect.mockResolvedValue("update");
    mockRunUpdate.mockReturnValue(0);

    await expect(offerUpdate("999.0.0")).resolves.toBe(true);
    expect(mockRunUpdate).toHaveBeenCalledOnce();
    expect(mockSelect.mock.calls[0]![0].message).toContain("→ 999.0.0");
    expect(mockSelect.mock.calls[0]![0].loop).toBe(false);
  });

  it("continues on the current version when npm fails", async () => {
    mockSelect.mockResolvedValue("update");
    mockRunUpdate.mockReturnValue(1);

    await expect(offerUpdate("999.0.0")).resolves.toBe(false);
  });

  it("skips without running npm", async () => {
    mockSelect.mockResolvedValue("skip");

    await expect(offerUpdate("999.0.0")).resolves.toBe(false);
    expect(mockRunUpdate).not.toHaveBeenCalled();
  });

  it("skips itself when nobody answers", async () => {
    vi.useFakeTimers();
    selectUntilAborted();

    const result = offerUpdate("999.0.0");
    await vi.advanceTimersByTimeAsync(UPDATE_PROMPT_TIMEOUT_MS);

    await expect(result).resolves.toBe(false);
    expect(mockRunUpdate).not.toHaveBeenCalled();
  });

  it("skips on Esc", async () => {
    selectUntilAborted();

    const result = offerUpdate("999.0.0");
    process.stdin.emit("keypress", "\u001b", { name: "escape" });

    await expect(result).resolves.toBe(false);
    expect(process.stdin.listenerCount("keypress")).toBe(0);
  });

  it("rethrows Ctrl+C so the command exits", async () => {
    mockSelect.mockRejectedValue(Object.assign(new Error("force closed"), { name: "ExitPromptError" }));

    await expect(offerUpdate("999.0.0")).rejects.toThrow("force closed");
  });
});
