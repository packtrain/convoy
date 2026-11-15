/**
 * @vitest-environment jsdom
 */
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { QuickThreadDialog } from "./index";

// Real ThreadComposer and TipTap editor; only Convex is faked. The mocked composer
// in quick-thread-dialog.test.tsx can't show where focus really lands.
const { queryResults } = vi.hoisted(() => ({ queryResults: new Map<string, unknown>() }));

vi.mock("convex/react", () => ({
  useMutation: () => Object.assign(vi.fn(), { withOptimisticUpdate: () => vi.fn() }),
  useQuery: (ref: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : queryResults.get(getFunctionName(ref))),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
  useConvex: () => ({ query: vi.fn() }),
}));

vi.mock("@/lib/authz/use-project-permissions", () => ({
  useProjectPermissions: () => ({ canUseThreads: true, isLoading: false }),
}));

const PROFILES = [
  {
    _id: "profile_1",
    name: "Laptop",
    isOnline: true,
    availableClis: [{ cliType: "claude-code" }],
    paths: [{ id: "path_1", path: "/tmp/project", label: "project" }],
  },
];

function renderDialog() {
  // StrictMode like `next dev`: its effect double-invoke detaches and re-attaches the editor DOM.
  const element = () => (
    <StrictMode>
      <QuickThreadDialog organizationId={"org_1" as Id<"organizations">} organizationSlug="contoso" projectAlias="OS" />
    </StrictMode>
  );
  const view = render(element());
  return { rerender: () => view.rerender(element()) };
}

function editor() {
  return document.querySelector<HTMLElement>('[data-thread-composer-editor="true"]');
}

describe("QuickThreadDialog focus with the real composer", () => {
  beforeEach(() => {
    queryResults.clear();
    queryResults.set("projects/core:getByAlias", { _id: "project_1", alias: "OS" });
    queryResults.set("agents/projectAgents:listByProject", []);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  test("focuses the editor when profiles are already loaded", async () => {
    queryResults.set("cli/profiles:listByProject", PROFILES);
    renderDialog();
    fireEvent.keyDown(document.body, { key: "N", shiftKey: true });

    await waitFor(() => expect(editor()?.getAttribute("contenteditable")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(editor()));
  });

  test("focuses the editor when profiles load after the dialog opens", async () => {
    const { rerender } = renderDialog();
    fireEvent.keyDown(document.body, { key: "N", shiftKey: true });
    await waitFor(() => expect(editor()?.getAttribute("contenteditable")).toBe("false"));
    // Radix's default would land on the first pill and open its card.
    expect(document.activeElement?.tagName).not.toBe("BUTTON");

    queryResults.set("cli/profiles:listByProject", PROFILES);
    act(() => rerender());

    await waitFor(() => expect(editor()?.getAttribute("contenteditable")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(editor()));
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});
