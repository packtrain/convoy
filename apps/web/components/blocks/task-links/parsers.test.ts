import { describe, expect, test } from "vitest";
import { getAppUrlBase } from "@/convex/lib/shared/appUrl";
import { parseConvoyLink, parsePullRequestLink, parseSnapshot } from "./parsers";

describe("parseConvoyLink", () => {
  test("accepts app-origin and relative task links", () => {
    expect(parseConvoyLink(`${getAppUrlBase()}/o/acme/OS/kanban?task=OS-1&artifact=kd7`)).toMatchObject({
      refId: "OS-1",
      artifactId: "kd7",
      organizationSlug: "acme",
      projectAlias: "OS",
      path: "/o/acme/OS/kanban?task=OS-1&artifact=kd7",
    });
    expect(parseConvoyLink("/o/acme/OS?task=OS-1")?.refId).toBe("OS-1");
  });

  test("rejects other origins, other routes, and unfinished streamed links", () => {
    expect(parseConvoyLink("https://evil.example/o/acme/OS?task=OS-1")).toBeNull();
    expect(parseConvoyLink(`${getAppUrlBase()}/o/acme/OS/threads?task=OS-1`)).toBeNull();
    expect(parseConvoyLink(`${getAppUrlBase()}/o/acme/OS?task=not a ref`)).toBeNull();
    expect(parseConvoyLink("streamdown:incomplete-link")).toBeNull();
  });

  test("rejects malformed escapes in the org or project segment instead of throwing", () => {
    expect(parseConvoyLink("/o/%E0%A4/OS?task=OS-1")).toBeNull();
    expect(parseConvoyLink("/o/acme/%E0%A4?task=OS-1")).toBeNull();
  });
});

describe("parsePullRequestLink", () => {
  test("accepts app-origin and relative PR reader links", () => {
    expect(parsePullRequestLink(`${getAppUrlBase()}/o/acme/OS/pull-requests?repo=contoso%2Fconvoy&pr=8`)).toEqual({
      number: 8,
      path: "/o/acme/OS/pull-requests?repo=contoso%2Fconvoy&pr=8",
    });
    expect(parsePullRequestLink("/o/acme/OS/pull-requests?repo=contoso/convoy&pr=8&tab=diff")?.number).toBe(8);
  });

  test("rejects other origins, missing repos, and bad numbers", () => {
    expect(parsePullRequestLink("https://evil.example/o/acme/OS/pull-requests?repo=a/b&pr=8")).toBeNull();
    expect(parsePullRequestLink("/o/acme/OS/pull-requests?pr=8")).toBeNull();
    expect(parsePullRequestLink("/o/acme/OS/pull-requests?repo=a/b&pr=0")).toBeNull();
    expect(parsePullRequestLink("/o/acme/OS/pull-requests?repo=a/b&pr=8x")).toBeNull();
    expect(parsePullRequestLink("/o/acme/OS/pull-requests")).toBeNull();
  });
});

test("parseSnapshot ignores unknown statuses and states", () => {
  expect(parseSnapshot("type=bug; status=In Progress")).toEqual({ typeKey: "bug", status: "In Progress", state: undefined });
  expect(parseSnapshot("status=Shipped; state=reopened")).toEqual({ typeKey: undefined, status: undefined, state: undefined });
  expect(parseSnapshot("state=merged").state).toBe("merged");
});
