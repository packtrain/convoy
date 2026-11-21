import { v, type Infer } from "convex/values";
import { cliCatalogModelValidator } from "../shared/validators";

/** `models` absent means the CLI's inventory failed: catalog unknown, not empty. */
export const availableAntigravityCliValidator = v.object({
  type: v.literal("antigravity"),
  version: v.string(),
  models: v.optional(v.array(cliCatalogModelValidator)),
});
export type AntigravityAvailableCli = Infer<typeof availableAntigravityCliValidator>;
