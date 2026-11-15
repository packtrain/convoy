import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ docker: vi.fn(), query: vi.fn(), close: vi.fn(), mutation: vi.fn(), select: vi.fn(), input: vi.fn() }));
vi.mock("@inquirer/prompts", () => ({ select: mocks.select, input: mocks.input }));
vi.mock("./docker.js", async importOriginal => ({ ...await importOriginal<typeof import("./docker.js")>(), docker: mocks.docker }));
vi.mock("../../lib/config/convex-client.js", () => ({ createConvexClient: () => ({ query: mocks.query, close: mocks.close, mutation: mocks.mutation }) }));
import { addTargetProject, addTargetProjectGuided } from "./projects.js";
const environment = { schema: 1 as const, name: "demo", owner: "00000000-0000-4000-8000-000000000000", daemon: "engine", version: "0.75.0", deployment: "demo", domains: "" };
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); mocks.docker.mockReset(); });
it("collects input on the host, sends secrets over stdin and registers target paths without host configuration", async () => {
  mocks.query.mockResolvedValue([]); mocks.docker.mockResolvedValue("Registered a.");
  vi.spyOn(console, "log").mockImplementation(() => {});
  await addTargetProject(environment, "a", { url: "https://example.convex.cloud", apiKey: "private-fixture", profileKey: "a", project: "project-id", nonInteractive: true });
  const [args, options] = mocks.docker.mock.calls.find(([args]) => args.includes("-i"))!;
  expect(args).not.toContain("private-fixture");
  expect(JSON.parse(options.input)).toEqual({ directory: "a", options: { url: "https://example.convex.cloud", apiKey: "private-fixture", profileKey: "a", project: "project-id" } });
  expect(mocks.mutation).not.toHaveBeenCalled();
});
it("forwards project creation to the target without creating it on the host", async () => {
  mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ _id: "org", slug: "demo", name: "Demo" }]);
  mocks.docker.mockResolvedValue("Registered a."); vi.spyOn(console, "log").mockImplementation(() => {});
  await addTargetProject(environment, "a", { url: "https://example.convex.cloud", apiKey: "private-fixture", profileKey: "a", create: true, org: "org", projectName: "Demo", projectAlias: "DM", nonInteractive: true });
  expect(JSON.parse(mocks.docker.mock.calls.find(([args]) => args.includes("-i"))![1].input).options).toMatchObject({ create: true, org: "org", projectAlias: "DM" });
  expect(mocks.mutation).not.toHaveBeenCalled();
});
it("asks for the organization in a select that does not wrap around", async () => {
  mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ _id: "org", slug: "demo", name: "Demo" }]);
  mocks.select.mockResolvedValue("org"); mocks.input.mockResolvedValueOnce("Demo").mockResolvedValueOnce("DM");
  mocks.docker.mockResolvedValue("Registered a."); vi.spyOn(console, "log").mockImplementation(() => {});
  const isTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  try {
    await addTargetProject(environment, "a", { url: "https://example.convex.cloud", apiKey: "private-fixture", profileKey: "a", create: true });
  } finally {
    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
  }
  expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ message: "Organization:", loop: false }));
});

it("uses structured guided results without terminal progress or secret arguments", async () => {
  const result = { ok: false, registered: false, applied: false, phase: "preparation", retrySafe: true, projectId: "created" };
  mocks.docker.mockResolvedValueOnce('{"guided":true}').mockResolvedValueOnce("").mockResolvedValueOnce(JSON.stringify(result));
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(await addTargetProjectGuided(environment, "a", { url: "https://example.convex.cloud", apiKey: "secret", profileKey: "a", project: "p" })).toEqual(result);
  const [args, options] = mocks.docker.mock.calls[2];
  expect(JSON.stringify(args)).not.toContain("secret");
  expect(JSON.parse(options.input).guided).toBe(true);
  expect(mocks.docker.mock.calls.every(([, options]) => !options.progress && !options.diagnostics && !options.redact)).toBe(true);
  expect(console.log).not.toHaveBeenCalled();
});
it("retains inputs when allow-domain fails before registration", async () => {
  mocks.docker.mockResolvedValueOnce('{"guided":true}').mockRejectedValueOnce(new Error("private detail"));
  await expect(addTargetProjectGuided(environment, "a", { url: "https://example.convex.cloud", apiKey: "secret", profileKey: "a", project: "p" })).resolves.toMatchObject({ reason: "environment-unavailable", retrySafe: true, registered: false });
  expect(mocks.docker).toHaveBeenCalledTimes(2);
});

it("rejects an incompatible target before sending credentials or starting registration", async () => {
  mocks.docker.mockResolvedValueOnce('{"guided":false}').mockRejectedValueOnce(new Error("Old target rejected guided input"));
  await expect(addTargetProjectGuided(environment, "a", { url: "https://example.convex.cloud", apiKey: "secret", profileKey: "a", project: "p" }))
    .resolves.toMatchObject({ reason: "target-incompatible", retrySafe: true, registered: false });
  expect(mocks.docker).toHaveBeenCalledTimes(1);
  expect(mocks.docker.mock.calls[0][1]?.input).toBeUndefined();
});

it.each(["unreachable", "invalid-json"])("retains inputs when compatibility probe fails: %s", async failure => {
  if (failure === "unreachable") mocks.docker.mockRejectedValueOnce(new Error("unavailable"));
  else mocks.docker.mockResolvedValueOnce("invalid-json");
  await expect(addTargetProjectGuided(environment, "a", { url: "https://example.convex.cloud", apiKey: "secret", profileKey: "a", project: "p" }))
    .resolves.toMatchObject({ reason: "environment-unavailable", retrySafe: true, registered: false });
  expect(mocks.docker).toHaveBeenCalledTimes(1);
});
it("keeps post-launch failures uncertain even after a successful probe", async () => {
  mocks.docker.mockResolvedValueOnce('{"guided":true}').mockResolvedValueOnce("").mockRejectedValueOnce(new Error("lost result"));
  await expect(addTargetProjectGuided(environment, "a", { url: "https://example.convex.cloud", apiKey: "secret", profileKey: "a", project: "p" })).rejects.toThrow("lost result");
});

it("probes the installed schema in a read-only Node process", async () => {
  const result = { ok: true, registered: true, applied: true, phase: "complete", retrySafe: true };
  mocks.docker.mockResolvedValueOnce('{"guided":true}').mockResolvedValueOnce("").mockResolvedValueOnce(JSON.stringify(result));
  await addTargetProjectGuided(environment, "a", { url: "https://example.convex.cloud", apiKey: "secret", profileKey: "a", project: "p" });
  const [args, options] = mocks.docker.mock.calls[0];
  const script = args.at(-1).replace("/opt/convoy/node_modules/@useconvoy/cli/dist/src/commands/environment/validators.js", new URL("./validators.ts", import.meta.url).href);
  expect(options).toEqual({ timeout: 15_000 });
  expect(script).not.toContain("secret");
  const run = (source: string) => promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source]);
  expect(JSON.parse((await run(script)).stdout)).toEqual({ guided: true });
  const legacy = script.replace("const request =", "const legacySchema = setupRequestSchema.omit({guided:true}).extend({options:setupRequestSchema.shape.options.omit({profileName:true})}); const request =")
    .replace("setupRequestSchema.safeParse(request)", "legacySchema.safeParse(request)");
  expect(JSON.parse((await run(legacy)).stdout)).toEqual({ guided: false });
});
