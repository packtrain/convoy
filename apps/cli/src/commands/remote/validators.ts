import { z } from "zod";

export const remoteName = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "Use 1-40 lowercase letters, digits or hyphens, starting with a letter.");
export const remoteSchema = z.object({
  name: remoteName,
  // An SSH destination or ssh:// URI; never an option.
  host: z.string().regex(/^[A-Za-z0-9_.@:%[\]/-]{1,255}$/).refine(host => !host.startsWith("-"), "Host cannot start with '-'."),
  container: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/).optional(),
  command: z.string().min(2).max(1024).refine(command => command.startsWith("/") && !/[\0\n\r]/.test(command), "Use an absolute path.").optional(),
}).strict();
export type Remote = z.infer<typeof remoteSchema>;
export const remotesSchema = z.object({ schema: z.literal(1), remotes: z.array(remoteSchema).max(128) }).strict();
