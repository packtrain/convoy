import { ConvexClient, ConvexHttpClient } from "convex/browser";
import type {
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";

export interface ConvexClientOptions {
  url: string;
  apiKey: string;
  /** Provider credentials replaced in every mutation arg; see cli-provider-keys spec. */
  secrets?: Array<string | undefined>;
  quiet?: boolean;
}

const REDACTED = "<redacted>";

// Convex echoes the rejected args — `apiKey` included — in validation errors,
// so every path that can print one is scrubbed of the key here, at the source.
function redactor(secret: string) {
  const scrub = (value: unknown): unknown =>
    typeof value === "string"
      ? value.split(secret).join(REDACTED)
      : value instanceof Error || value === null || typeof value !== "object"
        ? value
        : JSON.parse(JSON.stringify(value).split(secret).join(REDACTED));

  const scrubError = (error: unknown): unknown => {
    if (error instanceof Error) {
      error.message = scrub(error.message) as string;
      if (error.stack) error.stack = scrub(error.stack) as string;
      if ("data" in error) error.data = scrub(error.data);
    }
    return error;
  };

  return { scrub, scrubError };
}

/** Replace `secret` and its JSON-escaped form, which chunk `data` strings carry. */
export function redactAuth(value: string, secret?: string): string {
  if (!secret) return value;
  return value.split(JSON.stringify(secret).slice(1, -1)).join("[redacted]").split(secret).join("[redacted]");
}

/** Deep copy of `value` with each secret replaced in every string. */
export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value;
  const clean = (item: unknown): unknown =>
    typeof item === "string"
      ? secrets.reduce((text, secret) => redactAuth(text, secret), item)
      : Array.isArray(item)
        ? item.map(clean)
        : item !== null && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype
          ? Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, clean(entry)]))
          : item;
  return clean(value) as T;
}

/**
 * Create a Convex client wrapper that injects API key into all calls
 */
export function createConvexClient(options: ConvexClientOptions) {
  const { scrub, scrubError } = redactor(options.apiKey);
  const secrets = (options.secrets ?? []).filter((secret): secret is string => !!secret);
  const print =
    (level: "log" | "warn" | "error") =>
    (...args: unknown[]) =>
      console[level](...args.map((arg) => scrub(scrubError(arg))));
  const client = new ConvexClient(options.url, {
    logger: options.quiet ? false : { logVerbose: () => undefined, log: print("log"), warn: print("warn"), error: print("error") },
  });

  return {
    /**
     * The underlying Convex client
     */
    client,

    /** Redacted from every mutation; the flush buffer holds back a delta that may end in one. */
    secrets,

    /**
     * Execute a query with API key authentication
     */
    async query<Query extends FunctionReference<"query">>(
      query: Query,
      args: Omit<FunctionArgs<Query>, "apiKey"> & { apiKey?: string }
    ): Promise<FunctionReturnType<Query>> {
      const argsWithApiKey = {
        ...args,
        apiKey: args.apiKey ?? options.apiKey,
      } as FunctionArgs<Query>;
      return client.query(query, argsWithApiKey).catch((error: unknown) => {
        throw scrubError(error);
      });
    },

    /**
     * Execute a mutation with API key authentication
     */
    async mutation<Mutation extends FunctionReference<"mutation">>(
      mutation: Mutation,
      args: Omit<FunctionArgs<Mutation>, "apiKey"> & { apiKey?: string }
    ): Promise<FunctionReturnType<Mutation>> {
      const argsWithApiKey = {
        ...redactSecrets(args, secrets),
        apiKey: args.apiKey ?? options.apiKey,
      } as FunctionArgs<Mutation>;
      return client.mutation(mutation, argsWithApiKey).catch((error: unknown) => {
        throw scrubError(error);
      });
    },

    /**
     * Subscribe to a query with API key authentication
     */
    subscribe<Query extends FunctionReference<"query">>(
      query: Query,
      args: Omit<FunctionArgs<Query>, "apiKey"> & { apiKey?: string },
      callbacks: {
        onUpdate: (value: FunctionReturnType<Query>) => void;
        onError?: (error: Error) => void;
      }
    ): () => void {
      const argsWithApiKey = {
        ...args,
        apiKey: args.apiKey ?? options.apiKey,
      } as FunctionArgs<Query>;

      const unsubscribe = client.onUpdate(
        query,
        argsWithApiKey,
        (value: FunctionReturnType<Query>) => {
          callbacks.onUpdate(value);
        }
      );

      return unsubscribe;
    },

    /**
     * Close the connection
     */
    async close(): Promise<void> {
      await client.close();
    },
  };
}

export type ConvoyClient = ReturnType<typeof createConvexClient>;

/** Stateless HTTP transport with the same credential scrubbing as subscriptions. */
export function createConvexHttpClient(options: ConvexClientOptions, signal?: AbortSignal) {
  const { scrubError } = redactor(options.apiKey);
  const client = new ConvexHttpClient(options.url, {
    logger: false,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]) }),
  });
  return {
    async query<Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query>): Promise<FunctionReturnType<Query>> {
      try { return await client.query(query, { ...args, apiKey: options.apiKey }); }
      catch (error) { throw scrubError(error); }
    },
    async mutation<Mutation extends FunctionReference<"mutation">>(mutation: Mutation, args: FunctionArgs<Mutation>): Promise<FunctionReturnType<Mutation>> {
      try { return await client.mutation(mutation, { ...args, apiKey: options.apiKey }); }
      catch (error) { throw scrubError(error); }
    },
  };
}
