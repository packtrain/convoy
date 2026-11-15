import type { Writable } from "node:stream";
import { RESPONSE_LIMIT } from "./validators.js";

export class ServiceOutputError extends Error {}

/** Bound terminal queues independently of the service socket's queue. */
export class ServiceOutput {
  error?: Error;
  private pending = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly waiters = new Set<() => void>();
  constructor(private readonly failed: (error: Error) => void, private readonly stream: Writable = process.stdout) {
    stream.on("error", this.broken);
  }
  private readonly drained = () => {
    clearTimeout(this.timer); this.timer = undefined;
    for (const resolve of this.waiters) resolve(); this.waiters.clear();
  };
  private readonly broken = () => {
    if (this.error) return;
    this.error = new ServiceOutputError("Terminal output is blocked or too slow. Detached; service and agents remain running.");
    this.stream.destroy(); this.drained(); this.failed(this.error);
  };
  readonly write = (text: string) => {
    if (this.error) throw this.error;
    const frame = text + "\n";
    if (this.stream.writableLength + Buffer.byteLength(frame) > 2 * RESPONSE_LIMIT) { this.broken(); throw this.error; }
    this.pending++;
    if (!this.timer) this.timer = setTimeout(this.broken, 10000);
    this.stream.write(frame, error => {
      if (error) { this.broken(); return; }
      if (--this.pending === 0) this.drained();
    });
  };
  async flush() {
    if (this.pending && !this.error) await new Promise<void>(resolve => this.waiters.add(resolve));
    if (this.error) throw this.error;
  }
  dispose() { clearTimeout(this.timer); this.stream.off("error", this.broken); }
}
