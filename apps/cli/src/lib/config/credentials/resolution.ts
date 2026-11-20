import { randomUUID } from "node:crypto";
import { readConfig, withConfigLock } from "../toml.js";
import { projectIdentity, registrationIdentity, type ProjectEnvironment } from "../../../commands/project/validators.js";
import type { Profile } from "../types.js";
import { CredentialStore } from "./store.js";
import {
  credentialMutationSchema,
  type CredentialData,
  type CredentialMutation,
  type AuthDescriptor,
  type CodexAuth,
  type ClaudeAuth,
  type CursorAuth,
  type OpencodeAuth,
  type OpencodeKeys,
  type OpencodeSlot,
  OPENCODE_SLOT_LABELS,
  type Binding,
  type ManagedRuntime,
  MANAGED_RUNTIME_LABELS,
} from "./validators.js";

type Entry = CredentialData["entries"][string];
type EntryRule = { accepts: (entry: Entry) => boolean; refusal: string };
const launcherRequired = (label: string) =>
  `Managed ${label} credentials require an updated launcher. Follow the VM upgrade instructions.`;
/** Per runtime: where its bindings live, the launcher capability they need, and the entries it takes. */
const RUNTIME_BINDINGS: Record<ManagedRuntime, {
  field: "bindings" | "claudeBindings" | "cursorBindings"; capability?: string;
} & EntryRule> = {
  codex: { field: "bindings", accepts: (e) => !e.provider, refusal: "Codex needs a managed OpenAI, Mantle or Bedrock key." },
  "claude-code": {
    field: "claudeBindings", capability: "credentials-claude-v1", accepts: (e) => !!e.aws || e.provider === "anthropic",
    refusal: "Claude Code needs a managed Anthropic, Mantle or Bedrock key.",
  },
  cursor: {
    field: "cursorBindings", capability: "credentials-cursor-v1", accepts: (e) => e.provider === "cursor",
    refusal: "Cursor needs a managed Cursor account key.",
  },
};
const OPENCODE_REFUSAL = "OpenCode needs a managed OpenAI, Anthropic or Bedrock key.";
type Granted = { secret: string; aws?: Entry["aws"] };
/** Per OpenCode provider slot: the entries it takes, its extra launcher capability, and its payload key (OS-2018, OS-2205). */
const OPENCODE_SLOTS: Record<OpencodeSlot, EntryRule & { capability?: string; key: (granted: Granted) => NonNullable<OpencodeKeys[OpencodeSlot]> }> = {
  openai: { accepts: (e) => !e.provider && !e.aws, refusal: OPENCODE_REFUSAL, key: ({ secret }) => secret },
  anthropic: { accepts: (e) => e.provider === "anthropic", refusal: OPENCODE_REFUSAL, key: ({ secret }) => secret },
  "amazon-bedrock": {
    accepts: (e) => e.aws?.provider === "bedrock", refusal: OPENCODE_REFUSAL, capability: "credentials-opencode-v2",
    key: ({ secret, aws }) => ({ secret, region: aws!.region }),
  },
};

function bindingDescriptor(data: CredentialData, binding: Binding): AuthDescriptor {
  if (binding.mode !== "managed") return { mode: binding.mode };
  const entry = data.entries[binding.name];
  if (!entry) throw new Error("Managed credential binding references a missing entry.");
  return { mode: entry.enabled ? "managed" : "disabled", name: binding.name, entryId: entry.id, revision: entry.current };
}

/** An unbound Codex reads as native when only another runtime is bound; both deliver nothing. */
export function authDescriptor(data: CredentialData, identity: string): AuthDescriptor | undefined {
  const codex = data.bindings[identity] && bindingDescriptor(data, data.bindings[identity]);
  const claude = data.claudeBindings?.[identity] && bindingDescriptor(data, data.claudeBindings[identity]);
  const cursor = data.cursorBindings?.[identity] && bindingDescriptor(data, data.cursorBindings[identity]);
  const slots = data.opencodeBindings?.[identity];
  const opencode = slots && Object.fromEntries(Object.entries(slots).map(([slot, name]) => [slot, bindingDescriptor(data, { mode: "managed", name })]));
  if (!claude && !cursor && !opencode) return codex;
  return { ...(codex ?? { mode: "native" }), ...(claude ? { claude } : {}), ...(cursor ? { cursor } : {}), ...(opencode ? { opencode } : {}) };
}

/** The bound revision's secret; refuses an entry the runtime cannot take, such as a hand-edited binding. */
function managedSecret(data: CredentialData, current: { name?: string; revision?: number }, rule: EntryRule): Granted {
  const entry = data.entries[current.name!];
  const secret = entry?.revisions.find((r) => r.revision === current.revision)?.secret;
  if (!secret) throw new Error("Managed credential revision is missing.");
  if (!rule.accepts(entry)) throw new Error(rule.refusal);
  return { secret, aws: entry.aws };
}

type LaunchPayload = { codexAuth?: CodexAuth; claudeAuth?: ClaudeAuth; cursorAuth?: CursorAuth; opencodeAuth?: OpencodeAuth };

