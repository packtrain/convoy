/** Bounded NDJSON framing shared by the socket client, server and stdio bridge. */
export function frameParser(limit: number, receive: (value: unknown) => void, fail: () => void) {
  let pending = Buffer.alloc(0);
  let failed = false;
  const parse = (chunk: Buffer) => {
    if (failed) return;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const piece = chunk.subarray(offset, end);
      if (pending.length + piece.length > limit) { failed = true; fail(); return; }
      pending = Buffer.concat([pending, piece]);
      if (newline < 0) return;
      try { const value: unknown = JSON.parse(pending.toString("utf8")); pending = Buffer.alloc(0); receive(value); }
      catch { failed = true; fail(); return; }
      offset = newline + 1;
    }
  };
  return Object.assign(parse, { end() {
    if (!failed && pending.length) { failed = true; fail(); }
  } });
}
