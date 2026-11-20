import { createOpencodeClient } from "@opencode-ai/sdk/v2";

/**
 * Narrow boundary over the OpenCode SDK v2 client: the runner (and its
 * tests) depend on this structural interface only, so the SDK import stays
 * confined to this module.
 */

export type OpencodePermissionAction = "allow" | "ask" | "deny";

export type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: OpencodePermissionAction;
};

export type OpencodeModelRef = {
  providerID: string;
  modelID: string;
};

export interface OpencodeClientLike {
  createSession(input: {
    title: string;
    permission: OpencodePermissionRule[];
  }): Promise<{ id: string }>;
  promptAsync(input: {
    sessionID: string;
    model?: OpencodeModelRef;
    /** OpenCode agent to run (e.g. "plan"); omitted = default agent. */
    agent?: string;
    /** Model variant (provider-specific reasoning effort). */
    variant?: string;
    text: string;
  }): Promise<void>;
  /**
   * Execute a runtime command in a session (OpenCode expands the template
   * server-side). Unlike promptAsync, resolves only when the turn completes.
   */
  commandAsync(input: {
    sessionID: string;
    command: string;
    arguments?: string;
    model?: OpencodeModelRef;
    variant?: string;
  }): Promise<void>;
  /** Names of commands available in the session's directory. */
  listCommands(): Promise<string[]>;
  /**
   * Compact the session's context (`/compact`, OS-1614). OpenCode has no
   * `compact` entry in `command.list()`, so this is a dedicated endpoint
   * rather than a `commandAsync` invocation. It requires an explicit model
   * and, like `commandAsync`, resolves only once the compaction turn ends.
   */
  compactSession(input: {
    sessionID: string;
    model: OpencodeModelRef;
  }): Promise<void>;
  /** The session's own model, used when the run resolved no explicit one. */
  getSessionModel(sessionID: string): Promise<OpencodeModelRef | null>;
  /** Provider defaults (`providerID` → `modelID`) for the compaction fallback. */
  getDefaultModel(): Promise<OpencodeModelRef | null>;
  abortSession(sessionID: string): Promise<void>;
  /** Server-sent event stream; each item is a raw SDK event object. */
  subscribeEvents(signal: AbortSignal): Promise<AsyncIterable<unknown>>;
  replyPermission(
    requestID: string,
    reply: "once" | "always" | "reject",
  ): Promise<void>;
  replyQuestion(requestID: string, answers: string[][]): Promise<void>;
  rejectQuestion(requestID: string): Promise<void>;
  listProviders(signal?: AbortSignal): Promise<{
    all: Array<{
      id: string;
      name: string;
      models: Record<
        string,
        { id: string; name: string; variants?: Record<string, unknown>; limit?: { context: number }; api?: { npm?: string } }
      >;
    }>;
    connected: string[];
    defaults: Record<string, string>;
  }>;
  /** The run directory's effective `provider` config (global, project and inline merged). */
  getProviderConfig(): Promise<Record<string, {
    options?: Record<string, unknown>;
    models?: Record<string, { headers?: Record<string, string> }>;
  }>>;
}

function requireData<T>(data: T | undefined, context: string): T {
  // The client is created with throwOnError, so errors throw before this;
  // the per-call result type still marks data optional.
  if (data === undefined) {
    throw new Error(`OpenCode ${context} returned no data`);
  }
  return data;
}

export function connectOpencode(args: {
  baseUrl: string;
  directory: string;
  /** The server's Basic-auth password; every request and the event stream send it (OS-2018). */
  password: string;
}): OpencodeClientLike {
  const client = createOpencodeClient({
    baseUrl: args.baseUrl,
    directory: args.directory,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${args.password}`).toString("base64")}` },
    throwOnError: true,
  });

  return {
    async createSession(input) {
      const result = await client.session.create({
        title: input.title,
        permission: input.permission,
      });
      return { id: requireData(result.data, "session.create").id };
    },

    async promptAsync(input) {
      await client.session.promptAsync({
        sessionID: input.sessionID,
        ...(input.model ? { model: input.model } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.variant ? { variant: input.variant } : {}),
        parts: [{ type: "text", text: input.text }],
      });
    },

    async commandAsync(input) {
      // session.command's model parameter is a "providerID/modelID" slug.
      await client.session.command({
        sessionID: input.sessionID,
        command: input.command,
        ...(input.arguments !== undefined ? { arguments: input.arguments } : {}),
        ...(input.model
          ? { model: `${input.model.providerID}/${input.model.modelID}` }
          : {}),
        ...(input.variant ? { variant: input.variant } : {}),
      });
    },

    async listCommands() {
      const result = await client.command.list();
      const data = requireData(result.data, "command.list");
      return data
        .map((command) => command.name)
        .filter((name) => typeof name === "string" && name.length > 0);
    },

    async compactSession(input) {
      // `session.summarize` requires an explicit provider/model; it streams a
      // normal turn and emits `session.compacted` before going idle.
      await client.session.summarize({
        sessionID: input.sessionID,
        providerID: input.model.providerID,
        modelID: input.model.modelID,
      });
    },

    async getSessionModel(sessionID) {
      const result = await client.session.get({ sessionID });
      const model = requireData(result.data, "session.get").model;
      // `model.id` is the modelID (the session shape has no separate field).
      return model ? { providerID: model.providerID, modelID: model.id } : null;
    },

    async getDefaultModel() {
      const result = await client.provider.list();
      const data = requireData(result.data, "provider.list");
      // Prefer a connected provider's default; the map is keyed by provider.
      const providerId =
        data.connected.find((id) => data.default[id] !== undefined) ??
        Object.keys(data.default)[0];
      const modelId = providerId ? data.default[providerId] : undefined;
      return providerId && modelId
        ? { providerID: providerId, modelID: modelId }
        : null;
    },

    async abortSession(sessionID) {
      await client.session.abort({ sessionID });
    },

    async subscribeEvents(signal) {
      const result = await client.event.subscribe(undefined, { signal });
      return result.stream;
    },

    async replyPermission(requestID, reply) {
      await client.permission.reply({ requestID, reply });
    },

    async replyQuestion(requestID, answers) {
      await client.question.reply({ requestID, answers });
    },

    async rejectQuestion(requestID) {
      await client.question.reject({ requestID });
    },

    async listProviders(signal) {
      const result = await client.provider.list(undefined, { signal });
      const data = requireData(result.data, "provider.list");
      return {
        all: data.all.map((provider) => ({
          id: provider.id,
          name: provider.name,
          models: provider.models,
        })),
        connected: data.connected,
        defaults: data.default,
      };
    },

    async getProviderConfig() {
      const result = await client.config.get();
      return requireData(result.data, "config.get").provider ?? {};
    },
  };
}
