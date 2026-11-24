import { afterEach, expect, it, vi } from "vitest";

const { browsers, mounts, events, options } = vi.hoisted(() => ({
  options: [] as unknown[],
  browsers: [] as { shell: (operation: (signal: AbortSignal) => Promise<void>) => Promise<void> }[],
  mounts: [] as { unmount(): void }[],
  events: [] as string[],
}));
vi.mock("ink", () => ({
  render: (_node: unknown, option: unknown) => {
    events.push("mount");
    options.push(option);
    let exit!: () => void;
    const exited = new Promise<void>(resolve => { exit = resolve; });
    const instance = { unmount: () => exit(), clear: () => {}, cleanup: () => {}, waitUntilExit: () => exited };
    mounts.push(instance);
    return instance;
  },
}));
vi.mock("./app.js", () => ({ App: () => null }));
vi.mock("./workflow.js", () => ({
  Browser: class {
    environmentBusy = false;
    constructor(_targets: unknown, _selected: number, readonly shell: (operation: (signal: AbortSignal) => Promise<void>) => Promise<void>) { browsers.push(this); }
    start() {}
    dispose() {}
  },
}));

import { run } from "./render.js";

const enter = "\u001b[?1049h", leave = "\u001b[?1049l";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function recordScreen() {
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    if (String(chunk).includes(enter)) events.push("enter");
    if (String(chunk).includes(leave)) events.push("leave");
    return true;
  });
  Object.defineProperty(process.stdin, "setRawMode", { value: () => process.stdin, configurable: true });
}

afterEach(() => { vi.restoreAllMocks(); browsers.length = 0; mounts.length = 0; events.length = 0; options.length = 0; });

it("draws in the alternate screen and restores the shell screen on exit", async () => {
  recordScreen();
  const done = run([]);
  await tick();
  mounts[0]!.unmount();
  await done;
  expect(events).toEqual(["enter", "mount", "leave"]);
});

it("hands the shell screen to an operation and returns to the alternate screen", async () => {
  recordScreen();
  const done = run([]);
  await tick();
  const operation = browsers[0]!.shell(async () => { events.push("operation"); });
  await operation;
  await tick();
  mounts[1]!.unmount();
  await done;
  expect(events).toEqual(["enter", "mount", "leave", "operation", "enter", "mount", "leave"]);
});

// A spinner frame then rewrites one line, not the whole screen. Spec: docs/specs/cli-tui.md#tui-ux-review-cli-01700-os-2547
it("renders incrementally", async () => {
  recordScreen();
  const done = run([]);
  await tick();
  mounts[0]!.unmount();
  await done;
  expect(options[0]).toMatchObject({ incrementalRendering: true });
});
