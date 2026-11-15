import { describe, expect, it } from "vitest";
import { isOpenableUrl, parsePollResponse, parseStartResponse } from "./browser-login.js";

describe("isOpenableUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isOpenableUrl("https://app.convoy.build/cli-login?challenge=x")).toBe(true);
    expect(isOpenableUrl("http://localhost:3000/device")).toBe(true);
  });

  it("rejects non-web schemes and non-URLs (opener guard)", () => {
    expect(isOpenableUrl("file:///etc/passwd")).toBe(false);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("not a url")).toBe(false);
    expect(isOpenableUrl(42)).toBe(false);
    expect(isOpenableUrl(undefined)).toBe(false);
  });

  it("URL canonicalization percent-encodes shell metacharacters", () => {
    // The opener spawns without a shell AND passes the canonical href, so
    // raw response bytes never reach a command interpreter.
    expect(new URL('https://x.test/" & calc.exe').href).toBe("https://x.test/%22%20&%20calc.exe");
  });
});

describe("parseStartResponse", () => {
  const valid = {
    challengeId: "abc",
    userCode: "WDJB-MJHT",
    loginUrl: "https://app.test/cli-login?challenge=abc",
    deviceUrl: "https://app.test/device",
    expiresAt: 123456,
  };

  it("accepts a well-formed response", () => {
    expect(parseStartResponse(valid)).toEqual(valid);
  });

  it("rejects missing fields, bad URLs, and bad expiry", () => {
    expect(parseStartResponse(null)).toBeNull();
    expect(parseStartResponse({ ...valid, challengeId: "" })).toBeNull();
    expect(parseStartResponse({ ...valid, loginUrl: "file:///x" })).toBeNull();
    expect(parseStartResponse({ ...valid, deviceUrl: 7 })).toBeNull();
    expect(parseStartResponse({ ...valid, expiresAt: "soon" })).toBeNull();
    expect(parseStartResponse({ ...valid, expiresAt: Number.NaN })).toBeNull();
  });
});

describe("parsePollResponse", () => {
  it("accepts every status shape", () => {
    expect(parsePollResponse({ status: "pending" })).toEqual({ status: "pending" });
    expect(parsePollResponse({ status: "denied" })).toEqual({ status: "denied" });
    expect(parsePollResponse({ status: "expired" })).toEqual({ status: "expired" });
    expect(parsePollResponse({ status: "not_found" })).toEqual({ status: "not_found" });
    expect(parsePollResponse({ status: "approved", apiKey: "sk_user_x", email: "a@b.c" })).toEqual({
      status: "approved",
      apiKey: "sk_user_x",
      email: "a@b.c",
    });
  });

  it("rejects approved responses without a usable key", () => {
    expect(parsePollResponse({ status: "approved" })).toBeNull();
    expect(parsePollResponse({ status: "approved", apiKey: "", email: "a@b.c" })).toBeNull();
    expect(parsePollResponse({ status: "approved", apiKey: 1, email: "a@b.c" })).toBeNull();
    expect(parsePollResponse({ status: "???" })).toBeNull();
    expect(parsePollResponse("approved")).toBeNull();
  });
});
