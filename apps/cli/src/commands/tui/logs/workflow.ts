import { ZodError } from "zod";
import { ServiceCompatibilityError, ServiceUnavailableError } from "../../service/errors.js";
import { EVENT_BYTES, WINDOW_BYTES, WINDOW_EVENTS, pageSchema, type LogEvent, type LogState, type ReadLogs } from "./validators.js";

/** Each view retains a bounded window; stored order is the replay identity. */
export class Logs {
  private state: LogState = { events: [], bytes: 0, following: true, loading: false, latest: -1, seen: -1 };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private disposed = false;
  private reading = false;
  private pending?: "latest" | "older" | "newer";
  constructor(private readonly read: ReadLogs) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<LogState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  start() { this.navigate("latest"); }
  pause() { this.revision++; this.set({ following: false, loading: false }); }
  latest() { this.set({ following: true }); this.navigate("latest"); }
  older() { this.pause(); this.navigate("older"); }
  newer() { this.pause(); this.navigate("newer"); }
  retry() { this.navigate(this.state.following ? "latest" : "newer"); }
  dispose() {
    this.disposed = true; this.revision++; clearTimeout(this.timer); this.pending = undefined;
    this.state = { ...this.state, events: [], bytes: 0 }; this.listeners.clear();
  }
  private navigate(direction: "latest" | "older" | "newer") {
    this.revision++; clearTimeout(this.timer); this.pending = direction;
    if (!this.reading) void this.refresh();
  }
  private async refresh() {
    if (this.disposed || this.reading) return;
    const direction = this.pending; this.pending = undefined;
    const revision = this.revision;
    const current = () => !this.disposed && revision === this.revision;
    this.reading = true;
    // Paused views probe only the tail, keeping their loaded history stable.
    const probe = !direction && !this.state.following;
    const before = direction === "latest" ? Number.MAX_SAFE_INTEGER
      : direction === "older" ? this.state.events[0]?.order ?? Number.MAX_SAFE_INTEGER : undefined;
    const after = this.state.events.at(-1)?.order ?? -1;
    this.set({ loading: true });
    try {
      const page = pageSchema.parse((await this.read(probe ? { chunkAfter: Number.MAX_SAFE_INTEGER } : before !== undefined ? { chunkBefore: before } : { chunkAfter: after })).result);
      if (!current()) return;
      this.set({ latest: page.latest, status: page.run.status });
      if (!probe) {
        const events: LogEvent[] = [];
        let loadedBytes = 0;
        const reverse = direction === "older" || direction === "latest";
        for (const row of reverse ? [...page.page].reverse() : page.page) {
          const rowBytes = (row.bytes <= EVENT_BYTES ? row.bytes : Buffer.byteLength(row.eventJson)) + 256;
          if (loadedBytes + rowBytes > WINDOW_BYTES) break;
          loadedBytes += rowBytes;
          let event = row;
          // A larger event stays a descriptor; export retrieves every fragment.
          if (row.bytes <= EVENT_BYTES && row.nextOffset !== undefined) {
            let json = "", offset = 0;
            while (true) {
              const fragment = pageSchema.parse((await this.read({ eventOrder: row.order, eventOffset: offset })).result).page[0];
              if (!current()) return;
              if (!fragment || fragment.order !== row.order || fragment.length !== row.length) throw new Error("Changed event");
              json += fragment.eventJson;
              if (Buffer.byteLength(json) > EVENT_BYTES) throw new Error("Event exceeds window budget");
              if (fragment.nextOffset === undefined) break;
              if (fragment.nextOffset <= offset) throw new Error("Invalid fragment cursor");
              offset = fragment.nextOffset;
            }
            event = { ...row, eventJson: json, nextOffset: undefined };
          }
          events.push(event);
        }
        if (!current()) return;
        const combined = direction === "latest" ? events : direction === "older" ? [...events, ...this.state.events] : [...this.state.events, ...events];
        const unique = [...new Map(combined.map(event => [event.order, event])).values()].sort((a, b) => a.order - b.order);
        const size = (event: LogEvent) => Buffer.byteLength(event.eventJson) + 256;
        let bytes = unique.reduce((sum, event) => sum + size(event), 0);
        while (unique.length > WINDOW_EVENTS || bytes > WINDOW_BYTES) {
          bytes -= size((direction === "older" ? unique.pop() : unique.shift())!);
        }
        this.set({ events: unique, bytes, seen: this.state.following || direction === "newer" ? Math.max(this.state.seen, unique.at(-1)?.order ?? -1) : this.state.seen });
      }
      this.set({ error: undefined });
    } catch (error) {
      const message = error instanceof ServiceCompatibilityError ? "Update the service for raw log support."
        : error instanceof ServiceUnavailableError ? "Service disconnected. Wait for reconnect, then retry."
        : error instanceof ZodError ? "Invalid log response. Check service/backend versions."
        : "Logs unavailable. Check backend access and service/backend versions.";
      if (current()) this.set({ error: message + " r retries." });
    } finally {
      this.reading = false;
      if (!this.disposed) {
        this.set({ loading: false });
        // Catch up in bounded pages; polling only starts after the current read.
        const behind = this.state.following && (this.state.events.at(-1)?.order ?? -1) < this.state.latest;
        const settled = this.state.status === "completed" || this.state.status === "failed";
        if (this.pending || (!this.state.error && (!settled || behind))) {
          this.timer = setTimeout(() => void this.refresh(), this.pending || (behind && !this.state.error) ? 0 : 3000);
        }
      }
    }
  }
}
