// @vitest-environment jsdom
import { Profiler } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DueDateCell } from "@/components/blocks/tasks/task-table/cells/due-date-cell";
import { DateTimePicker } from "./datetime-picker";
import { generateDate } from "./datetime-utils";

const metrics = vi.hoisted(() => ({ parseMs: 0 }));
vi.mock("./datetime-utils", async importOriginal => {
  const actual = await importOriginal<typeof import("./datetime-utils")>();
  return { ...actual, generateDate: vi.fn((...args: Parameters<typeof actual.generateDate>) => {
    const start = performance.now();
    const result = actual.generateDate(...args);
    metrics.parseMs += performance.now() - start;
    return result;
  }) };
});

function mockViewport() {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(min-width: 640px)", media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

test("mounting 31 closed due-date cells does not parse hidden suggestions", () => {
  mockViewport();
  const samples: {wallMs: number; renderMs: number; parseMs: number; parses: number}[] = [];
  for (let trial = 0; trial < 5; trial++) {
    metrics.parseMs = 0;
    vi.mocked(generateDate).mockClear();
    let renderMs = 0;
    const start = performance.now();
    const view = render(<Profiler id="31-due-dates" onRender={(_id, _phase, duration) => { renderMs += duration; }}>
      {Array.from({length: 31}, (_, i) => <DueDateCell key={i} dueDate={null} onDueDateChange={() => {}} />)}
    </Profiler>);
    samples.push({wallMs: performance.now() - start, renderMs, parseMs: metrics.parseMs, parses: vi.mocked(generateDate).mock.calls.length});
    view.unmount();
  }
  if (process.env.GROUP_MOUNT_PROFILE) console.info(JSON.stringify(samples));
  expect(samples.map(sample => sample.parses)).toEqual([0, 0, 0, 0, 0]);
});

test("suggestions are parsed when opened and reused during position updates", () => {
  mockViewport();
  render(<DateTimePicker dateTime={undefined} setDateTime={vi.fn()} variant="ghost" mode="date" />);
  vi.mocked(generateDate).mockClear();
  fireEvent.focus(screen.getByRole("textbox"));
  expect(generateDate).toHaveBeenCalledTimes(4);
});

test("mounting desktop due-date cells never reads drawer scroll position", () => {
  mockViewport();
  const descriptor = Object.getOwnPropertyDescriptor(window, "scrollY")!;
  const readScrollY = vi.fn(() => 0);
  Object.defineProperty(window, "scrollY", { configurable: true, get: readScrollY });
  try {
    render(<>{Array.from({ length: 31 }, (_, index) => (
      <DueDateCell key={index} dueDate={null} onDueDateChange={vi.fn()} />
    ))}</>);
    expect(readScrollY).not.toHaveBeenCalled();
  } finally {
    cleanup();
    Object.defineProperty(window, "scrollY", descriptor);
  }
});
