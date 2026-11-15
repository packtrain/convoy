import { v, type Infer } from "convex/values";
import { apiKeyScopeReturnValidator, apiKeyKindValidator } from "../../lib/contracts/validators";

export const workerKeyStatusValidator = v.union(
  v.literal("active"), v.literal("expired"), v.literal("invalid"),
  v.literal("source-deleted"), v.literal("source-expired"), v.literal("source-scope"),
);
export type WorkerKeyStatus = Infer<typeof workerKeyStatusValidator>;

export const apiKeyListItemValidator = v.object({
  _id: v.id("apiKeys"),
  name: v.string(),
  keyPrefix: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  scope: apiKeyScopeReturnValidator,
  kind: v.optional(apiKeyKindValidator),
  workerStatus: v.optional(workerKeyStatusValidator),
  sourceKeyName: v.optional(v.string()),
});

export type ApiKeyListItem = Infer<typeof apiKeyListItemValidator>;
