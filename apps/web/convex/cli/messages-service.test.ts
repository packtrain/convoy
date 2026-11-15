import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext, setupFakeTimers } from "../../convex-testing";

setupFakeTimers();
async function fixture() {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);
  const thread = await ctx.cliThread(user._id, project._id, profile._id);
  const key = await asUser.mutation(api.apiKeys.core.create, { name: "service", expiresAt: Date.now() + 86400000,
    scope: { organizationId: project.organizationId, projectIds: [project._id] } });
  return { ctx, user, project, profile, thread, key, asUser, t };
}
describe("service run readers", () => {
  test("paginates assistant runs, preserving run IDs and excluding user messages", async () => {
    const { ctx, project, profile, thread, key, t } = await fixture();
    await ctx.cliMessage(thread._id, profile._id, { role: "assistant", runId: "one", createdAt: 1 });
    await ctx.cliMessage(thread._id, profile._id, { role: "user", createdAt: 2 });
    await ctx.cliMessage(thread._id, profile._id, { role: "assistant", runId: "two", createdAt: 3 });
    const args = { threadId: thread._id, projectId: project._id, apiKey: key.key };
    const first = await t.query(api.cli.messages.listServiceRuns, { ...args, paginationOpts: { numItems: 1, cursor: null } });
    expect(first.page.map(r => r.runId)).toEqual(["two"]);
    const second = await t.query(api.cli.messages.listServiceRuns, { ...args, paginationOpts: { numItems: 1, cursor: first.continueCursor } });
    expect(second.page.map(r => r.runId)).toEqual(["one"]);
  });
  test("returns normalized chunks in order and advances a bounded durable cursor", async () => {
    const { ctx, project, profile, thread, key, t } = await fixture();
    const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant", runId: "one" });
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, Array.from({ length: 12 }, (_, i) => ({ type: "text", data: `part${i}`, chunkOrder: i, createdAt: i + 1 })));
    const args = { threadId: thread._id, projectId: project._id, apiKey: key.key, messageId: message._id };
    const first = await t.query(api.cli.messages.getServiceRunLogs, args);
    expect(first.page).toHaveLength(10); expect(first.hasMore).toBe(true);
    const second = await t.query(api.cli.messages.getServiceRunLogs, { ...args, after: first.cursor });
    expect(second.page).toHaveLength(2); expect(second.hasMore).toBe(false);
    expect(second.page[0].order).toBeGreaterThan(first.cursor);
    expect(first.run.runId).toBe("one");
  });
  test("rejects expired credentials, another project, private threads and mismatched messages", async () => {
    const { ctx, user, project, profile, thread, key, t } = await fixture();
    const args = { threadId: thread._id, projectId: project._id, apiKey: key.key, paginationOpts: { numItems: 10, cursor: null } };
    const otherProject = await ctx.project(project.organizationId, user._id);
    await expect(t.query(api.cli.messages.listServiceRuns, { ...args, projectId: otherProject._id })).rejects.toThrow("selected project");
    const other = await ctx.user();
    const privateThread = await ctx.cliThread(other._id, project._id, profile._id);
    await expect(t.query(api.cli.messages.listServiceRuns, { ...args, threadId: privateThread._id })).rejects.toThrow();
    const otherThread = await ctx.cliThread(user._id, project._id, profile._id);
    const otherMessage = await ctx.cliMessage(otherThread._id, profile._id, { role: "assistant" });
    await expect(t.query(api.cli.messages.getServiceRunLogs, { threadId: thread._id, projectId: project._id, apiKey: key.key, messageId: otherMessage._id })).rejects.toThrow("Message not found");
    await t.run(c => c.db.patch("apiKeys", key.id, { expiresAt: Date.now() - 1 }));
    await expect(t.query(api.cli.messages.listServiceRuns, args)).rejects.toThrow();
  });
  test("marks oversized individual events as truncated within the transport budget", async () => {
    const { ctx, project, profile, thread, key, t } = await fixture();
    const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant", runId: "one" });
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [{ type: "text", data: "€".repeat(10000) }]);
    const result = await t.query(api.cli.messages.getServiceRunLogs, { threadId: thread._id, projectId: project._id, apiKey: key.key, messageId: message._id });
    expect(result.page[0].truncated).toBe(true);
    expect(result.page[0].eventJson.length).toBeLessThanOrEqual(2000);
  });
});

test("service list includes grouped execution threads and rejects an expired key", async () => {
  const { ctx, user, project, profile, thread, key, t } = await fixture();
  const child = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: thread._id, status: "pending", hasPendingUserMessages: true });
  const args = { projectId: project._id, apiKey: key.key, paginationOpts: { numItems: 10, cursor: null } };
  const result = await t.query(api.cli.threads.summaries.listServiceSummaries, args);
  expect(result.page.map(row => row.threadId)).toContain(child._id);
  await t.run(c => c.db.patch("apiKeys", key.id, { expiresAt: Date.now() - 1 }));
  await expect(t.query(api.cli.threads.summaries.listServiceSummaries, args)).rejects.toThrow();
});

