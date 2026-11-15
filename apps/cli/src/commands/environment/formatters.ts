import { getCliVersion } from "../../lib/version.js";
import type { LauncherFacts, Prerequisite } from "./validators.js";

/** Spec: docs/specs/cli-tui.md#environment-mode-cli-01270-os-2242 */
export const MODE_COPY = {
  shared: "Shared: one account and home folder for every project. Log in to GitHub, git and each runtime once. Projects can read each other's files.",
  isolated: "Isolated: a separate Linux account, sandbox and home per project. Log in per project. Needed when projects must not see each other.",
};

const underHome = (path: string) => /^\/(home|root)(\/|$)/.test(path) || path.split("/").includes(".nvm");

/** Isolated mode's prerequisites, each with its fix when missing. Spec: docs/specs/cli-shared-environments.md#choosing-the-mode-on-local-and-ssh-targets */
export function launcherPrerequisites(facts: LauncherFacts, version = getCliVersion()): Prerequisite[] {
  return [
    { name: "bubblewrap installed", fix: facts.bwrap ? undefined : "Install it: sudo apt-get install bubblewrap" },
    { name: "Unprivileged user namespaces allowed", fix: !facts.bwrap ? "Install bubblewrap, then check again." : facts.userns === undefined ? undefined
      : facts.apparmor ? `Ubuntu's AppArmor stops bubblewrap from creating the user namespaces the project sandbox needs (${facts.userns}). Allow it with a bwrap AppArmor profile: https://docs.convoy.build/docs/cli/isolated-projects#ubuntu-apparmor-prerequisite`
      : `bubblewrap cannot create a user namespace (${facts.userns}). Allow unprivileged user namespaces, for example with sudo sysctl -w kernel.unprivileged_userns_clone=1.` },
    { name: "Root-owned Node outside home folders", fix: underHome(facts.node) ? `${facts.node} is under a user home or nvm, which projects can't see. Install Node 22 system-wide, for example under /usr/local/bin, and put it first on PATH.`
      : facts.nodeRootOwned ? undefined : `${facts.node} or a parent folder is not root-owned, or others can write to it. Use a root-owned system Node.` },
    { name: "Convoy CLI under /opt/convoy", fix: facts.cli.startsWith("/opt/convoy/") && facts.cliRootOwned ? undefined
      : `Convoy runs from ${facts.cli}. Install it with sudo npm install --prefix /opt/convoy @useconvoy/cli@${version}, put /opt/convoy/node_modules/.bin first on PATH, and run that convoy.` },
  ];
}

export function prerequisiteLines(checks: Prerequisite[]) {
  return checks.map(check => check.fix ? `✗ ${check.name}: ${check.fix}` : `✓ ${check.name}`);
}

/** Shown under failed checks; `retry` names how to check again here. */
export function prerequisiteFailure(retry: string) {
  return `Nothing was installed, and this machine is still shared. Fix each ✗ item, then ${retry}. Help for each item: https://docs.convoy.build/docs/cli/troubleshooting#isolated-mode-prerequisites`;
}
