/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { usePullRequestSearch } from "./use-pull-request-search";

const search = vi.fn();

vi.mock("convex/react", () => ({ useAction: () => search }));
vi.mock("@/hooks/react/use-debounce", () => ({ useDebounce: <T,>(value: T) => value }));

afterEach(() => {
  cleanup();
  search.mockReset();
});

const hit = (number: number, providerUpdatedAt: number) => ({
  repositoryId: "repo_1",
  number,
  title: `PR ${number}`,
  author: "sam",
  state: "closed",
  draft: false,
  labels: [],
  providerCreatedAt: providerUpdatedAt,
  providerUpdatedAt,
});
const page = (pullRequests: ReturnType<typeof hit>[], hasMore = true) => ({ pullRequests, hasMore, incomplete: false, omittedRepositories: 0, failures: [] });

const render = (query = "fix") =>
  renderHook(({ query }) => usePullRequestSearch("project_1" as Id<"projects">, query, { sort: "updated", order: "desc" }), { initialProps: { query } });

describe("usePullRequestSearch", () => {
  test("a failed page is retried, not skipped, and loading ends with it", async () => {
    search.mockResolvedValueOnce(page([hit(1, 3)])).mockRejectedValueOnce(new Error("GitHub could not be reached")).mockResolvedValueOnce(page([hit(2, 2)], false));
    const { result } = render();
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe("GitHub could not be reached"));
    expect(result.current.loading).toBe(false);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.results).toHaveLength(2));
    expect(search.mock.calls.map(([args]) => args.page)).toEqual([1, 2, 2]);
    expect(result.current).toMatchObject({ loading: false, error: null, hasMore: false });
  });

  test("hits from every loaded page follow the chosen order, newest first", async () => {
    // Two installations: page 1 brings an old hit from one, page 2 newer hits from the other.
    search.mockResolvedValueOnce(page([hit(1, 30), hit(9, 1)])).mockResolvedValueOnce(page([hit(2, 20)], false));
    const { result } = render();
    await waitFor(() => expect(result.current.results).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.results).toHaveLength(3));
    expect(result.current.results.map((pr) => pr.number)).toEqual([1, 2, 9]);
  });

  test("a different Linked GitHub account behind You starts the search over (OS-2435)", async () => {
    search.mockResolvedValueOnce(page([hit(1, 3)])).mockResolvedValueOnce(page([hit(2, 2)], false));
    const { result, rerender } = renderHook(
      ({ viewer }) => usePullRequestSearch("project_1" as Id<"projects">, "fix", { sort: "updated", order: "desc", author: "me", viewer }),
      { initialProps: { viewer: 42 } }
    );
    await waitFor(() => expect(result.current.results.map((pr) => pr.number)).toEqual([1]));
    rerender({ viewer: 43 });
    await waitFor(() => expect(result.current.results.map((pr) => pr.number)).toEqual([2]));
    expect(search.mock.calls.map(([args]) => args.page)).toEqual([1, 1]);
  });

  test("coming back to a search starts it over from page 1", async () => {
    search.mockImplementation(async ({ query, page: number }: { query: string; page: number }) => page([hit(number * 10 + query.length, number)]));
    const view = render("fix");
    await waitFor(() => expect(view.result.current.results).toHaveLength(1));
    act(() => view.result.current.loadMore());
    await waitFor(() => expect(view.result.current.results).toHaveLength(2));
    view.rerender({ query: "login" });
    await waitFor(() => expect(view.result.current.results).toHaveLength(1));
    search.mockClear();
    view.rerender({ query: "fix" });
    await waitFor(() => expect(view.result.current.results).toHaveLength(1));
    expect(search.mock.calls.map(([args]) => [args.query, args.page])).toEqual([["fix", 1]]);
  });

  test("a page where a repository failed is retried, not passed, and keeps its notice until it succeeds", async () => {
    const failure = { repositories: ["acme/api"], message: "GitHub is limiting requests from Convoy. Try again in a few minutes." };
    search
      .mockResolvedValueOnce({ ...page([hit(1, 3)]), failures: [failure] })
      .mockRejectedValueOnce(new Error("GitHub could not be reached"))
      .mockResolvedValueOnce(page([hit(1, 3), hit(2, 2)]));
    const { result } = render();
    await waitFor(() => expect(result.current.failures).toEqual([failure]));
    expect(result.current).toMatchObject({ retryable: true, hasMore: false });
    // A Retry that fails outright still asks for the same page next time.
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe("GitHub could not be reached"));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.results).toHaveLength(2));
    expect(search.mock.calls.map(([args]) => args.page)).toEqual([1, 1, 1]);
    expect(result.current).toMatchObject({ failures: [], retryable: false, hasMore: true });
  });
});
