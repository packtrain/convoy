/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import { buildProjectDraftStorageKey, saveProjectDrafts } from "@/lib/threads/draft-storage";
import type { GuideSummary } from "@/convex/integrations/github/lib/validators";
import { useGenerateGuide } from "./run-pull-request-guide";

const state = vi.hoisted(() => ({
  composer: null as null | Record<string, unknown>,
  preferences: { agentAutoStart: false, guideAutoStart: false },
  guidePrompt: null as string | null,
  online: true,
  worktrees: [] as Array<{ id: string; path: string; label: string; kind: "worktree"; parentPathId: string }>,
  create: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
  upsert: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
  query: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));
const composer = { get props() { return state.composer; } };
const name = (fn: Parameters<typeof getFunctionName>[0]) => getFunctionName(fn);
vi.mock("convex/react", () => ({
  useQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    if (name(fn) === name(api.users.core.current)) return { _id: "user_1" };
    if (name(fn) === name(api.users.projectPreferences.get)) return state.preferences;
    if (name(fn) === name(api.integrations.github.guides.getPrompt)) return state.guidePrompt;
    if (name(fn) === name(api.agents.projectAgents.listByProject)) return [];
    return undefined;
  },
  useConvex: () => ({ query: state.query }),
  useMutation: (fn: Parameters<typeof getFunctionName>[0]) => (name(fn) === name(api.cli.threads.core.create) ? state.create : state.upsert),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/authz/use-project-permissions", () => ({ useProjectPermissions: () => ({ canUseThreads: true }) }));
vi.mock("@/lib/navigation", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: () => ({
    profiles: [
      {
        _id: "profile_1",
        name: "Laptop",
        isOnline: state.online,
        availableClis: [{ type: "codex", version: "1" }],
        paths: [{ id: "path_1", path: "/repo", label: "repo" }, ...state.worktrees],
      },
      { _id: "profile_2", name: "Desktop", isOnline: true, availableClis: [{ type: "codex", version: "1" }], paths: [{ id: "path_2", path: "/repo", label: "repo" }] },
    ],
    isLoading: false,
    hasProfiles: true,
  }),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>{children}</button>
  ),
}));
// The composer is tested on its own; this checks what the popup hands it.
vi.mock("@/components/blocks/tasks/task-thread-composer", () => ({
  TaskThreadComposer: (props: Record<string, unknown>) => {
    state.composer = props;
    return <div data-testid="composer">{props.extraSelectorTools as ReactNode}</div>;
  },
}));

const target = { projectId: "project_1" as never, organizationSlug: "org", projectAlias: "WEB", pullRequest: { owner: "acme", name: "web", number: 12, ref: "acme/web#12" } };

beforeEach(() => {
  window.localStorage.clear();
  state.preferences = { agentAutoStart: false, guideAutoStart: false };
  state.guidePrompt = null;
  state.online = true;
  state.worktrees = [];
  toast.error.mockClear();
  state.create = vi.fn().mockResolvedValue("thread_1");
  state.upsert = vi.fn().mockResolvedValue(null);
  state.query = vi.fn();
});

