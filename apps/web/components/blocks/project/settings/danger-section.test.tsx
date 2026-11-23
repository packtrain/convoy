/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DangerZoneSection } from "./danger-section";

const useQueryMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());
const setArchivedMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: (ref: string) => (ref === "setArchived" ? setArchivedMock : removeMock),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    projects: {
      core: { remove: "remove", setArchived: "setArchived" },
      members: { getMyRole: "projectRole" },
    },
    organizations: { members: { getMyRole: "orgRole" } },
  },
}));

vi.mock("@/lib/navigation", () => ({
  appRoute: {
    organization: (slug: string) => ({ pathname: `/o/${slug}` }),
  },
  useNavigation: () => ({ push: vi.fn(), replace: replaceMock }),
}));

const PROJECT = { _id: "p_1", name: "Website", alias: "WEB", isArchived: false };

function renderSection(
  orgRole: string | undefined,
  { projectRole = "project-admin", isArchived = false }: { projectRole?: string; isArchived?: boolean } = {}
) {
  useQueryMock.mockImplementation((ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    return ref === "orgRole" ? orgRole : projectRole;
  });
  return render(
    <DangerZoneSection
      project={{ ...PROJECT, isArchived } as never}
      organizationId={"org_1" as never}
      organizationSlug="acme"
    />
  );
}

describe("DangerZoneSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("renders the shared danger rows under the page shell's title", () => {
    renderSection("owner");

    expect(screen.queryByRole("heading", { name: "Danger zone" })).toBeNull();
    expect(screen.getByRole("heading", { name: /Archive project/, level: 4 })).toBeDefined();
    expect(screen.getByRole("heading", { name: /Delete project/, level: 4 })).toBeDefined();
  });

  test("archives the project after confirmation and stays on the page", async () => {
    setArchivedMock.mockResolvedValue(null);
    renderSection("member");

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(setArchivedMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toContain('"Website"');

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive project" }));
    });

    expect(setArchivedMock).toHaveBeenCalledWith({ id: "p_1", isArchived: true });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("offers Unarchive on an archived project", async () => {
    setArchivedMock.mockResolvedValue(null);
    renderSection("member", { isArchived: true });

    expect(screen.getByRole("heading", { name: /Unarchive project/, level: 4 })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unarchive project" }));
    });

    expect(setArchivedMock).toHaveBeenCalledWith({ id: "p_1", isArchived: false });
  });

  test("enables Archive for project:archive or org authority, and only then", () => {
    renderSection("owner", { projectRole: "member" });

    expect(
      (screen.getByRole("button", { name: "Archive" }) as HTMLButtonElement).disabled
    ).toBe(false);
    cleanup();
    renderSection("member", { projectRole: "member" });
    expect(
      (screen.getByRole("button", { name: "Archive" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  test("deletes the project after confirmation and leaves its settings", async () => {
    removeMock.mockResolvedValue(null);
    renderSection("owner");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(removeMock).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain('"Website"');

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    });

    expect(removeMock).toHaveBeenCalledWith({ id: "p_1" });
    expect(replaceMock).toHaveBeenCalledWith({ pathname: "/o/acme" });
  });

  test("stays on the page when the delete fails", async () => {
    removeMock.mockRejectedValue(new Error("boom"));
    renderSection("owner");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  test.each([["member"], [undefined]])(
    "disables Delete for org role %s, which cannot delete projects",
    (role) => {
      renderSection(role);

      expect(
        (screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled
      ).toBe(true);
    }
  );
});
