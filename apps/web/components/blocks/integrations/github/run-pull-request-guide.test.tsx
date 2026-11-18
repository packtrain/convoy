/** @vitest-environment jsdom */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useGenerateGuide } from "./run-pull-request-guide";

const composer = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("convex/react", () => ({
  useQuery: (fn: Parameters<typeof getFunctionName>[0]) => (getFunctionName(fn) === getFunctionName(api.users.core.current) ? { _id: "user_1" } : undefined),
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

const target = { projectId: "project_1" as never, organizationSlug: "org", projectAlias: "WEB", pullRequest: { owner: "acme", name: "web", number: 12, ref: "acme/web#12" } };

describe("useGenerateGuide (OS-2412)", () => {
  afterEach(() => {
    cleanup();
    composer.props = null;
  });

  test("opens a composer on the PR with the guide prompt, on its own draft", () => {
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }));
    expect(result.current.disabled).toBe(false);
    act(() => result.current.start());
    render(<>{result.current.dialog}</>);
    expect(composer.props).toMatchObject({ pullRequest: target.pullRequest, pullRequestGuide: { headSha: "h1" }, draftKey: "pull-request-guide:user_1", seedReplacesDraft: true });
    expect(composer.props?.seed).toContain("at commit h1");
  });

  test("a push while the popup is open keeps the head its prompt names, so the server rejects the run", () => {
    let revision = { baseSha: "b1", headSha: "h1" };
    const { result, rerender } = renderHook(() => useGenerateGuide(target, revision));
    act(() => result.current.start());
    const view = render(<>{result.current.dialog}</>);
    revision = { baseSha: "b1", headSha: "h2" };
    rerender();
    view.rerender(<>{result.current.dialog}</>);
    expect(composer.props).toMatchObject({ pullRequestGuide: { headSha: "h1" } });
  });

  test("Retry hands the failed guide to the run, on the current head (OS-2413)", () => {
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h2" }));
    act(() => result.current.start("guide_1" as never));
    render(<>{result.current.dialog}</>);
    expect(composer.props).toMatchObject({ pullRequestGuide: { headSha: "h2", retryGuideId: "guide_1" } });
  });

  test("disabled with the reason until Convoy has synced the PR", () => {
    const { result } = renderHook(() => useGenerateGuide(target, null));
    expect(result.current).toMatchObject({ disabled: true, reason: "Convoy has not synced this pull request yet" });
  });
});
