import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { connectOpencode } from "./client.js";

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

/** Records each request's headers; answers JSON, or one SSE event on /event. */
async function listen(seen: IncomingHttpHeaders[]): Promise<string> {
  server = createServer((req, res) => {
    seen.push(req.headers);
    if (req.url?.startsWith("/event")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"type":"server.connected","properties":{}}\n\n');
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ all: [], connected: [], default: {} }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe("connectOpencode", () => {
  // Each worker's server has its own password, so every call must carry it (OS-2018).
  it("sends the server password on requests and the event stream", async () => {
    const seen: IncomingHttpHeaders[] = [];
    const client = connectOpencode({ baseUrl: await listen(seen), directory: "/work", password: "pw-sentinel" });

    await client.listProviders();
    const abort = new AbortController();
    for await (const event of await client.subscribeEvents(abort.signal)) {
      expect(event).toMatchObject({ type: "server.connected" });
      break;
    }
    abort.abort();

    const expected = `Basic ${Buffer.from("opencode:pw-sentinel").toString("base64")}`;
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const headers of seen) expect(headers.authorization).toBe(expected);
  });
});
