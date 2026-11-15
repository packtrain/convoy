import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialStore } from "./store.js";
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "convoy-keys-"));
  dirs.push(dir);
  return { dir, store: new CredentialStore(dir) };
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
describe("managed credential store", () => {
  it("rejects an unsafe writable ancestor", () => {
    const { dir } = fixture();
    const parent = join(dir, "unsafe");
    mkdirSync(parent, { mode: 0o777 });
    chmodSync(parent, 0o777);
    const store = new CredentialStore(join(parent, "private"));
    expect(() => store.mutate(() => {})).toThrow(`Unsafe credential directory: ${parent} is writable by group or others. Run chmod go-w ${parent}.`);
  });
  it("names the chmod for a readable config folder, as on a laptop (OS-2248)", () => {
    const { dir } = fixture();
    chmodSync(dir, 0o755);
    expect(() => new CredentialStore(dir).mutate(() => {})).toThrow(`Credential directory must be owner-only (0700). Run chmod 700 ${dir}.`);
  });
  it("names a symlinked ancestor", () => {
    const { dir } = fixture();
    const link = join(dir, "link");
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), link);
    expect(() => new CredentialStore(join(link, "private")).mutate(() => {})).toThrow(`Unsafe credential directory: ${link} is not a plain directory (a symlink?).`);
  });
  it("fails closed if an opted-in credential store disappears", () => {
    const { store } = fixture();
    store.mutate((data) => {
      data.bindings["a".repeat(64)] = { mode: "disabled" };
    });
    rmSync(store.file);
    expect(() => store.read()).toThrow("Cannot read managed credentials");
  });
  it("keeps revisions and identity bindings atomic and private", () => {
    const { dir, store } = fixture();
    store.mutate((s) => {
      s.entries.work = { id: "id", enabled: true, current: 1, revisions: [{ revision: 1, secret: "sentinel", createdAt: 1 }] };
      s.bindings["a".repeat(64)] = { mode: "managed", name: "work" };
    });
    expect(store.read().generation).toBe(1);
    expect(store.read().entries.work?.revisions[0]?.secret).toBe("sentinel");
    expect(statSync(join(dir, "credentials-v1.json")).mode & 0o777).toBe(0o600);
  });
  it("retains valid content if a mutation fails", () => {
    const { dir, store } = fixture();
    store.mutate(() => {});
    const before = readFileSync(join(dir, "credentials-v1.json"), "utf8");
    expect(() =>
      store.mutate((s) => {
        s.generation = -10;
      })
    ).toThrow();
    expect(readFileSync(join(dir, "credentials-v1.json"), "utf8")).toBe(before);
  });
  it("rejects unknown schemas and symlinks without leaking contents", () => {
    const { dir, store } = fixture();
    const file = join(dir, "credentials-v1.json");
    writeFileSync(file, '{"version":99,"secret":"never-print"}', { mode: 0o600 });
    expect(() => store.read()).toThrow("Cannot read managed credentials");
    rmSync(file);
    symlinkSync(join(dir, "target"), file);
    expect(() => store.read()).toThrow();
  });
  it("refuses concurrent writers without stealing their lock", () => {
    const { store } = fixture();
    store.mutate(() => {
      expect(() => store.mutate(() => {})).toThrow("locked");
    });
  });
});

it("leaves an unused store absent under a symlinked home ancestor", () => {
  const { dir } = fixture();
  mkdirSync(join(dir, "real"));
  symlinkSync(join(dir, "real"), join(dir, "link"));
  expect(new CredentialStore(join(dir, "link", "config")).read().entries).toEqual({});
});
