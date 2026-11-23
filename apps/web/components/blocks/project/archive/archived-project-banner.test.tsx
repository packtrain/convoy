/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ArchivedProjectBanner } from "./index";

const setArchivedMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useMutation: () => setArchivedMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { projects: { core: { setArchived: "setArchived" } } },
}));

const PROJECT = { _id: "p_1", name: "Website", isArchived: true };

describe("ArchivedProjectBanner", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("renders nothing for an active project", () => {
    const { container } = render(
      <ArchivedProjectBanner project={{ ...PROJECT, isArchived: false } as never} canUnarchive />
    );
    expect(container.textContent).toBe("");
  });

  test("hides Unarchive from callers who cannot archive", () => {
    render(<ArchivedProjectBanner project={PROJECT as never} canUnarchive={false} />);

    expect(screen.getByRole("status").textContent).toContain("This project is archived.");
    expect(screen.queryByRole("button", { name: "Unarchive" })).toBeNull();
  });

  test("unarchives after confirmation", async () => {
    setArchivedMock.mockResolvedValue(null);
    render(<ArchivedProjectBanner project={PROJECT as never} canUnarchive />);

    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unarchive project" }));
    });

    expect(setArchivedMock).toHaveBeenCalledWith({ id: "p_1", isArchived: false });
  });
});
