import { v, type Infer } from "convex/values";
import type { ParseResult } from "../contracts";
import { success } from "../shared/parsing";

/** AWS providers a Codex profile can be assigned (OS-2105); see docs/specs/cli-provider-keys.md. */
export const codexProviderValidator = v.union(
  v.literal("mantle"),
  v.literal("bedrock"),
  v.literal("unknown"),
);

export type CodexProvider = Infer<typeof codexProviderValidator>;

export const availableCodexCliValidator = v.object({
  type: v.literal("codex"),
  version: v.string(),
  provider: v.optional(codexProviderValidator),
  region: v.optional(v.string()),
});

export type CodexAvailableCli = Infer<typeof availableCodexCliValidator>;

const REGION_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Unrecognized providers degrade to "unknown" so a newer CLI still registers. */
export function parseCodexAvailableCli(
  cli: Record<string, unknown>,
  version: string,
): ParseResult<CodexAvailableCli> {
  const provider: CodexProvider | undefined =
    cli.provider === undefined
      ? undefined
      : cli.provider === "mantle" || cli.provider === "bedrock"
        ? cli.provider
        : "unknown";
  const region =
    typeof cli.region === "string" && REGION_PATTERN.test(cli.region) ? cli.region : undefined;
  return success({
    type: "codex",
    version,
    ...(provider ? { provider } : {}),
    ...(region && provider !== "unknown" ? { region } : {}),
  });
}
