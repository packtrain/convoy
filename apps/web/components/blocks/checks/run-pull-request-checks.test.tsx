/** @vitest-environment jsdom */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { TaskChecks } from "./types";
import { RunPullRequestChecksButton } from "./run-pull-request-checks";

let viewer = { _id: "user_1" };
const composer = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("convex/react", () => ({
  useQuery: (fn: Parameters<typeof getFunctionName>[0]) => (getFunctionName(fn) === getFunctionName(api.users.core.current) ? viewer : undefined),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/authz/use-project-permissions", () => ({ useProjectPermissions: () => ({ canUseThreads: true }) }));
vi.mock("@/lib/navigation", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: () => ({ profiles: [{ _id: "profile_1", isOnline: true, paths: [] }], isLoading: false, hasProfiles: true }),
}));
// The composer is tested on its own; this checks what the popup hands it.
vi.mock("@/components/blocks/tasks/task-thread-composer", () => ({
  TaskThreadComposer: (props: Record<string, unknown>) => {
    composer.props = props;
    return <div data-testid="composer" />;
  },
}));

const data = {
  checklists: [{ _id: "pr", name: "PR", isDefault: false, checkKeys: ["risk"], taskTypeKeys: [] }],
  checklistId: "pr",
  followsTypeDefault: false,
  catalog: [{ key: "risk", label: "Merge risk", instruction: "Rate it" }],
  checks: [{ key: "risk", label: "Merge risk", instruction: "Rate it", added: false, results: [] }],
  pullRequest: { headSha: "abc123" },
} as unknown as TaskChecks;

const pullRequest = { owner: "acme", name: "web", number: 12, ref: "acme/web#12" };

describe("RunPullRequestChecksButton (OS-2400)", () => {
  afterEach(() => {
    cleanup();
    composer.props = null;
    viewer = { _id: "user_1" };
  });

  test("opens a thread composer on the PR, prefilled with the checks prompt for the head the card shows", () => {
    render(<RunPullRequestChecksButton projectId={"project_1" as never} organizationSlug="org" projectAlias="WEB" pullRequest={pullRequest} data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /Run checks/ }));

    const dialog = screen.getByRole("dialog", { name: "Run pull request checks" });
    expect(dialog.textContent).not.toContain("against");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(composer.props).toMatchObject({
      pullRequest,
      pullRequestChecks: { headSha: "abc123" },
      seedReplacesDraft: true,
      // Per member, so another member's choices on this browser don't carry over.
      draftKey: "pull-request-checks:user_1",
    });
    expect(composer.props?.seed).toContain("abc123");
    expect(composer.props?.seed).toContain("`risk` Merge risk: Rate it");
    // A Check that asks for a value or artifact gets the flag, and the agent writes each command out (OS-2401).
    expect(composer.props?.seed).toContain("Add `--value <answer>` or `--artifact <artifactId>` when the Check asks for one");
    expect(composer.props?.seed).toContain("Write each command out in full, without shell variables");
  });
});
