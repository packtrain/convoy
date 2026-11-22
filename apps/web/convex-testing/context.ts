import { convexTest } from "convex-test";
import migrations from "@convex-dev/migrations/test";
import authCore from "@convex-dev/auth/test";
import authEmail from "@convex-dev/auth/components/email/test";
import authPassword from "@convex-dev/auth/components/password/test";
import schema from "../convex/schema";
import { Id } from "../convex/_generated/dataModel";
import {
  buildUser,
  buildOrganization,
  buildOrgMember,
  buildProject,
  buildProjectMember,
  buildTask,
  buildTaskAttachment,
  buildComment,
  buildOrganizationInvitation,
  buildCliProfile,
  buildCliSession,
  buildCliThread,
  buildWorkflowRun,
  buildCliMessage,
  buildCliMessageChunks,
  buildUserPreferences,
  UserOverrides,
  OrgOverrides,
  ProjectOverrides,
  TaskOverrides,
  TaskAttachmentOverrides,
  CommentOverrides,
  OrganizationInvitationOverrides,
  CliProfileOverrides,
  CliSessionOverrides,
  CliThreadOverrides,
  CliMessageOverrides,
  CliMessageChunkInput,
  UserPreferencesOverrides,
} from "./builders";
import type { OrgRole, ProjectRole } from "../lib/authz/roles";
import { resetGenerators } from "./generators";
import type { TransactionMetrics } from "convex-test/dist/transactionMetrics";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

