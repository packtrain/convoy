import { describe, expect, test } from "vitest";

import {
  AGENT_BROWSER_AUTH_HEADER,
  buildAgentBrowserAppSignInUrl,
  buildAgentBrowserRedirectUrl,
  getBrowserFacingOrigin,
  getProvidedAgentBrowserSecret,
  isAllowedAgentBrowserHost,
  isValidAgentBrowserSecret,
  parseAllowedHosts,
} from "./lib";

describe("agent browser login helpers", () => {
  test("validates the browser-login secret without accepting missing values", () => {
    expect(isValidAgentBrowserSecret("secret", "secret")).toBe(true);
    expect(isValidAgentBrowserSecret("wrong", "secret")).toBe(false);
    expect(isValidAgentBrowserSecret(null, "secret")).toBe(false);
  });

  test("reads secrets from the header and only allows query secrets for GET", () => {
    const headers = new Headers([[AGENT_BROWSER_AUTH_HEADER, "from-header"]]);
    expect(
      getProvidedAgentBrowserSecret({
        method: "POST",
        url: "http://localhost:3000/api/agent/browser-login",
        headers,
      })
    ).toBe("from-header");
    expect(
      getProvidedAgentBrowserSecret({
        method: "GET",
        url: "http://localhost:3000/api/agent/browser-login?secret=from-query",
        headers: new Headers(),
      })
    ).toBe("from-query");
    expect(
      getProvidedAgentBrowserSecret({
        method: "POST",
        url: "http://localhost:3000/api/agent/browser-login?secret=from-query",
        headers: new Headers(),
      })
    ).toBeNull();
  });

  test("defaults to local hosts and supports configured host allowlists", () => {
    expect(
      isAllowedAgentBrowserHost(
        "http://localhost:3000/api/agent/browser-login",
        parseAllowedHosts(undefined)
      )
    ).toBe(true);
    expect(
      isAllowedAgentBrowserHost(
        "https://example.com/api/agent/browser-login",
        parseAllowedHosts(undefined)
      )
    ).toBe(false);
    expect(
      isAllowedAgentBrowserHost(
        "https://preview.convoy.build/api/agent/browser-login",
        parseAllowedHosts("preview.convoy.build")
      )
    ).toBe(true);
  });

  test("builds a callback redirect and sanitizes unsafe destinations", () => {
    expect(
      buildAgentBrowserRedirectUrl(
        "/o/acme/WEB?task=WEB-7",
        {
          method: "POST",
          url: "http://localhost:3000/api/agent/browser-login",
          headers: new Headers(),
        },
        undefined
      )
    ).toBe(
      "http://localhost:3000/auth/callback?redirect_url=%2Fo%2Facme%2FWEB%3Ftask%3DWEB-7"
    );
    expect(
      buildAgentBrowserRedirectUrl(
        "https://example.com/phishing",
        {
          method: "POST",
          url: "http://localhost:3000/api/agent/browser-login",
          headers: new Headers(),
        },
        undefined
      )
    ).toBe("http://localhost:3000/auth/callback?redirect_url=%2F");
  });

  test("prefers forwarded host when deriving the browser-facing origin", () => {
    expect(
      getBrowserFacingOrigin({
        method: "GET",
        url: "https://localhost:4039/api/agent/browser-login",
        headers: new Headers([
          ["x-forwarded-host", "app.convoy.localhost"],
          ["x-forwarded-proto", "https"],
        ]),
      })
    ).toBe("https://app.convoy.localhost");
  });

  test("builds app sign-in URLs from Clerk sign-in token URLs", () => {
    expect(
      buildAgentBrowserAppSignInUrl(
        "https://example.accounts.dev/sign-in?__clerk_ticket=ticket&redirect_url=https%3A%2F%2Fexample.com",
        "https://app.convoy.localhost/auth/callback?redirect_url=%2Fo%2F",
        {
          method: "GET",
          url: "https://localhost:4039/api/agent/browser-login",
          headers: new Headers([
            ["x-forwarded-host", "app.convoy.localhost"],
            ["x-forwarded-proto", "https"],
          ]),
        },
        undefined
      )
    ).toBe(
      "https://app.convoy.localhost/auth/sign-in?__clerk_ticket=ticket&redirect_url=https%3A%2F%2Fapp.convoy.localhost%2Fauth%2Fcallback%3Fredirect_url%3D%252Fo%252F"
    );
  });
});
