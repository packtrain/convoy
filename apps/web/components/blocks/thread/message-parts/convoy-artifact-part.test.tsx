/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ConvoyArtifactToolPayload } from "@/lib/ai-tools/convoy-artifact-tool";
import { ConvoyArtifactPart } from "./convoy-artifact-part";

vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  useRouteParams: () => ({ organizationSlug: "acme", projectAlias: "WEB" }),
  useNavigation: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    location: { pathname: "/o/acme/WEB/threads/thread_1", search: "" },
  }),
}));

afterEach(cleanup);

const payload: ConvoyArtifactToolPayload = {
  kind: "create_task_artifact",
  toolCallId: "call_1",
  server: "contoso",
  action: "Created artifact",
  state: "output-available",
  artifactId: "artifact_1",
  artifactName: "Implementation Plan",
};

const ARTIFACT_HREF = "/o/acme/WEB/artifacts/artifact_1";

describe("ConvoyArtifactPart", () => {
  test("opens the task ref in the sidebar on a plain left click", () => {
    const onOpenTask = vi.fn();
    render(
      <ConvoyArtifactPart
        payload={{ ...payload, taskRef: "WEB-1711" }}
        onOpenTask={onOpenTask}
      />
    );

    const link = screen.getByRole("link", { name: "WEB-1711" });
    expect(link.getAttribute("href")).toBe("/o/acme/WEB?task=WEB-1711");

    const handled = fireEvent.click(link, { button: 0 });

    expect(onOpenTask).toHaveBeenCalledWith("WEB-1711");
    // preventDefault ran, so the browser never follows the href.
    expect(handled).toBe(false);
  });

  test("leaves a task ref that is not a ref shape as plain text", () => {
    render(
      <ConvoyArtifactPart
        payload={{ ...payload, taskRef: "k17abc123def456" }}
        onOpenTask={vi.fn()}
      />
    );

    expect(screen.queryByRole("link", { name: /k17abc/ })).toBeNull();
    expect(screen.getByText(/on k17abc123def456/)).toBeTruthy();
  });

  test("opens the artifact in place on a plain left click", () => {
    const onOpenArtifact = vi.fn();
    render(
      <ConvoyArtifactPart payload={payload} onOpenArtifact={onOpenArtifact} />
    );

    const link = screen.getByRole("link", { name: /artifact/i });
    expect(link.getAttribute("href")).toBe(ARTIFACT_HREF);

    const handled = fireEvent.click(link, { button: 0 });

    expect(onOpenArtifact).toHaveBeenCalledWith("artifact_1");
    // preventDefault ran, so the browser never follows the href.
    expect(handled).toBe(false);
  });

  test("leaves modified and middle clicks to the browser", () => {
    const onOpenArtifact = vi.fn();
    render(
      <ConvoyArtifactPart payload={payload} onOpenArtifact={onOpenArtifact} />
    );

    const link = screen.getByRole("link", { name: /artifact/i });
    fireEvent.click(link, { button: 0, metaKey: true });
    fireEvent.click(link, { button: 0, ctrlKey: true });
    fireEvent.click(link, { button: 0, shiftKey: true });
    fireEvent.click(link, { button: 1 });

    expect(onOpenArtifact).not.toHaveBeenCalled();
  });

  test("stays a plain link when the host offers no handler", () => {
    render(<ConvoyArtifactPart payload={payload} />);

    const link = screen.getByRole("link", { name: /artifact/i });
    expect(link.getAttribute("href")).toBe(ARTIFACT_HREF);
  });

  test("renders a delete as a plain row with no body and no expander", () => {
    render(
      <ConvoyArtifactPart
        payload={{
          kind: "delete_task_artifact",
          toolCallId: "call_3",
          server: "contoso",
          action: "Deleted artifact",
          state: "output-available",
        }}
      />
    );

    expect(screen.getByText(/Deleted artifact/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Artifact deleted")).toBeNull();
  });

  test("opens list rows in place too", () => {
    const onOpenArtifact = vi.fn();
    render(
      <ConvoyArtifactPart
        payload={{
          kind: "list_task_artifacts",
          toolCallId: "call_2",
          server: "contoso",
          action: "Listed artifacts",
          state: "output-available",
          taskRef: "WEB-1",
          artifacts: [
            { id: "artifact_2", name: "Notes", contentType: "markdown" },
          ],
        }}
        onOpenArtifact={onOpenArtifact}
      />
    );

    // The rows live in the collapsible body.
    fireEvent.click(screen.getByRole("button", { name: /Listed artifacts/ }));
    fireEvent.click(screen.getByRole("link", { name: /Notes/ }), { button: 0 });

    expect(onOpenArtifact).toHaveBeenCalledWith("artifact_2");
  });
});
