/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { CurrentOrgProjectProvider } from "@/lib/routing/current-org-project-context";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import { useProjectTaskTableColumnVisibility } from "./use-project-task-table-column-visibility";

type ProjectUpdateArgs = {
  id: Id<"projects">;
  hiddenTaskTableColumns?: TaskTableColumnId[];
};

type ProjectQueryArgs =
  | { id: Id<"projects"> }
  | { organizationId: Id<"organizations">; alias: string };

type LocalStoreMock = {
  getQuery: ReturnType<typeof vi.fn>;
  setQuery: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const localStore = {
    getQuery: vi.fn(),
    setQuery: vi.fn(),
  };

  return {
    updateProjectMock: vi.fn(),
    toastErrorMock: vi.fn(),
    localStore,
  };
});

vi.mock("convex/react", () => ({
  useMutation: () => ({
    withOptimisticUpdate:
      (
        callback: (localStore: LocalStoreMock, args: ProjectUpdateArgs) => void
      ) =>
      (args: ProjectUpdateArgs) => {
        callback(mocks.localStore, args);
        return mocks.updateProjectMock(args);
      },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastErrorMock(...args),
  },
}));

const PROJECT_ID = "project_123" as Id<"projects">;
const OTHER_PROJECT_ID = "project_456" as Id<"projects">;
const ORGANIZATION_ID = "organization_123" as Id<"organizations">;

function createProject(
  overrides: Partial<Doc<"projects">> = {}
): Doc<"projects"> {
  return {
    _id: PROJECT_ID,
    _creationTime: 1,
    organizationId: ORGANIZATION_ID,
    name: "Project",
    alias: "OS",
    disabledStatuses: [],
    hiddenTaskTableColumns: [],
    isArchived: false,
    createdBy: "user_123" as Id<"users">,
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderVisibilityHook(
  hiddenTaskTableColumns: Parameters<
    typeof useProjectTaskTableColumnVisibility
  >[0]["hiddenTaskTableColumns"] = [],
  options: { withRouteProvider?: boolean } = {}
) {
  const { withRouteProvider = false } = options;
  const wrapper = withRouteProvider
    ? ({ children }: { children: ReactNode }) => (
        <CurrentOrgProjectProvider
          organizationId={ORGANIZATION_ID}
          organizationSlug="contoso"
          projectAlias="OS"
        >
          {children}
        </CurrentOrgProjectProvider>
      )
    : undefined;

  return renderHook(
    () =>
      useProjectTaskTableColumnVisibility({
        projectId: PROJECT_ID,
        hiddenTaskTableColumns,
        canEdit: true,
      }),
    { wrapper }
  );
}

describe("useProjectTaskTableColumnVisibility", () => {
  let projectById: Doc<"projects"> | null | undefined;
  let projectByAlias: Doc<"projects"> | null | undefined;

  beforeEach(() => {
    projectById = createProject();
    projectByAlias = createProject();
    mocks.updateProjectMock.mockResolvedValue(null);
    mocks.localStore.getQuery.mockImplementation(
      (_query: unknown, args: ProjectQueryArgs) => {
        if ("id" in args) {
          return projectById;
        }

        return projectByAlias;
      }
    );
    mocks.localStore.setQuery.mockImplementation(
      (
        _query: unknown,
        args: ProjectQueryArgs,
        value: Doc<"projects"> | null
      ) => {
        if ("id" in args) {
          projectById = value;
          return;
        }

        projectByAlias = value;
      }
    );
  });

  afterEach(() => {
    cleanup();
    mocks.updateProjectMock.mockReset();
    mocks.toastErrorMock.mockReset();
    mocks.localStore.getQuery.mockReset();
    mocks.localStore.setQuery.mockReset();
  });

  test("keeps controls enabled and applies rapid toggles while saves are pending", async () => {
    const firstSave = createDeferred<null>();
    const secondSave = createDeferred<null>();
    mocks.updateProjectMock
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);
    const { result } = renderVisibilityHook();

    let firstToggle!: Promise<void>;
    act(() => {
      firstToggle = result.current.toggleColumnVisibility("priority");
    });

    expect(result.current.canToggleColumns).toBe(true);
    expect(projectById?.hiddenTaskTableColumns).toEqual(["priority"]);

    let secondToggle!: Promise<void>;
    act(() => {
      secondToggle = result.current.toggleColumnVisibility("dueDate");
    });

    expect(projectById?.hiddenTaskTableColumns).toEqual([
      "priority",
      "dueDate",
    ]);
    expect(mocks.updateProjectMock).toHaveBeenNthCalledWith(1, {
      id: PROJECT_ID,
      hiddenTaskTableColumns: ["priority"],
    });
    expect(mocks.updateProjectMock).toHaveBeenNthCalledWith(2, {
      id: PROJECT_ID,
      hiddenTaskTableColumns: ["priority", "dueDate"],
    });

    await act(async () => {
      firstSave.resolve(null);
      secondSave.resolve(null);
      await Promise.all([firstToggle, secondToggle]);
    });

    expect(result.current.canToggleColumns).toBe(true);
  });

  test("optimistically patches the current project by id and alias", async () => {
    const { result } = renderVisibilityHook([], { withRouteProvider: true });

    await act(async () => {
      await result.current.toggleColumnVisibility("priority");
    });

    expect(projectById?.hiddenTaskTableColumns).toEqual(["priority"]);
    expect(projectByAlias?.hiddenTaskTableColumns).toEqual(["priority"]);
  });

  test("does not patch the route alias query when it is for another project", async () => {
    projectByAlias = createProject({ _id: OTHER_PROJECT_ID });
    const { result } = renderVisibilityHook([], { withRouteProvider: true });

    await act(async () => {
      await result.current.toggleColumnVisibility("priority");
    });

    expect(projectById?.hiddenTaskTableColumns).toEqual(["priority"]);
    expect(projectByAlias?.hiddenTaskTableColumns).toEqual([]);
  });

  test("shows an error and clears pending state when a save fails", async () => {
    mocks.updateProjectMock.mockRejectedValueOnce(new Error("save failed"));
    const { result } = renderVisibilityHook();

    await act(async () => {
      await result.current.toggleColumnVisibility("priority");
    });

    expect(mocks.toastErrorMock).toHaveBeenCalledWith(
      "Failed to update column visibility"
    );
  });
});
