import { z } from "zod";
export const keyNameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)
  .refine((name) => !Object.hasOwn(Object.prototype, name));
export const secretSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((s) => !/[\r\n\0]/.test(s));
export const awsRegionSchema = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d{1,2}$/);
/** A Mantle or Bedrock Runtime entry for Codex or Claude Code (OS-2107); absent = OpenAI. */
export const awsTargetSchema = z.object({ provider: z.enum(["mantle", "bedrock"]), region: awsRegionSchema }).strict();
/** An Anthropic API key for Claude Code (OS-2016) or a Cursor account key (OS-2017); absent = OpenAI or the `aws` target. */
export const entryProviderSchema = z.enum(["anthropic", "cursor"]);
const oneProvider = { message: "An entry has either aws or provider, never both." };
/** Runtimes with one binding per project; their lists and per-runtime rules derive from it. */
export const managedRuntimeSchema = z.enum(["codex", "claude-code", "cursor"]);
export type ManagedRuntime = z.infer<typeof managedRuntimeSchema>;
/** Every runtime a managed key can serve, each with a project login; OpenCode binds one key per provider slot (OS-2018). */
export const keyRuntimeSchema = z.enum([...managedRuntimeSchema.options, "opencode"]);
export type KeyRuntime = z.infer<typeof keyRuntimeSchema>;
export const MANAGED_RUNTIME_LABELS: Record<KeyRuntime, string> = { codex: "Codex", "claude-code": "Claude Code", cursor: "Cursor", opencode: "OpenCode" };
const revision = z.object({ revision: z.number().int().positive(), secret: secretSchema, createdAt: z.number().nonnegative() }).strict();
export const bindingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("managed"), name: keyNameSchema }).strict(),
  z.object({ mode: z.literal("disabled") }).strict(),
  z.object({ mode: z.literal("native") }).strict(),
]);
export type Binding = z.infer<typeof bindingSchema>;
export const credentialStoreSchema = z
  .object({
    version: z.literal(1),
    generation: z.number().int().nonnegative(),
    entries: z.record(
      keyNameSchema,
      z
        .object({
          id: z.string().min(1).max(80),
          enabled: z.boolean(),
          current: z.number().int().positive(),
          revisions: z.array(revision).min(1).max(32),
          aws: awsTargetSchema.optional(),
          provider: entryProviderSchema.optional(),
        })
        .strict()
        .refine((e) => !(e.aws && e.provider), oneProvider)
    ),
    bindings: z.record(z.string().regex(/^[a-f0-9]{64}$/), bindingSchema),
    /** Claude Code bindings (OS-2108); `bindings` stays Codex's. */
    claudeBindings: z.record(z.string().regex(/^[a-f0-9]{64}$/), bindingSchema).optional(),
    /** Cursor bindings (OS-2017). */
    cursorBindings: z.record(z.string().regex(/^[a-f0-9]{64}$/), bindingSchema).optional(),
    /** OpenCode key name per provider slot (OS-2018); `{}` disables OpenCode, absent = native login. */
    opencodeBindings: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.object({
      openai: keyNameSchema.optional(), anthropic: keyNameSchema.optional(), "amazon-bedrock": keyNameSchema.optional(),
    }).strict()).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if ([s.entries, s.bindings, s.claudeBindings ?? {}, s.cursorBindings ?? {}, s.opencodeBindings ?? {}].some((record) => Object.keys(record).length > 128))
      ctx.addIssue({ code: "custom", message: "Credential capacity exceeded" });
    for (const e of Object.values(s.entries))
      if (!e.revisions.some((r) => r.revision === e.current) || new Set(e.revisions.map((r) => r.revision)).size !== e.revisions.length)
        ctx.addIssue({ code: "custom", message: "Invalid credential revisions" });
  });
export type CredentialData = z.infer<typeof credentialStoreSchema>;
const runtimeAuthDescriptorSchema = z
  .object({
    mode: z.enum(["managed", "disabled", "native"]),
    name: keyNameSchema.optional(),
    entryId: z.string().max(80).optional(),
    revision: z.number().int().positive().optional(),
  })
  .strict();
/** OpenCode's descriptor: one per bound slot; `{}` is disabled (OS-2018). */
const opencodeDescriptorSchema = z.object({
  openai: runtimeAuthDescriptorSchema.optional(), anthropic: runtimeAuthDescriptorSchema.optional(), "amazon-bedrock": runtimeAuthDescriptorSchema.optional(),
}).strict();
/** Codex's descriptor, with Claude Code's (OS-2108), Cursor's (OS-2017) and OpenCode's (OS-2018) beside it when bound. */
export const authDescriptorSchema = runtimeAuthDescriptorSchema
  .extend({ claude: runtimeAuthDescriptorSchema.optional(), cursor: runtimeAuthDescriptorSchema.optional(), opencode: opencodeDescriptorSchema.optional() })
  .strict();
