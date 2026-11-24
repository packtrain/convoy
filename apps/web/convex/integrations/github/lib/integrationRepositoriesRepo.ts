import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { PaginationOptions, PaginationResult } from "convex/server";
import type { IntegrationProvider } from "../../../lib/contracts/integrations";
import { isSameRepository } from "../../../lib/contracts/github";

type Ctx = QueryCtx | MutationCtx;

export type RepositoryIdentity = {
  organizationId: Id<"organizations">;
  provider: IntegrationProvider;
  host: string;
  providerRepositoryId: number;
};

export type RepositoryDetails = Pick<Doc<"integrationRepositories">, "owner" | "name" | "isPrivate" | "htmlUrl">;

export async function getRepositoryById(ctx: Ctx, id: Id<"integrationRepositories">): Promise<Doc<"integrationRepositories"> | null> {
  return ctx.db.get("integrationRepositories", id);
}

/** The link and repository among `links` that hold the named repository. */
export async function findLinkedRepository(
  ctx: Ctx,
  links: Doc<"integrationRepositoryLinks">[],
  pr: { owner: string; name: string }
): Promise<{ link: Doc<"integrationRepositoryLinks">; repository: Doc<"integrationRepositories"> } | null> {
  for (const link of links) {
    const repository = await getRepositoryById(ctx, link.repositoryId);
    if (repository && isSameRepository(repository, pr)) return { link, repository };
  }
  return null;
}

/** A repository id from a URL, or null when it names no repository row. */
export function normalizeRepositoryId(ctx: Ctx, id: string): Id<"integrationRepositories"> | null {
  return ctx.db.normalizeId("integrationRepositories", id);
}

/** Every tenant's copy of one provider repository, for webhook routing. */
export async function paginateRepositoriesByProviderIdentity(
  ctx: Ctx,
  identity: Omit<RepositoryIdentity, "organizationId">,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"integrationRepositories">>> {
  return ctx.db
    .query("integrationRepositories")
    .withIndex("by_provider_and_host_and_providerRepositoryId_and_organizationId", (q) =>
      q.eq("provider", identity.provider).eq("host", identity.host).eq("providerRepositoryId", identity.providerRepositoryId)
    )
    .paginate(paginationOpts);
}

/** Every tenant's repositories, for the reconciliation sweep. */
export async function paginateRepositories(
  ctx: Ctx,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"integrationRepositories">>> {
  return ctx.db.query("integrationRepositories").paginate(paginationOpts);
}

/** Insert or refresh the organization's copy; returns its id. */
export async function upsertRepository(
  ctx: MutationCtx,
  identity: RepositoryIdentity,
  details: RepositoryDetails
): Promise<Id<"integrationRepositories">> {
  const existing = await ctx.db
    .query("integrationRepositories")
    .withIndex("by_provider_and_host_and_providerRepositoryId_and_organizationId", (q) =>
      q
        .eq("provider", identity.provider)
        .eq("host", identity.host)
        .eq("providerRepositoryId", identity.providerRepositoryId)
        .eq("organizationId", identity.organizationId)
    )
    .unique();
  if (existing) {
    await ctx.db.patch("integrationRepositories", existing._id, details);
    return existing._id;
  }
  return ctx.db.insert("integrationRepositories", { ...identity, ...details, syncStatus: "importing", openCount: 0, closedCount: 0 });
}

export type RepositorySyncPatch = Partial<
  Pick<
    Doc<"integrationRepositories">,
    | "syncStatus"
    | "importPage"
    | "importedCount"
    | "leaseToken"
    | "leaseClaimedAt"
    | "lastSuccessAt"
    | "error"
    | "openCount"
    | "closedCount"
    | "countedThroughNumber"
    | "reconcileStartedAt"
    | "reconciledAt"
    | "history"
    | "historyRequest"
  >
>;

export async function updateRepositorySync(ctx: MutationCtx, id: Id<"integrationRepositories">, patch: RepositorySyncPatch): Promise<void> {
  await ctx.db.patch("integrationRepositories", id, patch);
}

export async function deleteRepository(ctx: MutationCtx, id: Id<"integrationRepositories">): Promise<void> {
  await ctx.db.delete("integrationRepositories", id);
}
