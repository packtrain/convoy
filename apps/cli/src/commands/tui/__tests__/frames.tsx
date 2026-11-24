// Main views of a two-project shared Docker environment at one terminal size, checked as plain text so they hold
// without color. FRAMES_DIR=<dir> also writes each frame there. Spec: docs/specs/cli-tui.md#tui-ux-review-cli-01700-os-2547
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import type { BrowseState, Row } from "../validators.js";
import { settle } from "./test-helpers.js";

const [columns, rows] = (process.argv[2] ?? "110x34").split("x").map(Number);
const stdout = Object.assign(new PassThrough(), { columns, rows, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let frame = "";
stdout.on("data", chunk => { if (plain(chunk.toString()).trim()) frame = chunk.toString(); });
const offline = async () => { throw new Error("offline"); };
const browser = new Browser([
  { id: "local-test", name: "local-test", transport: "docker", mode: "shared", endpoint: "docker exec convoy-local-test-0f079851 /home/node/.convoy/service/control.sock", open: offline,
    maintenance: { status: async () => ({}), release: async () => ({ installed: "0.169.1", proposed: "0.169.1" }), execute: async () => ({}) } },
  { id: "build-box", name: "build-box", transport: "ssh", endpoint: "ssh build-box", open: offline },
]);
const now = Date.now();
const thread = (threadId: string, title: string, extra: Partial<Row["thread"]> = {}): Row => ({ profile: "os", thread: { threadId, title, lastActivityAt: now - 22_000, ...extra } });
const threads = [
  thread("k57abc12def34ghi56jkl78mno90pqr1", "Fix the flaky login test in the onboarding suite", { status: "streaming", associatedTaskId: "t1", associatedTaskRef: "OS-2481", cliType: "codex" }),
  thread("k57abc12def34ghi56jkl78mno90pqr2", "Review PR #812: billing webhooks and the retry queue", { status: "waiting_input", associatedTaskId: "t2", associatedTaskRef: "OS-2477" }),
  thread("k57abc12def34ghi56jkl78mno90pqr3", "sup?", { status: "completed" }),
  thread("k57abc12def34ghi56jkl78mno90pqr4", "Queued follow-up", { status: "idle", hasPendingUserMessages: true }),
];
let state: BrowseState = { ...browser.getSnapshot(), observations: [{
  health: "connected", version: "0.169.1", snapshot: { pid: 42, mode: "shared" } as never,
  profiles: [
    { profile: "os", status: "online", attempts: 1, activeRuns: 1, versions: { codex: "0.63.0", "claude-code": "2.0.14" }, logins: { codex: "signed-out", "claude-code": "signed-in" }, warning: "Codex is not logged in on this account." },
    { profile: "landing", status: "online", attempts: 1, activeRuns: 0, versions: { codex: "0.63.0" }, logins: { codex: "signed-out" } },
  ],
}, { health: "unknown", profiles: [] }] };
const listeners = new Set<() => void>();
const update = (next: Partial<BrowseState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
browser.getSnapshot = () => state;
browser.subscribe = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };
browser.select = scope => update({ scope, rows: scope.profile ? threads : [], history: undefined });
browser.showActions = actions => update({ actions, credentials: undefined });
browser.showCredentials = value => update({ actions: false, credentials: value ? "view" : undefined });
browser.history = row => update({ history: row, rows: row ? [0, 1].map(i => ({ ...row, run: { threadId: row.thread.threadId, messageId: `m${i}`, runId: `run-${i}`, status: "completed", createdAt: now - 60_000, updatedAt: now - 30_000 } })) : threads });
const instance = render(<App browser={browser} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false });
const text = () => frame.split("\n").map(plain).join("\n");
const lines = () => text().split("\n");
const footer = () => lines().at(-2) ?? "";
const line = (pattern: RegExp) => lines().find(value => pattern.test(value)) ?? "";
async function key(value: string) { stdin.write(value); await settle(80); }
const shot = (name: string) => {
  if (!process.env.FRAMES_DIR) return;
  mkdirSync(process.env.FRAMES_DIR, { recursive: true });
  writeFileSync(join(process.env.FRAMES_DIR, `${columns}x${rows}-${name}.txt`), text());
};
const small = rows < 30;
// Every failed check is reported together, so one run shows all regressions.
const failures: string[] = [];
const check = (run: () => void) => { try { run(); } catch (error) { failures.push(`${(error as Error).message.split("\n")[0].slice(0, 200)}`); } };
try {
  await settle(120);
  shot("details");
  // B4: the selected row carries a marker, not only a fill.
  check(() => assert.match(line(/▾ local-/), /^› ▾ local-/, "selected sidebar row is marked"));
  // A1: an unobserved environment shows a hollow dot.
  check(() => assert.match(line(/build-box/), /ssh ○/));
  // D2: environment view rows name their keys.
  check(() => assert.match(line(/^\s+Actions\s/), /Actions\s+a(\s|$)/));
  check(() => assert.match(line(/^\s+Credentials\s/), /Credentials\s+c(\s|$)/));
  check(() => assert.match(line(/^\s+\+ Add project/), /\+ Add project\s+\+(\s|$)/));
  // L2, L3: no repeated endpoint, project count or unknown queue.
  check(() => assert(!text().includes("registered projects")));
  check(() => assert(!text().includes("queued count unknown")));
  // L1: one line of notices.
  check(() => assert(!text().includes("Project notices")));
  check(() => assert.match(text(), /! os: Needs sign-in: Codex .*\[w\] all notices/));
  // B3: the footer fits and always ends with keys and detach.
  check(() => assert.match(footer(), /\[\?\] keys\s+\[q\] detach\s*$/));
  check(() => assert(!footer().includes("[n/p]")));
  // L7: below 100 columns the sidebar narrows so Details keeps its values.
  if (columns < 100) check(() => assert(text().includes("shared · one account for all projects")));
  // L6: hidden Details content is announced.
  if (small) check(() => assert.match(text(), /↓ \d+ more/));
  await key("\u001b[C");
  // B4: Details runtime rows too.
  check(() => assert.match(line(/Codex\s+0\.63\.0/), /›\s*Codex/));
  check(() => assert.match(footer(), /\[↑\/↓\] rows.*\[\?\] keys\s+\[q\] detach\s*$/));
  await key("a");
  shot("actions");
  check(() => assert.match(line(/\[l\] Saved service JSON logs/), /› \[l\]/));
  check(() => assert(text().includes("Delete environment") || /↓ \d+ more/.test(text()), "Actions shows or announces every control"));
  // D1: ? lists the keys.
  await key("?");
  shot("keys");
  check(() => assert.match(text(), /Keys · Actions/));
  if (small) { check(() => assert.match(text(), /↓ \d+ more · PgDn/)); await key("\u001b[6~"); }
  check(() => assert.match(text(), /q Ctrl\+C\s+detach/));
  await key("\u001b");
  check(() => assert(!text().includes("Keys · Actions")));
  await key("\u001b"); await key("\u001b[B"); await key("\u001b[B"); await key("\u001b[B"); await key("\r");
  shot("runs");
  // L4: no PROJECT column or unknown runtime.
  check(() => assert(!text().includes("PROJECT")));
  check(() => assert(!text().includes("runtime unkno")));
  // L5: the title leads and the task ref follows; no placeholder for an unlinked thread.
  const title = lines().findIndex(value => value.includes("Fix the flaky login test"));
  check(() => assert(title > 0 && lines()[title + 1].includes("OS-2481")));
  check(() => assert.match(lines()[title], /codex/, "a known runtime ends the title line"));
  check(() => assert(!text().includes("[no task]")));
  check(() => assert(!text().includes(threads[2].thread.threadId), "thread IDs are shortened"));
  // A2: readable states.
  check(() => assert(text().includes("needs input") && !text().includes("waiting_input")));
  check(() => assert(text().includes("idle · queued")));
  check(() => assert.match(footer(), small ? /\[Enter\] open.*\[\?\] keys\s+\[q\] detach\s*$/ : /\[Enter\] open.*\[n\/p\] page.*\[\?\] keys\s+\[q\] detach\s*$/));
  await key("\u001b[B"); await key("\r");
  shot("history");
  // Tabs keep their labels beside a long title.
  check(() => assert.match(text(), /\[r\] Runs\s+\[a\] Actions/));
  // B2: the title never wraps beside a long thread title.
  check(() => assert(text().includes("Execution history")));
  if (failures.length) throw new Error(`${failures.length} frame checks failed:\n${failures.join("\n")}\n\n${text()}`);
  console.log(`Frame checks passed: ${columns}x${rows}`);
} finally {
  instance.unmount();
}