describe("useGenerateGuide (OS-2412)", () => {
  afterEach(() => {
    cleanup();
    state.composer = null;
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

  test("Update guide follows up the newest ready guide, with its steps in the prompt (OS-2417)", async () => {
    const guide = (id: string, status: GuideSummary["status"], headSha: string) =>
      ({ _id: id, status, headSha, requester: { name: "Maya", avatarUrl: null, isViewer: false } }) as GuideSummary;
    const guides = [guide("writing_1", "writing", "h-other"), guide("ready_2", "ready", "h0"), guide("ready_1", "ready", "h-old")];
    state.query.mockResolvedValue({ ...guides[1], steps: [{ title: "Add the schema", explanation: "Adds a table.", files: [{ path: "convex/schema.ts" }], questions: [] }] });
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }, guides));
    await act(async () => result.current.update());
    expect(state.query).toHaveBeenCalledWith(api.integrations.github.guides.get, { guideId: "ready_2" });
    render(<>{result.current.dialog}</>);
    expect(composer.props).toMatchObject({ pullRequestGuide: { headSha: "h1", baseGuideId: "ready_2" } });
    expect(composer.props?.seed).toContain("This guide follows up the guide written for h0.");
    expect(composer.props?.seed).toContain("Base step 1: Add the schema");
    expect(screen.getByText("Update the guide")).toBeTruthy();
  });

  test("Retry of a follow-up follows up the newest ready guide again (OS-2417)", async () => {
    const failed = { _id: "failed_1", status: "failed", headSha: "h0", base: { guideId: "gone" }, requester: { isViewer: true } } as unknown as GuideSummary;
    const ready = { _id: "ready_1", status: "ready", headSha: "h-old", requester: { isViewer: true } } as unknown as GuideSummary;
    state.query.mockResolvedValue({ ...ready, steps: [] });
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }, [failed, ready]));
    await act(async () => result.current.start("failed_1" as never));
    render(<>{result.current.dialog}</>);
    expect(composer.props).toMatchObject({ pullRequestGuide: { headSha: "h1", retryGuideId: "failed_1", baseGuideId: "ready_1" } });
  });

  test("the prompt carries the project's Guide prompt and the PR's Stack (OS-2416)", () => {
    state.guidePrompt = "Write every explanation as one short sentence.";
    const layers = [{ number: 11, title: "Schema" }, { number: 12, title: "API" }];
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }, [], layers));
    act(() => result.current.start());
    render(<>{result.current.dialog}</>);
    expect(composer.props?.seed).toContain("Write every explanation as one short sentence.");
    expect(composer.props?.seed).not.toContain("How to write the guide:");
    expect(composer.props?.seed).toContain("#12 API (this pull request)");
    // The Guide stores the instructions the seed was built with, not the setting at send time.
    expect(composer.props?.pullRequestGuide).toEqual({ headSha: "h1", guidePrompt: "Write every explanation as one short sentence." });
  });

  test("waits for a stacked PR's Layers, so the prompt never leaves them out (OS-2416)", () => {
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }, [], null));
    expect(result.current.disabled).toBe(true);
    act(() => result.current.start());
    expect(result.current.dialog).toBeNull();
  });

  test("an automatic start sends the instructions it used (OS-2416)", async () => {
    state.guidePrompt = "Be brief.";
    state.preferences = { agentAutoStart: false, guideAutoStart: true };
    saveProjectDrafts(buildProjectDraftStorageKey("org", "WEB"), {
      "pull-request-guide:user_1": { text: "", profileId: "profile_1", pathId: "path_1", cliType: "codex", updatedAt: Date.now() },
    });
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }));
    act(() => result.current.start());
    render(<>{result.current.dialog}</>);
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    expect(state.create.mock.calls[0][0].pullRequestGuide).toEqual({ headSha: "h1", guidePrompt: "Be brief." });
  });

  test("disabled with the reason until Convoy has synced the PR", () => {
    const { result } = renderHook(() => useGenerateGuide(target, null));
    expect(result.current).toMatchObject({ disabled: true, reason: "Convoy has not synced this pull request yet" });
  });
});

