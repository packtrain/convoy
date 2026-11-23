/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProjectMcpConfigurationDialog } from "./project-mcp-configuration-dialog";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("convex/react", () => ({ useQuery: () => undefined }));

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

describe("ProjectMcpConfigurationDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  test("renders project-scoped .mcp.json and Codex snippets without tabs", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://happy-animal-123.convex.cloud");

    render(
      <ProjectMcpConfigurationDialog
        open
        onOpenChange={vi.fn()}
        organizationSlug="acme"
        projectAlias="WEB"
      />
    );

    expect(screen.getByRole("heading", { name: "Configure MCP" })).toBeDefined();
    expect(screen.queryByRole("tab")).toBeNull();

    const mcpJson = screen.getByLabelText(
      ".mcp.json configuration"
    ) as HTMLTextAreaElement;
    expect(mcpJson.value).toContain(
      '"url": "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB"'
    );
    expect(mcpJson.value).toContain('"Authorization": "Bearer <YOUR_API_KEY>"');

    const minimal = screen.getByLabelText(
      ".codex/config.toml minimal configuration"
    ) as HTMLTextAreaElement;
    const full = screen.getByLabelText(
      ".codex/config.toml full configuration"
    ) as HTMLTextAreaElement;
    expect(minimal.value).toContain("[mcp_servers.convoy]");
    expect(full.value).toContain("[mcp_servers.convoy.tools.update_task_link]");
    expect(full.value).not.toContain("get_tasks_by_ref");

    const minimalBlock = screen.getByText(".codex/config.toml minimal");
    const fullBlock = screen.getByText(".codex/config.toml full");
    expect(
      minimalBlock.compareDocumentPosition(fullBlock) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("copies individual snippets", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://happy-animal-123.convex.cloud");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <ProjectMcpConfigurationDialog
        open
        onOpenChange={vi.fn()}
        organizationSlug="acme"
        projectAlias="WEB"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy .mcp.json" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB"
        )
      );
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(".mcp.json copied");
  });
});
