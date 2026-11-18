/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { Checklist } from "./types";
import { PullRequestChecksSettings } from "./pull-request-checks-settings";

const data = vi.hoisted(() => ({ checklists: [] as unknown[] | undefined, mutate: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: () => data.checklists,
  useMutation: () => data.mutate,
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    checks: { checklists: { list: "checklists.list", setDefaults: "setDefaults" } },
    projects: { core: { update: "projects.update" } },
  },
}));

const projectId = "project_1" as Id<"projects">;
const checklist = (name: string, pullRequests = false): Checklist => ({
  _id: `checklist_${name}` as Id<"checklists">,
  name,
  checkKeys: [],
  taskTypeKeys: ["feature"],
  pullRequests,
});
const picker = () => screen.getByRole("combobox", { name: "Default checklist for pull requests" });

describe("PullRequestChecksSettings", () => {
  // Radix Select scrolls the picked option into view, which jsdom lacks.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    data.checklists = [];
    data.mutate.mockReset();
  });

  test("picking the default checklist changes only the pull request default", async () => {
    data.checklists = [checklist("Review", true), checklist("Release")];
    render(<PullRequestChecksSettings projectId={projectId} canEdit publishPullRequestChecks />);

    expect(picker().textContent).toContain("Review");
    fireEvent.click(picker());
    fireEvent.click(await screen.findByRole("option", { name: "Release" }));

    await waitFor(() => expect(data.mutate).toHaveBeenCalledWith({ projectId, taskTypes: [], pullRequests: "checklist_Release" }));
  });

  test("No checks clears the default", async () => {
    data.checklists = [checklist("Review", true)];
    render(<PullRequestChecksSettings projectId={projectId} canEdit publishPullRequestChecks />);

    fireEvent.click(picker());
    fireEvent.click(await screen.findByRole("option", { name: "No checks" }));

    await waitFor(() => expect(data.mutate).toHaveBeenCalledWith({ projectId, taskTypes: [], pullRequests: null }));
  });

  test("the publish switch saves the project setting", async () => {
    render(<PullRequestChecksSettings projectId={projectId} canEdit publishPullRequestChecks />);

    fireEvent.click(screen.getByRole("switch", { name: "Publish results to the Git host" }));

    await waitFor(() => expect(data.mutate).toHaveBeenCalledWith({ id: projectId, publishPullRequestChecks: false }));
  });

  test("a member without edit rights sees both settings disabled", () => {
    data.checklists = [checklist("Review", true)];
    render(<PullRequestChecksSettings projectId={projectId} canEdit={false} publishPullRequestChecks />);

    expect(picker()).toHaveProperty("disabled", true);
    expect(screen.getByRole("switch", { name: "Publish results to the Git host" })).toHaveProperty("disabled", true);
  });
});
