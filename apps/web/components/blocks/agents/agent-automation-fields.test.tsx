/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Id } from "@/convex/_generated/dataModel";
import type {
  CliModel,
  CliTypeSlug,
} from "@/lib/cli-runtime-ui/registry";
import {
  AgentAutomationFields,
  type AgentAutomationDraft,
} from "./agent-automation-fields";

vi.mock("@/components/blocks/thread/thread-composer", () => ({
  ThreadComposer: ({
    selectorsProps,
  }: {
    selectorsProps: {
      cliType: CliTypeSlug;
      cliModel?: CliModel;
      onCliTypeChange: (cliType: CliTypeSlug) => void;
      onCliModelChange: (cliModel: CliModel) => void;
    };
  }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          selectorsProps.onCliTypeChange("codex");
          selectorsProps.onCliModelChange("gpt-5.6-sol");
        }}
      >
        Select Codex GPT
      </button>
      <output data-testid="selected-cli-model">
        {selectorsProps.cliType}:{selectorsProps.cliModel}
      </output>
    </div>
  ),
}));

function ControlledAutomationFields() {
  const [value, setValue] = useState<AgentAutomationDraft>({
    enabled: true,
    promptText: "",
    composerDocument: { version: 1, refs: [] },
    cliType: "claude-code",
    cliModel: "haiku",
  });

  return (
    <AgentAutomationFields
      organizationId={"organization_1" as Id<"organizations">}
      projectId={"project_1" as Id<"projects">}
      value={value}
      onChange={(patch) =>
        setValue((previous) => ({ ...previous, ...patch }))
      }
      disabled={false}
    />
  );
}

describe("AgentAutomationFields", () => {
  afterEach(cleanup);

  test("keeps a newly selected non-default runtime when its model is selected in the same interaction", () => {
    render(<ControlledAutomationFields />);

    fireEvent.click(screen.getByRole("button", { name: "Select Codex GPT" }));

    expect(screen.getByTestId("selected-cli-model").textContent).toBe(
      "codex:gpt-5.6-sol"
    );
  });
});
