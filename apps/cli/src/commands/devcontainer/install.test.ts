import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TEMPLATE_FILES,
  convexFirewallHint,
  installDevcontainerTemplate,
} from "./install.js";

const failingFetch: typeof fetch = () =>
  Promise.reject(new Error("network unreachable"));

describe("convexFirewallHint", () => {
  it("extracts the deployment slug from Convex cloud URLs", () => {
    expect(convexFirewallHint("https://happy-otter-123.convex.cloud")).toEqual({
      kind: "deployment",
      value: "happy-otter-123",
    });
    expect(convexFirewallHint("https://happy-otter-123.convex.site")).toEqual({
      kind: "deployment",
      value: "happy-otter-123",
    });
  });

  it("returns the hostname for self-hosted backends", () => {
    expect(convexFirewallHint("https://convex.mycompany.com:3210")).toEqual({
      kind: "domain",
      value: "convex.mycompany.com",
    });
  });

  it("returns null for localhost and invalid URLs", () => {
    expect(convexFirewallHint("http://127.0.0.1:3210")).toBeNull();
    expect(convexFirewallHint("https://backend.convoy.localhost")).toBeNull();
    expect(convexFirewallHint("not a url")).toBeNull();
  });
});

describe("installDevcontainerTemplate", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "convoy-devc-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("ships portable profile selection and Convoy setup in both containers", () => {
    for (const relative of [".devcontainer/devcontainer.json", "templates/devcontainer/devcontainer.json"]) {
      const source = fs.readFileSync(path.join(import.meta.dirname, "../../../../../", relative), "utf8");
      expect(source).not.toContain('"CONVOY_PROFILE": "os-devcontainer"');
      expect(source).toContain('"CONVOY_PROFILE": "${localEnv:CONVOY_PROFILE}"');
      expect(source).toContain('"CONVOY_HOST_WORKSPACE": "${localWorkspaceFolder}"');
      expect(source).toContain("@useconvoy/cli@latest");
      expect(source).toContain("convoy devcontainer --configure");
    }
  });

  it("keeps the template's Convoy state in private container volumes, not the host config", () => {
    const root = path.join(import.meta.dirname, "../../../../../templates/devcontainer");
    const json = fs.readFileSync(path.join(root, "devcontainer.json"), "utf8");
    expect(json).not.toContain("${localEnv:HOME}/.config/convoy");
    expect(json).toContain("target=/home/node/.config/convoy,type=volume");
    expect(json).toContain("target=/home/node/.convoy,type=volume");
    // Volumes copy the image folder's owner and mode; config and service state refuse anything wider than 0700.
    expect(fs.readFileSync(path.join(root, "Dockerfile"), "utf8")).toMatch(/chmod 700 \/home\/node\/\.config\/convoy \/home\/node\/\.convoy/);
  });

  it("builds on the runtimes' Node and installs OpenCode with its own script, like the repo container", () => {
    const root = path.join(import.meta.dirname, "../../../../../");
    const dockerfile = fs.readFileSync(path.join(root, "templates/devcontainer/Dockerfile"), "utf8");
    const json = fs.readFileSync(path.join(root, "templates/devcontainer/devcontainer.json"), "utf8");
    // Claude Code needs Node 22; npm's opencode-ai postinstall picks the musl binary on arm64 glibc.
    expect(dockerfile).toMatch(/^FROM node:22$/m);
    expect(json).not.toContain("opencode-ai@latest");
    expect(json).toContain("curl -fsSL https://opencode.ai/install | bash");
    // The service starts from postStartCommand, which reads no shell rc file.
    expect(dockerfile).toContain("ENV PATH=$PATH:/home/node/.local/bin:/home/node/.opencode/bin");
    // The ~/.local/share/opencode bind mount would otherwise create ~/.local as root and break the Cursor installer.
    expect(dockerfile).toMatch(/mkdir -p [^\n]*\/home\/node\/\.local\/share \/home\/node\/\.local\/bin/);
  });

  it("starts the project service with every container start, after the firewall, without blocking startup", () => {
    const root = path.join(import.meta.dirname, "../../../../../templates/devcontainer");
    const start = JSON.parse(fs.readFileSync(path.join(root, "devcontainer.json"), "utf8").replace(/^\s*\/\/.*$/gm, "")).postStartCommand as string;
    // Even with no projects yet, so a later project add connects live instead of needing a manual start.
    expect(start).toMatch(/init-firewall\.sh;.*fi; convoy service start -b \|\| echo "WARN: .*" >&2$/);
  });

  it("ships standalone browser tooling independently of the CLI package", async () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../../package.json"), "utf8"));
    expect(packageJson.dependencies).not.toHaveProperty("playwright");
    const pins = new Set<string>();
    for (const relative of [".devcontainer/Dockerfile", "templates/devcontainer/Dockerfile", "templates/project-isolation/Dockerfile"]) {
      const source = fs.readFileSync(path.join(import.meta.dirname, "../../../../../", relative), "utf8");
      pins.add(source.match(/^ARG PLAYWRIGHT_CLI_VERSION=(\S+)$/m)?.[1] ?? relative);
      expect(source).toContain("@playwright/cli@${PLAYWRIGHT_CLI_VERSION}");
      // One image browser; repo scripts reach it through config.json instead of a second cache.
      expect(source).not.toContain("convoy-browsers");
      expect(source).not.toMatch(/chown -R node:node \/usr\/local\/share\s/);
      expect(source).toContain("/usr/local/share/playwright-cli/config.json");
      expect(source).not.toContain("/opt/convoy/node_modules/.bin/playwright");
    }
    expect(pins.size).toBe(1);
    const projects = await installDevcontainerTemplate({ projectDir, projects: true, fetchImpl: failingFetch });
    expect(JSON.parse(fs.readFileSync(path.join(projects.targetDir, "devcontainer.json"), "utf8")).build.args.CONVOY_VERSION).toBe(packageJson.version);
  });

  it("warns at start when the image predates the checked-out Dockerfile", async () => {
    const single = await installDevcontainerTemplate({ projectDir, fetchImpl: failingFetch });
    const repo = path.join(import.meta.dirname, "../../../../../.devcontainer");
    for (const dir of [single.targetDir, repo]) {
      expect(fs.readFileSync(path.join(dir, "Dockerfile"), "utf8")).toContain("COPY Dockerfile /usr/local/share/convoy-devcontainer/Dockerfile");
      expect(fs.readFileSync(path.join(dir, "devcontainer.json"), "utf8"))
        .toContain("cmp -s /usr/local/share/convoy-devcontainer/Dockerfile .devcontainer/Dockerfile");
    }
  });

  it("installs the parent workspace template with private state and no host auth mounts", async () => {
    const result = await installDevcontainerTemplate({ projectDir, projects: true, fetchImpl: failingFetch });
    const config = JSON.parse(fs.readFileSync(path.join(result.targetDir, "devcontainer.json"), "utf8"));
    expect(config.workspaceMount).toBe("source=${localWorkspaceFolder},target=/workspace,type=bind");
    expect(config.mounts.join(" ")).not.toContain("localEnv:HOME");
    expect(config.mounts.join(" ")).toContain("/var/lib/convoy-projects");
    for (const name of ["launcher.py", "install.py", "start.sh", "init-firewall.sh"]) {
      expect(result.files).toContain(name);
    }
  });

  it("fetches the same project template files and shared firewall from GitHub", async () => {
    const requests: string[] = [];
    const result = await installDevcontainerTemplate({ projectDir, projects: true, fetchImpl: async (url) => {
      requests.push(String(url));
      return new Response("content");
    } });
    expect(result.source).toBe("github");
    expect(requests.some((url) => url.endsWith("/project-isolation/launcher.py"))).toBe(true);
    expect(requests.some((url) => url.endsWith("/devcontainer/init-firewall.sh"))).toBe(true);
  });

  it("falls back to the bundled template when GitHub is unreachable", async () => {
    const result = await installDevcontainerTemplate({
      projectDir,
      fetchImpl: failingFetch,
    });

    expect(result.source).toBe("bundled");
    for (const file of TEMPLATE_FILES) {
      expect(fs.existsSync(path.join(projectDir, ".devcontainer", file))).toBe(
        true
      );
    }
    const stat = fs.statSync(
      path.join(projectDir, ".devcontainer", "init-firewall.sh")
    );
    expect(stat.mode & 0o111).not.toBe(0);
  });

  it("uses GitHub contents when the fetch succeeds", async () => {
    const okFetch: typeof fetch = (input) =>
      Promise.resolve(
        new Response(`remote content for ${String(input)}`, { status: 200 })
      );

    const result = await installDevcontainerTemplate({
      projectDir,
      fetchImpl: okFetch,
    });

    expect(result.source).toBe("github");
    const dockerfile = fs.readFileSync(
      path.join(projectDir, ".devcontainer", "Dockerfile"),
      "utf8"
    );
    expect(dockerfile).toContain("remote content for");
    expect(dockerfile).toContain("templates/devcontainer/Dockerfile");
  });

  it("refuses to overwrite an existing .devcontainer without force", async () => {
    fs.mkdirSync(path.join(projectDir, ".devcontainer"));

    await expect(
      installDevcontainerTemplate({ projectDir, fetchImpl: failingFetch })
    ).rejects.toThrow(/already exists/);
  });

  it("overwrites an existing .devcontainer with force", async () => {
    const targetDir = path.join(projectDir, ".devcontainer");
    fs.mkdirSync(targetDir);
    fs.writeFileSync(path.join(targetDir, "Dockerfile"), "old");

    const result = await installDevcontainerTemplate({
      projectDir,
      force: true,
      fetchImpl: failingFetch,
    });

    expect(result.source).toBe("bundled");
    expect(
      fs.readFileSync(path.join(targetDir, "Dockerfile"), "utf8")
    ).not.toBe("old");
  });
});

it("both firewalls consume the selected profile's backend hosts", () => {
  for (const dir of [".devcontainer", "templates/devcontainer"]) {
    const root = path.join(import.meta.dirname, "../../../../../", dir);
    const firewall = fs.readFileSync(path.join(root, "init-firewall.sh"), "utf8");
    expect(firewall).toContain('add_convoy_domains');
    expect(fs.readFileSync(path.join(root, "Dockerfile"), "utf8")).toMatch(/env_keep.*CODEX_HOME/);
  }
});
