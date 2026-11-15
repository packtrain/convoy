/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { SkillPreviewDialog } from "./skill-preview-dialog";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({ useQuery: useQueryMock }));

vi.mock("@/convex/_generated/api", () => ({
  api: { skills: { core: { get: "skills.core.get" } } },
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({ value }: { value: string }) {
      return <div data-testid="skill-md">{value}</div>;
    },
}));

function renderDialog(args: { detail?: unknown; isInstalled?: boolean } = {}) {
  useQueryMock.mockReturnValue(args.detail);

  return render(
    <SkillPreviewDialog
      skillId={"skill_template" as Id<"skills">}
      name="pdf-tools"
      description="Fill and read PDFs"
      isInstalled={args.isInstalled ?? false}
      isInstalling={false}
      onInstall={onInstallMock}
      onClose={onCloseMock}
    />
  );
}

const onInstallMock = vi.fn();
const onCloseMock = vi.fn();

describe("SkillPreviewDialog", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    onInstallMock.mockReset();
    onCloseMock.mockReset();
  });

  test("renders SKILL.md and the other file paths, without their contents", () => {
    renderDialog({
      detail: { skillMd: "# PDF tools", files: [{ path: "references/fields.md", content: "secret detail" }] },
    });

    expect(screen.getByRole("heading", { name: "/pdf-tools" })).toBeDefined();
    expect(screen.getByTestId("skill-md").textContent).toBe("# PDF tools");
    expect(screen.getByText("references/fields.md")).toBeDefined();
    expect(screen.queryByText("secret detail")).toBeNull();
  });

  test("long markdown is cut until it is clicked", () => {
    renderDialog({ detail: { skillMd: "a".repeat(601), files: [] } });

    const expand = screen.getByRole("button", { name: "Expand SKILL.md" });
    expect(within(expand).getByText("Click to expand").parentElement?.className).toContain(
      "group-focus-visible/expand:opacity-100"
    );
    fireEvent.click(expand);

    expect(screen.queryByRole("button", { name: "Expand SKILL.md" })).toBeNull();
  });

  test("short markdown is shown whole", () => {
    renderDialog({ detail: { skillMd: "# PDF tools", files: [] } });

    expect(screen.queryByRole("button", { name: "Expand SKILL.md" })).toBeNull();
  });

  test("the footer installs the previewed template and closes", () => {
    renderDialog({ detail: { skillMd: "# PDF tools", files: [] } });

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(onInstallMock).toHaveBeenCalledWith("skill_template");
    expect(onCloseMock).toHaveBeenCalled();
  });

  test("an installed template cannot be installed twice", () => {
    renderDialog({ detail: { skillMd: "# PDF tools", files: [] }, isInstalled: true });

    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.getByRole("button", { name: "Installed" }).getAttribute("disabled")).not.toBeNull();
  });

  test("shows a loading placeholder until the bundle arrives", () => {
    renderDialog();

    expect(screen.getByLabelText("Loading skill")).toBeDefined();
  });
});
