import { open, link, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pageSchema, type ReadLogs } from "./validators.js";

/** Await each sink write before fetching again; no full-event or run buffer. */
export async function streamLogs(read: ReadLogs, write: (text: string) => Promise<void>, signal: AbortSignal): Promise<number> {
  let after = -1, boundary: number | undefined, count = 0;
  const check = () => signal.throwIfAborted();
  while (true) {
    check();
    const page = pageSchema.parse((await read({ chunkAfter: after })).result);
    check(); boundary ??= page.latest;
    for (const event of page.page) {
      if (event.order > boundary) return count;
      if (event.order <= after) throw new Error("Invalid log cursor");
      if (event.nextOffset === undefined) { await write(event.eventJson + "\n"); check(); }
      else {
        let offset = 0;
        while (true) {
          check();
          const part = pageSchema.parse((await read({ eventOrder: event.order, eventOffset: offset })).result).page[0];
          check();
          if (!part || part.order !== event.order || part.length !== event.length) throw new Error("Stored event changed");
          await write(part.eventJson); check();
          if (part.nextOffset === undefined) { await write("\n"); break; }
          if (part.nextOffset <= offset) throw new Error("Invalid event cursor");
          offset = part.nextOffset;
        }
      }
      after = event.order; count++;
    }
    if (after >= boundary || !page.hasMore) return count;
    if (!page.page.length) throw new Error("Log history unavailable");
  }
}

export async function exportLogs(read: ReadLogs, destination: string, overwrite: boolean, signal: AbortSignal,
  progress: (partial: string) => void): Promise<number> {
  const partial = `${destination}.${randomUUID()}.partial`;
  const file = await open(partial, "wx", 0o600);
  progress(partial);
  let count: number;
  try {
    count = await streamLogs(read, text => file.writeFile(text, "utf8"), signal);
    signal.throwIfAborted(); await file.sync();
  } finally { await file.close(); }
  signal.throwIfAborted();
  if (overwrite) await rename(partial, destination);
  else { await link(partial, destination); await unlink(partial); }
  return count;
}
