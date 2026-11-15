import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

describe.each(["codex", "claude-code"] as const)("%s usage request availability", cliType => {
  test.each(["send", "create", "edit"])("rejects an offline usage request: %s", async operation => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/project", label: "project" }],
    });
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { cliType });
    const request = operation === "create"
      ? asUser.mutation(api.cli.threads.core.create, {
          profileId: profile._id, pathId: "path-1", cliType, content: "/usage", runtimeCommand: true,
        })
      : operation === "edit"
        ? asUser.mutation(api.cli.messages.editLastResend, {
            messageId: (await ctx.cliMessage(thread._id, profile._id, { role: "user", cliType }))._id,
            content: "/usage", runtimeCommand: true,
          })
        : asUser.mutation(api.cli.messages.send, {
            threadId: thread._id, content: "/usage", runtimeCommand: true,
          });
    await expect(request).rejects.toThrow(/runner is offline/i);
  });

  test("allows online lookup, keeps it out of steering and leaves other commands unchanged", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { cliType });
    await expect(asUser.mutation(api.cli.messages.send, {
      threadId: thread._id, content: "/compact", runtimeCommand: true,
    })).resolves.toBeDefined();
    const key = await asUser.mutation(api.apiKeys.core.create, { name: "CLI", expiresAt: Date.now() + 86400000 });
    await ctx.cliSession(profile._id, key.id);
    const id = await asUser.mutation(api.cli.messages.send, {
      threadId: thread._id, content: "/usage", runtimeCommand: true, steer: true,
    });
    const message = await t.run(runCtx => runCtx.db.get("cliMessages", id));
    expect(message?.runtimeCommand).toBe(true);
    expect(message?.steerRequestedAt).toBeUndefined();
  });
});
