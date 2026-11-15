import { z } from "zod";

export const accessibleProjectSchema = z.object({
  _id: z.string(),
  name: z.string(),
  alias: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
});
export type AccessibleProject = z.infer<typeof accessibleProjectSchema>;
export const organizationChoiceSchema = z.object({ _id: z.string(), name: z.string(), slug: z.string() });

export function validateSetupProfileKey(key: string): void {
  if (!/^[a-z][a-z0-9_-]*$/.test(key)) {
    throw new Error(`Invalid profile key "${key}". Use lowercase letters, numbers, hyphens or underscores, starting with a letter.`);
  }
}
