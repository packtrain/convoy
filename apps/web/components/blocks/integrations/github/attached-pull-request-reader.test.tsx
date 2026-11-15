/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { AttachedPullRequestReader } from "./attached-pull-request-reader";

let status: unknown;
vi.mock("./use-integration-status", () => ({ useIntegrationStatus: () => status }));
vi.mock("./pull-request-reader", () => ({
  PullRequestReader: ({ repositoryId }: { repositoryId: string }) => <p>Reader for {repositoryId}</p>,
  PullRequestReaderSkeleton: () => <p>Loading</p>,
}));

const pullRequest = { owner: "Acme", name: "Web", number: 7, ref: "acme/web#7" };
const connection = (state: "active" | "disconnected") => ({
  repositoryId: "repo_1",
  status: state,
  repository: { owner: "acme", name: "web", htmlUrl: "https://github.com/acme/web" },
});
const tab = () => (
  <AttachedPullRequestReader projectId={"project_1" as Id<"projects">} pullRequest={pullRequest} organizationSlug="org" projectAlias="WEB" />
);

afterEach(cleanup);

describe("AttachedPullRequestReader (OS-2193)", () => {
  test("a connected repository opens the reader", () => {
    status = { connections: [connection("active")] };
    render(tab());
    expect(screen.getByText("Reader for repo_1")).toBeTruthy();
  });

  test("a disconnected repository links to GitHub instead", () => {
    status = { connections: [connection("disconnected")] };
    render(tab());
    expect(screen.getByRole("link", { name: "Open on GitHub" }).getAttribute("href")).toBe("https://github.com/Acme/Web/pull/7");
  });
});
