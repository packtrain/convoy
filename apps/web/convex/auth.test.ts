import { afterEach, beforeEach, expect, test, describe, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { sentEmails } from "@convex-dev/auth/components/email/test";
import { createTestContext } from "../convex-testing";
import { getAppUrlBase } from "./lib/shared/appUrl";

const PASSWORD = "correct horse battery staple";

type TestConvex = ReturnType<typeof createTestContext>["t"];

/** Calls as the session an access token names, with the token's real issuer. */
function asSession(t: TestConvex, accessToken: string) {
  const claims = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string; iss: string };
  return t.withIdentity({ subject: claims.sub, issuer: claims.iss });
}

/** Sign-up as the browser runs it with verification off: one mutation. */
async function signUp(t: TestConvex, email: string) {
  const result = await t.mutation(api.auth.signUpWithoutEmailVerification, { email, password: PASSWORD });
  if (result.status !== "complete") throw new Error(`sign-up failed: ${JSON.stringify(result)}`);
  return result.tokens;
}

describe("Convex Auth email and password, verification off", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "convex");
    vi.stubEnv("AUTH_EMAIL_VERIFICATION", "off");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function client() {
    // The email component rate-limits by client IP.
    return createTestContext().t.withRequestMetadata({ ip: "203.0.113.7" }) as TestConvex;
  }

  test("sign-up signs in at once and leaves one user and no pending code", async () => {
    const t = client();
    const tokens = await signUp(t, "robin@example.com");

    const user = await asSession(t, tokens.accessToken).query(api.users.core.current, {});
    expect(user).toMatchObject({ _id: tokens.userId, email: "robin@example.com", name: "robin" });
    expect(user?.tokenIdentifier).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("pendingSignUpCodes").collect())).toEqual([]);
  });

  test("users.email holds the normalized address, so by_email lookups find it", async () => {
    const t = client();
    const { userId } = await signUp(t, "Robin.Hale@Example.com");

    const found = await t.run((ctx) =>
      ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", "robin.hale@example.com")).unique()
    );
    expect(found?._id).toBe(userId);
    expect(found?.name).toBe("robin.hale");
  });

  test("onboarding names the first workspace from the user's name", async () => {
    const t = client();
    const tokens = await signUp(t, "robin@example.com");

    const result = await asSession(t, tokens.accessToken).mutation(api.users.core.onboard, {});
    const org = await t.run((ctx) => ctx.db.get("organizations", result.organizationId));
    expect(org?.name).toBe("robin's Workspace");
  });

  test("sign-in with the right password returns the same user, a wrong one does not", async () => {
    const t = client();
    const { userId } = await signUp(t, "robin@example.com");

    const ok = await t.mutation(api.auth.signInWithEmailPassword, { email: "robin@example.com", password: PASSWORD });
    expect(ok.status === "complete" && ok.tokens.userId).toBe(userId);
    const wrong = await t.mutation(api.auth.signInWithEmailPassword, { email: "robin@example.com", password: "wrong password!" });
    expect(wrong).toEqual({ status: "error", userError: { error: "INVALID_CREDENTIALS" } });
  });

  test("a second sign-up with the same address reports it taken and adds no user", async () => {
    const t = client();
    await signUp(t, "robin@example.com");

    const again = await t.mutation(api.auth.signUpWithoutEmailVerification, { email: "ROBIN@example.com", password: PASSWORD });
    expect(again).toEqual({ status: "error", userError: { error: "EMAIL_TAKEN" } });
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });

  test("a weak password is reported and adds no user", async () => {
    const t = client();

    const result = await t.mutation(api.auth.signUpWithoutEmailVerification, { email: "robin@example.com", password: "short" });
    expect(result).toEqual({ status: "error", userError: { error: "PASSWORD_TOO_SHORT" } });
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });

  test("store resolves the signed-up user instead of creating one from the session token", async () => {
    const t = client();
    const tokens = await signUp(t, "robin@example.com");

    expect(await asSession(t, tokens.accessToken).mutation(api.users.core.store, {})).toBe(tokens.userId);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });

  test("a token with a session's subject but another issuer resolves to no user", async () => {
    const t = client();
    const tokens = await signUp(t, "robin@example.com");
    const { sub } = JSON.parse(atob(tokens.accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string };

    const forged = t.withIdentity({ subject: sub, issuer: "https://other-issuer.example" });
    expect(await forged.query(api.users.core.current, {})).toBeNull();
  });

  test("sign-out ends the session", async () => {
    const t = client();
    const tokens = await signUp(t, "robin@example.com");
    const session = asSession(t, tokens.accessToken);

    await t.mutation(api.auth.signOut, { refreshToken: tokens.refreshToken });
    expect(await session.query(api.users.core.current, {})).toBeNull();
  });

  test("the stand-in sender keeps only sign-up links", async () => {
    const t = client();
    const send = (path: string) =>
      t.mutation(internal.auth.deliverAuthEmail, {
        options: { apiKey: "", testMode: false, initialBackoffMs: 0, retryAttempts: 0 },
        from: "Convoy <auth@convoy.invalid>",
        to: ["robin@example.com"],
        text: `Open this link:\n\n${getAppUrlBase()}${path}?code=secret-code\n`,
      });
    const pending = () => t.run((ctx) => ctx.db.query("pendingSignUpCodes").collect());

    expect(await send("/auth/reset-password")).toBe("dropped");
    expect(await send("/auth/change-email")).toBe("dropped");
    expect(await pending()).toEqual([]);
    expect(await send("/auth/verify-email")).toBe("stored");
    expect(await pending()).toMatchObject([{ email: "robin@example.com", code: "secret-code" }]);
  });

  test("without AUTH_MODE=convex, no Convex Auth account can be created", async () => {
    vi.stubEnv("AUTH_MODE", "");
    const t = client();

    await expect(
      t.mutation(api.auth.signUpWithoutEmailVerification, { email: "robin@example.com", password: PASSWORD })
    ).rejects.toThrow("Convex Auth sign-up is not enabled on this deployment");
    await expect(
      t.mutation(api.auth.signUpWithEmailPassword, { email: "robin@example.com", password: PASSWORD })
    ).rejects.toThrow("Convex Auth sign-up is not enabled on this deployment");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });
});

