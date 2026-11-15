import { Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { ServiceOutput } from "./output.js";
it("flushes writes below the stream high-water mark", async () => {
  let complete!: () => void;
  const stream = new Writable({ write(_chunk, _encoding, callback) { complete = callback; } });
  const output = new ServiceOutput(vi.fn(), stream); let flushed = false;
  try {
    output.write("short"); void output.flush().then(() => { flushed = true; });
    complete(); await Promise.resolve(); await Promise.resolve();
    expect(flushed).toBe(true);
  } finally { output.dispose(); stream.destroy(); }
});
it("times out a stalled small write with a bounded diagnostic", async () => {
  vi.useFakeTimers();
  const stream = new Writable({ write() {} }); const failed = vi.fn(); const output = new ServiceOutput(failed, stream);
  try { output.write("short"); await vi.advanceTimersByTimeAsync(10001); expect(failed).toHaveBeenCalledOnce(); }
  finally { output.dispose(); stream.destroy(); vi.useRealTimers(); }
});
