/** Dev only: install an unpublished CLI build on a saved remote. Docs: docs/agents/publishing-the-cli.md#deploying-a-build-to-a-remote */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRemote } from "../src/commands/remote/paths.js";
import { sshArgs, sshForward } from "../src/commands/remote/ssh.js";
import type { Remote } from "../src/commands/remote/validators.js";

// Reruns install.py with the arguments its saved configuration came from.
const LAUNCHER = `import json, pwd, subprocess, sys
c = json.load(open("/etc/convoy-projects.json"))
sys.exit(subprocess.call([sys.executable, "-I", c["package_root"] + "/dist/templates/project-isolation/install.py",
  "--control-user", pwd.getpwuid(c["control_uid"]).pw_name, "--workspace", c["workspace"],
  "--package-root", c["package_root"], "--node", c["node"], "--state", c["state"]]))`;

export async function deploy(remote: Remote, tarball: string, launcher: boolean) {
  if (remote.container) throw new Error(`Remote ${remote.name} runs Convoy in a container. Rebuild that environment instead.`);
  const shell = { ...remote, command: "/bin/sh" };
  // A private mktemp folder, because root installs whatever file sits at this path.
  const upload = spawnSync("ssh", sshArgs(shell, ["-c", 'd=$(mktemp -d) && cat > "$d/cli.tgz" && printf "convoy-upload:%s\\n" "$d"']),
    { input: readFileSync(tarball), encoding: "utf8" });
  const folder = /^convoy-upload:(\/.+)$/m.exec(upload.stdout ?? "")?.[1];
  if (upload.status !== 0 || !folder) throw new Error(`Upload to ${remote.name} failed: ${upload.stderr?.trim() || `ssh exited with status ${upload.status}`}.`);
  if (await sshForward(remote, ["service", "stop"])) console.log("Service stop failed; continuing in case it was not running.");
  const install = `sudo npm install --prefix /opt/convoy "$1"${launcher ? ' && sudo python3 -I -c "$2"' : ""}; s=$?; rm -rf "$(dirname "$1")"; exit $s`;
  if (await sshForward(shell, ["-c", install, "sh", `${folder}/cli.tgz`, LAUNCHER])) throw new Error(`Install on ${remote.name} failed. Its service is stopped; fix the install and rerun.`);
  for (const args of [["service", "start", "-b"], ["--version"], ["service", "status"]]) {
    if (await sshForward(remote, args)) throw new Error(`convoy ${args.join(" ")} failed on ${remote.name}.`);
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const [name, ...flags] = process.argv.slice(2).filter(arg => arg !== "--");
  const cli = dirname(dirname(fileURLToPath(import.meta.url))), out = mkdtempSync(join(tmpdir(), "convoy-deploy-"));
  try {
    if (!name || flags.some(flag => flag !== "--launcher")) throw new Error("Usage: pnpm cli:deploy <remote> [--launcher]");
    const remote = readRemote(name);
    execFileSync("pnpm", ["run", "build"], { cwd: cli, stdio: "inherit" });
    execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", out], { cwd: cli, stdio: "inherit" });
    await deploy(remote, join(out, readdirSync(out)[0]), flags.includes("--launcher"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  } finally { rmSync(out, { recursive: true, force: true }); }
}
