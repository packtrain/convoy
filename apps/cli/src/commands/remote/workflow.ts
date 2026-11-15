import { ServiceClient } from "../service/client.js";
import { logSchema } from "../service/validators.js";
import { sshBridge, sshForward, sshRun } from "./ssh.js";
import type { Remote } from "./validators.js";
import { projectAddResultSchema, projectCheckSchema, projectAccountsSchema, unavailableProjectResult, type LoginRuntime, type ProjectAddResult } from "../project/validators.js";
import type { ProjectAddOptions } from "../project/workflow.js";
import { managedCredentialStatusSchema } from "../../lib/config/credentials/validators.js";

/** TUI operations for a saved remote; each one is a single SSH command. */
export function remoteTarget(remote: Remote) {
  const checkProject = async () => {
    const client = await ServiceClient.open(sshBridge(remote));
    try { return Boolean(client.hello?.capabilities?.includes("project-setup-v1")); } finally { client.close(); }
  };
  return {
    checkProject,
    addProject: async (directory: string, options: ProjectAddOptions): Promise<ProjectAddResult> => {
      try { if (!await checkProject()) return { ...unavailableProjectResult(), reason: "target-incompatible" }; }
      catch { return unavailableProjectResult(); }
      // The request, API key included, travels on stdin, never in argv. Spec: docs/specs/cli-remote.md#guided-add-project-and-credentials-cli-01130-os-2158
      const output = await sshRun(remote, ["project", "setup"], 360_000, JSON.stringify({ guided: true, directory, options }));
      return projectAddResultSchema.parse(JSON.parse(output.split("\n").at(-1) ?? ""));
    },
    credentials: { status: async () => managedCredentialStatusSchema.parse(JSON.parse(await sshRun(remote, ["keys", "status", "--json"]))) },
    open: (signal: AbortSignal) => ServiceClient.open(sshBridge(remote), signal),
    start: async () => { await sshRun(remote, ["service", "start", "-b"], 60_000); },
    savedLogs: async (after: number, profile?: string) => {
      const output = await sshRun(remote, ["service", "logs", "--json", ...(profile ? ["--profile", profile] : [])]);
      const retained = output ? output.split("\n").map(line => logSchema.parse(JSON.parse(line))) : [];
      const entries = retained.filter(entry => entry.seq > after).slice(0, 100);
      return { entries, cursor: entries.at(-1)?.seq ?? after, gap: after > 0 && after < (retained[0]?.seq ?? 1) - 1 };
    },
    account: async (profile: string, identity: string) => projectAccountsSchema.parse(JSON.parse(await sshRun(remote, ["project", "account", profile, "--expected-identity", identity], 25_000))),
    check: async (profile: string) => projectCheckSchema.parse(JSON.parse(await sshRun(remote, ["project", "check", profile, "--json"], 120_000))),
    shell: async (profile: string, identity: string | undefined, signal?: AbortSignal, login?: LoginRuntime) => {
      const code = await sshForward(remote, ["project", "shell", profile, ...(identity ? ["--expected-identity", identity] : []), ...(login ? ["--login", login] : [])], signal);
      if (code !== 0) throw new Error(`${login ? "Runtime login" : "Project shell"} exited with status ${code}.`);
    },
  };
}