test("service reads and cancellation preserve scoped-key and ownership boundaries", async () => {
  const { ctx, user, project, profile, thread, asUser, t } = await fixture();
  const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant", status: "streaming", runId: "active" });
  await t.run(c => c.db.patch("cliThreads", thread._id, { activeAssistantMessageId: message._id, processingState: "streaming" }));
  const otherOrg = await ctx.organization(user._id, { slug: "other" });
  const scoped = await asUser.mutation(api.apiKeys.core.create, { name: "wrong", expiresAt: Date.now() + 86400000, scope: { organizationId: otherOrg._id, projectIds: [] } });
  await expect(t.query(api.cli.messages.listServiceRuns, { threadId: thread._id, projectId: project._id, apiKey: scoped.key, paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow();
  await expect(t.query(api.cli.messages.getServiceRunLogs, { threadId: thread._id, projectId: project._id, apiKey: scoped.key, messageId: message._id })).rejects.toThrow();
  await expect(t.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: thread._id, apiKey: scoped.key, expectedRunId: "active" })).rejects.toThrow();
  const other = await ctx.user();
  await ctx.orgMember(project.organizationId, other._id, "admin");
  await ctx.projectMember(project._id, other._id, "member");
  await expect(ctx.asUser(other).mutation(api.cli.threads.runControl.cancelProcessing, { threadId: thread._id, expectedRunId: "active" })).rejects.toThrow();
  expect((await t.run(c => c.db.get("cliMessages", message._id)))?.status).toBe("streaming");
});

test.each([-2, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects invalid log cursor %s with a cursor diagnostic", async after => {
  const { ctx, project, profile, thread, key, t } = await fixture();
  const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant" });
  await expect(t.query(api.cli.messages.getServiceRunLogs, { threadId: thread._id, projectId: project._id, apiKey: key.key, messageId: message._id, after })).rejects.toThrow("Invalid stored run log cursor");
});

test("API-key cancellation requires an explicit run selection and preserves active work", async () => {
  const { ctx, profile, thread, key, t } = await fixture();
  const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant", status: "streaming", runId: "active" });
  await t.run(c => c.db.patch("cliThreads", thread._id, { activeAssistantMessageId: message._id, processingState: "streaming" }));
  await expect(t.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: thread._id, apiKey: key.key })).rejects.toThrow("Select a run ID before cancelling from the service");
  expect((await t.run(c => c.db.get("cliMessages", message._id)))?.status).toBe("streaming");
});

test("service pages expose task references only for active tasks in the selected project", async () => {
  const { ctx, user, project, profile, thread, key, t } = await fixture();
  const task = await ctx.task(project._id, user._id);
  await t.run(c => c.db.patch("cliThreads", thread._id, { associatedTaskId: task._id }));
  const repeated = await ctx.cliThread(user._id, project._id, profile._id, { associatedTaskId: task._id });
  const unlinked = await ctx.cliThread(user._id, project._id, profile._id);
  const args = { projectId: project._id, apiKey: key.key, paginationOpts: { numItems: 20, cursor: null } };
  const page = (await t.query(api.cli.threads.summaries.listServiceSummaries, args)).page;
  expect(page.find(row => row.threadId === thread._id)).toMatchObject({ associatedTaskRef: `${project.alias}-${task.refNumber}` });
  expect(page.find(row => row.threadId === repeated._id)).toMatchObject({ associatedTaskRef: `${project.alias}-${task.refNumber}` });
  expect(page.find(row => row.threadId === unlinked._id)).not.toHaveProperty("associatedTaskRef");
  await t.run(c => c.db.patch("tasks", task._id, { isDeleted: true }));
  const deleted = (await t.query(api.cli.threads.summaries.listServiceSummaries, args)).page;
  expect(deleted.find(row => row.threadId === thread._id)).not.toHaveProperty("associatedTaskRef");
  const otherProject = await ctx.project(project.organizationId, user._id);
  await t.run(c => c.db.patch("tasks", task._id, { isDeleted: false, projectId: otherProject._id }));
  const moved = (await t.query(api.cli.threads.summaries.listServiceSummaries, args)).page;
  expect(moved.find(row => row.threadId === thread._id)).not.toHaveProperty("associatedTaskRef");
  await t.run(c => c.db.delete("tasks", task._id));
  expect((await t.query(api.cli.threads.summaries.listServiceSummaries, args)).page).toHaveLength(3);
});


test("raw service logs preserve nested stored payloads larger than the preview limit", async () => {
  const { ctx, project, profile, thread, key, t } = await fixture();
  const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant" });
  const payload = { type: "assistant", nested: { text: "hello".repeat(600), flags: [true, 42] } };
  await ctx.cliMessageChunks(message._id, thread._id, profile._id, [{ type: "assistant", data: JSON.stringify(payload) }]);
  const result = await t.query(api.cli.messages.getServiceRunLogs, {
    threadId: thread._id, projectId: project._id, apiKey: key.key, messageId: message._id, raw: true,
  });
  expect(JSON.parse(result.page[0].eventJson)).toEqual(payload);
  expect(result.page[0].truncated).toBe(false);
});

