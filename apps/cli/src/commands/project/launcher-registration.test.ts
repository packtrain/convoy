import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, spawnSync: vi.fn() }));
import { addLocalProject } from "./launcher.js";
it("reports failed spawn as safe to retry without losing inputs", async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  const result = addLocalProject("a", {});
  const assertion = expect(result).resolves.toMatchObject({ ok: false, retrySafe: true, registered: false, reason: "environment-unavailable" });
  child.emit("error", new Error("spawn ENOENT")); child.emit("close", -2);
  await assertion;
});
it("keeps a lost result unknown once the child has started", async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  const result = addLocalProject("a", {});
  const assertion = expect(result).rejects.toThrow("outcome unknown");
  child.emit("spawn"); child.emit("close", 1); await assertion;
});
it("reports synchronous spawn failure as safe to retry", async () => {
  mocks.spawn.mockImplementationOnce(() => { throw new Error("invalid spawn options"); });
  await expect(addLocalProject("a", {})).resolves.toMatchObject({ reason: "environment-unavailable", retrySafe: true });
});
