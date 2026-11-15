import { expect, it } from "vitest";
import { managedCredentialStatusSchema } from "./validators.js";

it("drops secret fields from target credential metadata before displaying it", () => {
  const status = managedCredentialStatusSchema.parse({
    service: true, compatible: true, configurationError: false, secret: "top-level-secret",
    entries: [{ name: "work", provider: "openai", auth: "api-key", billing: "API usage", enabled: true, revision: 1, retainedRevisions: [1], secret: "entry-secret" }],
    projects: [{ identity: "a", profiles: ["a"], desired: { mode: "managed", name: "work" }, state: "online", verified: false, secret: "project-secret" }],
  });
  expect(JSON.stringify(status)).not.toContain("secret");
  expect(status.entries[0].name).toBe("work");
  expect(status.projects[0].desired).toEqual({ mode: "managed", name: "work" });
});
