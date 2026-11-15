/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { WorkflowDefinition } from "@/convex/lib/contracts/workflowDefinition";
import type { SlashCommandRef } from "@/lib/slash-commands/composer";
import type { ThreadComposerDraft, ThreadDraftPatch } from "@/lib/threads/draft-storage";
import { useWorkflowRunComposer } from "./use-workflow-run-composer";

const useQueryMock = vi.fn();
const startRunMock = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args) as unknown,
  useMutation: () => startRunMock,
}));

const pushMock = vi.fn();
vi.mock("@/lib/navigation", () => ({
  useNavigation: () => ({ push: pushMock }),
  appRoute: {
    projectThreadDetail: (org: string, alias: string, threadId: string) => `/o/${org}/${alias}/threads/${threadId}`,
  },
}));

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastErrorMock(...args) } }));

const REF: SlashCommandRef = {
  type: "slash-command",
  id: "cmd-1" as Id<"slashCommands">,
  scope: "project",
  key: "review",
  canonicalKey: "project:review",
  displayLabel: "/review",
};
const PROMPT_TEXT = "Plan it carefully";

function buildDefinition({ runInNewWorktree = false }: { runInNewWorktree?: boolean } = {}): WorkflowDefinition {
  return {
    runInNewWorktree,
    lanes: [
      {
        laneId: "lane-1",
        name: "Executor",
        type: "single",
        defaults: { cliType: "claude-code", cliModel: "opus", cliEffort: "medium", mode: "act" },
      },
    ],
    stages: [
      {
        stageId: "stage-1",
        name: "Plan",
        steps: [
          {
            stepId: "step-1",
            laneId: "lane-1",
            action: {
              type: "prompt",
              content: { displayContent: PROMPT_TEXT, composerDocument: { version: 1, refs: [REF] } },
            },
          },
        ],
      },
    ],
  };
}

const WORKFLOW_ID = "wf-1" as Id<"workflows">;
const SELECTION = { _id: WORKFLOW_ID, name: "Release Train" };

function setup({
  definition = buildDefinition(),
  initialDraft,
  profileId = "profile-1",
  options,
}: {
  definition?: WorkflowDefinition;
  initialDraft?: Partial<ThreadComposerDraft>;
  profileId?: string;
  options?: Partial<Parameters<typeof useWorkflowRunComposer>[0]>;
} = {}) {
  useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
    args === "skip" ? undefined : { _id: WORKFLOW_ID, name: "Release Train", draftDefinition: definition }
  );
  startRunMock.mockResolvedValue({ runId: "run-1", containerThreadId: "thread-1" });

  let draft: ThreadComposerDraft | undefined = initialDraft ? ({ text: "", ...initialDraft } as ThreadComposerDraft) : undefined;
  const setDraft = vi.fn((patch: ThreadDraftPatch) => {
    draft = { text: "", ...draft, ...patch } as ThreadComposerDraft;
  });
  const profiles = [
    { _id: "profile-1" as Id<"cliProfiles">, paths: [{ id: "path-1", path: "/repo", label: "repo" }] },
  ];

  const { result, rerender } = renderHook(() =>
    useWorkflowRunComposer({
      organizationSlug: "acme",
      projectAlias: "app",
      profiles,
      draftState: { profileId, pathId: "path-1", baseRef: draft?.baseRef },
      draft,
      setDraft,
      ...options,
    })
  );

  const select = async () => {
    await act(async () => {
      result.current.selectWorkflow(SELECTION);
    });
    rerender();
  };

  return { result, rerender, select, setDraft, getDraft: () => draft };
}

/** Await inside act and hand the rejection back — `expect(act()).rejects` escapes the test. */
async function startAndCatch(
  result: { current: ReturnType<typeof useWorkflowRunComposer> },
  message: ReturnType<typeof submitMessage>
): Promise<unknown> {
  let error: unknown = null;
  await act(async () => {
    error = await result.current.maybeStartRun(message).then(
      () => null,
      (thrown: unknown) => thrown
    );
  });
  return error;
}

function submitMessage(text: string, overrides: { files?: { url: string }[]; pullRequestUrl?: string } = {}) {
  return {
    text,
    composerDocument: { version: 1 as const, refs: [REF] },
    files: (overrides.files ?? []) as never[],
    pullRequestUrl: overrides.pullRequestUrl,
  };
}

