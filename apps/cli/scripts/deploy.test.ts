import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { deploy } from "./deploy.js";

let directory: string, path: string;
const script = (name: string, body: string) => { writeFileSync(join(directory, "bin", name), `#!/bin/sh\n${body}\n`); chmodSync(join(directory, "bin", name), 0o755); };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cv-deploy-")); mkdirSync(join(directory, "bin"));
  // Fake ssh logs each remote command and runs only the shell steps; sudo and npm are fakes too.
  // The remote command arrives wrapped for the login shell; the fake unwraps it first.
  script("print-command", `printf '%s' "$2"`);
  script("ssh", `for last; do :; done\ninner=$(SHELL="${directory}/bin/print-command" /bin/sh -c "$last")
printf '%s\\n' "$inner" >> "${directory}/log"\ncase "$inner" in *"'/bin/sh'"*) exec /bin/sh -c "$inner";; esac`);
  script("sudo", `exec "$@"`);
  script("npm", `cp "$4" "${directory}/installed.tgz"; printf '%s\\n' "$@" > "${directory}/npm"`);
  script("python3", `printf '%s\\n' "$@" > "${directory}/python"`);
  writeFileSync(join(directory, "cli.tgz"), "package");
  path = process.env.PATH!; process.env.PATH = `${join(directory, "bin")}:${path}`;
});
afterEach(() => { process.env.PATH = path; rmSync(directory, { recursive: true, force: true }); });

it("installs the build as root, restarts the service and reports the result", async () => {
  await deploy({ name: "vm", host: "vm" }, join(directory, "cli.tgz"), false);
  expect(readFileSync(join(directory, "installed.tgz"), "utf8")).toBe("package");
  expect(readFileSync(join(directory, "npm"), "utf8")).toMatch(/^install\n--prefix\n\/opt\/convoy\n/);
  const log = readFileSync(join(directory, "log"), "utf8");
  expect(log.match(/'convoy' .*/g)).toEqual(["'convoy' 'service' 'stop'", "'convoy' 'service' 'start' '-b'", "'convoy' '--version'", "'convoy' 'service' 'status'"]);
  expect(existsSync(join(directory, "python"))).toBe(false);
  // The private upload folder is removed after the install.
  expect(existsSync(readFileSync(join(directory, "npm"), "utf8").split("\n")[3])).toBe(false);
});

it("reruns the launcher installer with the saved configuration on request", async () => {
  await deploy({ name: "vm", host: "vm", command: "/opt/convoy/node_modules/.bin/convoy" }, join(directory, "cli.tgz"), true);
  expect(readFileSync(join(directory, "python"), "utf8")).toContain("/etc/convoy-projects.json");
  expect(readFileSync(join(directory, "log"), "utf8")).toContain("'/opt/convoy/node_modules/.bin/convoy' 'service' 'start' '-b'");
});

it("refuses a remote inside a container", async () => {
  await expect(deploy({ name: "box", host: "vm", container: "convoy-dev" }, join(directory, "cli.tgz"), false)).rejects.toThrow("container");
});

it("stops when the install fails and leaves the service stopped", async () => {
  script("npm", "exit 1");
  await expect(deploy({ name: "vm", host: "vm" }, join(directory, "cli.tgz"), false)).rejects.toThrow("Install on vm failed");
  expect(readFileSync(join(directory, "log"), "utf8")).not.toContain("'start'");
});
