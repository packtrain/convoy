/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentListItem } from "./agent-list-item";

afterEach(cleanup);

// OS-2521: detected repos and worktrees are not extra working directories.
test("the path summary counts configured paths only", () => {
  render(
    <AgentListItem
      onClick={() => {}}
      agent={{
        sessionId: "session_1" as Id<"cliSessions">,
        profileId: "profile_1" as Id<"cliProfiles">,
        instanceId: "instance_1",
        name: "acme",
        userName: "Agent",
        isOnline: true,
        paths: [
          { id: "folder", path: "/tmp/acme" },
          { id: "repo_a", path: "/tmp/acme/old-app", kind: "repo" },
          { id: "repo_b", path: "/tmp/acme/new-app", kind: "repo" },
          { id: "wt", path: "/tmp/acme-wt", kind: "worktree" },
        ],
      }}
    />
  );
  expect(screen.getByText("/tmp/acme")).toBeTruthy();
  expect(screen.queryByText(/more/)).toBeNull();
});
