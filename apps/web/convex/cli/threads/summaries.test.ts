import { expect, test, describe } from "vitest";
import { api } from "../../_generated/api";
import { createTestContext, setupFakeTimers } from "../../../convex-testing";

setupFakeTimers();

describe("getSummary (OS-1162)", () => {
  const PATHS = {
    paths: [
      {
        id: "path-1",
        path: "/repo/path-1",
        label: "path-1",
        gitRemoteUrl: "git@github.com:packtrain/convoy.git",
      },
    ],
  };

  test("returns the target tuple and queue state for an owned thread", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      name: "Laptop",
      ...PATHS,
    });
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "path-1",
      path: "/repo/path-1",
      title: "Implement OS-1625",
      status: "streaming",
      processingState: "streaming",
      hasPendingUserMessages: true,
      hasPendingInteraction: true,
      queueHeldAt: 5_000,
    });

    const result = await asUser.query(api.cli.threads.summaries.getSummary, {
      threadId: thread._id,
    });

    expect(result).toMatchObject({
      threadId: thread._id,
      title: "Implement OS-1625",
      status: "streaming",
      // The spawn tuple: every field an agent copies into create_thread.
      profileId: profile._id,
      pathId: "path-1",
      path: "/repo/path-1",
      cliType: "claude-code",
      profileName: "Laptop",
      processingState: "streaming",
      hasPendingUserMessages: true,
      hasPendingInteraction: true,
      queueHeldAt: 5_000,
      isDone: false,
    });
    // No live session, so the target is offline — which is informational, not
    // an error: work queued against it starts when that CLI connects.
    expect(result?.targetOnline).toBe(false);
    expect(result?.lastHeartbeatAt).toBeUndefined();
    // Container fields belong to containers only.
    expect(result?.kind).toBeUndefined();
    expect(result?.childCount).toBeUndefined();
    expect(result?.aggregateStatus).toBeUndefined();
  });

  test("reports the target online while the profile has a live session", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "path-1",
      path: "/repo/path-1",
    });

    const result = await asUser.query(api.cli.threads.summaries.getSummary, {
      threadId: thread._id,
    });

    expect(result?.targetOnline).toBe(true);
    expect(result?.lastHeartbeatAt).toBe(session.lastHeartbeatAt);
  });

  test("falls back to the thread's path snapshot when the profile path is gone", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    // The path was removed from the profile after the thread was created, so
    // only the creation-time snapshot on the thread can answer "where".
    const profile = await ctx.cliProfile(user._id, project._id, { paths: [] });
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "path-gone",
      path: "/repo/removed",
    });

    const result = await asUser.query(api.cli.threads.summaries.getSummary, {
      threadId: thread._id,
    });

    expect(result?.path).toBe("/repo/removed");
    expect(result?.pathId).toBe("path-gone");
  });

  test("returns null for a thread owned by another user", async () => {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const { asUser: asStranger } = await ctx.setupUser();

    expect(
      await asStranger.query(api.cli.threads.summaries.getSummary, { threadId: thread._id })
    ).toBeNull();
  });

  // A shape-valid id from another table is a realistic mistake, not a
  // malicious one: `projectId` is an argument on nearly every other MCP tool,
  // so an agent holds one. With `threadId: v.id("cliThreads")` the argument
  // validator rejected it *before* the handler ran, with a "Validator error:
  // Expected ID for table" message that `isConvexIdError` does not match — so
  // MCP surfaced an opaque -32603 instead of "Thread not found". Normalizing
  // inside the query (as `get` does) folds it into the same null.
  test("returns null for a well-formed id from another table", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    expect(
      await asUser.query(api.cli.threads.summaries.getSummary, { threadId: project._id })
    ).toBeNull();
  });

  test("returns null for an unparseable thread id", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();

    expect(
      await asUser.query(api.cli.threads.summaries.getSummary, { threadId: "not-an-id" })
    ).toBeNull();
  });

  test("returns null for a soft-deleted thread", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      isDeleted: true,
    });

    expect(
      await asUser.query(api.cli.threads.summaries.getSummary, { threadId: thread._id })
    ).toBeNull();
  });

  test("a shared thread is readable by a project teammate", async () => {
    const ctx = createTestContext();
    const { user: owner, org, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(owner._id, project._id, PATHS);
    const thread = await ctx.cliThread(owner._id, project._id, profile._id, {
      pathId: "path-1",
      path: "/repo/path-1",
      sharedAt: Date.now(),
    });
    const teammate = await ctx.user();
    await ctx.orgMember(org._id, teammate._id, "member");
    await ctx.projectMember(project._id, teammate._id, "member");

    const result = await ctx.asUser(teammate).query(api.cli.threads.summaries.getSummary, {
      threadId: thread._id,
    });

    // Same read rule as the web thread view: sharing is read-only and the
    // agent-facing query must not invent a stricter or looser one.
    expect(result?.threadId).toBe(thread._id);
    expect(result?.profileId).toBe(profile._id);
  });

  /**
  * A group is shared as a unit, so a teammate reading a child depends entirely on
  * `isSharedForViewer`'s container lookup — a different branch from the test above, which
  * returns early on the thread's own `sharedAt`. This is the likelier real call:
  * `get_thread` exists to be used on ids an agent drilled to from a container.
  */
  async function setupSharedGroupChild(options: { shared: boolean }) {
    const ctx = createTestContext();
    const { user: owner, org, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(owner._id, project._id, PATHS);
    const container = await ctx.cliThread(owner._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      ...(options.shared ? { sharedAt: Date.now() } : {}),
    });
    const child = await ctx.cliThread(owner._id, project._id, profile._id, {
      parentThreadId: container._id,
      pathId: "path-1",
      path: "/repo/path-1",
    });
    const teammate = await ctx.user();
    await ctx.orgMember(org._id, teammate._id, "member");
    await ctx.projectMember(project._id, teammate._id, "member");

    return { asTeammate: ctx.asUser(teammate), container, child, profile };
  }

  test("a child of a shared group is readable by a teammate", async () => {
    const { asTeammate, container, child, profile } = await setupSharedGroupChild({
      shared: true,
    });

    const result = await asTeammate.query(api.cli.threads.summaries.getSummary, {
      threadId: child._id,
    });

    expect(result?.threadId).toBe(child._id);
    expect(result?.projectId).toBe(child.projectId);
    expect(result?.profileId).toBe(profile._id);
    expect(result?.parentThreadId).toBe(container._id);
  });

  test("a child of an unshared group stays hidden from a teammate", async () => {
    const { asTeammate, container, child } = await setupSharedGroupChild({
      shared: false,
    });

    expect(
      await asTeammate.query(api.cli.threads.summaries.getSummary, { threadId: child._id })
    ).toBeNull();
    // The container is no more readable than its members.
    expect(
      await asTeammate.query(api.cli.threads.summaries.getSummary, { threadId: container._id })
    ).toBeNull();
  });

  test("accepts a valid API key with no Clerk identity", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "path-1",
      path: "/repo/path-1",
    });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Threads",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const result = await t.query(api.cli.threads.summaries.getSummary, {
      threadId: thread._id,
      apiKey: key,
    });

    expect(result?.threadId).toBe(thread._id);
  });

  test("denies a key scoped to another organization", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "path-1",
      path: "/repo/path-1",
    });
    // The caller owns this thread, but the key is scoped away from its
    // project: the credential boundary must apply. Passing `user._id` to
    // `getViewableThread` instead of the whole principal would let this
    // through, because the ownership check alone would pass.
    const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Other-org key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: { organizationId: otherOrg._id, projectIds: [] },
    });

    expect(
      await t.query(api.cli.threads.summaries.getSummary, { threadId: thread._id, apiKey: key })
    ).toBeNull();
  });

  test("a container returns metadata only, with no member list", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      title: "Group title",
      status: "completed",
      childCount: 2,
      aggregateStatus: "running",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      parentThreadId: container._id,
      pathId: "path-1",
      path: "/repo/path-1",
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", container._id, { originThreadId: child._id });
    });

    const result = await asUser.query(api.cli.threads.summaries.getSummary, {
      threadId: container._id,
    });

    expect(result).toMatchObject({
      threadId: container._id,
      // Shared with the thread branch: `threads send --attach` authorizes its
      // uploads on the thread's own project (OS-1634).
      projectId: project._id,
      title: "Group title",
      kind: "group",
      childCount: 2,
      aggregateStatus: "running",
      originThreadId: child._id,
    });
    // Membership is `list_threads(containerId)`'s answer, not this one — one
    // question, one read path. A container also has no runtime target, so
    // exposing one would invite an agent to message it.
    expect(result).not.toHaveProperty("children");
    expect(result?.profileId).toBeUndefined();
    expect(result?.pathId).toBeUndefined();
    expect(result?.cliType).toBeUndefined();
    expect(result?.processingState).toBeUndefined();
    expect(result?.targetOnline).toBeUndefined();
    // `status` is thread-only for the same reason as `processingState`.
    expect(result?.status).toBeUndefined();
  });

  test("an idle group reads aggregateStatus 'idle', not 'completed'", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      aggregateStatus: "idle",
    });

    const result = await asUser.query(api.cli.threads.summaries.getSummary, {
      threadId: container._id,
    });

    // The sidebar's `containerItemStatus` maps idle → "completed" so a group
    // can render with the thread card. Handing that projection to an agent
    // would report a group as finished when it is merely quiet.
    expect(result?.aggregateStatus).toBe("idle");
    // And `status` is absent rather than the stored `"completed"` constant: a
    // caller reading the field that means "what is this doing" on every other
    // row would reach the same wrong conclusion by another route.
    expect(result?.status).toBeUndefined();
  });

  test("a group child reports its container and its spawner", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const spawner = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
      spawnedByThreadId: spawner._id,
      pathId: "path-1",
      path: "/repo/path-1",
    });

    const result = await asUser.query(api.cli.threads.summaries.getSummary, {
      threadId: child._id,
    });

    // Two different edges: `parentThreadId` is the group it renders in,
    // `spawnedByThreadId` is who asked for it. Neither derives the other.
    expect(result?.parentThreadId).toBe(container._id);
    expect(result?.spawnedByThreadId).toBe(spawner._id);
  });

  test("reports isDone for a thread marked done after its last activity", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const done = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: 1_000,
      doneAt: 2_000,
      pathId: "path-1",
      path: "/repo/path-1",
    });
    const reopened = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      // A legacy mark (no `isMarkedDone`) expires on newer activity (OS-2176).
      lastActivityAt: 3_000,
      doneAt: 2_000,
      pathId: "path-1",
      path: "/repo/path-1",
    });

    expect(
      (await asUser.query(api.cli.threads.summaries.getSummary, { threadId: done._id }))?.isDone
    ).toBe(true);
    expect(
      (await asUser.query(api.cli.threads.summaries.getSummary, { threadId: reopened._id }))?.isDone
    ).toBe(false);
  });
});

