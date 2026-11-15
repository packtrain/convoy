import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";

function textChunk(text: string, createdAt: number) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text }] },
    }),
    createdAt,
  };
}

type TestClient = ReturnType<ReturnType<typeof createTestContext>["asUser"]>;

/**
 * Read-only thread sharing (OS-1574). The suite lives in its own file because
 * the rule spans four modules — threads, messages, messageChunks, and the
 * owner-only queries that must *not* follow it.
 */
describe("cli thread sharing", () => {
  /**
   * Owner + one project teammate on the same thread. `shared` decides whether
   * the thread carries `sharedAt`; `teammateProjectRole` exercises the
   * permission matrix (VIEWER has no CLI_THREAD permission).
   */
  async function setupSharing(
    options: {
      shared?: boolean;
      teammateProjectRole?: "project-admin" | "member" | "viewer";
    } = {}
  ) {
    const ctx = createTestContext();
    const { user: owner, org, project, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(owner._id, project._id, {
      paths: [{ id: "path-1", path: "/home/owner/repo", label: "repo" }],
    });
    const thread = await ctx.cliThread(owner._id, project._id, profile._id, {
      pathId: "path-1",
      title: "Owner thread",
      ...(options.shared ? { sharedAt: Date.now() } : {}),
    });

    const teammate = await ctx.user();
    await ctx.orgMember(org._id, teammate._id, "member");
    await ctx.projectMember(
      project._id,
      teammate._id,
      options.teammateProjectRole ?? "member"
    );

    return {
      ctx,
      t,
      owner,
      org,
      project,
      profile,
      thread,
      teammate,
      asOwner: ctx.asUser(owner),
      asTeammate: ctx.asUser(teammate),
    };
  }

  /** Every read query the sharing rule governs must come back empty. */
  async function expectNoReadAccess(
    as: TestClient,
    threadId: Id<"cliThreads">,
    messageId: Id<"cliMessages">
  ) {
    expect(await as.query(api.cli.threads.core.get, { threadId })).toBeNull();

    expect(
      await as.query(api.cli.messages.listEnvelopesByThread, { threadId })
    ).toEqual({ envelopes: [], hasOlderEnvelopes: false });

    const page = await as.query(api.cli.messages.listByThread, {
      threadId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toEqual([]);

    expect(
      (await as.query(api.cli.messageChunks.listWindowByThread, { threadId }))
        .page
    ).toEqual([]);
    expect(
      (
        await as.query(api.cli.messageChunks.listLiveByThread, {
          threadId,
          after: { createdAt: 1000, messageId, chunkOrder: 0 },
        })
      ).page
    ).toEqual([]);
    expect(
      (
        await as.query(api.cli.messageChunks.listNormalizedByMessages, {
          threadId,
          messageIds: [messageId],
        })
      ).page
    ).toEqual([]);
  }

  /**
   * The mirror of `expectNoReadAccess`: every read query the rule governs
   * answers. Asserted as a set rather than one representative query because
   * the three chunk queries reach the rule through their own helper.
   */
  async function expectFullReadAccess(
    as: TestClient,
    threadId: Id<"cliThreads">,
    messageId: Id<"cliMessages">
  ) {
    expect((await as.query(api.cli.threads.core.get, { threadId }))?._id).toBe(threadId);

    expect(
      (await as.query(api.cli.messages.listEnvelopesByThread, { threadId }))
        .envelopes
    ).not.toEqual([]);

    const page = await as.query(api.cli.messages.listByThread, {
      threadId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).not.toEqual([]);

    expect(
      (await as.query(api.cli.messageChunks.listWindowByThread, { threadId })).page
    ).toHaveLength(2);
    expect(
      (
        await as.query(api.cli.messageChunks.listLiveByThread, {
          threadId,
          after: { createdAt: 1000, messageId, chunkOrder: 0 },
        })
      ).page
    ).toHaveLength(1);
    expect(
      (
        await as.query(api.cli.messageChunks.listNormalizedByMessages, {
          threadId,
          messageIds: [messageId],
        })
      ).page
    ).toHaveLength(2);
  }

  /** A thread with one assistant message and two chunks to read. */
  async function withTranscript(
    fixture: Awaited<ReturnType<typeof setupSharing>>
  ) {
    const message = await fixture.ctx.cliMessage(
      fixture.thread._id,
      fixture.profile._id,
      { role: "assistant", status: "streaming", content: [] }
    );
    await fixture.ctx.cliMessageChunks(
      message._id,
      fixture.thread._id,
      fixture.profile._id,
      [textChunk("first", 1000), textChunk("second", 2000)]
    );
    return message;
  }

  describe("threads.listSharedByProject (OS-1576)", () => {
    const firstPage = { numItems: 10, cursor: null };

    test("returns the owner's shared, non-deleted threads, most recently shared first", async () => {
      const { ctx, owner, project, profile, thread, asOwner } =
        await setupSharing({ shared: true });
      // `setupSharing`'s thread is shared "now"; these bracket it so the
      // ordering assertion can't pass by insertion order alone.
      const sharedEarlier = await ctx.cliThread(
        owner._id,
        project._id,
        profile._id,
        { title: "Shared earlier", sharedAt: 1000 }
      );
      const sharedLater = await ctx.cliThread(
        owner._id,
        project._id,
        profile._id,
        { title: "Shared later", sharedAt: Date.now() + 10_000 }
      );
      await ctx.cliThread(owner._id, project._id, profile._id, {
        title: "Never shared",
      });
      const deleted = await ctx.cliThread(owner._id, project._id, profile._id, {
        title: "Shared then deleted",
        sharedAt: 2000,
        isDeleted: true,
      });

      const shared = await asOwner.query(api.cli.threads.lists.listSharedByProject, {
        projectId: project._id,
        paginationOpts: firstPage,
      });

      expect(shared.page.map((item) => item._id)).toEqual([
        sharedLater._id,
        thread._id,
        sharedEarlier._id,
      ]);
      expect(shared.page.map((item) => item._id)).not.toContain(deleted._id);
      expect(shared.page[0].sharedAt).toBe(sharedLater.sharedAt);
      expect(shared.isDone).toBe(true);
    });

    test("pages through the shared threads in order", async () => {
      const { ctx, owner, project, profile, asOwner } = await setupSharing();
      // Shared at 1000..5000, so the expected page order is fully determined.
      const threads = [];
      for (const sharedAt of [1000, 2000, 3000, 4000, 5000]) {
        threads.push(
          await ctx.cliThread(owner._id, project._id, profile._id, {
            title: `Shared at ${sharedAt}`,
            sharedAt,
          })
        );
      }
      const newestFirst = [...threads].reverse().map((item) => item._id);

      const page1 = await asOwner.query(api.cli.threads.lists.listSharedByProject, {
        projectId: project._id,
        paginationOpts: { numItems: 2, cursor: null },
      });
      expect(page1.page.map((item) => item._id)).toEqual(newestFirst.slice(0, 2));
      expect(page1.isDone).toBe(false);

      const page2 = await asOwner.query(api.cli.threads.lists.listSharedByProject, {
        projectId: project._id,
        paginationOpts: { numItems: 2, cursor: page1.continueCursor },
      });
      expect(page2.page.map((item) => item._id)).toEqual(newestFirst.slice(2, 4));

      const page3 = await asOwner.query(api.cli.threads.lists.listSharedByProject, {
        projectId: project._id,
        paginationOpts: { numItems: 2, cursor: page2.continueCursor },
      });
      expect(page3.page.map((item) => item._id)).toEqual(newestFirst.slice(4));
      expect(page3.isDone).toBe(true);
    });

    test("excludes another user's shared threads in the same project", async () => {
      const { ctx, project, teammate, asTeammate } = await setupSharing({
        shared: true,
      });
      const teammateProfile = await ctx.cliProfile(teammate._id, project._id, {
        paths: [{ id: "path-2", path: "/home/teammate/repo", label: "repo" }],
      });
      const own = await ctx.cliThread(
        teammate._id,
        project._id,
        teammateProfile._id,
        { pathId: "path-2", title: "Teammate's own shared", sharedAt: 3000 }
      );

      const shared = await asTeammate.query(
        api.cli.threads.lists.listSharedByProject,
        { projectId: project._id, paginationOpts: firstPage }
      );

      expect(shared.page.map((item) => item._id)).toEqual([own._id]);
    });

    test("excludes the caller's own shared threads in another project", async () => {
      const { ctx, owner, org, project, thread, asOwner } = await setupSharing({
        shared: true,
      });
      const otherProject = await ctx.project(org._id, owner._id);
      const otherProfile = await ctx.cliProfile(owner._id, otherProject._id, {
        paths: [{ id: "path-2", path: "/home/owner/other", label: "other" }],
      });
      const elsewhere = await ctx.cliThread(
        owner._id,
        otherProject._id,
        otherProfile._id,
        { pathId: "path-2", title: "Shared elsewhere", sharedAt: 5000 }
      );

      const here = await asOwner.query(api.cli.threads.lists.listSharedByProject, {
        projectId: project._id,
        paginationOpts: firstPage,
      });
      const there = await asOwner.query(api.cli.threads.lists.listSharedByProject, {
        projectId: otherProject._id,
        paginationOpts: firstPage,
      });

      expect(here.page.map((item) => item._id)).toEqual([thread._id]);
      expect(there.page.map((item) => item._id)).toEqual([elsewhere._id]);
    });

    // The index is not parent-aware, so a shared group child would surface here
    // as a standalone row. `share` rejecting children keeps that unreachable,
    // and the group addition's transfer (OS-1579) must land the flag on the container —
    // a list row already — rather than leaving it on the reparented child.
    test("the first group addition moves the shared row from the thread to its new group", async () => {
      const fixture = await setupSharing({ shared: true });

      const before = await fixture.asOwner.query(
        api.cli.threads.lists.listSharedByProject,
        { projectId: fixture.project._id, paginationOpts: firstPage }
      );
      expect(before.page.map((item) => item._id)).toEqual([
        fixture.thread._id,
      ]);

      const { containerId } = await fixture.asOwner.mutation(
        api.cli.threads.groups.addThreadToGroup,
        {
          sourceThreadId: fixture.thread._id,
          profileId: fixture.profile._id,
          pathId: "path-1",
          cliType: "claude-code",
          content: "Group child task",
        }
      );

      const after = await fixture.asOwner.query(
        api.cli.threads.lists.listSharedByProject,
        { projectId: fixture.project._id, paginationOpts: firstPage }
      );

      // The container, once — never the reparented child alongside it.
      expect(after.page.map((item) => item._id)).toEqual([containerId]);
    });

    test("returns nothing without project access", async () => {
      const { ctx, project } = await setupSharing({ shared: true });
      const outsider = await ctx.user();

      const shared = await ctx
        .asUser(outsider)
        .query(api.cli.threads.lists.listSharedByProject, {
          projectId: project._id,
          paginationOpts: firstPage,
        });

      expect(shared.page).toEqual([]);
      expect(shared.isDone).toBe(true);
    });
  });

  describe("threads.get", () => {
    test("teammate reads a shared thread and sees isOwner false", async () => {
      const { thread, asTeammate } = await setupSharing({ shared: true });

      const result = await asTeammate.query(api.cli.threads.core.get, {
        threadId: thread._id,
      });

      expect(result?._id).toBe(thread._id);
      expect(result?.isOwner).toBe(false);
    });
  });

  describe("messages", () => {
    test("teammate reads message envelopes and pages on a shared thread", async () => {
      const { ctx, thread, profile, asTeammate } = await setupSharing({
        shared: true,
      });
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        status: "completed",
        content: [],
      });

      const { envelopes } = await asTeammate.query(
        api.cli.messages.listEnvelopesByThread,
        { threadId: thread._id }
      );
      expect(envelopes.map((envelope) => envelope._id)).toEqual([message._id]);

      const page = await asTeammate.query(api.cli.messages.listByThread, {
        threadId: thread._id,
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(page.page.map((item) => item._id)).toEqual([message._id]);
    });
  });

  describe("messageChunks", () => {
    test("teammate reads all three chunk queries on a shared thread", async () => {
      const { ctx, thread, profile, asTeammate } = await setupSharing({
        shared: true,
      });
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        status: "streaming",
        content: [],
      });
      const chunks = await ctx.cliMessageChunks(
        message._id,
        thread._id,
        profile._id,
        [textChunk("first", 1000), textChunk("second", 2000)]
      );
      const firstCursor = {
        createdAt: chunks[0].createdAt,
        messageId: chunks[0].messageId,
        chunkOrder: chunks[0].chunkOrder,
      };

      const window = await asTeammate.query(
        api.cli.messageChunks.listWindowByThread,
        { threadId: thread._id }
      );
      expect(window.page).toHaveLength(2);

      const live = await asTeammate.query(
        api.cli.messageChunks.listLiveByThread,
        { threadId: thread._id, after: firstCursor }
      );
      expect(live.page).toHaveLength(1);

      const byMessages = await asTeammate.query(
        api.cli.messageChunks.listNormalizedByMessages,
        { threadId: thread._id, messageIds: [message._id] }
      );
      expect(byMessages.page).toHaveLength(2);
    });
  });

  describe("access boundary", () => {
    test("owner reads their own thread with isOwner true", async () => {
      const { thread, asOwner } = await setupSharing();

      const result = await asOwner.query(api.cli.threads.core.get, {
        threadId: thread._id,
      });

      expect(result?._id).toBe(thread._id);
      expect(result?.isOwner).toBe(true);
    });

    test("teammate gets nothing from an unshared thread", async () => {
      const fixture = await setupSharing();
      const message = await withTranscript(fixture);

      await expectNoReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });

    test("project viewer gets nothing even when the thread is shared", async () => {
      const fixture = await setupSharing({
        shared: true,
        teammateProjectRole: "viewer",
      });
      const message = await withTranscript(fixture);

      await expectNoReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });

    test("org admin with no project membership gets nothing from a shared thread (OS-1536)", async () => {
      const fixture = await setupSharing({ shared: true });
      const message = await withTranscript(fixture);
      const admin = await fixture.ctx.user();
      await fixture.ctx.orgMember(fixture.org._id, admin._id, "admin");

      await expectNoReadAccess(
        fixture.ctx.asUser(admin),
        fixture.thread._id,
        message._id
      );
    });

    test("outsider gets nothing even when the thread is shared", async () => {
      const fixture = await setupSharing({ shared: true });
      const message = await withTranscript(fixture);
      const outsider = await fixture.ctx.user();

      await expectNoReadAccess(
        fixture.ctx.asUser(outsider),
        fixture.thread._id,
        message._id
      );
    });

    test("teammate gets nothing from a deleted shared thread", async () => {
      const fixture = await setupSharing({ shared: true });
      const message = await withTranscript(fixture);
      await fixture.t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", fixture.thread._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      await expectNoReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });
  });

  describe("share / unshare", () => {
    test("owner shares, teammate reads, owner unshares, access is revoked", async () => {
      const fixture = await setupSharing();
      const message = await withTranscript(fixture);

      await fixture.asOwner.mutation(api.cli.threads.core.share, {
        threadId: fixture.thread._id,
      });

      const shared = await fixture.asTeammate.query(api.cli.threads.core.get, {
        threadId: fixture.thread._id,
      });
      expect(shared?._id).toBe(fixture.thread._id);
      expect(shared?.sharedAt).toBeGreaterThan(0);

      await fixture.asOwner.mutation(api.cli.threads.core.unshare, {
        threadId: fixture.thread._id,
      });

      await expectNoReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
      await fixture.t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", fixture.thread._id);
        expect(thread?.sharedAt).toBeUndefined();
      });
    });

    test("share is idempotent and keeps the original timestamp stable enough to re-read", async () => {
      const fixture = await setupSharing();

      await fixture.asOwner.mutation(api.cli.threads.core.share, {
        threadId: fixture.thread._id,
      });
      await fixture.asOwner.mutation(api.cli.threads.core.share, {
        threadId: fixture.thread._id,
      });

      const result = await fixture.asTeammate.query(api.cli.threads.core.get, {
        threadId: fixture.thread._id,
      });
      expect(result?.sharedAt).toBeGreaterThan(0);
    });

    test("unshare on a never-shared thread is a no-op", async () => {
      const fixture = await setupSharing();

      await fixture.asOwner.mutation(api.cli.threads.core.unshare, {
        threadId: fixture.thread._id,
      });

      await fixture.t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", fixture.thread._id);
        expect(thread?.sharedAt).toBeUndefined();
      });
    });

    test("teammate cannot share someone else's thread", async () => {
      const fixture = await setupSharing({ shared: true });

      await expect(
        fixture.asTeammate.mutation(api.cli.threads.core.share, {
          threadId: fixture.thread._id,
        })
      ).rejects.toThrow("Not authorized");
      await expect(
        fixture.asTeammate.mutation(api.cli.threads.core.unshare, {
          threadId: fixture.thread._id,
        })
      ).rejects.toThrow("Not authorized");
    });

    // Groups became shareable in OS-1579; run containers did not — a run
    // answers only to its starting user (OS-1366).
    test("workflow run containers cannot be shared", async () => {
      const fixture = await setupSharing();
      const { runId } = await fixture.ctx.workflowRun(
        fixture.owner._id,
        fixture.project._id,
        fixture.profile._id
      );
      const container = await fixture.ctx.cliThread(
        fixture.owner._id,
        fixture.project._id,
        fixture.profile._id,
        { kind: "group", workflowRunId: runId, title: "Run" }
      );

      await expect(
        fixture.asOwner.mutation(api.cli.threads.core.share, {
          threadId: container._id,
        })
      ).rejects.toThrow("Workflow runs cannot be shared");
    });

    test("group children cannot be shared", async () => {
      const fixture = await setupSharing();
      const container = await fixture.ctx.cliThread(
        fixture.owner._id,
        fixture.project._id,
        fixture.profile._id,
        { kind: "group", title: "Group" }
      );
      const child = await fixture.ctx.cliThread(
        fixture.owner._id,
        fixture.project._id,
        fixture.profile._id,
        { parentThreadId: container._id, title: "Child" }
      );

      await expect(
        fixture.asOwner.mutation(api.cli.threads.core.share, {
          threadId: child._id,
        })
      ).rejects.toThrow("Threads inside a group cannot be shared");
    });

    test("sharing a missing thread is idempotent", async () => {
      const fixture = await setupSharing();
      const removedId = fixture.thread._id;
      await fixture.t.run(async (runCtx) => {
        await runCtx.db.delete("cliThreads", removedId);
      });

      await expect(
        fixture.asOwner.mutation(api.cli.threads.core.share, { threadId: removedId })
      ).resolves.toBeNull();
    });
  });

  describe("owner-only reads stay owner-only on a shared thread", () => {
    test("composer, interaction, and continuation queries return empty", async () => {
      const fixture = await setupSharing({ shared: true });

      expect(
        await fixture.asTeammate.query(
          api.cli.interactionRequests.listPendingByThread,
          { threadId: fixture.thread._id }
        )
      ).toEqual([]);
      expect(
        await fixture.asTeammate.query(api.cli.facts.getThreadRuntimeCommands, {
          threadId: fixture.thread._id,
        })
      ).toEqual([]);
      expect(
        await fixture.asTeammate.query(
          api.cli.messages.getLatestContinuationForThread,
          { threadId: fixture.thread._id }
        )
      ).toBeNull();
    });

    test("getGroup returns null for a teammate on an unshared group", async () => {
      const fixture = await setupSharing();
      const container = await fixture.ctx.cliThread(
        fixture.owner._id,
        fixture.project._id,
        fixture.profile._id,
        { kind: "group", title: "Group" }
      );

      expect(
        await fixture.asTeammate.query(api.cli.threads.groups.getGroup, {
          containerId: container._id,
        })
      ).toBeNull();
    });
  });

  /**
   * Sharing a group as a unit (OS-1579). The flag lives on the container and
   * nowhere else: a child is readable because *its container* is shared, which
   * is what keeps the shared-threads index (not parent-aware) honest.
   */
  describe("group sharing (OS-1579)", () => {
    /**
     * The fixture's thread, reparented under a container. Patched directly
     * rather than through `addThreadToGroup` so each test controls whether the
     * container carries `sharedAt` — the transfer path is tested separately.
     */
    async function setupSharedGroup({
      shared = true,
      runOwned = false,
    }: { shared?: boolean; runOwned?: boolean } = {}) {
      const fixture = await setupSharing();
      const workflowRunId = runOwned
        ? (await fixture.ctx.workflowRun(fixture.owner._id, fixture.project._id, fixture.profile._id)).runId
        : undefined;
      const container = await fixture.ctx.cliThread(
        fixture.owner._id,
        fixture.project._id,
        fixture.profile._id,
        {
          kind: "group",
          workflowRunId,
          title: "Group",
          ...(shared ? { sharedAt: Date.now() } : {}),
        }
      );
      const groupChild = await fixture.ctx.cliThread(
        fixture.owner._id,
        fixture.project._id,
        fixture.profile._id,
        { parentThreadId: container._id, title: "Group child" }
      );
      await fixture.t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", fixture.thread._id, {
          parentThreadId: container._id,
        });
      });
      return { ...fixture, container, groupChild };
    }

    test("teammate reads a child of a shared group", async () => {
      const fixture = await setupSharedGroup();
      const message = await withTranscript(fixture);

      await expectFullReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });

    test("teammate gets nothing from a child whose group is not shared", async () => {
      const fixture = await setupSharedGroup({ shared: false });
      const message = await withTranscript(fixture);

      await expectNoReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });

    test("teammate reads the container itself, and its tab strip", async () => {
      const fixture = await setupSharedGroup();

      expect(
        (await fixture.asTeammate.query(api.cli.threads.core.get, {
          threadId: fixture.container._id,
        }))?.isOwner
      ).toBe(false);

      const group = await fixture.asTeammate.query(api.cli.threads.groups.getGroup, {
        containerId: fixture.container._id,
      });
      expect(group?.children.map((child) => child._id).sort()).toEqual(
        [fixture.thread._id, fixture.groupChild._id].sort()
      );
    });

    test("a child carries its group's share state for the header badge", async () => {
      const fixture = await setupSharedGroup();

      const child = await fixture.asOwner.query(api.cli.threads.core.get, {
        threadId: fixture.thread._id,
      });

      expect(child?.sharedAt).toBeUndefined();
      expect(child?.containerSharedAt).toBe(fixture.container.sharedAt);
    });

    test("a child in an unshared group has no group share state", async () => {
      const fixture = await setupSharedGroup({ shared: false });

      const child = await fixture.asOwner.query(api.cli.threads.core.get, {
        threadId: fixture.thread._id,
      });

      expect(child?.containerSharedAt).toBeUndefined();
    });

    test("owner shares and unshares a group container", async () => {
      const fixture = await setupSharedGroup({ shared: false });
      const message = await withTranscript(fixture);

      await fixture.asOwner.mutation(api.cli.threads.core.share, {
        threadId: fixture.container._id,
      });
      await expectFullReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );

      await fixture.asOwner.mutation(api.cli.threads.core.unshare, {
        threadId: fixture.container._id,
      });
      await expectNoReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });

    test("group children still cannot be shared individually", async () => {
      const fixture = await setupSharedGroup({ shared: false });

      await expect(
        fixture.asOwner.mutation(api.cli.threads.core.share, {
          threadId: fixture.thread._id,
        })
      ).rejects.toThrow("Threads inside a group cannot be shared");
    });

    // The point of the transfer: the link the owner handed out before the
    // split keeps working, now covered by the container instead of the thread.
    test("adding a thread to a shared thread transfers the share to the new group", async () => {
      const fixture = await setupSharing({ shared: true });
      const message = await withTranscript(fixture);

      const { containerId } = await fixture.asOwner.mutation(
        api.cli.threads.groups.addThreadToGroup,
        {
          sourceThreadId: fixture.thread._id,
          profileId: fixture.profile._id,
          pathId: "path-1",
          cliType: "claude-code",
          content: "Group child task",
        }
      );

      await fixture.t.run(async (runCtx) => {
        const source = await runCtx.db.get("cliThreads", fixture.thread._id);
        expect(source?.parentThreadId).toBe(containerId);
        // Never both: the child would leak into the shared-threads view.
        expect(source?.sharedAt).toBeUndefined();
        const container = await runCtx.db.get("cliThreads", containerId);
        expect(container?.sharedAt).toBe(fixture.thread.sharedAt);
      });

      await expectFullReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });

    test("adding a thread to an unshared thread shares nothing", async () => {
      const fixture = await setupSharing();

      const { containerId } = await fixture.asOwner.mutation(
        api.cli.threads.groups.addThreadToGroup,
        {
          sourceThreadId: fixture.thread._id,
          profileId: fixture.profile._id,
          pathId: "path-1",
          cliType: "claude-code",
          content: "Group child task",
        }
      );

      await fixture.t.run(async (runCtx) => {
        expect(
          (await runCtx.db.get("cliThreads", containerId))?.sharedAt
        ).toBeUndefined();
      });
    });

    test("a deleted container revokes its children", async () => {
      const fixture = await setupSharedGroup();
      const message = await withTranscript(fixture);
      await fixture.t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", fixture.container._id, {
          isDeleted: true,
        });
      });

      await expectNoReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });

    /**
     * The reachable-by-UI version of the deleted-container case: emptying a
     * group soft-deletes the container (OS-1474), and the share lives nowhere
     * else. The ex-child does not inherit it — same as the pin, which a
     * dissolving group also does not give back.
     */
    test("moving the last child out dissolves the group and revokes its link", async () => {
      const fixture = await setupSharedGroup();
      const message = await withTranscript(fixture);
      await expectFullReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );

      await fixture.asOwner.mutation(api.cli.threads.groups.moveChildOut, {
        threadId: fixture.groupChild._id,
      });
      await fixture.asOwner.mutation(api.cli.threads.groups.moveChildOut, {
        threadId: fixture.thread._id,
      });

      await fixture.t.run(async (runCtx) => {
        expect(
          (await runCtx.db.get("cliThreads", fixture.container._id))?.isDeleted
        ).toBe(true);
        const movedOut = await runCtx.db.get("cliThreads", fixture.thread._id);
        expect(movedOut?.parentThreadId).toBeUndefined();
        expect(movedOut?.sharedAt).toBeUndefined();
      });

      await expectNoReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });

    /**
     * `share` rejects run containers, so a `sharedAt` can only reach one by
     * backfill or manual patch — which is exactly what this fixture does. The
     * access rule must refuse it on its own rather than trusting that guard:
     * a run answers only to its starting user (OS-1366).
     */
    test("a shared workflow run container does not cover its children", async () => {
      const fixture = await setupSharedGroup({ runOwned: true });
      const message = await withTranscript(fixture);

      await expectNoReadAccess(
        fixture.asTeammate,
        fixture.thread._id,
        message._id
      );
    });

    test("project viewer gets nothing from a shared group", async () => {
      const fixture = await setupSharedGroup();
      const message = await withTranscript(fixture);
      const viewer = await fixture.ctx.user();
      await fixture.ctx.orgMember(fixture.org._id, viewer._id, "member");
      await fixture.ctx.projectMember(fixture.project._id, viewer._id, "viewer");

      await expectNoReadAccess(
        fixture.ctx.asUser(viewer),
        fixture.thread._id,
        message._id
      );
    });

    test("writes stay owner-only on a child of a shared group", async () => {
      const fixture = await setupSharedGroup();

      await expect(
        fixture.asTeammate.mutation(api.cli.threads.core.updateTitle, {
          threadId: fixture.thread._id,
          title: "Renamed by a viewer",
        })
      ).rejects.toThrow();
      await expect(
        fixture.asTeammate.mutation(api.cli.threads.core.unshare, {
          threadId: fixture.container._id,
        })
      ).rejects.toThrow("Not authorized");
    });
  });

  describe("writes stay owner-only on a shared thread", () => {
    type WriteArgs = {
      as: TestClient;
      threadId: Id<"cliThreads">;
      userMessageId: Id<"cliMessages">;
    };

    /**
     * Sharing grants reads only. Exhaustive rather than a sample: this is the
     * phase's safety property, and a write that quietly followed the read rule
     * would let a teammate steer someone else's agent.
     */
    const WRITE_CASES: Array<[string, (args: WriteArgs) => Promise<unknown>]> = [
      [
        "threads.updateTitle",
        ({ as, threadId }) =>
          as.mutation(api.cli.threads.core.updateTitle, { threadId, title: "Nope" }),
      ],
      [
        "threads.markRead",
        ({ as, threadId }) => as.mutation(api.cli.threads.core.markRead, { threadId }),
      ],
      [
        "threads.markUnread",
        ({ as, threadId }) =>
          as.mutation(api.cli.threads.core.markUnread, { threadId }),
      ],
      [
        "threads.cancelProcessing",
        ({ as, threadId }) =>
          as.mutation(api.cli.threads.runControl.cancelProcessing, { threadId }),
      ],
      [
        "threads.remove",
        ({ as, threadId }) => as.mutation(api.cli.threads.core.remove, { threadId }),
      ],
      [
        "threads.pin",
        ({ as, threadId }) => as.mutation(api.cli.threads.core.pin, { threadId }),
      ],
      [
        "threads.unpin",
        ({ as, threadId }) => as.mutation(api.cli.threads.core.unpin, { threadId }),
      ],
      [
        "messages.send",
        ({ as, threadId }) =>
          as.mutation(api.cli.messages.send, { threadId, content: "hello" }),
      ],
      [
        "messages.backfillLegacyContentForThread",
        ({ as, threadId }) =>
          as.mutation(api.cli.messages.backfillLegacyContentForThread, {
            threadId,
          }),
      ],
      [
        "messages.requestSteer",
        ({ as, userMessageId }) =>
          as.mutation(api.cli.messages.requestSteer, {
            messageId: userMessageId,
          }),
      ],
      [
        "messages.removeQueued",
        ({ as, userMessageId }) =>
          as.mutation(api.cli.messages.removeQueued, {
            messageId: userMessageId,
          }),
      ],
      [
        "messages.editLastResend",
        ({ as, userMessageId }) =>
          as.mutation(api.cli.messages.editLastResend, {
            messageId: userMessageId,
            content: "edited",
          }),
      ],
      [
        "messages.retry",
        ({ as, userMessageId }) =>
          as.mutation(api.cli.messages.retry, { messageId: userMessageId }),
      ],
      [
        "interactionRequests.respond",
        ({ as, threadId }) =>
          as.mutation(api.cli.interactionRequests.respond, {
            threadId,
            requestId: "request-1",
            responseJson: "{}",
          }),
      ],
    ];

    test.each(WRITE_CASES)("%s rejects a teammate", async (_name, run) => {
      const fixture = await setupSharing({ shared: true });
      const userMessage = await fixture.ctx.cliMessage(
        fixture.thread._id,
        fixture.profile._id,
        { role: "user", status: "pending" }
      );

      await expect(
        run({
          as: fixture.asTeammate,
          threadId: fixture.thread._id,
          userMessageId: userMessage._id,
        })
      ).rejects.toThrow("Not authorized");
    });

    test("batch actions silently skip a shared thread the caller doesn't own", async () => {
      const fixture = await setupSharing({ shared: true });

      await fixture.asTeammate.mutation(api.cli.threads.batch.batchMarkDone, {
        threadIds: [fixture.thread._id],
      });
      await fixture.asTeammate.mutation(api.cli.threads.batch.batchMarkRead, {
        threadIds: [fixture.thread._id],
      });
      await fixture.asTeammate.mutation(api.cli.threads.batch.batchRemove, {
        threadIds: [fixture.thread._id],
      });

      await fixture.t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", fixture.thread._id);
        expect(thread?.doneAt).toBeUndefined();
        expect(thread?.readAt).toBeUndefined();
        expect(thread?.isDeleted).toBe(false);
      });
    });
  });
});
