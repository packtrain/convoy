/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { ProjectAgentPreviewDialog } from "./project-agent-preview-dialog";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({ value }: { value: string }) {
      return <div data-testid="agent-prompt">{value}</div>;
    },
}));

const onInstallMock = vi.fn();
const onCloseMock = vi.fn();

function renderDialog(args: { prompt?: string; isInstalled?: boolean } = {}) {
  return render(
    <ProjectAgentPreviewDialog
      agentId={"agent_template" as Id<"agents">}
      name="Code Reviewer"
      description="Reviews pull requests"
      prompt={args.prompt}
      isInstalled={args.isInstalled ?? false}
      isInstalling={false}
      onInstall={onInstallMock}
      onClose={onCloseMock}
    />
  );
}

describe("ProjectAgentPreviewDialog", () => {
  afterEach(() => {
    cleanup();
    onInstallMock.mockReset();
    onCloseMock.mockReset();
  });

  test("renders the template prompt", () => {
    renderDialog({ prompt: "# Review\nRead the diff first." });

    expect(screen.getByRole("heading", { name: "Code Reviewer" })).toBeDefined();
    expect(screen.getByTestId("agent-prompt").textContent).toBe("# Review\nRead the diff first.");
  });

  test("a long prompt is cut until it is clicked", () => {
    renderDialog({ prompt: "a".repeat(601) });

    const expand = screen.getByRole("button", { name: "Expand prompt" });
    expect(within(expand).getByText("Click to expand").parentElement?.className).toContain(
      "group-focus-visible/expand:opacity-100"
    );
    fireEvent.click(expand);

    expect(screen.queryByRole("button", { name: "Expand prompt" })).toBeNull();
  });

  test("a short prompt is shown whole", () => {
    renderDialog({ prompt: "Read the diff first." });

    expect(screen.queryByRole("button", { name: "Expand prompt" })).toBeNull();
  });

  test("a template without a prompt says so", () => {
    renderDialog();

    expect(screen.getByText("This template has no prompt.")).toBeDefined();
  });

  test("the footer installs the previewed template and closes", () => {
    renderDialog({ prompt: "Read the diff first." });

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(onInstallMock).toHaveBeenCalledWith("agent_template");
    expect(onCloseMock).toHaveBeenCalled();
  });

  test("an installed template cannot be installed twice", () => {
    renderDialog({ prompt: "Read the diff first.", isInstalled: true });

    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.getByRole("button", { name: "Installed" }).getAttribute("disabled")).not.toBeNull();
  });
});