describe("useWorkflowRunComposer", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  test("starts in the source group and hands navigation to the workspace", async () => {
    const onStarted = vi.fn();
    const { result, select } = setup({ options: {
      sourceThreadId: "source-1" as Id<"cliThreads">,
      expectedContainerId: "group-1" as Id<"cliThreads">,
      onStarted,
    } });
    await select();
    await act(async () => { await result.current.maybeStartRun(submitMessage(PROMPT_TEXT)); });
    expect(startRunMock).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "source-1", expectedContainerId: "group-1" }));
    expect(onStarted).toHaveBeenCalledWith("thread-1", "run-1");
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("keeps the submitted draft and selection until the workspace handoff finishes", async () => {
    let finish!: () => void;
    const handoff = new Promise<void>((resolve) => { finish = resolve; });
    const { result, select, getDraft } = setup({ options: { onStarted: () => handoff } });
    await select();
    let submission!: Promise<boolean>;
    await act(async () => { submission = result.current.maybeStartRun(submitMessage(PROMPT_TEXT)); });
    expect(result.current.isStarting).toBe(true);
    expect(getDraft()?.text).toBe(PROMPT_TEXT);
    expect(result.current.selectedWorkflow).toEqual(SELECTION);
    await act(async () => { finish(); await submission; });
    expect(result.current.isStarting).toBe(false);
    expect(getDraft()?.text).toBe("");
    expect(result.current.selectedWorkflow).toBeNull();
  });

  test("a standalone source preserves the expectation that it has no container", async () => {
    const { result, select } = setup({ options: { sourceThreadId: "source-1" as Id<"cliThreads">, expectedContainerId: null } });
    await select();
    await act(async () => { await result.current.maybeStartRun(submitMessage(PROMPT_TEXT)); });
    expect(startRunMock).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "source-1", expectedContainerId: null }));
  });

  test("selecting seeds prompt text, slash-command document, runtime, and the worktree preselect", async () => {
    const { select, getDraft } = setup({ definition: buildDefinition({ runInNewWorktree: true }) });
    await select();

    const draft = getDraft();
    expect(draft?.text).toBe(PROMPT_TEXT);
    expect(draft?.composerContent).toMatchObject({ type: "doc" });
    expect(draft).toMatchObject({ cliType: "claude-code", cliModel: "opus", cliEffort: "medium", mode: "act" });
    expect(draft?.baseRef).toEqual({ type: "branch", startFromOrigin: false });
    expect(draft?.seedCount).toBe(1);
  });

  test("typed text survives selecting a workflow; the runtime still seeds", async () => {
    const { select, getDraft } = setup({ initialDraft: { text: "my own words" } });
    await select();

    expect(getDraft()?.text).toBe("my own words");
    expect(getDraft()?.cliType).toBe("claude-code");
  });

  test("deselecting reverts the unedited prefill and the seeded worktree", async () => {
    const { result, select, getDraft } = setup({ definition: buildDefinition({ runInNewWorktree: true }) });
    await select();

    await act(async () => {
      result.current.selectWorkflow(null);
    });

    expect(getDraft()?.text).toBe("");
    expect(getDraft()?.baseRef).toBeUndefined();
  });

  test("deselecting keeps an edited prompt", async () => {
    const { result, rerender, select, setDraft, getDraft } = setup();
    await select();
    await act(async () => {
      setDraft({ text: "edited by hand" });
    });
    rerender();

    await act(async () => {
      result.current.selectWorkflow(null);
    });

    expect(getDraft()?.text).toBe("edited by hand");
  });

  test("an unedited prompt sends no override; an edited one carries the slash-command document", async () => {
    const { result, select, rerender } = setup();
    await select();

    await act(async () => {
      await result.current.maybeStartRun(submitMessage(PROMPT_TEXT));
    });
    expect(startRunMock).toHaveBeenLastCalledWith(expect.objectContaining({ firstPromptOverride: undefined }));

    await select();
    rerender();
    await act(async () => {
      await result.current.maybeStartRun(submitMessage("Changed plan"));
    });
    expect(startRunMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        firstPromptOverride: { displayContent: "Changed plan", composerDocument: { version: 1, refs: [REF] } },
      })
    );
  });

  test("a first lane with no prompt step sends typed text as the kickoff override; an empty composer sends none (OS-1921)", async () => {
    const definition = buildDefinition();
    definition.stages[0].steps = [
      { stepId: "step-1", laneId: "lane-1", action: { type: "bash", script: "pnpm lint", timeoutMs: 60_000, reportOutput: "on_failure" } },
    ];
    const { result, select, rerender } = setup({ definition });
    await select();

    await act(async () => {
      await result.current.maybeStartRun(submitMessage(""));
    });
    expect(startRunMock).toHaveBeenLastCalledWith(expect.objectContaining({ firstPromptOverride: undefined }));

    await select();
    rerender();
    await act(async () => {
      await result.current.maybeStartRun(submitMessage("Some context first"));
    });
    expect(startRunMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        firstPromptOverride: { displayContent: "Some context first", composerDocument: { version: 1, refs: [REF] } },
      })
    );
  });

  test("the derived worktree branch comes from the prompt plus a run suffix, not the workflow name", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000_000_000);
    const { result, select } = setup({ definition: buildDefinition({ runInNewWorktree: true }) });
    await select();

    await act(async () => {
      await result.current.maybeStartRun(submitMessage(PROMPT_TEXT));
    });

    const args = startRunMock.mock.calls.at(-1)?.[0] as { worktree?: { branch: string } };
    expect(args.worktree?.branch).toMatch(/^feat\/plan-it-carefully-/);
    expect(args.worktree?.branch).not.toContain("release-train");
  });

  test("a rejected start keeps the draft and rethrows so the composer does not clear", async () => {
    const { result, select, setDraft, getDraft } = setup();
    await select();
    startRunMock.mockRejectedValueOnce(new Error("nope"));
    setDraft.mockClear();

    expect(await startAndCatch(result, submitMessage(PROMPT_TEXT))).not.toBeNull();

    expect(toastErrorMock).toHaveBeenCalled();
    expect(setDraft).not.toHaveBeenCalled();
    expect(getDraft()?.text).toBe(PROMPT_TEXT);
  });

  test("attachments cannot ride along on a run start", async () => {
    const { result, select } = setup();
    await select();

    expect(await startAndCatch(result, submitMessage(PROMPT_TEXT, { files: [{ url: "blob:x" }] }))).not.toBeNull();

    expect(startRunMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalled();
  });

  test("an attached pull request cannot ride along on a run start (OS-2193)", async () => {
    const { result, select } = setup();
    await select();

    expect(await startAndCatch(result, submitMessage(PROMPT_TEXT, { pullRequestUrl: "https://github.com/contoso/convoy/pull/482" }))).not.toBeNull();

    expect(startRunMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("A pull request can't start a workflow run yet. Remove it or deselect the workflow.");
  });

  test("an unresolvable machine selection rejects with a toast instead of silently swallowing", async () => {
    const { result, select } = setup({ profileId: "missing-profile" });
    await select();

    expect(await startAndCatch(result, submitMessage(PROMPT_TEXT))).not.toBeNull();

    expect(startRunMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalled();
  });

  test("exposes loading while the selected workflow has not resolved", async () => {
    useQueryMock.mockReturnValue(undefined);
    startRunMock.mockResolvedValue({ runId: "run-1", containerThreadId: "thread-1" });
    let draft: ThreadComposerDraft | undefined;
    const { result } = renderHook(() =>
      useWorkflowRunComposer({
        organizationSlug: "acme",
        projectAlias: "app",
        profiles: [{ _id: "profile-1" as Id<"cliProfiles">, paths: [{ id: "path-1", path: "/repo", label: "repo" }] }],
        draftState: { profileId: "profile-1", pathId: "path-1", baseRef: undefined },
        draft,
        setDraft: (patch) => {
          draft = { text: "", ...draft, ...patch } as ThreadComposerDraft;
        },
      })
    );

    expect(result.current.isWorkflowLoading).toBe(false);
    await act(async () => {
      result.current.selectWorkflow(SELECTION);
    });
    expect(result.current.isWorkflowLoading).toBe(true);
  });
});