describe("Convex Auth email and password, verification required", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "convex");
    vi.stubEnv("AUTH_EMAIL_VERIFICATION", "required");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Convoy <auth@example.com>");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function client() {
    return createTestContext().t.withRequestMetadata({ ip: "203.0.113.7" }) as TestConvex;
  }

  /** The `code` of the verify-email link in the only email sent. */
  async function emailedCode(t: TestConvex) {
    const [email] = await sentEmails(t);
    const link = email.text?.match(/https?:\/\/\S+/)?.[0] ?? "";
    expect(link.startsWith(`${getAppUrlBase()}/auth/verify-email?`)).toBe(true);
    return new URL(link).searchParams.get("code") ?? "";
  }

  test("the one-transaction sign-up reports that verification is required and creates nothing", async () => {
    const t = client();

    const result = await t.mutation(api.auth.signUpWithoutEmailVerification, { email: "robin@example.com", password: PASSWORD });
    expect(result).toEqual({ status: "emailVerificationRequired" });
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
    expect(await sentEmails(t)).toEqual([]);
  });

  test("sign-up emails a link through Resend; the link completes it and signs in", async () => {
    const t = client();

    const started = await t.mutation(api.auth.signUpWithEmailPassword, { email: "Robin@Example.com", password: PASSWORD });
    if (!started.success) throw new Error(started.userError.error);
    const [email] = await sentEmails(t);
    expect(email).toMatchObject({
      from: "Convoy <auth@example.com>",
      to: ["Robin@Example.com"],
      subject: "Verify your email address",
    });
    // Our HTML template wraps the same link; the package's text stays as the plain-text part.
    expect(email.html).toContain(`href="${email.text?.match(/https?:\/\/\S+/)?.[0]}"`);
    expect(email.html).toContain("1 hour");
    expect(await t.run((ctx) => ctx.db.query("pendingSignUpCodes").collect())).toEqual([]);

    const unverified = await t.mutation(api.auth.signInWithEmailPassword, { email: "robin@example.com", password: PASSWORD });
    expect(unverified).toEqual({ status: "error", userError: { error: "USER_NOT_FOUND" } });

    const completed = await t.mutation(api.auth.completeSignUpWithEmailPassword, {
      emailCode: await emailedCode(t),
      browserSecret: started.browserSecret,
    });
    if (completed.status !== "complete") throw new Error(completed.userError.error);
    const user = await asSession(t, completed.tokens.accessToken).query(api.users.core.current, {});
    expect(user).toMatchObject({ email: "robin@example.com", name: "robin" });

    const signedIn = await t.mutation(api.auth.signInWithEmailPassword, { email: "robin@example.com", password: PASSWORD });
    expect(signedIn.status === "complete" && signedIn.tokens.userId).toBe(completed.tokens.userId);
  });

  test("an account made with verification off still signs in after it is turned on", async () => {
    vi.stubEnv("AUTH_EMAIL_VERIFICATION", "off");
    const t = client();
    const { userId } = await signUp(t, "robin@example.com");
    vi.stubEnv("AUTH_EMAIL_VERIFICATION", "required");

    const result = await t.mutation(api.auth.signInWithEmailPassword, { email: "robin@example.com", password: PASSWORD });
    expect(result.status === "complete" && result.tokens.userId).toBe(userId);
  });

  test("a recovery link sets a new password, signs in, and ends the other sessions", async () => {
    vi.stubEnv("AUTH_EMAIL_VERIFICATION", "off");
    const t = client();
    const old = await signUp(t, "robin@example.com");
    vi.stubEnv("AUTH_EMAIL_VERIFICATION", "required");
    const NEW_PASSWORD = "another horse battery staple";

    const started = await t.mutation(api.auth.startPasswordRecovery, { email: "Robin@Example.com" });
    if (!started.success) throw new Error(started.userError.error);
    expect(started.sentTo).toBe("robin@example.com");
    const [email] = await sentEmails(t);
    const link = email.text?.match(/https?:\/\/\S+/)?.[0] ?? "";
    expect(link.startsWith(`${getAppUrlBase()}/auth/reset-password?`)).toBe(true);
    expect(email.subject).toBe("Reset your password");
    expect(email.html).toContain(`href="${link}"`);
    expect(email.html).toContain("10 minutes");
    const recovery = { emailCode: new URL(link).searchParams.get("code") ?? "", browserSecret: started.browserSecret };

    expect(await t.query(api.auth.checkPasswordRecovery, recovery)).toEqual({ success: true });
    const completed = await t.mutation(api.auth.completePasswordRecovery, { ...recovery, newPassword: NEW_PASSWORD });
    if (completed.status !== "complete") throw new Error(completed.userError.error);
    expect(completed.tokens.userId).toBe(old.userId);
    const notice = (await sentEmails(t)).find((sent) => sent.subject === "Your password was changed");
    expect(notice?.html).toContain(`href="${getAppUrlBase()}/auth/forgot-password"`);

    expect(await asSession(t, old.accessToken).query(api.users.core.current, {})).toBeNull();
    expect(await asSession(t, completed.tokens.accessToken).query(api.users.core.current, {})).toMatchObject({ _id: old.userId });
    const withOld = await t.mutation(api.auth.signInWithEmailPassword, { email: "robin@example.com", password: PASSWORD });
    expect(withOld).toEqual({ status: "error", userError: { error: "INVALID_CREDENTIALS" } });
    const withNew = await t.mutation(api.auth.signInWithEmailPassword, { email: "robin@example.com", password: NEW_PASSWORD });
    expect(withNew.status === "complete" && withNew.tokens.userId).toBe(old.userId);
  });

  test("without a Resend key, sign-up fails plainly and creates nothing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const t = client();

    await expect(
      t.mutation(api.auth.signUpWithEmailPassword, { email: "robin@example.com", password: PASSWORD })
    ).rejects.toThrow("Email sending is not configured");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
    expect(await sentEmails(t)).toEqual([]);
  });
});

