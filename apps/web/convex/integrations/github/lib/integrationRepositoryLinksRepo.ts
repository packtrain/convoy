import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { PaginationOptions, PaginationResult } from "convex/server";

type Ctx = QueryCtx | MutationCtx;

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function getRepositoryLinkById(
  ctx: Ctx,
  id: Id<"integrationRepositoryLinks">
): Promise<Doc<"integrationRepositoryLinks"> | null> {
  return ctx.db.get("integrationRepositoryLinks", id);
}

/** A project connects at most this many repositories, so its lists stay one bounded merge. */
export const MAX_PROJECT_REPOSITORIES = 100;

export async function listActiveRepositoryLinksForProject(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<Doc<"integrationRepositoryLinks">[]> {
  return ctx.db
    .query("integrationRepositoryLinks")
    .withIndex("by_projectId_and_status_and_disconnectedAt", (q) => q.eq("projectId", projectId).eq("status", "active"))
    .take(MAX_PROJECT_REPOSITORIES);
}

/** Active links across the organization's projects, for resolving PR links. */
export async function listActiveRepositoryLinksForOrganization(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  limit: number
): Promise<Doc<"integrationRepositoryLinks">[]> {
  return ctx.db
    .query("integrationRepositoryLinks")
    .withIndex("by_organizationId_and_status", (q) => q.eq("organizationId", organizationId).eq("status", "active"))
    .take(limit);
}

/** The project's retained links, most recently disconnected first. */
export async function listRetainedRepositoryLinksForProject(
  ctx: Ctx,
  projectId: Id<"projects">,
  limit: number
): Promise<Doc<"integrationRepositoryLinks">[]> {
  return ctx.db
    .query("integrationRepositoryLinks")
    .withIndex("by_projectId_and_status_and_disconnectedAt", (q) => q.eq("projectId", projectId).eq("status", "disconnected"))
    .order("desc")
    .take(limit);
}

export async function findRepositoryLinkForProjectAndRepository(
  ctx: Ctx,
  projectId: Id<"projects">,
  repositoryId: Id<"integrationRepositories">
): Promise<Doc<"integrationRepositoryLinks"> | null> {
  // ponytail: scans the repository's links; few projects share one repository.
  for await (const link of ctx.db
    .query("integrationRepositoryLinks")
    .withIndex("by_repositoryId_and_status", (q) => q.eq("repositoryId", repositoryId))) {
    if (link.projectId === projectId) {
      return link;
    }
  }
  return null;
}

export async function getActiveRepositoryLinkForRepository(
  ctx: Ctx,
  repositoryId: Id<"integrationRepositories">
): Promise<Doc<"integrationRepositoryLinks"> | null> {
  return ctx.db
    .query("integrationRepositoryLinks")
    .withIndex("by_repositoryId_and_status", (q) => q.eq("repositoryId", repositoryId).eq("status", "active"))
    .first();
}

/** True when a link other than `exceptId` (active or retained) still needs the repository's data. */
export async function hasOtherRepositoryLink(
  ctx: Ctx,
  repositoryId: Id<"integrationRepositories">,
  exceptId: Id<"integrationRepositoryLinks">
): Promise<boolean> {
  const links = await ctx.db
    .query("integrationRepositoryLinks")
    .withIndex("by_repositoryId_and_status", (q) => q.eq("repositoryId", repositoryId))
    .take(2);
  return links.some((link) => link._id !== exceptId);
}

export async function paginateRepositoryLinksByProject(
  ctx: Ctx,
  projectId: Id<"projects">,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"integrationRepositoryLinks">>> {
  return ctx.db
    .query("integrationRepositoryLinks")
    .withIndex("by_projectId_and_status_and_disconnectedAt", (q) => q.eq("projectId", projectId))
    .paginate(paginationOpts);
}

export async function paginateGithubRepositoryLinksByInstallation(
  ctx: Ctx,
  installationId: number,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"integrationRepositoryLinks">>> {
  return ctx.db
    .query("integrationRepositoryLinks")
    .withIndex("by_provider_and_githubInstallationId", (q) => q.eq("provider", "github").eq("github.installationId", installationId))
    .paginate(paginationOpts);
}

export async function insertRepositoryLink(
  ctx: MutationCtx,
  props: Pick<Doc<"integrationRepositoryLinks">, "organizationId" | "projectId" | "repositoryId" | "provider" | "github" | "connectedBy">
): Promise<Id<"integrationRepositoryLinks">> {
  return ctx.db.insert("integrationRepositoryLinks", {
    ...props,
    status: "active",
    generation: 1,
    connectedAt: Date.now(),
  });
}

/** Reconnect a retained link: a new generation obsoletes its pending purge. */
export async function reactivateRepositoryLink(
  ctx: MutationCtx,
  link: Doc<"integrationRepositoryLinks">,
  props: Pick<Doc<"integrationRepositoryLinks">, "github" | "connectedBy">
): Promise<number> {
  const generation = link.generation + 1;
  await ctx.db.patch("integrationRepositoryLinks", link._id, {
    ...props,
    status: "active",
    generation,
    connectedAt: Date.now(),
    disconnectedAt: undefined,
    deleteAfter: undefined,
    error: undefined,
  });
  return generation;
}

/** Hide the link's content and start its retention window; returns the new generation and deadline. */
export async function deactivateRepositoryLink(
  ctx: MutationCtx,
  link: Doc<"integrationRepositoryLinks">,
  error?: string
): Promise<{ generation: number; deleteAfter: number }> {
  const now = Date.now();
  const generation = link.generation + 1;
  const deleteAfter = now + RETENTION_MS;
  await ctx.db.patch("integrationRepositoryLinks", link._id, {
    status: "disconnected",
    generation,
    disconnectedAt: now,
    deleteAfter,
    error,
  });
  return { generation, deleteAfter };
}

/** Bring a retained link's deletion date forward to now. */
export async function expireRepositoryLink(ctx: MutationCtx, id: Id<"integrationRepositoryLinks">): Promise<void> {
  await ctx.db.patch("integrationRepositoryLinks", id, { deleteAfter: Date.now() });
}

export async function deleteRepositoryLink(ctx: MutationCtx, id: Id<"integrationRepositoryLinks">): Promise<void> {
  await ctx.db.delete("integrationRepositoryLinks", id);
}
