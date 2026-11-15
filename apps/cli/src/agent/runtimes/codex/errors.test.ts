import { PassThrough } from "node:stream";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { collectCodexDiagnostics, formatCodexFailure, sanitizeCodexDiagnostic } from "./errors.js";

describe("Codex failure diagnostics", () => {
  it.each([
    "CODEX_HOME does not exist", "Permission denied", "Network error ECONNREFUSED",
    "HTTP 403 from proxy", "usage limit reached", "Unknown startup error",
  ])("keeps a non-auth cause without login advice: %s", (message) => {
    expect(formatCodexFailure(message)).toBe(message);
  });

  it("redacts split secrets before logging, retains only the recent tail, and flushes EOF", async () => {
    const stream = new PassThrough();
    const log = vi.fn();
    const tail = collectCodexDiagnostics(stream, "split-sentinel", log);
    for (let i = 0; i < 30; i++) stream.write(`line-${i}\n`);
    stream.write("invalid API key: split-");
    stream.end("sentinel");
    await once(stream, "end");
    expect(tail()).toContain("invalid API key: [redacted]");
    expect(tail()).not.toContain("line-0");
    expect(tail().split(" | ")).toHaveLength(12);
    expect(JSON.stringify(log.mock.calls)).not.toContain("split-sentinel");
  });

  it("discards an oversized credential line and resumes on the next line", async () => {
    const stream = new PassThrough();
    const log = vi.fn();
    const tail = collectCodexDiagnostics(stream, undefined, log);
    stream.write("access_token=" + "s".repeat(9000));
    stream.end("secret-end\nPermission denied\n");
    await once(stream, "end");
    expect(tail()).toBe("[oversized diagnostic line omitted] | Permission denied");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-end");
  });

  it("redacts recognizable credentials and preserves the diagnostic", () => {
    const message = 'invalid API key: opaque-value token=token-sentinel https://user:password@host.invalid/?access_token=query-secret';
    const clean = sanitizeCodexDiagnostic(message);
    for (const secret of ["opaque-value", "token-sentinel", "password", "query-secret"]) expect(clean).not.toContain(secret);
    expect(formatCodexFailure(message)).toContain("authentication failed");
  });

  it("bounds formatted errors and strips terminal control sequences", () => {
    const message = sanitizeCodexDiagnostic("\x1b[31mPermission denied\x1b[0m\x00" + "x".repeat(10000));
    expect(message).toHaveLength(6144);
    expect(message).toMatch(/^Permission denied/);
    expect(message).not.toContain("\x1b");
  });
});
