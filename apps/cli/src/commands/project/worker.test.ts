import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { projectIdentity } from "./validators.js";
const mocks = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn(), profile: vi.fn(), connect: vi.fn() }));
vi.mock("../../lib/config/convex-client.js", () => ({ createConvexClient: () => ({ query: mocks.query, close: mocks.close }) }));
vi.mock("../../lib/config/toml.js", () => ({ setProfile: mocks.profile }));
vi.mock("../connect/workflow.js", () => ({ runConnect: mocks.connect }));
import { runProjectWorker } from "./worker.js";
const config = { convexUrl: "https://example.com", apiKey: "secret-value", projectId: "a", organizationId: "org", profileKey: "a", paths: ["/workspace/a"], projectIdentity: projectIdentity("https://example.com", "org", "a") };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CONVOY_PROJECT_IDENTITY", config.projectIdentity);
  vi.spyOn(process, "getuid").mockReturnValue(20001);
  mocks.query.mockResolvedValue({ kind: "organization", organizationId: "org", projectIds: ["a"] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("starts on a framed config, forwards flags, and requests shutdown on EOF", async () => {
  const input = new PassThrough();
  mocks.connect.mockImplementation(async ({ shutdownSignal }) => {
    await new Promise<void>((resolve) => shutdownSignal.addEventListener("abort", () => resolve(), { once: true }));
  });
  const running = runProjectWorker(input);
  const outcome = running.catch((error) => error);
  input.write(JSON.stringify({ ...config, connectionName: "vm-a", force: true }) + "\n");
  try {
    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalled());
    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ connectionName: "vm-a", force: true, nonInteractive: true }));
  } finally { input.end(); await outcome; }
  expect(mocks.connect.mock.calls[0][0].shutdownSignal.aborted).toBe(true);
});

it("redacts malformed configuration", async () => {
  const input = new PassThrough();
  const result = runProjectWorker(input);
  input.end("not-json secret-value\n");
  await expect(result).rejects.toThrow("Invalid isolated worker configuration");
});

it("identifies scope verification failures without leaking backend error text", async () => {
  mocks.query.mockRejectedValue(new Error("server echoed secret-value"));
  const input = new PassThrough();
  const result = runProjectWorker(input);
  const outcome = result.catch((error: Error) => error);
  input.write(JSON.stringify(config) + "\n");
  // EOF must not be needed to verify startup configuration.
  await vi.waitFor(() => expect(mocks.query).toHaveBeenCalled());
  input.end();
  expect((await outcome as Error).message).toBe("Project scope verification failed. Check the project-scoped API key and backend currentScope query.");
});

it("hands an AWS credential to Codex as its provider, never as managed OpenAI auth (OS-2107)", async () => {
  const input = new PassThrough();
  mocks.connect.mockResolvedValue(undefined);
  const running = runProjectWorker(input);
  input.write(JSON.stringify({ ...config, codexAuth: { mode: "mantle", secret: "aws-token", region: "eu-west-1" } }) + "\n");
  await running;
  const call = mocks.connect.mock.calls[0][0];
  expect(call.codexProvider).toEqual({ provider: "mantle", token: "aws-token", region: "eu-west-1" });
  expect(call.codexAuth).toBeUndefined();
});

it("hands a Claude Code credential to the runner only, never to the worker env (OS-2108)", async () => {
  const input = new PassThrough();
  mocks.connect.mockResolvedValue(undefined);
  const running = runProjectWorker(input);
  const claudeAuth = { mode: "bedrock", secret: "aws-token", region: "us-west-2" };
  input.write(JSON.stringify({ ...config, claudeAuth }) + "\n");
  await running;
  expect(mocks.connect.mock.calls[0][0].claudeAuth).toEqual(claudeAuth);
  expect(JSON.stringify(process.env)).not.toContain("aws-token");
});

it("hands a Cursor key to the runner only, never to the worker env (OS-2017)", async () => {
  const input = new PassThrough();
  mocks.connect.mockResolvedValue(undefined);
  const running = runProjectWorker(input);
  const cursorAuth = { mode: "managed", secret: "cursor-key" };
  input.write(JSON.stringify({ ...config, cursorAuth }) + "\n");
  await running;
  expect(mocks.connect.mock.calls[0][0].cursorAuth).toEqual(cursorAuth);
  expect(JSON.stringify(process.env)).not.toContain("cursor-key");
});

it("hands OpenCode keys to the runner only, never to the worker env (OS-2018)", async () => {
  const input = new PassThrough();
  mocks.connect.mockResolvedValue(undefined);
  const running = runProjectWorker(input);
  const opencodeAuth = { mode: "managed", keys: { openai: "opencode-openai-key" } };
  input.write(JSON.stringify({ ...config, opencodeAuth }) + "\n");
  await running;
  expect(mocks.connect.mock.calls[0][0].opencodeAuth).toEqual(opencodeAuth);
  expect(JSON.stringify(process.env)).not.toContain("opencode-openai-key");
});

it("runs a shared frame without the Linux boundary or a private profile write, with any key that sees the project", async () => {
  vi.stubEnv("CONVOY_PROJECT_IDENTITY", "");
  mocks.query.mockResolvedValue({ kind: "organization", organizationId: "org", projectIds: [] });
  mocks.connect.mockResolvedValue(undefined);
  const input = new PassThrough();
  const running = runProjectWorker(input);
  input.write(JSON.stringify({ ...config, mode: "shared" }) + "\n");
  await running;
  expect(mocks.profile).not.toHaveBeenCalled();
  expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ leaseHolder: "service", paths: ["/workspace/a"], nonInteractive: true }));
  expect(mocks.connect.mock.calls[0][0]).not.toHaveProperty("mode");
});

it("still requires the Linux boundary and a one-project key for an isolated frame", async () => {
  vi.stubEnv("CONVOY_PROJECT_IDENTITY", "");
  const input = new PassThrough();
  const result = runProjectWorker(input);
  input.write(JSON.stringify(config) + "\n");
  await expect(result).rejects.toThrow("does not match the Linux boundary");
});

it("refuses a shared key that cannot see the project", async () => {
  vi.stubEnv("CONVOY_PROJECT_IDENTITY", "");
  mocks.query.mockResolvedValue({ kind: "organization", organizationId: "other", projectIds: [] });
  const input = new PassThrough();
  const result = runProjectWorker(input);
  input.write(JSON.stringify({ ...config, mode: "shared" }) + "\n");
  await expect(result).rejects.toThrow("Project scope verification failed");
  expect(mocks.connect).not.toHaveBeenCalled();
});