/** What a launch delivers for `current`; pure, so the service snapshot can check capabilities. */
export function launchPayload(data: CredentialData, current: AuthDescriptor | undefined): LaunchPayload {
  const result: LaunchPayload = {};
  if (current && current.mode !== "native") {
    if (current.mode === "disabled") result.codexAuth = { mode: "disabled" };
    else {
      const { secret, aws } = managedSecret(data, current, RUNTIME_BINDINGS.codex);
      result.codexAuth = aws ? { mode: aws.provider, secret, region: aws.region } : { mode: "managed", secret };
    }
  }
  const claude = current?.claude;
  if (claude?.mode === "disabled") result.claudeAuth = { mode: "disabled" };
  else if (claude?.mode === "managed") {
    const { secret, aws } = managedSecret(data, claude, RUNTIME_BINDINGS["claude-code"]);
    result.claudeAuth = aws ? { mode: aws.provider, secret, region: aws.region } : { mode: "anthropic", secret };
  }
  const cursor = current?.cursor;
  if (cursor?.mode === "disabled") result.cursorAuth = { mode: "disabled" };
  else if (cursor?.mode === "managed") {
    result.cursorAuth = { mode: "managed", secret: managedSecret(data, cursor, RUNTIME_BINDINGS.cursor).secret };
  }
  if (current?.opencode) {
    const keys = Object.fromEntries((Object.entries(current.opencode) as [OpencodeSlot, AuthDescriptor][])
      .filter(([, slot]) => slot.mode === "managed").map(([slot, bound]) => [slot, OPENCODE_SLOTS[slot].key(managedSecret(data, bound, OPENCODE_SLOTS[slot]))])) as OpencodeKeys;
    result.opencodeAuth = Object.keys(keys).length ? { mode: "managed", keys } : { mode: "disabled" };
  }
  return result;
}

/** Launcher capabilities a payload needs; direct and service launches share it. */
export function launchCapabilities({ codexAuth, claudeAuth, cursorAuth, opencodeAuth }: LaunchPayload): string[] {
  return [
    ...(codexAuth ? [codexAuth.mode === "mantle" || codexAuth.mode === "bedrock" ? "credentials-aws-v1" : "credentials-v1"] : []),
    ...(claudeAuth ? ["credentials-claude-v1"] : []),
    ...(claudeAuth?.mode === "anthropic" ? ["credentials-anthropic-v1"] : []),
    ...(cursorAuth ? ["credentials-cursor-v1"] : []),
    ...(opencodeAuth ? ["credentials-opencode-v1"] : []),
    ...(opencodeAuth?.mode === "managed" ? (Object.keys(opencodeAuth.keys) as OpencodeSlot[]).flatMap((slot) => OPENCODE_SLOTS[slot].capability ?? []) : []),
  ];
}

export function launchAuth(identity: string, expected?: AuthDescriptor, store = new CredentialStore()): LaunchPayload {
  const data = store.read();
  const current = authDescriptor(data, identity);
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error("Managed credentials changed before launch. Reload the project.");
  return launchPayload(data, current);
}

/** AWS credentials reach Codex through the OS-2105 provider path, not managed OpenAI login. */
export function connectAuth<T extends { codexAuth?: CodexAuth }>({ codexAuth, ...rest }: T) {
  const aws = codexAuth?.mode === "mantle" || codexAuth?.mode === "bedrock" ? codexAuth : undefined;
  return { ...rest, ...(aws ? { codexProvider: { provider: aws.mode, token: aws.secret, region: aws.region } } : { codexAuth }) };
}

export function assertCredentialNames(data: CredentialData, legacy = readConfig().keys) {
  if (Object.keys(data.entries).some((name) => Object.hasOwn(legacy ?? {}, name)))
    throw new Error("Managed credential name conflicts with a legacy key. Rename the legacy entry before continuing.");
}

/** The bound registration's identity; a shared one needs no launcher registry. */
function bindIdentity(profile: Profile | undefined, environment: ProjectEnvironment | "shared"): string {
  if (environment === "shared") {
    const identity = profile?.project_mode && registrationIdentity(profile);
    if (!identity || profile.paths.length !== 1) throw new Error("Managed credentials require a registered shared project.");
    return identity;
  }
  const isolated = profile?.project_isolation;
  const registration = environment.registrations.find((r) => r.identity === isolated?.identity);
  if (
    !isolated ||
    !registration ||
    registration.status === "pending" ||
    registration.status === "removed" ||
    profile.paths.length !== 1 ||
    profile.paths[0] !== registration.path ||
    projectIdentity(profile.url, isolated.organization_id, profile.project_id) !== isolated.identity
  )
    throw new Error("Managed credentials require a registered isolated profile.");
  return isolated.identity;
}

/**
 * `accounted`: active identities whose running service worker holds no grant of a removed entry.
 * A shared environment runs this CLI's own worker, so no launcher capability applies. Spec: docs/specs/cli-shared-environments.md#credentials
 */
