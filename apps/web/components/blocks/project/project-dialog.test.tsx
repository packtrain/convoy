/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { ProjectDialog, type ProjectDialogData } from "./project-dialog";
import type { UseDialogReturnWithData } from "@/hooks/ui/use-dialog";

const useMutationMock = vi.hoisted(() => vi.fn());
const showConvexErrorToastMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useMutation: useMutationMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    projects: {
      core: {
        create: { _type: "mutation", name: "projects.core.create" },
      },
    },
  },
}));

vi.mock("@/lib/errors", () => ({
  showConvexErrorToast: showConvexErrorToastMock,
}));

function makeDialog(): UseDialogReturnWithData<ProjectDialogData> {
  return {
    isOpen: true,
    open: vi.fn(),
    close: vi.fn(),
    data: undefined,
    props: {
      open: true,
      onClose: vi.fn(),
    },
  };
}

async function submitProjectForm() {
  fireEvent.change(screen.getByPlaceholderText("My project"), {
    target: { value: "Demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectDialog", () => {
  test("shows the server error message when create fails (e.g. duplicate alias)", async () => {
    const error = new ConvexError("A project with this alias already exists in this organization");
    const createMock = vi.fn().mockRejectedValue(error);
    useMutationMock.mockReturnValue(createMock);
    const dialog = makeDialog();

    render(<ProjectDialog organizationId="org_1" dialog={dialog} />);
    await submitProjectForm();

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    await waitFor(() => expect(showConvexErrorToastMock).toHaveBeenCalledWith(error, "Failed to create project"));
    expect(dialog.close).not.toHaveBeenCalled();
  });

  test("closes the dialog on success without an error toast", async () => {
    const createMock = vi.fn().mockResolvedValue("project_1");
    useMutationMock.mockReturnValue(createMock);
    const dialog = makeDialog();
    const onSuccess = vi.fn();

    render(<ProjectDialog organizationId="org_1" dialog={dialog} onSuccess={onSuccess} />);
    await submitProjectForm();

    await waitFor(() => expect(dialog.close).toHaveBeenCalled());
    expect(onSuccess).toHaveBeenCalled();
    expect(showConvexErrorToastMock).not.toHaveBeenCalled();
  });
});
