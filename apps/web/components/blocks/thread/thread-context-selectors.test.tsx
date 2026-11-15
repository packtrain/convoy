/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThreadContextSelectors } from "./thread-context-selectors";

vi.mock("@/lib/threads/hooks/use-cli-favorite-combos", () => ({
  useCliFavoriteCombos: () => ({ favoriteCombos: [], toggleFavoriteCombo: vi.fn() }),
}));

const cliTypeSelectorMock = vi.fn();

vi.mock("./cli-type-selector", () => ({
  CliTypeSelector: (props: { allowedCliTypes?: string[]; compact?: boolean }) => {
    cliTypeSelectorMock(props);
    return <div data-testid="cli-type-selector" />;
  },
}));

const modeSelectorMock = vi.fn();

vi.mock("./mode-selector", () => ({
  ModeSelector: (props: { compact?: boolean }) => {
    modeSelectorMock(props);
    return <div data-testid="mode-selector" />;
  },
}));

const BASE_PROPS = {
  profiles: [],
  profileId: "profile-1",
  pathId: "path-1",
  cliType: "claude-code" as const,
  mode: undefined,
  cliModel: undefined,
  onModeChange: vi.fn(),
};

describe("ThreadContextSelectors", () => {
  afterEach(() => {
    cleanup();
    cliTypeSelectorMock.mockReset();
    modeSelectorMock.mockReset();
  });

  test("renders only the footer selectors: CLI/model and mode", () => {
    render(
      <ThreadContextSelectors
        {...BASE_PROPS}
        // Context-bar concerns are configuration passed through to
        // ThreadComposer; this component must not render them itself.
        projectAgents={[{ _id: "agent-1", name: "Reviewer", appearance: { color: "#22c55e" } }]}
        projectAgentId="agent-1"
        onProjectAgentChange={vi.fn()}
        onBaseRefChange={vi.fn()}
        onPathChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("cli-type-selector")).toBeDefined();
    expect(screen.getByTestId("mode-selector")).toBeDefined();
    expect(screen.queryByTestId("thread-agent-selector")).toBeNull();
    expect(screen.queryByTestId("working-directory-selector")).toBeNull();
    expect(screen.queryByTestId("base-ref-selector")).toBeNull();
  });

  test("lockAgentContext restricts the CLI selector to the thread's runtime", () => {
    render(<ThreadContextSelectors {...BASE_PROPS} lockAgentContext />);

    expect(cliTypeSelectorMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowedCliTypes: ["claude-code"] })
    );
  });

  test("without lockAgentContext all runtimes stay selectable", () => {
    render(<ThreadContextSelectors {...BASE_PROPS} />);

    expect(cliTypeSelectorMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowedCliTypes: undefined })
    );
  });

  test("compact renders both selectors icon-only (OS-2151)", () => {
    render(<ThreadContextSelectors {...BASE_PROPS} compact />);

    expect(cliTypeSelectorMock).toHaveBeenCalledWith(expect.objectContaining({ compact: true }));
    expect(modeSelectorMock).toHaveBeenCalledWith(expect.objectContaining({ compact: true }));
  });
});
