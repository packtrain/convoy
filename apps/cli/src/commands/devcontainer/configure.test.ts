import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as TOML from "smol-toml";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureDevcontainer } from "./install.js";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("../../lib/config/profile.js", () => ({ resolveProfile: resolve }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = async () => null; } }));
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "convoy-container-"));
  resolve.mockReturnValue({ key: "any-machine-name", profile: {
    url: "https://example.convex.cloud/", api_key: "test-credential", project_id: "project-id",
  } });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
it("replaces a host symlink with private config and preserves unrelated settings", async () => {
  const host = path.join(dir, "host.toml");
  const original = '[mcp_servers.other]\nurl = "https://other.example/mcp"\n';
  fs.writeFileSync(host, original);
  const home = path.join(dir, "codex-local"); fs.mkdirSync(home);
  const file = path.join(home, "config.toml"); fs.symlinkSync(host, file);
  expect(await configureDevcontainer({ codexHome: home })).toEqual({ configured: true, profile: "any-machine-name" });
  expect(fs.readFileSync(host, "utf8")).toBe(original);
  expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(TOML.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ mcp_servers: {
    other: { url: "https://other.example/mcp" },
    convoy: { url: "https://example.convex.site/api/mcp?project=project-id", http_headers: { Authorization: "Bearer test-credential" } },
  } });
  await configureDevcontainer({ codexHome: home });
  expect(fs.readFileSync(path.join(home, "convoy-domains"), "utf8")).toBe("example.convex.cloud\nexample.convex.site\n");
});
it("leaves no-account containers unchanged", async () => {
  resolve.mockReturnValue({});
  expect(await configureDevcontainer({ codexHome: dir })).toEqual({ configured: false });
  expect(fs.readdirSync(dir)).toEqual([]);
});
it("refuses the host Codex home", async () => {
  await expect(configureDevcontainer({ codexHome: path.join(os.homedir(), ".codex") })).rejects.toThrow("container-private");
});
