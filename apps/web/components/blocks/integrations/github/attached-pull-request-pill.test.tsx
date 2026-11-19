/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { AttachedPullRequestPill } from "./attached-pull-request-pill";

let live: unknown;
vi.mock("convex/react", () => ({ useQuery: () => live }));
vi.mock("@/lib/auth/hooks", () => ({ useAppConvexAuth: () => ({ isAuthenticated: true }) }));

const pullRequest = { owner: "vercel", name: "next.js", number: 1, ref: "vercel/next.js#1" };
const pill = () => <AttachedPullRequestPill pullRequest={pullRequest} projectId={"project_1" as Id<"projects">} />;

afterEach(cleanup);

describe("AttachedPullRequestPill (OS-2193)", () => {
  test("a PR in a connected repository shows only its number", () => {
    live = { number: 1, title: "Fix routing", state: "open", isDraft: false };
    render(pill());
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Fix routing")).toBeTruthy();
  });

  test("a PR outside the connected repositories shows its full name", () => {
    live = null;
    render(pill());
    expect(screen.getByText("vercel/next.js#1")).toBeTruthy();
  });
});
