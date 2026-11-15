import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildInvitationUrl,
  buildOrganizationUrl,
  buildProjectUrl,
  getAppUrlBase,
} from "./links";

describe("email links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses the default app url when not configured", () => {
    expect(getAppUrlBase()).toBe("https://app.convoy.build");
  });

  test("uses the default app url when configured with whitespace", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", " ");

    expect(getAppUrlBase()).toBe("https://app.convoy.build");
  });

  test("builds absolute invitation, organization, and project urls", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    expect(buildInvitationUrl("invite_123")).toBe(
      "https://app.example.com/auth/invite/invite_123",
    );
    expect(buildOrganizationUrl("acme")).toBe("https://app.example.com/o/acme/");
    expect(buildProjectUrl("acme", "WEB")).toBe("https://app.example.com/o/acme/WEB");
  });
});
