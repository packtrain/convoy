/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { PullRequestCheckIcons, usePullRequestListChecks } from "./pull-request-check-icons";

// The real useQueries over a client whose queries never load, so only the hook's own renders count.
const client = {
  watchQuery: () => ({ onUpdate: () => () => {}, localQueryResult: () => undefined, journal: () => undefined }),
} as unknown as ConvexReactClient;

function Rows({ refs }: { refs: string[] }) {
  const checks = usePullRequestListChecks("project_1" as Id<"projects">, refs);
  return <p>{checks.size} loaded</p>;
}

describe("usePullRequestListChecks", () => {
  afterEach(cleanup);

  test("a fresh refs array each render does not resubscribe in a loop", () => {
    render(
      <ConvexProvider client={client}>
        <Rows refs={["r/1#1", "r/1#2"]} />
      </ConvexProvider>
    );
    expect(screen.getByText("0 loaded")).toBeDefined();
  });

  test("icons keep each Check's slot: an unreported one is the pending circle, an outdated one is dimmed", () => {
    render(
      <PullRequestCheckIcons
        checks={[
          { key: "risk", label: "Merge risk", status: "passed", value: "low", note: undefined, outdated: true },
          { key: "tests", label: "All tests pass", status: "pending", value: undefined, note: undefined, outdated: false },
        ]}
      />
    );
    const [risk, tests] = screen.getByLabelText("Pull request checks").children;
    expect(risk.querySelector("[aria-label='Passed']")).not.toBeNull();
    expect(risk.className).toContain("opacity-40");
    expect(tests.querySelector("[aria-label='Pending']")).not.toBeNull();
    expect(tests.className).not.toContain("opacity-40");
  });
});