describe("listSummaries (OS-1626)", () => {
  const PATHS = {
    paths: [
      {
        id: "path-1",
        path: "/repo/path-1",
        label: "path-1",
      },
    ],
  };
  const PAGE = { cursor: null, numItems: 20 };

  test("leaves background threads out unless asked for them (OS-2513)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const mine = await ctx.cliThread(user._id, project._id, profile._id, { pathId: "path-1", path: "/repo/path-1" });
    const guide = await ctx.cliThread(user._id, project._id, profile._id, { pathId: "path-1", path: "/repo/path-1", isBackground: true });

    const normal = await asUser.query(api.cli.threads.summaries.listSummaries, { projectId: project._id, paginationOpts: PAGE });
    const background = await asUser.query(api.cli.threads.summaries.listSummaries, { projectId: project._id, paginationOpts: PAGE, background: true });

    expect(normal.page.map((row) => row.threadId)).toEqual([mine._id]);
    expect(background.page.map((row) => row.threadId)).toEqual([guide._id]);
  });

  test("returns the project's threads with the same fields as getSummary", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, { name: "Laptop", ...PATHS });
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Implement OS-1626",
      status: "streaming",
      processingState: "streaming",
      pathId: "path-1",
      path: "/repo/path-1",
    });

    const result = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });

    expect(result.page).toHaveLength(1);
    // One tier, one shape: a row is what `get_thread` would have returned, so
    // an agent can act on a list row without a second call.
    expect(result.page[0]).toMatchObject({
      threadId: thread._id,
      title: "Implement OS-1626",
      status: "streaming",
      profileId: profile._id,
      pathId: "path-1",
      path: "/repo/path-1",
      cliType: "claude-code",
      profileName: "Laptop",
      processingState: "streaming",
      targetOnline: false,
      isDone: false,
    });
  });

  test("resolves online state for every row from one batched lookup", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const online = await ctx.cliProfile(user._id, project._id, PATHS);
    const offline = await ctx.cliProfile(user._id, project._id, PATHS);
    const { id: apiKeyId } = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(online._id, apiKeyId);
    const onlineThread = await ctx.cliThread(user._id, project._id, online._id, {
      lastActivityAt: 2_000,
    });
    const offlineThread = await ctx.cliThread(user._id, project._id, offline._id, {
      lastActivityAt: 1_000,
    });

    const result = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });

    // Per-row online state, resolved once per distinct profile rather than
    // per row — the whole reason the list can afford the same shape as the
    // single read.
    const byId = new Map(result.page.map((row) => [row.threadId, row]));
    expect(byId.get(onlineThread._id)?.targetOnline).toBe(true);
    expect(byId.get(onlineThread._id)?.lastHeartbeatAt).toBe(session.lastHeartbeatAt);
    expect(byId.get(offlineThread._id)?.targetOnline).toBe(false);
    expect(byId.get(offlineThread._id)?.lastHeartbeatAt).toBeUndefined();
  });

  /**
  * `targetOnline` must not depend on *which* query asked. `cliSessions.projectId` is
  * optional, so a session predating that denorm is invisible to
  * `by_project_and_lastHeartbeatAt` — a project-keyed scan would report the target offline
  * while `get_thread`, resolving by profile, reports it online. One thread, one moment, two
  * answers is the ambiguity the shared validator exists to rule out.
  */
  test("agrees with getSummary on a session that predates the project denorm", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const { id: apiKeyId } = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyId);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "path-1",
      path: "/repo/path-1",
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliSessions", session._id, { projectId: undefined });
    });

    const single = await asUser.query(api.cli.threads.summaries.getSummary, { threadId: thread._id });
    const list = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });

    expect(single?.targetOnline).toBe(true);
    expect(list.page[0]?.targetOnline).toBe(single?.targetOnline);
    expect(list.page[0]?.lastHeartbeatAt).toBe(single?.lastHeartbeatAt);
  });

  test("shows a group as one row and excludes its members", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      title: "Group title",
      status: "completed",
      childCount: 2,
      aggregateStatus: "running",
      lastActivityAt: 3_000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: container._id,
      status: "streaming",
      lastActivityAt: 2_000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: container._id,
      status: "streaming",
      lastActivityAt: 1_000,
    });
    const plain = await ctx.cliThread(user._id, project._id, profile._id, {
      lastActivityAt: 500,
    });

    const result = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });

    // A 20-row page is 20 units of work: the group counts once, not once per
    // member, and `kind`'s presence is what says the id is drillable.
    expect(result.page.map((row) => row.threadId)).toEqual([container._id, plain._id]);
    expect(result.page[0]).toMatchObject({
      kind: "group",
      childCount: 2,
      aggregateStatus: "running",
    });
    // Raw, not `containerItemStatus`' idle → "completed" projection, and no
    // target — a container cannot be sent messages.
    expect(result.page[0]?.status).toBeUndefined();
    expect(result.page[0]?.profileId).toBeUndefined();
    expect(result.page[0]?.pathId).toBeUndefined();
    expect(result.page[0]?.cliType).toBeUndefined();
    expect(result.page[0]?.processingState).toBeUndefined();
    expect(result.page[0]?.targetOnline).toBeUndefined();
  });

  test("an idle group's row reads aggregateStatus 'idle', not 'completed'", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      aggregateStatus: "idle",
    });

    const result = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });

    // The sidebar projects idle → "completed" so a group renders with the
    // thread card. This list must not: a quiet group is not a finished one.
    expect(result.page[0]?.aggregateStatus).toBe("idle");
    expect(result.page[0]?.status).toBeUndefined();
  });

  test("a page of only containers resolves no target at all", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      aggregateStatus: "idle",
    });
    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      workflowRunId: runId,
      status: "completed",
      aggregateStatus: "running",
    });

    const result = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });

    // Nothing to look up: no profile load, no session scan. Plain groups and
    // run containers answer the same way — neither has a runtime target.
    expect(result.page).toHaveLength(2);
    expect(result.page.map((row) => row.kind)).toEqual(["group", "group"]);
    // The run container carries its binding so MCP callers can tell it apart.
    expect(result.page.map((row) => row.workflowRunId).sort()).toEqual([runId, undefined]);
    for (const row of result.page) {
      expect(row.profileId).toBeUndefined();
      expect(row.profileName).toBeUndefined();
      expect(row.targetOnline).toBeUndefined();
    }
  });

  test("excludes done threads by default and includes them on request", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const active = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: 2_000,
    });
    const done = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: 1_000,
      doneAt: 5_000,
    });

    const activeOnly = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });
    expect(activeOnly.page.map((row) => row.threadId)).toEqual([active._id]);

    const all = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      includeDone: true,
      paginationOpts: PAGE,
    });
    expect(all.page.map((row) => row.threadId)).toEqual([active._id, done._id]);
    expect(all.page.find((row) => row.threadId === done._id)?.isDone).toBe(true);
  });

  test("round-trips the pagination cursor", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const newest = await ctx.cliThread(user._id, project._id, profile._id, { lastActivityAt: 3_000 });
    const middle = await ctx.cliThread(user._id, project._id, profile._id, { lastActivityAt: 2_000 });
    const oldest = await ctx.cliThread(user._id, project._id, profile._id, { lastActivityAt: 1_000 });

    const first = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(first.page.map((row) => row.threadId)).toEqual([newest._id, middle._id]);
    expect(first.isDone).toBe(false);

    const second = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    expect(second.page.map((row) => row.threadId)).toEqual([oldest._id]);
  });

  test("returns an empty page to a project non-member", async () => {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    await ctx.cliThread(user._id, project._id, profile._id);
    const stranger = await ctx.user();

    const result = await ctx.asUser(stranger).query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });

    expect(result.page).toEqual([]);
  });

  test("shows only the caller's own threads to a project teammate", async () => {
    const ctx = createTestContext();
    const { user: owner, org, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(owner._id, project._id, PATHS);
    await ctx.cliThread(owner._id, project._id, profile._id);
    const teammate = await ctx.user();
    await ctx.orgMember(org._id, teammate._id, "member");
    await ctx.projectMember(project._id, teammate._id, "member");

    const result = await ctx.asUser(teammate).query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });

    // `userId`-scoped like every other thread list: a teammate with project
    // access still sees only their own threads, not the owner's.
    expect(result.page).toEqual([]);
  });

  test("accepts a valid API key with no Clerk identity", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Threads",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const result = await t.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
      apiKey: key,
    });

    expect(result.page.map((row) => row.threadId)).toEqual([thread._id]);
  });

  test("omits soft-deleted threads", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    await ctx.cliThread(user._id, project._id, profile._id, { isDeleted: true });
    const live = await ctx.cliThread(user._id, project._id, profile._id);

    const result = await asUser.query(api.cli.threads.summaries.listSummaries, {
      projectId: project._id,
      paginationOpts: PAGE,
    });

    expect(result.page.map((row) => row.threadId)).toEqual([live._id]);
  });

  /**
   * Both call shapes at once, deliberately: the point is that they agree. A
   * scoped key must be denied on each, and passing `user._id` instead of the
   * whole principal would let both through on the ownership check alone.
   */
  test("denies a key scoped to another organization", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: container._id });
    // The caller owns these threads, but the key is scoped away from their project.
    const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Other-org key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: { organizationId: otherOrg._id, projectIds: [] },
    });

    expect(
      (
        await t.query(api.cli.threads.summaries.listSummaries, {
          projectId: project._id,
          paginationOpts: PAGE,
          apiKey: key,
        })
      ).page
    ).toEqual([]);
    expect(
      (
        await t.query(api.cli.threads.summaries.listGroupSummaries, {
          parentThreadId: container._id,
          apiKey: key,
        })
      )
    ).toEqual([]);
  });
});

