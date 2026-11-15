import { beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
const mocks = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn(), client: vi.fn(), http: vi.fn() }));
vi.mock("../../../lib/config/convex-client.js", () => ({ createConvexClient: mocks.client, createConvexHttpClient: mocks.http }));
import { savedDeploymentUrls, loadChoices, validateForm } from "./workflow.js";
beforeEach(() => { vi.clearAllMocks(); mocks.client.mockReturnValue({ query: mocks.query, close: mocks.close }); mocks.http.mockReturnValue({ query: mocks.query }); });
it("loads actual choices with the bounded HTTP client", async () => {
  mocks.query.mockImplementation(async ref => getFunctionName(ref).startsWith("projects/") ? [{ _id: "p", name: "P", alias: "PP", organizationId: "o", organizationName: "Org" }] : [{ _id: "o", name: "Org", slug: "org" }]);
  const result = await loadChoices("https://example.convex.cloud", "secret");
  expect(result.projects[0]._id).toBe("p"); expect(result.organizations[0]._id).toBe("o");
  expect(mocks.http).toHaveBeenCalledWith({ url: "https://example.convex.cloud", apiKey: "secret" }, expect.any(AbortSignal));
});
it("rejects discovery after access failure", async () => {
  mocks.query.mockRejectedValue(new Error("denied"));
  await expect(loadChoices("https://example.convex.cloud", "secret")).rejects.toThrow("denied");
  expect(mocks.client).not.toHaveBeenCalled();
});
it.each(["http://example.com", "https://user:secret@example.com", "https://example.com?key=secret"])("rejects unsafe deployment %s before sending credentials", async url => {
  await expect(loadChoices(url, "secret")).rejects.toThrow(); expect(mocks.client).not.toHaveBeenCalled();
});
it("validates fields without contacting the backend", () => {
  const options = { url: "https://example.convex.cloud", project: "p", profileKey: "pp", profileName: "Display" };
  expect(() => validateForm("pp", options)).not.toThrow();
  expect(() => validateForm("../pp", options)).toThrow("traversal");
  expect(() => validateForm("pp", { ...options, profileKey: "INVALID" })).toThrow("profile key");
  expect(() => validateForm("pp", { ...options, clone: "https://user:secret@example.com/repo" })).toThrow("without credentials");
  expect(mocks.client).not.toHaveBeenCalled();
});

it("uses bounded HTTP discovery instead of a reconnecting subscription client", async () => {
  mocks.query.mockResolvedValue([]);
  await loadChoices("https://example.convex.cloud", "secret");
  expect(mocks.http).toHaveBeenCalledOnce();
  expect(mocks.client).not.toHaveBeenCalled();
});
it("rejects nested relative paths before registration but permits absolute target paths", () => {
  const options = { url: "https://example.convex.cloud", project: "p", profileKey: "pp", profileName: "Display" };
  expect(() => validateForm("nested/pp", options)).toThrow("direct child");
  expect(() => validateForm("/workspace/pp", options)).not.toThrow();
});
it("aborts the sibling discovery request after one query fails", async () => {
  const abort = new AbortController();
  let requestSignal: AbortSignal | undefined;
  mocks.http.mockImplementation((_options, signal) => { requestSignal = signal; return { query: mocks.query }; });
  mocks.query.mockRejectedValueOnce(new Error("denied")).mockImplementationOnce(() => new Promise(() => {}));
  await expect(loadChoices("https://example.convex.cloud", "secret", abort.signal)).rejects.toThrow("denied");
  expect(requestSignal?.aborted).toBe(true);
  expect(abort.signal.aborted).toBe(false);
});

it("deduplicates inspected deployments and excludes unsafe endpoints without fetching", () => {
  expect(savedDeploymentUrls(["https://one.convex.cloud/", "https://one.convex.cloud", "https://two.convex.cloud", "http://localhost:3210", "https://user:secret@example.com", "not-a-url"]))
    .toEqual(["https://one.convex.cloud", "https://two.convex.cloud"]);
  expect(mocks.http).not.toHaveBeenCalled();
});

it("offers only enabled provider credentials compatible with onboarding's runtime", async () => {
  const { runtimeAccessChoices } = await import("./workflow.js");
  const entries = ["openai", "mantle", "bedrock", "anthropic", "cursor"].flatMap(provider => [true, false].map(enabled => ({ name: `${provider}-${enabled}`, provider, enabled, auth: "api-key", billing: "api", revision: 1, retainedRevisions: [] })));
  expect(runtimeAccessChoices("codex", entries).map(entry => entry.name)).toEqual(["openai-true", "mantle-true", "bedrock-true"]);
  expect(runtimeAccessChoices("claude-code", entries).map(entry => entry.name)).toEqual(["mantle-true", "bedrock-true"]);
});