export type AuthDescriptor = z.infer<typeof authDescriptorSchema>;
const RUNTIME_DESCRIPTORS: Record<ManagedRuntime, (descriptor: AuthDescriptor) => z.infer<typeof runtimeAuthDescriptorSchema> | undefined> = {
  codex: ({ claude: _claude, cursor: _cursor, opencode: _opencode, ...codex }) => codex,
  "claude-code": (descriptor) => descriptor.claude,
  cursor: (descriptor) => descriptor.cursor,
};
/** One runtime's part of a descriptor; Codex's is the top level. */
export const runtimeDescriptor = (runtime: ManagedRuntime, descriptor?: AuthDescriptor) => descriptor && RUNTIME_DESCRIPTORS[runtime](descriptor);
export const codexAuthSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("managed"), secret: secretSchema }).strict(),
  z.object({ mode: z.enum(["mantle", "bedrock"]), secret: secretSchema, region: awsRegionSchema }).strict(),
  z.object({ mode: z.literal("disabled") }).strict(),
  z.object({ mode: z.literal("native") }).strict(),
]);
export type CodexAuth = z.infer<typeof codexAuthSchema>;
/** Claude Code payload: an AWS or Anthropic key, or disabled; native login sends none (OS-2108, OS-2016). */
export const claudeAuthSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.enum(["mantle", "bedrock"]), secret: secretSchema, region: awsRegionSchema }).strict(),
  z.object({ mode: z.literal("anthropic"), secret: secretSchema }).strict(),
  z.object({ mode: z.literal("disabled") }).strict(),
]);
export type ClaudeAuth = z.infer<typeof claudeAuthSchema>;
/** Cursor payload: a Cursor account key or disabled; native login sends none (OS-2017). */
export const cursorAuthSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("managed"), secret: secretSchema }).strict(),
  z.object({ mode: z.literal("disabled") }).strict(),
]);
export type CursorAuth = z.infer<typeof cursorAuthSchema>;
/** Providers OpenCode takes one managed key for each: OpenAI and Anthropic API keys (OS-2018), Bedrock Runtime keys (OS-2205). */
export const opencodeSlotSchema = z.enum(["openai", "anthropic", "amazon-bedrock"]);
export type OpencodeSlot = z.infer<typeof opencodeSlotSchema>;
export const OPENCODE_SLOT_LABELS: Record<OpencodeSlot, string> = { openai: "OpenAI", anthropic: "Anthropic", "amazon-bedrock": "Bedrock" };
const opencodeKeysSchema = z.object({
  openai: secretSchema.optional(), anthropic: secretSchema.optional(),
  "amazon-bedrock": z.object({ secret: secretSchema, region: awsRegionSchema }).strict().optional(),
}).strict();
export type OpencodeKeys = z.infer<typeof opencodeKeysSchema>;
/** OpenCode payload: the assigned key per slot, or disabled; native login sends none. */
export const opencodeAuthSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("managed"), keys: opencodeKeysSchema }).strict(),
  z.object({ mode: z.literal("disabled") }).strict(),
]);
export type OpencodeAuth = z.infer<typeof opencodeAuthSchema>;
export const credentialMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"), name: keyNameSchema, secret: secretSchema, aws: awsTargetSchema.optional(), provider: entryProviderSchema.optional(),
  }).strict().refine((r) => !(r.aws && r.provider), oneProvider),
  z.object({ action: z.literal("rotate"), name: keyNameSchema, secret: secretSchema }).strict(),
  z.object({ action: z.literal("rollback"), name: keyNameSchema, revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("disable"), name: keyNameSchema }).strict(),
  z.object({ action: z.literal("remove"), name: keyNameSchema }).strict(),
  z.object({
    action: z.literal("bind"), profile: z.string().min(1).max(80), runtime: keyRuntimeSchema.optional(), binding: bindingSchema,
  }).strict(),
]);
export type CredentialMutation = z.infer<typeof credentialMutationSchema>;

export const authResultSchema = z
  .object({
    result: z.enum([
      "configured",
      "setup-failed",
      "request-succeeded",
      "authentication-failed",
      "quota-or-rate-limit",
      "network-failed",
      "request-failed",
    ]),
    at: z.number().nonnegative(),
  })
  .strict();
export type AuthResult = z.infer<typeof authResultSchema>;

export const managedCredentialStatusSchema = z.object({
  service: z.boolean(), compatible: z.boolean(), configurationError: z.boolean(),
  entries: z.array(z.object({
    name: keyNameSchema, provider: z.string(), region: z.string().optional(), auth: z.string(), billing: z.string(),
    enabled: z.boolean(), revision: z.number().int().positive(), retainedRevisions: z.array(z.number().int().positive()).max(32),
  })).max(128),
  projects: z.array(z.object({
    identity: z.string(), profiles: z.array(z.string()).max(128), desired: authDescriptorSchema.optional(),
    applied: authDescriptorSchema.optional(), state: z.string(), pending: z.boolean().optional(),
    authResult: authResultSchema.optional(), verified: z.boolean(),
  })).max(128),
});
export type ManagedCredentialStatus = z.infer<typeof managedCredentialStatusSchema>;
