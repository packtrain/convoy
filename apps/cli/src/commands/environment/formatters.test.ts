import { expect, it } from "vitest";
import { launcherPrerequisites, prerequisiteFailure, prerequisiteLines } from "./formatters.js";
import type { LauncherFacts } from "./validators.js";

const ready: LauncherFacts = { bwrap: "/usr/bin/bwrap", apparmor: false, node: "/usr/bin/node", nodeRootOwned: true, cli: "/opt/convoy/node_modules/@useconvoy/cli", cliRootOwned: true };
const fixes = (facts: Partial<LauncherFacts>) => launcherPrerequisites({ ...ready, ...facts }, "1.2.3").filter(check => check.fix).map(check => check.fix);

it("passes every prerequisite on a prepared machine", () => {
  expect(fixes({})).toEqual([]);
  expect(prerequisiteLines(launcherPrerequisites(ready))).toEqual(["✓ bubblewrap installed", "✓ Unprivileged user namespaces allowed", "✓ Root-owned Node outside home folders", "✓ Convoy CLI under /opt/convoy"]);
});

it("names the fix for each missing prerequisite", () => {
  expect(fixes({ bwrap: undefined })).toEqual([expect.stringContaining("apt-get install bubblewrap"), expect.stringContaining("Install bubblewrap")]);
  expect(fixes({ userns: "bwrap: setting up uid map: Permission denied", apparmor: true })).toEqual([expect.stringMatching(/^Ubuntu's AppArmor stops bubblewrap .*sandbox.*isolated-projects#ubuntu-apparmor-prerequisite/)]);
  expect(fixes({ userns: "bwrap: No permissions to create new namespace" })).toEqual([expect.stringContaining("kernel.unprivileged_userns_clone")]);
  expect(fixes({ node: "/home/me/.nvm/versions/node/v22.0.0/bin/node" })).toEqual([expect.stringContaining("under a user home or nvm")]);
  expect(fixes({ node: "/root/node/bin/node" })).toEqual([expect.stringContaining("under a user home or nvm")]);
  expect(fixes({ nodeRootOwned: false })).toEqual([expect.stringContaining("not root-owned")]);
  expect(fixes({ cli: "/home/me/.npm-global/lib/node_modules/@useconvoy/cli" })).toEqual([expect.stringContaining("sudo npm install --prefix /opt/convoy @useconvoy/cli@1.2.3")]);
  expect(fixes({ cliRootOwned: false })).toEqual([expect.stringContaining("/opt/convoy")]);
  expect(prerequisiteLines(launcherPrerequisites({ ...ready, bwrap: undefined }))[0]).toMatch(/^✗ bubblewrap installed: /);
});

it("says nothing changed and where the help for each item is", () => {
  expect(prerequisiteFailure("run the same command again")).toBe("Nothing was installed, and this machine is still shared. Fix each ✗ item, then run the same command again. Help for each item: https://docs.convoy.build/docs/cli/troubleshooting#isolated-mode-prerequisites");
});
