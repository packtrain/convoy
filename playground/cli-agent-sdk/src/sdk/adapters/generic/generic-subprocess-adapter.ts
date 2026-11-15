import { resolveExecutable } from "../executable-resolution.js";
import type {
  BuildSpawnSpecContext,
  DetectCapabilitiesContext,
  DetectVersionContext,
  HandleInputContext,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderVersionInfo,
  ProviderId,
  ResolveExecutableContext,
  ResolvedExecutable,
} from "../../types.js";

export class GenericSubprocessAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly defaultTransportMode = "line-text" as const;

  constructor(providerId: ProviderId = "generic") {
    this.id = providerId;
  }

  async resolveExecutable(ctx: ResolveExecutableContext): Promise<ResolvedExecutable> {
    return resolveExecutable(this.id, ctx.providerConfig);
  }

  async detectVersion(_ctx: DetectVersionContext): Promise<ProviderVersionInfo> {
    return { raw: "unknown", normalized: "0.0.0" };
  }

  async detectCapabilities(
    _ctx: DetectCapabilitiesContext
  ): Promise<ProviderCapabilities> {
    return {
      supportsJsonStream: true,
      supportsResume: false,
      supportsInterrupt: true,
      supportsPty: false,
    };
  }

  async buildSpawnSpec(ctx: BuildSpawnSpecContext) {
    const args = Array.isArray(ctx.providerOptions?.args)
      ? (ctx.providerOptions.args.filter((a): a is string => typeof a === "string") as string[])
      : [];

    const appendPromptAsArg = ctx.providerOptions?.appendPromptAsArg === true;
    const bootstrapInput: unknown[] = [];

    if (ctx.prompt) {
      if (appendPromptAsArg) {
        args.push(ctx.prompt);
      } else {
        bootstrapInput.push(ctx.prompt);
      }
    }

    const transportMode = ctx.transportMode;

    return {
      command: ctx.resolvedExecutable.command,
      args,
      cwd: ctx.cwd,
      env: {
        ...ctx.env,
        ...ctx.providerConfig?.envOverrides,
      },
      transportMode,
      bootstrapInput,
      detached: true,
    };
  }

  async handleInput(ctx: HandleInputContext): Promise<void> {
    if (!ctx.child.stdin || ctx.child.stdin.destroyed) return;

    if (ctx.input.type === "user_text") {
      ctx.child.stdin.write(`${ctx.input.text}\n`);
      return;
    }

    if (ctx.input.type === "stdin_line") {
      ctx.child.stdin.write(`${ctx.input.line}\n`);
      return;
    }

    ctx.child.stdin.write(`${JSON.stringify(ctx.input.payload)}\n`);
  }
}
