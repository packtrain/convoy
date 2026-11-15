import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";

const { clientMock, constructorMock } = vi.hoisted(() => ({
  clientMock: { query: vi.fn(), mutation: vi.fn(), onUpdate: vi.fn(), close: vi.fn() },
  constructorMock: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexClient: class {
    constructor(...args: unknown[]) {
      constructorMock(...args);
      return clientMock;
    }
  },
}));

import { createConvexClient } from "./convex-client.js";

const KEY = "sk_user_supersecret123";
const leaky = `[CONVEX M(workflows/core:create)] ArgumentValidationError: Object contains extra field \`apiKey\`.\nObject: {apiKey: "${KEY}", name: "x"}`;

describe("createConvexClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redacts the API key from a rejected query or mutation before it can be printed", async () => {
    const client = createConvexClient({ url: "https://example.convex.cloud", apiKey: KEY });
    clientMock.query.mockRejectedValueOnce(new Error(leaky));
    clientMock.mutation.mockRejectedValueOnce(Object.assign(new ConvexError(leaky), { data: leaky }));

    const queryError = await client.query("q" as never, {} as never).catch((error: Error) => error);
    const mutationError = await client.mutation("m" as never, {} as never).catch((error: ConvexError<string>) => error);

    expect(queryError.message).not.toContain(KEY);
    expect(queryError.message).toContain("<redacted>");
    expect(mutationError.message).not.toContain(KEY);
    expect(mutationError.data).not.toContain(KEY);
  });

  it("gives the Convex client a logger that redacts the key from its own error logs", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    createConvexClient({ url: "https://example.convex.cloud", apiKey: KEY });

    const { logger } = constructorMock.mock.calls[0][1];
    logger.error(leaky, { nested: KEY });

    const printed = JSON.stringify(consoleError.mock.calls);
    expect(printed).not.toContain(KEY);
    expect(printed).toContain("<redacted>");
  });
});

describe("createConvexClient secrets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redacts provider secrets from every uploaded string but keeps the API key arg", async () => {
    const token = "ABSKbedrock+token/42==";
    const client = createConvexClient({ url: "https://example.convex.cloud", apiKey: KEY, secrets: [token, undefined] });
    clientMock.mutation.mockResolvedValueOnce(null);

    await client.mutation("m" as never, {
      errorMessage: `401 for ${token}`,
      chunks: [{ type: "item/agentMessage/delta", data: JSON.stringify({ delta: `key=${token}` }), timestamp: 1 }],
    } as never);

    const sent = clientMock.mutation.mock.calls[0][1];
    expect(JSON.stringify(sent)).not.toContain(token);
    expect(sent.errorMessage).toBe("401 for [redacted]");
    expect(JSON.parse(sent.chunks[0].data)).toEqual({ delta: "key=[redacted]" });
    expect(sent.chunks[0].timestamp).toBe(1);
    expect(sent.apiKey).toBe(KEY);
  });

  it("redacts the JSON-escaped form of a secret inside chunk data", async () => {
    const token = 'odd"token\\42';
    const client = createConvexClient({ url: "https://example.convex.cloud", apiKey: KEY, secrets: [token] });
    clientMock.mutation.mockResolvedValueOnce(null);

    await client.mutation("m" as never, { chunks: [{ data: JSON.stringify({ delta: token }) }] } as never);

    expect(JSON.parse(clientMock.mutation.mock.calls[0][1].chunks[0].data)).toEqual({ delta: "[redacted]" });
  });
});