test("getSettings reports email as on unless verification is off", async () => {
  const { t } = createTestContext();
  expect(await t.query(api.auth.getSettings, {})).toEqual({ emailEnabled: true });
  vi.stubEnv("AUTH_EMAIL_VERIFICATION", "off");
  expect(await t.query(api.auth.getSettings, {})).toEqual({ emailEnabled: false });
  vi.unstubAllEnvs();
});

describe("unified auth", () => {
  describe("getOptionalAuthenticatedUser with API key", () => {
    test("should authenticate via API key when no Clerk token", async () => {
      const ctx = createTestContext();
      const { asUser, project, t } = await ctx.setupProject();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Create API key
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      // Use API key to list tasks (no Clerk auth - use t.query without identity)
      const tasks = await t.query(api.tasks.core.listByProject, {
        projectId: project._id,
        apiKey: key,
      });

      // Should work (return empty array, but not throw)
      expect(Array.isArray(tasks)).toBe(true);
    });

    test("should reject invalid API key", async () => {
      const ctx = createTestContext();
      const { project, t } = await ctx.setupProject();

      const tasks = await t.query(api.tasks.core.listByProject, {
        projectId: project._id,
        apiKey: "sk_user_invalid_key_12345",
      });

      // Should return empty (not authenticated)
      expect(tasks).toEqual([]);
    });

    test("should reject expired API key", async () => {
      const ctx = createTestContext();
      const { asUser, project, t } = await ctx.setupProject();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const { id, key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      // Directly update the key to be expired (bypass validation)
      await t.run(async (runCtx) => {
        await runCtx.db.patch("apiKeys", id, { expiresAt: Date.now() - 1000 });
      });

      const tasks = await t.query(api.tasks.core.listByProject, {
        projectId: project._id,
        apiKey: key,
      });

      expect(tasks).toEqual([]);
    });
  });

  describe("Clerk auth still works", () => {
    test("should authenticate via Clerk when apiKey not provided", async () => {
      const ctx = createTestContext();
      const { asUser, project } = await ctx.setupProject();

      // Use Clerk auth (normal flow)
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        // No apiKey - uses Clerk token
      });

      expect(Array.isArray(tasks)).toBe(true);
    });

    test("should prefer Clerk auth when both provided", async () => {
      const ctx = createTestContext();
      const { asUser, project } = await ctx.setupProject();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      // Provide both Clerk auth AND API key
      // Clerk should take precedence
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        apiKey: key,
      });

      expect(Array.isArray(tasks)).toBe(true);
    });
  });

  describe("listAccessible", () => {
    test("should return projects with role info via API key", async () => {
      const ctx = createTestContext();
      const { asUser, project, org, t } = await ctx.setupProject();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      // List accessible projects using API key (no Clerk auth)
      const projects = await t.query(api.projects.core.listAccessible, {
        apiKey: key,
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]._id).toBe(project._id);
      expect(projects[0].name).toBe(project.name);
      expect(projects[0].organizationName).toBe(org.name);
      expect(projects[0].organizationSlug).toBe(org.slug);
      expect(projects[0].role).toBeDefined();
      expect(projects[0].role.name).toBe("project-admin"); // setupProject adds the creator
      expect(projects[0].role.permissions).toEqual(["*"]);
    });

    test("should return the org admin's project role, not their org role (OS-1536)", async () => {
      const ctx = createTestContext();
      const { project, org, t } = await ctx.setupProject();

      // Create another user as admin using test context helper
      const adminUser = await ctx.user();
      await ctx.orgMember(org._id, adminUser._id, "admin");
      await ctx.projectMember(project._id, adminUser._id, "member");
      const asAdmin = ctx.asUser(adminUser);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const { key } = await asAdmin.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      const projects = await t.query(api.projects.core.listAccessible, {
        apiKey: key,
      });

      expect(projects).toHaveLength(1);
      expect(projects[0].role.name).toBe("member");
    });

    test("should return correct role for project member", async () => {
      const ctx = createTestContext();
      const { project, org, t } = await ctx.setupProject();

      // Create another user as org member + project member using test context helpers
      const memberUser = await ctx.user();
      await ctx.orgMember(org._id, memberUser._id, "member");
      await ctx.projectMember(project._id, memberUser._id, "member");
      const asMember = ctx.asUser(memberUser);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const { key } = await asMember.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      const projects = await t.query(api.projects.core.listAccessible, {
        apiKey: key,
      });

      expect(projects).toHaveLength(1);
      expect(projects[0].role.name).toBe("member");
      expect(projects[0].role.permissions).toEqual(["TASK_CREATE", "TASK_UPDATE", "TASK_DELETE"]);
    });

    test("should return correct role for project viewer", async () => {
      const ctx = createTestContext();
      const { project, org, t } = await ctx.setupProject();

      // Create another user as org member + project viewer using test context helpers
      const viewerUser = await ctx.user();
      await ctx.orgMember(org._id, viewerUser._id, "member");
      await ctx.projectMember(project._id, viewerUser._id, "viewer");
      const asViewer = ctx.asUser(viewerUser);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const { key } = await asViewer.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      const projects = await t.query(api.projects.core.listAccessible, {
        apiKey: key,
      });

      expect(projects).toHaveLength(1);
      expect(projects[0].role.name).toBe("viewer");
      expect(projects[0].role.permissions).toEqual([]);
    });

    test("should not return projects user has no access to", async () => {
      const ctx = createTestContext();
      const { project: project1 } = await ctx.setupProject();
      const { asUser: asUser2, t } = await ctx.setupProject(); // Different user/org

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const { key } = await asUser2.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      const projects = await t.query(api.projects.core.listAccessible, {
        apiKey: key,
      });

      // Should only see user2's project, not project1
      expect(projects.every((p) => p._id !== project1._id)).toBe(true);
    });

    test("should return empty for invalid API key", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupProject();

      const projects = await t.query(api.projects.core.listAccessible, {
        apiKey: "sk_user_invalid_key_12345",
      });

      expect(projects).toEqual([]);
    });
  });

  describe("tasks.getById", () => {
    test("should get task by id via API key", async () => {
      const ctx = createTestContext();
      const { asUser, project, user, t } = await ctx.setupProject();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Create a task
      const task = await ctx.task(project._id, user._id, { name: "Test Task" });

      // Create API key
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      // Get task via API key
      const result = await t.query(api.tasks.core.getById, {
        id: task._id,
        apiKey: key,
      });

      expect(result).not.toBeNull();
      expect(result?._id).toBe(task._id);
      expect(result?.name).toBe("Test Task");
      expect(result?.refId).toMatch(/^[A-Z][A-Z0-9]*-\d+$/); // Alias can have letters+numbers
    });

    test("should return null for task in inaccessible project", async () => {
      const ctx = createTestContext();
      const { project: project1, user: user1 } = await ctx.setupProject();
      const { asUser: asUser2, t } = await ctx.setupProject(); // Different user

      // Create task in first user's project
      const task = await ctx.task(project1._id, user1._id, { name: "Secret Task" });

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const { key } = await asUser2.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      // Second user shouldn't see first user's task
      const result = await t.query(api.tasks.core.getById, {
        id: task._id,
        apiKey: key,
      });

      expect(result).toBeNull();
    });
  });

  describe("tasks.create via API key", () => {
    test("should create task via API key", async () => {
      const ctx = createTestContext();
      const { asUser, project, t } = await ctx.setupProject();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      // Create task using API key (no Clerk auth)
      const createResult = await t.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: crypto.randomUUID(),
        name: "API Created Task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "0|hzzzzz:",
        apiKey: key,
      });
      const { taskId } = createResult;

      expect(createResult).toMatchObject({
        taskId,
        projectId: project._id,
        organizationId: project.organizationId,
        projectAlias: project.alias,
        refNumber: 1,
        refId: `${project.alias}-1`,
      });

      // Verify the task was created
      const task = await t.query(api.tasks.core.getById, {
        id: taskId,
        apiKey: key,
      });
      expect(task?.name).toBe("API Created Task");
    });
  });

  describe("tasks.update via API key", () => {
    test("should update task via API key", async () => {
      const ctx = createTestContext();
      const { asUser, project, user, t } = await ctx.setupProject();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Create task
      const task = await ctx.task(project._id, user._id, { name: "Original Name" });

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      // Update using API key
      await t.mutation(api.tasks.core.update, {
        id: task._id,
        name: "Updated Name",
        apiKey: key,
      });

      // Verify the update
      const updated = await t.query(api.tasks.core.getById, {
        id: task._id,
        apiKey: key,
      });
      expect(updated?.name).toBe("Updated Name");
    });
  });

  describe("tasks.remove via API key", () => {
    test("should soft delete task via API key", async () => {
      const ctx = createTestContext();
      const { asUser, project, user, t } = await ctx.setupProject();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Create task
      const task = await ctx.task(project._id, user._id, { name: "To Delete" });

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      // Delete using API key
      await t.mutation(api.tasks.core.remove, {
        id: task._id,
        apiKey: key,
      });

      // Verify the task is deleted (getById returns null for deleted tasks)
      const deleted = await t.query(api.tasks.core.getById, {
        id: task._id,
        apiKey: key,
      });
      expect(deleted).toBeNull();
    });
  });
});
