import { connect } from "node:net";
import type { Readable, Writable } from "node:stream";
import { frameParser } from "./parsers.js";
import { FRAME_LIMIT, RESPONSE_LIMIT, requestSchema, responseSchema } from "./validators.js";

/** Protocol-only transport. The service, not this bridge, authorizes operations. */
export async function serviceBridge(path: string, input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => {
    let ended = false, inputEnded = false, socketEnded = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const finish = (error?: Error) => {
      if (ended) return;
      ended = true;
      clearTimeout(deadline);
      input.off("data", fromInput); input.off("end", end); input.off("error", failure);
      output.off("error", failure); output.off("drain", drain);
      socket.destroy(); input.pause();
      if (error) reject(error); else resolve();
    };
    const timeout = () => finish(new Error(`Service bridge timed out after 45 seconds.${pending.size ? ` Outcome unknown for request IDs: ${[...pending].join(", ")}. Inspect state before retrying.` : ""}`));
    const failure = () => finish(new Error("Service bridge closed: invalid frame, permissions, connection or slow output."));
    const settle = () => {
      if (ended || (!inputEnded && !socketEnded)) return;
      if (pending.size) {
        if (socketEnded) finish(new Error(`Service bridge reply lost. Outcome unknown for request IDs: ${[...pending].join(", ")}. Inspect state before retrying.`));
        return;
      }
      if (!output.writableLength) finish();
      else if (!deadline) deadline = setTimeout(timeout, 45000);
    };
    const end = () => {
      fromInput.end();
      if (ended) return;
      inputEnded = true;
      // EOF detaches subscriptions once their initial snapshot and all replies drain.
      deadline = setTimeout(timeout, 45000);
      settle();
    };
    const drain = () => { socket.resume(); settle(); };
    const fromInput = frameParser(FRAME_LIMIT, value => {
      if (ended) return;
      const request = requestSchema.safeParse(value);
      if (!request.success || pending.has(request.data.id) || pending.size >= 8) { failure(); return; }
      if (socket.writableLength > FRAME_LIMIT * 2) { failure(); return; }
      pending.add(request.data.id);
      if (!socket.write(JSON.stringify(request.data) + "\n")) input.pause();
    }, failure);
    const fromSocket = frameParser(RESPONSE_LIMIT, value => {
      if (ended) return;
      const response = responseSchema.safeParse(value);
      if (!response.success) { failure(); return; }
      const frame = JSON.stringify(response.data) + "\n";
      if (output.writableLength + Buffer.byteLength(frame) > RESPONSE_LIMIT * 2) { failure(); return; }
      if (!output.write(frame, error => { if (error) failure(); else settle(); })) socket.pause();
      if (!response.data.event || response.data.event === "snapshot") pending.delete(response.data.id);
      settle();
    }, failure);
    socket.on("data", fromSocket);
    socket.on("drain", () => { if (!ended && !inputEnded) input.resume(); });
    socket.on("error", (error: NodeJS.ErrnoException) => ["ENOENT", "ECONNREFUSED"].includes(error.code ?? "")
      ? finish(new Error("Service unavailable.")) : failure());
    socket.on("end", () => { fromSocket.end(); socketEnded = true; settle(); });
    socket.on("close", () => { fromSocket.end(); socketEnded = true; settle(); });
    socket.setTimeout(45000, timeout);
    input.on("data", fromInput); input.once("end", end); input.once("error", failure);
    output.on("drain", drain); output.on("error", failure);
  });
}
