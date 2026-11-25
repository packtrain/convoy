import { afterEach, expect, it, vi } from "vitest";
import { launchAgentPlist, printRunResult, printServiceEvent, systemdUserUnit } from "./formatters.js";
afterEach(() => vi.restoreAllMocks());
it("prints plain run rows with identifiers and pagination guidance", () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  printRunResult({ page: [{ threadId: "t-1", messageId: "m-1", runId: "r-1", status: "streaming", title: "Task title" }], isDone: false, continueCursor: "next-page" });
  const text = out.mock.calls.flat().join("\n");
  expect(text).toContain("t-1"); expect(text).toContain("m-1"); expect(text).toContain("r-1");
  expect(text).toContain("--cursor next-page"); expect(text.trim().startsWith("{")).toBe(false);
});
it("prints normalized text and tool events without raw JSON", () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  printRunResult({ kind: "text", text: "Hello\u001b[31m world" });
  printRunResult({ kind: "tool_start", toolName: "Read", toolCallId: "tool-1" });
  expect(out.mock.calls[0][0]).toBe("Hello world");
  expect(out.mock.calls[1][0]).toMatch(/tool_start.*Read.*tool-1/);
  expect(out.mock.calls[1][0]).not.toContain("{");
});
it("prints normalized attach execution updates as plain lines", () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  printServiceEvent({ v: 1, id: "event", ok: true, result: { profile: "a", event: { threadId: "thread", runId: "run", phase: "completed" } } });
  expect(out.mock.calls[0][0]).toBe("[a] thread completed (run run)");
});
it("preserves raw JSON mode", () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {}); const row = { kind: "text", text: "Hello" };
  printRunResult(row, true); expect(out).toHaveBeenCalledWith(JSON.stringify(row));
});
it("marks truncated stored events and shows their preview", () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  printRunResult({ kind: "text", truncated: true, preview: '{"kind":"text","text":"partial' });
  expect(out.mock.calls[0][0]).toContain("[truncated]"); expect(out.mock.calls[0][0]).toContain("partial");
});
it("prints project warnings under the status table", () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  printServiceEvent({ v: 1, id: "s", ok: true, pid: 1, cursor: 0, profiles: [
    { profile: "a", status: "failed", attempts: 4, warning: "codex is not installed for this project." },
    { profile: "b", status: "online", attempts: 1 },
  ] });
  const text = out.mock.calls.flat().join("\n");
  expect(text).toContain("Warnings:\n  a: failed · codex is not installed for this project.");
  expect(text).not.toContain("b: online");
});
it("prints each project's runtimes with version, login and credential (OS-2502)", () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  printServiceEvent({ v: 1, id: "s", ok: true, pid: 1, cursor: 0, profiles: [
    { profile: "a", status: "online", attempts: 1, versions: { codex: "0.142.3", cursor: "1.2.0" }, logins: { codex: "signed-in", "claude-code": "signed-out" },
      desiredAuth: { mode: "managed", name: "none", claude: { mode: "disabled" }, cursor: { mode: "managed", name: "team" } } },
    { profile: "b", status: "stopped", attempts: 0 },
  ] });
  const text = out.mock.calls.flat().join("\n");
  expect(text).toContain([
    "PROFILE\tRUNTIME\tVERSION\tLOGIN\tCREDENTIAL",
    "a\tCodex\t0.142.3\tsigned in\tkey none",
    "a\tClaude Code\tunknown\tsigned out\tnone",
    "a\tCursor\t1.2.0\tunknown\tkey team",
    "Runtimes not reported yet: b",
  ].join("\n"));
});
it("renders a login job that runs once at load with escaped paths", () => {
  const plist = launchAgentPlist("build.convoy.service", ["/n<o>de", "/a&b/convoy", "service", "start"], { PATH: "/opt/homebrew/bin:/usr/bin" });
  expect(plist).toContain("<string>/n&lt;o&gt;de</string>\n    <string>/a&amp;b/convoy</string>");
  expect(plist).toContain("<key>PATH</key>\n    <string>/opt/homebrew/bin:/usr/bin</string>");
  expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
  expect(plist).not.toContain("KeepAlive");
});
it("renders a systemd user unit with quoted, specifier-safe arguments", () => {
  const unit = systemdUserUnit(["/n o/node", "/a\"b/50%$x/convoy", "service", "start"], { PATH: "/home/u/bin:/usr/bin", CODEX_HOME: "/c%d" });
  expect(unit).toContain('ExecStart="/n o/node" "/a\\"b/50%%$$x/convoy" "service" "start"\n');
  expect(unit).toContain('Environment="PATH=/home/u/bin:/usr/bin"\nEnvironment="CODEX_HOME=/c%%d"\n');
  expect(unit).toContain("[Install]\nWantedBy=default.target\n");
  expect(unit).not.toContain("Restart");
  expect(unit).toContain("KillMode=mixed\n");
});