export function mutateCredentials(request: CredentialMutation, environment: ProjectEnvironment | "shared", store = new CredentialStore(), accounted: string[] = []) {
  const parsed = credentialMutationSchema.safeParse(request);
  if (!parsed.success) throw new Error("Invalid managed credential request.");
  request = parsed.data;
  const supports = (capability: string) => environment === "shared" || !!environment.capabilities?.includes(capability);
  // Config lock precedes credential lock; never hold either while stopping workers.
  return withConfigLock((config) =>
    store.mutate((data) => {
      assertCredentialNames(data, config.keys);
      if (request.action === "bind") {
        const identity = bindIdentity(config.profiles[request.profile], environment);
        const bound = request.binding.mode === "managed" ? data.entries[request.binding.name] : undefined;
        if (request.binding.mode === "managed" && !bound?.enabled)
          throw new Error("Managed credential is missing or disabled. Rotate it to enable a replacement.");
        if (request.runtime === "opencode") {
          if (!supports("credentials-opencode-v1"))
            throw new Error(launcherRequired(MANAGED_RUNTIME_LABELS.opencode));
          const { [identity]: slots, ...others } = data.opencodeBindings ?? {};
          if (request.binding.mode === "native") data.opencodeBindings = others;
          else if (request.binding.mode === "disabled") data.opencodeBindings = { ...others, [identity]: {} };
          else {
            const slot = (Object.keys(OPENCODE_SLOTS) as OpencodeSlot[]).find((key) => OPENCODE_SLOTS[key].accepts(bound!));
            if (!slot) throw new Error(OPENCODE_REFUSAL);
            const capability = OPENCODE_SLOTS[slot].capability;
            if (capability && !supports(capability))
              throw new Error(launcherRequired(`${MANAGED_RUNTIME_LABELS.opencode} ${OPENCODE_SLOT_LABELS[slot]}`));
            data.opencodeBindings = { ...others, [identity]: { ...slots, [slot]: request.binding.name } };
          }
          return;
        }
        // Older services expect Codex binds without `runtime`.
        const runtime = request.runtime ?? "codex";
        const { field, capability, accepts, refusal } = RUNTIME_BINDINGS[runtime];
        if (capability && !supports(capability))
          throw new Error(launcherRequired(MANAGED_RUNTIME_LABELS[runtime]));
        if (bound && !accepts(bound)) throw new Error(refusal);
        if (bound?.provider === "anthropic" && !supports("credentials-anthropic-v1"))
          throw new Error("Managed Anthropic keys require an updated launcher. Follow the VM upgrade instructions.");
        data[field] = { ...data[field], [identity]: request.binding };
        return;
      }
      const name = request.name;
      if (Object.hasOwn(config.keys ?? {}, name)) throw new Error("Managed credential name conflicts with a legacy key.");
      const entry = Object.hasOwn(data.entries, name) ? data.entries[name] : undefined;
      if (request.action === "add") {
        if (entry) throw new Error("Managed credential already exists. Use keys rotate.");
        if (request.aws && !supports("credentials-aws-v1"))
          throw new Error("Managed AWS credentials require an updated launcher. Follow the VM upgrade instructions.");
        if (request.provider === "anthropic" && !supports("credentials-anthropic-v1"))
          throw new Error("Managed Anthropic keys require an updated launcher. Follow the VM upgrade instructions.");
        if (request.provider === "cursor" && !supports("credentials-cursor-v1"))
          throw new Error("Managed Cursor keys require an updated launcher. Follow the VM upgrade instructions.");
        data.entries[name] = {
          ...(request.aws ? { aws: request.aws } : {}),
          ...(request.provider ? { provider: request.provider } : {}),
          id: randomUUID(),
          enabled: true,
          current: 1,
          revisions: [{ revision: 1, secret: request.secret, createdAt: Date.now() }],
        };
        return;
      }
      if (!entry) throw new Error("Managed credential not found.");
      if (request.action === "disable") {
        entry.enabled = false;
        return;
      }
      if (request.action === "remove") {
        const bindings = Object.values(RUNTIME_BINDINGS).flatMap(({ field }) => Object.values(data[field] ?? {}));
        if (bindings.some((b) => b.mode === "managed" && b.name === name) ||
          Object.values(data.opencodeBindings ?? {}).some((slots) => Object.values(slots).includes(name)))
          throw new Error(`${name} is assigned to a project. Unassign it before deleting.`);
        const running = environment === "shared" ? undefined : environment.registrations.find((r) => r.active && !accounted.includes(r.identity));
        if (running) throw new Error(`Project ${running.path} is running and may still hold ${name}. Stop it before deleting.`);
        delete data.entries[name];
        return;
      }
      if (request.action === "rollback") {
        if (!entry.revisions.some((r) => r.revision === request.revision)) throw new Error("Managed credential revision not retained.");
        entry.current = request.revision;
        return;
      }
      if (entry.revisions.length >= 32)
        throw new Error("Managed credential revision limit reached. Stop workers, unassign and recreate the entry.");
      entry.current = Math.max(...entry.revisions.map((r) => r.revision)) + 1;
      entry.revisions.push({ revision: entry.current, secret: request.secret, createdAt: Date.now() });
      entry.enabled = true;
    })
  );
}
