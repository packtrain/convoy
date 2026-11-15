import { describe, expect, test } from "vitest";
import { getAppUrlBase } from "@/convex/lib/shared/appUrl";
import { parseConvoyLink, parseSnapshot } from "./parsers";

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
});

test("parseSnapshot ignores unknown statuses", () => {
  expect(parseSnapshot("type=bug; status=In Progress")).toEqual({ typeKey: "bug", status: "In Progress" });
  expect(parseSnapshot("status=Shipped")).toEqual({ typeKey: undefined, status: undefined });
});
