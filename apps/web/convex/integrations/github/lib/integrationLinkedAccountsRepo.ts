import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

type Ctx = QueryCtx | MutationCtx;
type GithubFields = Doc<"integrationLinkedAccounts">["github"];

/** An organization id from a signed OAuth state; null when it isn't one. */
export function normalizeOrganizationId(ctx: Ctx, id: string): Id<"organizations"> | null {
  return ctx.db.normalizeId("organizations", id);
}

export async function getLinkedAccountById(ctx: Ctx, id: Id<"integrationLinkedAccounts">): Promise<Doc<"integrationLinkedAccounts"> | null> {
  return ctx.db.get("integrationLinkedAccounts", id);
}

export async function findLinkedAccount(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  userId: Id<"users">
): Promise<Doc<"integrationLinkedAccounts"> | null> {
  return ctx.db
    .query("integrationLinkedAccounts")
    .withIndex("by_userId_and_organizationId_and_provider", (q) =>
      q.eq("userId", userId).eq("organizationId", organizationId).eq("provider", "github")
    )
    .unique();
}

/** Every organization's link to one GitHub account; a revoked App grant reaches all of them. */
export async function listLinkedAccountsForGithubUser(ctx: Ctx, githubUserId: number): Promise<Doc<"integrationLinkedAccounts">[]> {
  return ctx.db
    .query("integrationLinkedAccounts")
    .withIndex("by_provider_and_githubUserId_and_organizationId", (q) => q.eq("provider", "github").eq("github.userId", githubUserId))
    .take(100);
}

/** The member in `organizationId` who linked this GitHub account, if any. */
export async function findLinkedAccountForGithubUser(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  githubUserId: number
): Promise<Doc<"integrationLinkedAccounts"> | null> {
  return ctx.db
    .query("integrationLinkedAccounts")
    .withIndex("by_provider_and_githubUserId_and_organizationId", (q) =>
      q.eq("provider", "github").eq("github.userId", githubUserId).eq("organizationId", organizationId)
    )
    .first();
}

/** Link or relink the member's account with fresh tokens. */
export async function upsertLinkedAccount(
  ctx: MutationCtx,
  owner: { organizationId: Id<"organizations">; userId: Id<"users"> },
  github: GithubFields
): Promise<Id<"integrationLinkedAccounts">> {
  const existing = await findLinkedAccount(ctx, owner.organizationId, owner.userId);
  if (existing) {
    await ctx.db.replace("integrationLinkedAccounts", existing._id, { ...owner, provider: "github", status: "active", github, linkedAt: Date.now() });
    return existing._id;
  }
  return ctx.db.insert("integrationLinkedAccounts", { ...owner, provider: "github", status: "active", github, linkedAt: Date.now() });
}

export async function patchLinkedAccount(
  ctx: MutationCtx,
  account: Doc<"integrationLinkedAccounts">,
  patch: { status?: Doc<"integrationLinkedAccounts">["status"]; github?: Partial<GithubFields> }
): Promise<void> {
  await ctx.db.patch("integrationLinkedAccounts", account._id, {
    ...(patch.status ? { status: patch.status } : {}),
    // An undefined field clears it, as a top-level patch would.
    ...(patch.github
      ? { github: Object.fromEntries(Object.entries({ ...account.github, ...patch.github }).filter(([, value]) => value !== undefined)) as GithubFields }
      : {}),
  });
}

export async function deleteLinkedAccount(ctx: MutationCtx, id: Id<"integrationLinkedAccounts">): Promise<void> {
  await ctx.db.delete("integrationLinkedAccounts", id);
}
