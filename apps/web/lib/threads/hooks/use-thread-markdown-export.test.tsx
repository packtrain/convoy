/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { CliThreadForkedFrom } from "@/convex/lib/contracts/validators";

import {
  EXPORT_STALL_MS,
  useThreadMarkdownExport,
  type ThreadMarkdownExportMessages,
} from "@/lib/threads/hooks/use-thread-markdown-export";

const downloadArtifact = vi.hoisted(() =>
  vi.fn<(content: string, fileName: string, contentType: string) => boolean>(() => true)
);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));

vi.mock("@/lib/tasks/download-artifact", () => ({ downloadArtifact }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), toast) }));
const readWholeForkPrefix = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useConvex: () => ({}) }));
vi.mock("@/lib/threads/hooks/use-fork-prefix", () => ({ readWholeForkPrefix }));

const CREATED_AT = Date.UTC(2026, 7, 14, 15, 20);

function messages(
  overrides: Partial<ThreadMarkdownExportMessages> = {}
): ThreadMarkdownExportMessages {
  return {
    envelopes: [
      { _id: "u1", role: "user", createdAt: CREATED_AT },
    ] as ThreadMarkdownExportMessages["envelopes"],
    renderStateByMessageId: new Map(),
    userTextById: new Map([["u1", "hello"]]),
    visibleMessageIds: ["u1"] as ThreadMarkdownExportMessages["visibleMessageIds"],
    isLoading: false,
    hasOlderChunks: false,
    hasOlderEnvelopes: false,
    isLoadingOlderChunks: false,
    loadOlderChunks: vi.fn(),
    loadedChunkCount: 1,
    ...overrides,
  };
}

function render(cliMessages: ThreadMarkdownExportMessages, forkedFrom?: CliThreadForkedFrom) {
  return renderHook(
    (props: { cliMessages: ThreadMarkdownExportMessages }) =>
      useThreadMarkdownExport({
        title: "Printable thread",
        cliType: "claude-code",
        forkedFrom,
        cliMessages: props.cliMessages,
      }),
    { initialProps: { cliMessages } }
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 7, 14, 15, 31));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useThreadMarkdownExport", () => {
  test("downloads the transcript when all history is already loaded", () => {
    const { result } = render(messages());

    act(() => {
      result.current.exportMarkdown?.();
    });

    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    const [markdown, fileName, contentType] = downloadArtifact.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(markdown).toContain("**You** · 2026-08-14 15:20");
    expect(markdown).toContain("hello");
    expect(fileName).toBe("thread-printable-thread-2026-08-14.md");
    expect(contentType).toBe("markdown");
    expect(result.current.isExporting).toBe(false);
  });

  test("drains older history before exporting", () => {
    const loadOlderChunks = vi.fn();
    const { result, rerender } = render(
      messages({ hasOlderChunks: true, loadOlderChunks })
    );

    act(() => {
      result.current.exportMarkdown?.();
    });

    expect(loadOlderChunks).toHaveBeenCalledTimes(1);
    expect(downloadArtifact).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(true);

    // The page lands: one more message, no more history.
    act(() => {
      rerender({
        cliMessages: messages({
          envelopes: [
            { _id: "u0", role: "user", createdAt: CREATED_AT - 60_000 },
            { _id: "u1", role: "user", createdAt: CREATED_AT },
          ] as ThreadMarkdownExportMessages["envelopes"],
          userTextById: new Map([
            ["u0", "earlier question"],
            ["u1", "hello"],
          ]),
          loadedChunkCount: 2,
        }),
      });
    });

    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    expect(downloadArtifact.mock.calls[0]?.[0]).toContain("earlier question");
    expect(result.current.isExporting).toBe(false);
  });

  test("exports what it has when history stops arriving", () => {
    // `hasOlderChunks` can outlive a usable cursor, leaving `loadOlderChunks` a
    // no-op and no further state change to wait for.
    const { result } = render(messages({ hasOlderChunks: true }));

    act(() => {
      result.current.exportMarkdown?.();
    });
    expect(downloadArtifact).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(EXPORT_STALL_MS);
    });

    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    expect(result.current.isExporting).toBe(false);
  });

  test("reports a failed hand-off to the browser", () => {
    downloadArtifact.mockReturnValueOnce(false);
    const { result } = render(messages());

    act(() => {
      result.current.exportMarkdown?.();
    });

    expect(toast.error).toHaveBeenCalled();
  });

  describe("a fork", () => {
    const forkedFrom = { threadId: "parent", copiesInFlight: 0 } as unknown as CliThreadForkedFrom;

    test("puts the parent's history before the fork's own rows", async () => {
      vi.useRealTimers();
      readWholeForkPrefix.mockResolvedValueOnce({
        envelopes: [{ _id: "p1", role: "user", createdAt: CREATED_AT - 60_000 }],
        partsByMessageId: new Map(),
        userTextById: new Map([["p1", "parent question"]]),
        complete: true,
      });
      const { result } = render(messages(), forkedFrom);

      act(() => {
        result.current.exportMarkdown?.();
      });

      await waitFor(() => expect(downloadArtifact).toHaveBeenCalledTimes(1));
      const markdown = downloadArtifact.mock.calls[0]?.[0] ?? "";
      expect(markdown.indexOf("parent question")).toBeGreaterThan(-1);
      expect(markdown.indexOf("parent question")).toBeLessThan(markdown.indexOf("hello"));
      expect(markdown).not.toContain("outside the loaded window");
    });

    test("notes history the walk could not reach", async () => {
      vi.useRealTimers();
      readWholeForkPrefix.mockResolvedValueOnce({
        envelopes: [],
        partsByMessageId: new Map(),
        userTextById: new Map(),
        complete: false,
      });
      const { result } = render(messages(), forkedFrom);

      act(() => {
        result.current.exportMarkdown?.();
      });

      await waitFor(() => expect(downloadArtifact).toHaveBeenCalledTimes(1));
      expect(downloadArtifact.mock.calls[0]?.[0]).toContain("outside the loaded window");
    });

    test("offers no export while the copied run is still landing", () => {
      const { result } = render(messages(), { ...forkedFrom, copiesInFlight: 1 });

      expect(result.current.exportMarkdown).toBeUndefined();
    });
  });
});
