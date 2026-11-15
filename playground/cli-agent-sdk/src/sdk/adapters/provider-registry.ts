import type { ProviderAdapter, ProviderId } from "../types.js";
import { ClaudeAdapter } from "./claude/claude-adapter.js";
import { CodexAdapter } from "./codex/codex-adapter.js";
import { GenericSubprocessAdapter } from "./generic/generic-subprocess-adapter.js";

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`No adapter registered for provider ${providerId}`);
    }
    return adapter;
  }

  has(providerId: ProviderId): boolean {
    return this.adapters.has(providerId);
  }
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new ClaudeAdapter());
  registry.register(new CodexAdapter());
  registry.register(new GenericSubprocessAdapter("generic"));
  registry.register(new GenericSubprocessAdapter("amp"));
  registry.register(new GenericSubprocessAdapter("droid"));
  registry.register(new GenericSubprocessAdapter("factory"));
  registry.register(new GenericSubprocessAdapter("coderabbit"));
  registry.register(new GenericSubprocessAdapter("gemini"));
  return registry;
}
