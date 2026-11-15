// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { MoveToListMenuContent } from "./move-to-list-menu-content";
import type { TaskListResultsController } from "./use-task-list-results";

const mocks = vi.hoisted(() => ({ loaded: true }));
vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) =>
    args === "skip" || !mocks.loaded
      ? undefined
      : [{ _id: "design", listKey: "list:sprintlist1", name: "Design", color: null, rank: "a" }],
}));

afterEach(() => {
  mocks.loaded = true;
});

vi.mock("./use-task-list-results", () => ({
  useActiveTaskListResults: () => undefined,
}));

const list = (id: string, ref: string, name: string) =>
  ({ _id: id, ref, name, isDefault: false, color: null }) as never;
const results = {
  query: "",
  setQuery: () => {},
  resetQuery: () => {},
  results: [list("sprintlist1", "SPRINT", "Sprint"), list("laterlist1", "LATER", "Later")],
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  loadMore: () => {},
} as unknown as TaskListResultsController;

function renderMenu(props: { skipSections?: boolean } = {}) {
  const onMoveToList = vi.fn();
  const onAfterSelect = vi.fn();
  render(
    <MoveToListMenuContent
      projectId={"project" as Id<"projects">}
      resultsController={results}
      onMoveToList={onMoveToList}
      onAfterSelect={onAfterSelect}
      {...props}
    />
  );
  return { onMoveToList, onAfterSelect };
}

test("a List without sections moves at once", () => {
  const { onMoveToList, onAfterSelect } = renderMenu();
  fireEvent.click(screen.getByText("Later"));
  expect(onMoveToList).toHaveBeenCalledWith("LATER");
  expect(onAfterSelect).toHaveBeenCalled();
});

test("a List with sections asks for the destination section", () => {
  const { onMoveToList, onAfterSelect } = renderMenu();
  fireEvent.click(screen.getByText("Sprint"));
  expect(onMoveToList).not.toHaveBeenCalled();
  expect(screen.getByText("Section in Sprint")).toBeDefined();

  fireEvent.click(screen.getByText("Design"));
  expect(onMoveToList).toHaveBeenCalledWith("SPRINT", "design");
  expect(onAfterSelect).toHaveBeenCalled();
});

test("No section in the second step clears the section", () => {
  const { onMoveToList } = renderMenu();
  fireEvent.click(screen.getByText("Sprint"));
  fireEvent.click(screen.getByText("No section"));
  expect(onMoveToList).toHaveBeenCalledWith("SPRINT", undefined);
});

test("the section step has a way back to the Lists", () => {
  renderMenu();
  fireEvent.click(screen.getByText("Sprint"));
  fireEvent.click(screen.getByText("Section in Sprint"));
  expect(screen.getByText("Later")).toBeDefined();
});

test("Lists wait for sections to load, so a fast click cannot skip the section step", () => {
  mocks.loaded = false;
  const { onMoveToList } = renderMenu();
  fireEvent.click(screen.getByText("Sprint"));
  fireEvent.click(screen.getByText("Backlog"));
  expect(onMoveToList).not.toHaveBeenCalled();
});

test("skipSections moves at once and never loads sections", () => {
  const { onMoveToList } = renderMenu({ skipSections: true });
  fireEvent.click(screen.getByText("Sprint"));
  expect(onMoveToList).toHaveBeenCalledWith("SPRINT");
});

test("the List search uses the shared borderless dropdown search row", () => {
  renderMenu();
  const input = screen.getByPlaceholderText("Search lists...");
  expect(input.closest('[data-slot="dropdown-search-input-wrapper"]')).not.toBeNull();
});
