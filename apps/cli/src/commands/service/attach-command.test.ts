import { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ open: vi.fn(), request: vi.fn(), close: vi.fn(), delays: [] as number[] }));
vi.mock("./client.js", () => ({ serviceEndpoint: () => "/test", ServiceClient: { open: mocks.open } }));
vi.mock("./paths.js", () => ({ servicePaths: () => ({ socket: "/test" }) }));
import { addServiceClients, attachCommand } from "./attach.js";
import { ServiceTransportError } from "./errors.js";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); process.exitCode = undefined; mocks.open.mockReset(); mocks.request.mockReset(); mocks.delays.length = 0; });
it("reports a readable invalid page size before connecting", async () => {
  const command = new Command("service");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  command.exitOverride(); command.configureOutput({ writeErr: text => console.error(text) }); addServiceClients(command);
  await command.parseAsync(["runs", "list", "--profile", "a", "--limit", "abc"], { from: "user" }).catch(() => {});
  expect(error.mock.calls.flat().join(" ")).toContain("Page size must be an integer from 1 to 50");
  expect(mocks.open).not.toHaveBeenCalled();
});
it("backs off idle follow polls while fetching available pages immediately", async () => {
  const command = new Command("service"); addServiceClients(command);
  mocks.open.mockResolvedValue({ request: mocks.request, close: mocks.close });
  mocks.request.mockResolvedValueOnce({ result: { page: [], cursor: -1, hasMore: false, run: { status: "streaming" } } })
    .mockResolvedValueOnce({ result: { page: [], cursor: -1, hasMore: false, run: { status: "streaming" } } })
    .mockResolvedValueOnce({ result: { page: [], cursor: -1, hasMore: false, run: { status: "completed" } } });
  vi.useFakeTimers();
  const original = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms: number) => { mocks.delays.push(ms); return original(callback, ms); }) as typeof setTimeout);
  const running = command.parseAsync(["runs", "logs", "thread", "--profile", "a", "--message", "message", "--follow"], { from: "user" });
  await vi.runAllTimersAsync(); await running;
  expect(mocks.delays).toEqual([1000, 2000]);
});

it("stops instead of retrying when the transport fails before the first connection", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.open.mockRejectedValue(new ServiceTransportError("SSH to vm failed: Host key verification failed."));
  const running = attachCommand.parseAsync([], { from: "user" });
  await new Promise(resolve => setTimeout(resolve, 1500));
  process.emit("SIGINT"); await running;
  expect(mocks.open).toHaveBeenCalledOnce(); expect(process.exitCode).toBe(1);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("Host key verification failed."));
});
