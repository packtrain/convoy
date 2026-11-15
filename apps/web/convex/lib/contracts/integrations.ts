import { v, type Infer } from "convex/values";

// Schema-mirror validators shared by every integration provider (docs/adr/0013-one-folder-per-integration-provider.md).

/** One value until a second provider ships; every row carries it from first insert. */
export const integrationProviderValidator = v.literal("github");
export type IntegrationProvider = Infer<typeof integrationProviderValidator>;

export const integrationSetupStatusValidator = v.union(v.literal("pending"), v.literal("claimed"), v.literal("authorized"));