test("raw history pages backwards and retrieves oversized stored JSON in bounded fragments", async () => {
  const { ctx, project, profile, thread, key, t } = await fixture();
  const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant" });
  const payload = { nested: { text: "😀€\\\"".repeat(18000) } };
  await ctx.cliMessageChunks(message._id, thread._id, profile._id, Array.from({ length: 12 }, (_, i) => ({ type: "assistant", data: i === 11 ? JSON.stringify(payload) : JSON.stringify({ i }), chunkOrder: i })));
  const args = { threadId: thread._id, projectId: project._id, apiKey: key.key, messageId: message._id, raw: true };
  const tail = await t.query(api.cli.messages.getServiceRunLogs, { ...args, before: Number.MAX_SAFE_INTEGER });
  expect(tail.page.map(row => row.order)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(tail.latest).toBe(11); expect(tail.hasMore).toBe(true);
  expect(tail.page.at(-1)).toMatchObject({ eventJson: "", nextOffset: 0, truncated: false });
  const older = await t.query(api.cli.messages.getServiceRunLogs, { ...args, before: 2 });
  expect(older.page.map(row => row.order)).toEqual([0, 1]); expect(older.hasMore).toBe(false);
  let offset = 0, json = "";
  do {
    const result = await t.query(api.cli.messages.getServiceRunLogs, { ...args, eventOrder: 11, offset });
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(128 * 1024);
    const row = result.page[0]; json += row.eventJson;
    if (!("nextOffset" in row) || row.nextOffset === undefined) break;
    expect(row.nextOffset).toBeGreaterThan(offset); offset = row.nextOffset;
  } while (true);
  expect(JSON.parse(json)).toEqual(payload);
  await expect(t.query(api.cli.messages.getServiceRunLogs, { ...args, eventOrder: 900 })).rejects.toThrow("Invalid stored run log cursor");
  await expect(t.query(api.cli.messages.getServiceRunLogs, { ...args, eventOrder: 11, offset: 90000000 })).rejects.toThrow("Invalid stored run log cursor");
});

test("raw history labels incomplete historical data and retains non-JSON stored bytes", async () => {
  const { ctx, project, profile, thread, key, t } = await fixture();
  const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant" });
  const data = '{"incomplete":';
  await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
    { type: "assistant", data },
    { type: "assistant", data: JSON.stringify({ text: "… [truncated: payload too large to store]" }) },
  ]);
  const result = await t.query(api.cli.messages.getServiceRunLogs, { threadId: thread._id, projectId: project._id, apiKey: key.key, messageId: message._id, raw: true });
  expect(JSON.parse(result.page[0].eventJson)).toEqual({ type: "assistant", data });
  expect(result.page[0]).toMatchObject({ fidelity: expect.stringContaining("non-JSON") });
  expect(result.page[1]).toMatchObject({ fidelity: expect.stringContaining("shortened") });
});

test("raw JSON preserves exact number tokens, duplicate keys and string escapes through fragments", async () => {
  const { ctx, project, profile, thread, key, t } = await fixture();
  const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant" });
  const tokens = '"id":9007199254740993,"huge":1e400,"zero":-0,"x":1,"x":2,"escaped":"a \\" b \\u0061"';
  const compact = '{' + tokens + '}';
  const large = '{' + tokens + ',"text":"' + "x".repeat(20000) + '"}';
  await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
    { type: "assistant", data: '{\n  ' + tokens + '\n}' },
    { type: "assistant", data: large },
  ]);
  const args = { threadId: thread._id, projectId: project._id, apiKey: key.key, messageId: message._id, raw: true };
  const page = await t.query(api.cli.messages.getServiceRunLogs, args);
  expect(page.page[0].eventJson).toBe(compact);
  let offset = 0, json = "";
  do {
    const result = await t.query(api.cli.messages.getServiceRunLogs, { ...args, eventOrder: 1, offset });
    json += result.page[0].eventJson;
    const row = result.page[0];
    if (!("nextOffset" in row) || row.nextOffset === undefined) break;
    offset = row.nextOffset;
  } while (true);
  expect(json).toBe(large);
});

test("raw JSON flags the surrogate-safe historical storage cap", async () => {
  const { ctx, project, profile, thread, key, t } = await fixture();
  const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant" });
  await ctx.cliMessageChunks(message._id, thread._id, profile._id, [{ type: "assistant", data: "x".repeat(99999) }]);
  const result = await t.query(api.cli.messages.getServiceRunLogs, { threadId: thread._id, projectId: project._id, apiKey: key.key, messageId: message._id, raw: true });
  expect(result.page[0]).toMatchObject({ fidelity: "possibly shortened before storage" });
});