describe("listGroupSummaries (OS-1626)", () => {
  const PATHS = {
    paths: [
      {
        id: "path-1",
        path: "/repo/path-1",
        label: "path-1",
      },
    ],
  };

  test("omits soft-deleted members", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const live = await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: container._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: container._id,
      isDeleted: true,
    });

    const result = await asUser.query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: container._id,
    });

    expect(result.map((row) => row.threadId)).toEqual([live._id]);
  });

  test("drills into a group's members when given its ID", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const first = await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: container._id,
      pathId: "path-1",
      path: "/repo/path-1",
    });
    const second = await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: container._id,
      pathId: "path-1",
      path: "/repo/path-1",
    });
    // Another group's child must not leak into this drill-down.
    const otherContainer = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: otherContainer._id,
    });

    const result = await asUser.query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: container._id,
    });

    // Creation order (`by_parentThreadId`), the stable member order.
    expect(result.map((row) => row.threadId)).toEqual([first._id, second._id]);
    // Members are ordinary threads: full target, so a Group child can be spawned
    // beside one without another call.
    expect(result[0]).toMatchObject({
      parentThreadId: container._id,
      profileId: profile._id,
      pathId: "path-1",
      path: "/repo/path-1",
    });
  });

  /**
   * The whole group in one answer, up to `MAX_GROUP_CHILDREN`. This query takes
   * no `paginationOpts` at all — that is the point of it being separate from
   * `listSummaries` — so the only thing to pin here is that nothing truncates on
   * the way out. That `list_threads`' `limit` is ignored on this call shape is
   * pinned where `limit` exists, in `mcp/handler.test.ts`.
   */
  test("returns every member of the group", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    for (let index = 0; index < 5; index += 1) {
      await ctx.cliThread(user._id, project._id, profile._id, {
        parentThreadId: container._id,
      });
    }

    const result = await asUser.query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: container._id,
    });

    expect(result).toHaveLength(5);
  });

  test("filters done members in the drill-down too", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const active = await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: container._id,
      lastActivityAt: 2_000,
    });
    const done = await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: container._id,
      lastActivityAt: 1_000,
      doneAt: 5_000,
    });

    // In-memory here rather than indexed, which is safe only because the row
    // set is capped — the filter must still behave the same as the flat list's.
    const activeOnly = await asUser.query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: container._id,
    });
    expect(activeOnly.map((row) => row.threadId)).toEqual([active._id]);

    const all = await asUser.query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: container._id,
      includeDone: true,
    });
    expect(all.map((row) => row.threadId)).toEqual([active._id, done._id]);
  });

  test("returns nothing for a well-formed ID from another table", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    await ctx.cliThread(user._id, project._id, profile._id);

    // A `v.id("cliThreads")` argument would reject this in the argument
    // validator with a message `isConvexIdError` does not match, surfacing over
    // MCP as an opaque -32603 instead of an empty list. Agents hold projectIds.
    const result = await asUser.query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: project._id,
    });

    expect(result).toEqual([]);
  });

  test("returns nothing for an unparseable parentThreadId", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    await ctx.cliThread(user._id, project._id, profile._id);

    const result = await asUser.query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: "not-an-id",
    });

    expect(result).toEqual([]);
  });

  test("returns nothing when drilled into an ordinary thread", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);

    // Not "the thread itself": a plain thread has no members, and answering
    // with its own row would silently answer a different question.
    const result = await asUser.query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: thread._id,
    });

    expect(result).toEqual([]);
  });

  test("returns nothing when drilled into another user's group", async () => {
    const ctx = createTestContext();
    const { user: owner, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(owner._id, project._id, PATHS);
    const container = await ctx.cliThread(owner._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    await ctx.cliThread(owner._id, project._id, profile._id, { parentThreadId: container._id });
    const { user: stranger } = await ctx.setupProject();

    const result = await ctx.asUser(stranger).query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: container._id,
    });

    expect(result).toEqual([]);
  });

  test("lets a teammate drill into a shared group", async () => {
    const ctx = createTestContext();
    const { user: owner, org, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(owner._id, project._id, PATHS);
    const container = await ctx.cliThread(owner._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      sharedAt: Date.now(),
    });
    const child = await ctx.cliThread(owner._id, project._id, profile._id, {
      parentThreadId: container._id,
      pathId: "path-1",
      path: "/repo/path-1",
    });
    const teammate = await ctx.user();
    await ctx.orgMember(org._id, teammate._id, "member");
    await ctx.projectMember(project._id, teammate._id, "member");

    const result = await ctx.asUser(teammate).query(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: container._id,
    });

    // The container's `sharedAt` covers its members (OS-1579), so the
    // drill-down is authorized on the container — the same rule the web tabs
    // view follows. The flat list stays the caller's own threads.
    expect(result.map((row) => row.threadId)).toEqual([child._id]);
  });

  /**
   * That every group member belongs to the container's owner is a mutation-side
   * invariant, and this is a cross-user read seam — a shared group hands these
   * rows to a teammate — so the read must not trust it. A row parented here by
   * backfill or manual patch would otherwise be readable by whoever can read the
   * container.
   */
  test("omits a member that is not the container owner's", async () => {
    const ctx = createTestContext();
    const { user: owner, org, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(owner._id, project._id, PATHS);
    const container = await ctx.cliThread(owner._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      sharedAt: Date.now(),
    });
    const ownRow = await ctx.cliThread(owner._id, project._id, profile._id, {
      parentThreadId: container._id,
    });
    const teammate = await ctx.user();
    await ctx.orgMember(org._id, teammate._id, "member");
    await ctx.projectMember(project._id, teammate._id, "member");
    // Not reachable through `addThreadToGroup`, which pins the source's owner —
    // only through a backfill or a manual patch.
    const foreignProfile = await ctx.cliProfile(teammate._id, project._id, PATHS);
    await ctx.cliThread(teammate._id, project._id, foreignProfile._id, {
      parentThreadId: container._id,
    });

    const asOwner = ctx.asUser(owner);
    expect(
      (
        await asOwner.query(api.cli.threads.summaries.listGroupSummaries, {
          parentThreadId: container._id,
        })
      ).map((row) => row.threadId)
    ).toEqual([ownRow._id]);
    // And the teammate reading the shared group sees no more than the owner does.
    expect(
      (
        await ctx.asUser(teammate).query(api.cli.threads.summaries.listGroupSummaries, {
          parentThreadId: container._id,
        })
      ).map((row) => row.threadId)
    ).toEqual([ownRow._id]);
  });
});
