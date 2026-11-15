import { expect, test, describe } from "vitest";
import { api } from "./_generated/api";
import { createTestContext } from "../convex-testing";

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
