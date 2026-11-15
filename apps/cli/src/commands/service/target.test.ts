import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ logs: vi.fn(), request: vi.fn() }));
vi.mock("../environment/index.js", () => ({ targetEnvironment: () => ({ name: "demo" }), targetCommands: { operationalLogs: mocks.logs } }));
vi.mock("./client.js", () => ({ serviceRequest: mocks.request, serviceEndpoint: () => "/target" }));
import { serviceCommand } from "./command.js";
import { ServiceUnavailableError } from "./errors.js";
afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; });
it("reads retained target logs when the target service is stopped", async () => {
  mocks.request.mockRejectedValue(new ServiceUnavailableError("Service unavailable"));
  mocks.logs.mockResolvedValue([{ seq: 1, ts: 0, profile: "a", message: "retained event" }]);
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await serviceCommand.commands.find(c => c.name() === "logs")!.parseAsync([], { from: "user" });
  expect(output).toHaveBeenCalledWith("1970-01-01T00:00:00.000Z [a] retained event");
  expect(process.exitCode).toBeUndefined();
});
