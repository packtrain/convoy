export type Run = {
  id: string;
  task: string;
  title: string;
  profile: string;
  runtime: string;
  status: "running" | "waiting" | "queued" | "completed" | "failed" | "canceled";
  elapsed: string;
  activity: string;
};

export const RUNS: Run[] = [
  { id: "r-104", task: "OS-1997", title: "Build the terminal run browser", profile: "convoy", runtime: "Codex", status: "running", elapsed: "4m 12s", activity: "Reading the service event contract" },
  { id: "r-103", task: "WEB-82", title: "Add keyboard navigation to search", profile: "website", runtime: "Claude Code", status: "running", elapsed: "2m 08s", activity: "Running search navigation tests" },
  { id: "r-102", task: "OS-2048", title: "Update the deployment workflow", profile: "convoy", runtime: "Codex", status: "waiting", elapsed: "6m 31s", activity: "Approval required · continue in the web app" },
  { id: "r-101", task: "WEB-86", title: "Check the mobile navigation", profile: "website", runtime: "OpenCode", status: "queued", elapsed: "—", activity: "Waiting for an available worker" },
  { id: "r-100", task: "Unlinked", title: "Explain the workspace layout", profile: "convoy", runtime: "Cursor", status: "completed", elapsed: "38s", activity: "Workspace summary ready" },
  { id: "r-099", task: "OS-1997", title: "Explore the service event contract", profile: "convoy", runtime: "Codex", status: "completed", elapsed: "1m 46s", activity: "Investigation complete · earlier run" },
  { id: "r-098", task: "WEB-79", title: "Investigate the failing build", profile: "website", runtime: "Claude Code", status: "failed", elapsed: "12s", activity: "Authentication required · sign in and retry" },
];

export const HISTORY = [
  { sequence: 1, type: "message", role: "user", content: "Build a keyboard-driven run browser. Keep the service headless." },
  { sequence: 2, type: "notification", method: "item/started", params: { item: { id: "item-01", type: "agentMessage", text: "I'll check the existing service contract." } } },
  { sequence: 3, type: "notification", method: "item/commandExecution/outputDelta", params: { itemId: "item-02", delta: "Snapshot, history and event subscription types.\n", stream: "stdout" } },
  { sequence: 4, type: "notification", method: "item/completed", params: { item: { id: "item-02", type: "commandExecution", command: "pnpm test service", exitCode: 0, aggregatedOutput: "✓ snapshot ordering\n✓ event cursor replay\n✓ cancellation identity\n3 tests passed" } } },
  { sequence: 5, type: "notification", method: "item/agentMessage/delta", params: { itemId: "item-03", delta: "Next I'll check how history pagination behaves while new events arrive." } },
];

export const ENVIRONMENTS = [
  {
    id: "test", workspaceRoot: "/workspace", transport: "Docker", address: "local / convoy-test",
    clientVersion: "0.83.0", serviceVersion: "0.83.0", concurrency: 5,
    isolated: false, instance: "6f650ece…", uptime: "24m", latency: "8ms",
    runtimes: "claude-code@2.1.281 · opencode@1.18.18 · cursor@2026.08.11-e8db854 · codex@0.156.1",
    profiles: [
      { id: "convoy", key: "os-devcontainer-sandbox", name: "Convoy Sandbox (dev)", endpoint: "https://happy-otter-123.convex.cloud", project: "jn7fixtureproject0000000000000000", path: "/workspace/sandbox/playground", skill: false },
      { id: "website", key: "website-dev", name: "Website (dev)", endpoint: "https://website-demo.convex.cloud", project: "sample-website-project", path: "/workspace/website", skill: true },
    ],
  },
  {
    id: "build-vm", workspaceRoot: "/srv/convoy-workspaces", transport: "SSH", address: "ubuntu@convoy-build · private service socket",
    clientVersion: "0.83.0", serviceVersion: "0.82.1", concurrency: 3,
    isolated: true, instance: "b8732ab1…", uptime: "2h 18m", latency: "42ms",
    runtimes: "claude-code@2.1.281 · codex@0.156.1",
    profiles: [
      { id: "convoy", key: "convoy-remote", name: "Convoy on build VM", endpoint: "https://happy-otter-123.convex.cloud", project: "jn7fixtureproject0000000000000000", path: "/srv/convoy-workspaces/convoy", skill: true },
      { id: "website", key: "website-remote", name: "Website on build VM", endpoint: "https://website-demo.convex.cloud", project: "sample-website-project", path: "/srv/convoy-workspaces/website", skill: true },
    ],
  },
];

export type Environment = typeof ENVIRONMENTS[number];
export const REMOTE_RUNS: Run[] = [
  { ...RUNS[0], id: "vm-201", task: "OS-2051", title: "Check the deployment on the build VM", elapsed: "12m 04s", activity: "Inspecting deployment logs on the remote workspace" },
  { ...RUNS[3], id: "vm-202", title: "Run the website smoke tests" },
];

export type Credential = { name: string; provider: string; auth: string; revision: number; disabled: boolean; assigned: string[]; delivery?: Record<string, "applied" | "pending reconnect" | "failed"> };
export const SAMPLE_CREDENTIALS: Credential[] = [{ name: "work-openai", provider: "OpenAI", auth: "API key", revision: 1, disabled: false, assigned: [] }];