/** `transactionLimits` enforces Convex's per-transaction read and write limits. */
export function createTestContext(options: { transactionLimits?: Partial<TransactionMetrics> | boolean } = {}) {
  resetGenerators();
  const t = convexTest({ schema, modules, ...options });
  migrations.register(t);
  authCore.registerCore(t);
  authEmail.registerEmail(t);
  authPassword.registerPassword(t);

  const ctx = {
    t,

    // Level 1: User only (for testing org creation)
    async setupUser(overrides?: UserOverrides) {
      let user!: Awaited<ReturnType<typeof buildUser>>;

      await t.run(async (runCtx) => {
        user = await buildUser(runCtx.db, overrides);
      });

      const asUser = t.withIdentity({
        tokenIdentifier: user.tokenIdentifier,
        email: user.email,
      });

      return { user, asUser, t };
    },

    // Level 2: User + Org (for testing project creation)
    async setupOrg(overrides?: { user?: UserOverrides; organization?: OrgOverrides }) {
      let user!: Awaited<ReturnType<typeof buildUser>>;
      let org!: Awaited<ReturnType<typeof buildOrganization>>;

      await t.run(async (runCtx) => {
        user = await buildUser(runCtx.db, overrides?.user);
        org = await buildOrganization(runCtx.db, user._id, overrides?.organization);
        await buildOrgMember(runCtx.db, org._id, user._id, "owner");
      });

      const asUser = t.withIdentity({
        tokenIdentifier: user.tokenIdentifier,
        email: user.email,
      });

      return { user, org, asUser, t };
    },

    // Level 3: User + Org + Project (most common case)
    async setupProject(overrides?: {
      user?: UserOverrides;
      organization?: OrgOverrides;
      project?: ProjectOverrides;
    }) {
      let user!: Awaited<ReturnType<typeof buildUser>>;
      let org!: Awaited<ReturnType<typeof buildOrganization>>;
      let project!: Awaited<ReturnType<typeof buildProject>>;

      await t.run(async (runCtx) => {
        user = await buildUser(runCtx.db, overrides?.user);
        org = await buildOrganization(runCtx.db, user._id, overrides?.organization);
        await buildOrgMember(runCtx.db, org._id, user._id, "owner");
        project = await buildProject(runCtx.db, org._id, user._id, overrides?.project);
        // Add creator as project admin (matches real projects.create behavior)
        await buildProjectMember(runCtx.db, project._id, user._id, "project-admin");
      });

      const asUser = t.withIdentity({
        tokenIdentifier: user.tokenIdentifier,
        email: user.email,
      });

      return { user, org, project, asUser, t };
    },

    // Individual entity builders
    async organization(userId: Id<"users">, overrides?: OrgOverrides) {
      let result!: Awaited<ReturnType<typeof buildOrganization>>;
      await t.run(async (runCtx) => {
        result = await buildOrganization(runCtx.db, userId, overrides);
        await buildOrgMember(runCtx.db, result._id, userId, "owner");
      });
      return result;
    },

    async project(
      orgId: Id<"organizations">,
      userId: Id<"users">,
      overrides?: ProjectOverrides,
      options?: { withCreatorMembership?: boolean }
    ) {
      let result!: Awaited<ReturnType<typeof buildProject>>;
      await t.run(async (runCtx) => {
        result = await buildProject(runCtx.db, orgId, userId, overrides);
        // Creator is project admin, matching real projects.create behavior (OS-1706).
        if (options?.withCreatorMembership !== false) {
          await buildProjectMember(runCtx.db, result._id, userId, "project-admin");
        }
      });
      return result;
    },

    async task(
      projectId: Id<"projects">,
      userId: Id<"users">,
      overrides?: TaskOverrides
    ) {
      let result!: Awaited<ReturnType<typeof buildTask>>;
      await t.run(async (runCtx) => {
        result = await buildTask(runCtx.db, projectId, userId, overrides);
      });
      return result;
    },

    async tasks(
      projectId: Id<"projects">,
      userId: Id<"users">,
      count: number,
      overrides?: TaskOverrides
    ) {
      const results: Awaited<ReturnType<typeof buildTask>>[] = [];
      await t.run(async (runCtx) => {
        for (let i = 0; i < count; i++) {
          results.push(await buildTask(runCtx.db, projectId, userId, overrides));
        }
      });
      return results;
    },

    async taskAttachment(
      taskId: Id<"tasks">,
      userId: Id<"users">,
      storageId: Id<"_storage">,
      overrides?: TaskAttachmentOverrides
    ) {
      let result!: Awaited<ReturnType<typeof buildTaskAttachment>>;
      await t.run(async (runCtx) => {
        result = await buildTaskAttachment(
          runCtx.db,
          taskId,
          userId,
          storageId,
          overrides
        );
      });
      return result;
    },

    async comment(
      taskId: Id<"tasks">,
      authorId: Id<"users">,
      overrides?: CommentOverrides
    ) {
      let result!: Awaited<ReturnType<typeof buildComment>>;
      await t.run(async (runCtx) => {
        result = await buildComment(runCtx.db, taskId, authorId, overrides);
      });
      return result;
    },

    // Create a standalone user (for invitation tests)
    async user(overrides?: UserOverrides) {
      let result!: Awaited<ReturnType<typeof buildUser>>;
      await t.run(async (runCtx) => {
        result = await buildUser(runCtx.db, overrides);
      });
      return result;
    },

    // Create org membership (for testing different roles)
    async orgMember(
      orgId: Id<"organizations">,
      userId: Id<"users">,
      role: OrgRole
    ) {
      let result!: Awaited<ReturnType<typeof buildOrgMember>>;
      await t.run(async (runCtx) => {
        result = await buildOrgMember(runCtx.db, orgId, userId, role);
      });
      return result;
    },

    // Create project membership (for testing project-level permissions)
    async projectMember(
      projectId: Id<"projects">,
      userId: Id<"users">,
      role: ProjectRole
    ) {
      let result!: Awaited<ReturnType<typeof buildProjectMember>>;
      await t.run(async (runCtx) => {
        result = await buildProjectMember(runCtx.db, projectId, userId, role);
      });
      return result;
    },

    // Get authenticated test client for a user
    asUser(user: { tokenIdentifier: string; email: string }) {
      return t.withIdentity({
        tokenIdentifier: user.tokenIdentifier,
        email: user.email,
      });
    },

    // Create invitation (for testing invitation flows without email)
    async organizationInvitation(
      orgId: Id<"organizations">,
      invitedBy: Id<"users">,
      overrides?: OrganizationInvitationOverrides
    ) {
      let result!: Awaited<ReturnType<typeof buildOrganizationInvitation>>;
      await t.run(async (runCtx) => {
        result = await buildOrganizationInvitation(
          runCtx.db,
          orgId,
          invitedBy,
          overrides
        );
      });
      return result;
    },

    // Create CLI profile (persistent connection identity)
    async cliProfile(
      userId: Id<"users">,
      projectId: Id<"projects">,
      overrides?: CliProfileOverrides
    ) {
      let result!: Awaited<ReturnType<typeof buildCliProfile>>;
      await t.run(async (runCtx) => {
        result = await buildCliProfile(runCtx.db, userId, projectId, overrides);
      });
      return result;
    },

    // Create CLI session (ephemeral - active when CLI is running)
    async cliSession(
      profileId: Id<"cliProfiles">,
      apiKeyId: Id<"apiKeys">,
      overrides?: CliSessionOverrides
    ) {
      let result!: Awaited<ReturnType<typeof buildCliSession>>;
      await t.run(async (runCtx) => {
        result = await buildCliSession(runCtx.db, profileId, apiKeyId, overrides);
      });
      return result;
    },

    // Create a minimal Workflow run chain (guard-test fixture, OS-1366)
    async workflowRun(
      userId: Id<"users">,
      projectId: Id<"projects">,
      profileId: Id<"cliProfiles">
    ) {
      let result!: Awaited<ReturnType<typeof buildWorkflowRun>>;
      await t.run(async (runCtx) => {
        result = await buildWorkflowRun(runCtx.db, userId, projectId, profileId);
      });
      return result;
    },

    // Create CLI thread (conversation with a CLI)
    async cliThread(
      userId: Id<"users">,
      projectId: Id<"projects">,
      profileId: Id<"cliProfiles">,
      overrides?: CliThreadOverrides
    ) {
      let result!: Awaited<ReturnType<typeof buildCliThread>>;
      await t.run(async (runCtx) => {
        result = await buildCliThread(runCtx.db, userId, projectId, profileId, overrides);
      });
      return result;
    },

    // Create CLI message (individual message in a chat)
    async cliMessage(
      threadId: Id<"cliThreads">,
      profileId: Id<"cliProfiles">,
      overrides?: CliMessageOverrides
    ) {
      let result!: Awaited<ReturnType<typeof buildCliMessage>>;
      await t.run(async (runCtx) => {
        result = await buildCliMessage(runCtx.db, threadId, profileId, overrides);
      });
      return result;
    },

    // Create CLI message chunks (assistant stream payloads)
    async cliMessageChunks(
      messageId: Id<"cliMessages">,
      threadId: Id<"cliThreads">,
      profileId: Id<"cliProfiles">,
      chunks: CliMessageChunkInput[]
    ) {
      let result!: Awaited<ReturnType<typeof buildCliMessageChunks>>;
      await t.run(async (runCtx) => {
        result = await buildCliMessageChunks(
          runCtx.db,
          messageId,
          threadId,
          profileId,
          chunks
        );
      });
      return result;
    },

    // Create user preferences
    async userPreferences(
      userId: Id<"users">,
      overrides?: UserPreferencesOverrides
    ) {
      let result!: Awaited<ReturnType<typeof buildUserPreferences>>;
      await t.run(async (runCtx) => {
        result = await buildUserPreferences(runCtx.db, userId, overrides);
      });
      return result;
    },
  };

  return ctx;
}

export type TestContext = ReturnType<typeof createTestContext>;