describe("Generate guide without asking (OS-2414)", () => {
  afterEach(() => {
    cleanup();
    state.composer = null;
  });

  // What the Guide composer's draft keeps after a send: its pills, not its text.
  const remember = (baseRef?: { type: "worktree"; pathId: string }) =>
    saveProjectDrafts(buildProjectDraftStorageKey("org", "WEB"), {
      "pull-request-guide:user_1": { text: "", profileId: "profile_1", pathId: "path_1", cliType: "codex", cliModel: "gpt-6-astra", baseRef, updatedAt: Date.now() },
    });

  const expectComposerInstead = async () => {
    const { result, rerender } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }));
    act(() => result.current.start());
    const view = render(<>{result.current.dialog}</>);
    await waitFor(() => {
      rerender();
      view.rerender(<>{result.current.dialog}</>);
      expect(screen.getByTestId("composer")).toBeTruthy();
    });
    expect(state.create).not.toHaveBeenCalled();
  };

  test("the composer saves a changed choice when the member sends", () => {
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }));
    act(() => result.current.start());
    render(<>{result.current.dialog}</>);
    fireEvent.click(screen.getByRole("button", { name: "Auto-start next time" }));
    expect(state.upsert).not.toHaveBeenCalled();
    act(() => (composer.props?.onThreadCreated as (id: string) => void)("thread_1"));
    expect(state.upsert).toHaveBeenCalledWith({ projectId: "project_1", guideAutoStart: true });
  });

  test("says so when the choice could not be saved", async () => {
    state.upsert = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }));
    act(() => result.current.start());
    render(<>{result.current.dialog}</>);
    fireEvent.click(screen.getByRole("button", { name: "Auto-start next time" }));
    act(() => (composer.props?.onThreadCreated as (id: string) => void)("thread_1"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save the Generate guide choice"));
  });

  test("starts the run at once with the remembered profile, path, and model, and a fresh prompt", async () => {
    state.preferences = { agentAutoStart: false, guideAutoStart: true };
    remember();
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }));
    act(() => result.current.start());
    render(<>{result.current.dialog}</>);
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    expect(state.create.mock.calls[0][0]).toMatchObject({
      profileId: "profile_1",
      pathId: "path_1",
      cliType: "codex",
      cliModel: "gpt-6-astra",
      pullRequestUrl: "https://github.com/acme/web/pull/12",
      pullRequestGuide: { headSha: "h1" },
    });
    expect(state.create.mock.calls[0][0].content).toContain("at commit h1");
    expect(screen.queryByTestId("composer")).toBeNull();
  });

  test("opens the composer when the remembered profile is offline", async () => {
    state.preferences = { agentAutoStart: false, guideAutoStart: true };
    state.online = false;
    remember();
    await expectComposerInstead();
  });

  test("opens the composer when the remembered worktree is gone, rather than run in its parent checkout", async () => {
    state.preferences = { agentAutoStart: false, guideAutoStart: true };
    remember({ type: "worktree", pathId: "worktree_1" });
    await expectComposerInstead();
  });

  test("starts in the remembered worktree while it exists", async () => {
    state.preferences = { agentAutoStart: false, guideAutoStart: true };
    state.worktrees = [{ id: "worktree_1", path: "/repo-wt", label: "wt", kind: "worktree", parentPathId: "path_1" }];
    remember({ type: "worktree", pathId: "worktree_1" });
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }));
    act(() => result.current.start());
    render(<>{result.current.dialog}</>);
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    expect(state.create.mock.calls[0][0]).toMatchObject({ profileId: "profile_1", pathId: "worktree_1" });
  });

  test("Retry always opens the composer, so the member can fix what failed", () => {
    state.preferences = { agentAutoStart: false, guideAutoStart: true };
    remember();
    const { result } = renderHook(() => useGenerateGuide(target, { baseSha: "b1", headSha: "h1" }));
    act(() => result.current.start("guide_1" as never));
    render(<>{result.current.dialog}</>);
    expect(composer.props).toMatchObject({ pullRequestGuide: { headSha: "h1", retryGuideId: "guide_1" } });
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe("Duplicate-run warning (OS-2415)", () => {
  afterEach(() => {
    cleanup();
    state.composer = null;
  });

  const guide = (overrides: Partial<GuideSummary>): GuideSummary => ({
    _id: "guide_1" as GuideSummary["_id"],
    status: "writing",
    baseSha: "b1",
    headSha: "c91f02a9e1",
    cliType: "codex",
    createdAt: 1,
    requester: { name: "Maya", avatarUrl: null, isViewer: false },
    canDelete: false,
    ...overrides,
  });
  function Host({ guides }: { guides: GuideSummary[] }) {
    const launch = useGenerateGuide(target, { baseSha: "b1", headSha: "c91f02a9e1" }, guides);
    return (
      <>
        <button type="button" onClick={() => launch.start()}>Generate guide</button>
        {launch.dialog}
      </>
    );
  }

  test("warns about another member's guide still writing on the same head, then starts on Start my own anyway", () => {
    render(<Host guides={[guide({})]} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate guide" }));
    expect(screen.getByText("Maya is already writing a guide for c91f02a")).toBeTruthy();
    expect(screen.queryByTestId("composer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start my own anyway" }));
    expect(screen.getByTestId("composer")).toBeTruthy();
  });

  test("Cancel starts nothing", () => {
    render(<Host guides={[guide({})]} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate guide" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Maya is already writing a guide for c91f02a")).toBeNull();
    expect(screen.queryByTestId("composer")).toBeNull();
  });

  test.each([
    ["the viewer's own", { requester: { name: "Me", avatarUrl: null, isViewer: true } }],
    ["a failed", { status: "failed" as const }],
    ["a ready", { status: "ready" as const }],
    ["another head's", { headSha: "0000000000" }],
  ])("does not warn about %s guide", (_, overrides) => {
    render(<Host guides={[guide(overrides)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate guide" }));
    expect(screen.getByTestId("composer")).toBeTruthy();
  });
});
