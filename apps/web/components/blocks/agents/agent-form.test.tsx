/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentForm, EMPTY_AGENT_FORM_VALUES } from "./agent-form";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
      return <textarea aria-label="Prompt editor" value={value} onChange={(event) => onChange(event.target.value)} />;
    },
}));

describe("AgentForm", () => {
  beforeAll(() => {
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserver);
  });

  afterEach(() => {
    cleanup();
  });

  test("side-by-side Details fields stay top-aligned when one shows a validation error", async () => {
    render(
      <AgentForm
        mode="create"
        layout="settings-page"
        initialValues={EMPTY_AGENT_FORM_VALUES}
        canManage
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Name is required")).toBeDefined();
    // The name error grows the grid row; a stretched field would sink its label.
    expect(screen.getByLabelText("Agent name").closest("[data-slot='form-item']")?.className).toContain("content-start");
    expect(screen.getByLabelText("Category").closest("[data-slot='form-item']")?.className).toContain("content-start");
  });
});
