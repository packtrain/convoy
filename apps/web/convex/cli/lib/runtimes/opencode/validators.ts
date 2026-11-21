import { v } from "convex/values";
import { cliCatalogModelValidator } from "../shared/validators";

export const opencodeAdvertisedModelValidator = v.object({
  ...cliCatalogModelValidator.fields,
  // Optional only so documents written before OS-1721 still validate; nothing
  // reads or writes them — the slug is `providerID/modelID`.
  providerID: v.optional(v.string()),
  modelID: v.optional(v.string()),
});

export const availableOpencodeCliValidator = v.object({
  type: v.literal("opencode"),
  version: v.string(),
  models: v.optional(v.array(opencodeAdvertisedModelValidator)),
  defaultModel: v.optional(v.string()),
});
