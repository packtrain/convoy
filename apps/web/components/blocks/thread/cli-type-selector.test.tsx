/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CliTypeSelector } from "./cli-type-selector";

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children, content }: { children: ReactNode; content: string }) => (
    <span data-tooltip-content={content}>{children}</span>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", async () => {
  const { useEffect } = await import("react");
  return {
    // Opens once on mount and reflects the controlled open state, so tests can
    // observe whether a pick closes the menu (Radix itself can't open in jsdom).
    DropdownMenu: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => onOpenChange?.(true), []);
      return (
        <div data-testid="dropdown-menu-root" data-open={String(open ?? false)}>
          {children}
        </div>
      );
    },
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div className={className} data-testid="dropdown-menu-content">
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
    title,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    title?: string;
  }) => (
    <button
      type="button"
      disabled={disabled}
      title={title}
      data-testid={`item-${typeof children === "string" ? children : "custom"}`}
      onClick={onClick}
    >
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <div />,
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({
    children,
    disabled,
  }: {
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled}>
      {children}
    </button>
  ),
    DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

describe("CliTypeSelector", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  test("locked selector skips the cli-type list and shows current runtime options directly", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={vi.fn()}
        allowedCliTypes={["claude-code"]}
      />
    );

    // Other CLI types are not listed at all.
    expect(screen.queryByText("Codex")).toBeNull();
    expect(screen.queryByText("OpenCode")).toBeNull();
    // The active runtime's model options are the top-level menu.
    expect(screen.getByRole("button", { name: /^Opus 5\.5$/i })).toBeDefined();
  });

  test("names the AWS provider, Region and limits for Codex on Mantle (OS-2105)", () => {
    render(
      <CliTypeSelector
        value="codex"
        cliModel="default"
        onChange={vi.fn()}
        allowedCliTypes={["codex"]}
        availableClis={[{ type: "codex", version: "0.156.1", provider: "mantle", region: "us-east-1" }]}
      />
    );

    expect(screen.getByText("AWS Bedrock (Mantle) · us-east-1")).toBeDefined();
    expect(screen.getByText(/No Fast mode or image generation/)).toBeDefined();
    expect(screen.getByText(/Select a supported model/)).toBeDefined();
    // Only the Reasoning "Default" remains; the machine-default model is hidden.
    expect(screen.getAllByRole("button", { name: /^Default$/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^GPT-6 Sol$/ })).toBeDefined();
  });

  test("notes the missing hosted web search on Bedrock Runtime (OS-2105)", () => {
    render(
      <CliTypeSelector
        value="codex"
        cliModel="gpt-6-sol"
        onChange={vi.fn()}
        allowedCliTypes={["codex"]}
        availableClis={[{ type: "codex", version: "0.156.1", provider: "bedrock", region: "us-west-2" }]}
      />
    );

    expect(screen.getByText("AWS Bedrock · us-west-2")).toBeDefined();
    expect(screen.getByText(/hosted web search/)).toBeDefined();
    expect(screen.queryByText(/Select a supported model/)).toBeNull();
  });

  test("locked model selector is wide enough for model and effort labels", () => {
    render(
      <CliTypeSelector
        value="codex"
        cliModel="gpt-5.6-luna"
        cliEffort="high"
        onChange={vi.fn()}
        allowedCliTypes={["codex"]}
      />
    );

    expect(screen.getByTestId("dropdown-menu-content").classList).toContain(
      "w-56",
    );
  });

  test("locked selector still changes the model without firing a type change", () => {
    const onChange = vi.fn();
    const onCliModelChange = vi.fn();

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
        allowedCliTypes={["claude-code"]}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /^Opus 5\.5$/i })[0]);

    expect(onChange).not.toHaveBeenCalled();
    expect(onCliModelChange).toHaveBeenCalledWith("opus-5-5");
  });

  test.each([
    ["claude-code", "opus-5-5"],
    ["cursor", "claude-opus-5-5"],
  ] as const)("selects Opus 5.5 for %s", (cliType, model) => {
    const onCliModelChange = vi.fn();
    render(<CliTypeSelector value={cliType} cliModel="default" onChange={vi.fn()}
      onCliModelChange={onCliModelChange} allowedCliTypes={[cliType]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Opus 5\.5$/i })[0]);
    expect(onCliModelChange).toHaveBeenCalledWith(model);
  });

  test("uses pointer cursor when enabled", () => {
    render(<CliTypeSelector value="claude-code" onChange={vi.fn()} />);

    const trigger = screen.getByTitle("Claude Code");
    expect(trigger.classList.contains("cursor-pointer")).toBe(true);
  });

  test("uses default cursor when disabled", () => {
    render(<CliTypeSelector value="claude-code" onChange={vi.fn()} disabled />);

    const trigger = screen.getByTitle("Claude Code");
    expect(trigger.classList.contains("cursor-default")).toBe(true);
  });

  test("trigger label truncates instead of widening a narrow footer (OS-2144)", () => {
    render(<CliTypeSelector value="claude-code" cliModel="opus" cliEffort="high" onChange={vi.fn()} />);

    const trigger = screen.getByTitle("Opus");
    expect(trigger.classList.contains("min-w-0")).toBe(true);
    expect(trigger.classList.contains("shrink")).toBe(true);
    expect(trigger.classList.contains("shrink-0")).toBe(false);
    expect(trigger.textContent).toContain("High");
    expect(trigger.querySelector("span.truncate")?.textContent).toContain("Opus");
  });

  test("shows the selected Claude model in the trigger label", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="opus"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByTitle("Opus")).toBeDefined();
  });

  test.each([
    ["claude-code", "opus", "Opus", /^Opus(?: \(1M\))?$/i],
    ["cursor", "claude-opus-4-8", "Opus 4.8", /^Opus 4\.8$/i],
  ] as const)("keeps the stored %s model label without offering Opus 4.8", (cliType, cliModel, label, retiredLabel) => {
    render(
      <CliTypeSelector value={cliType} cliModel={cliModel} onChange={vi.fn()}
        allowedCliTypes={[cliType]} />
    );
    expect(screen.getByTitle(label)).toBeDefined();
    const modelRows = screen.getAllByTestId("item-custom");
    expect(modelRows.some((row) => retiredLabel.test(row.textContent ?? ""))).toBe(false);
  });

  test("shows explicit Opus 4.7 labels when that model is selected", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="opus-4-7"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByTitle("Opus 4.7")).toBeDefined();
  });

  test("uses provider-aware labels from the selected Claude runtime when available", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="sonnet-1m"
        availableClis={[
          {
            type: "claude-code",
            version: "2.1.52",
            provider: "bedrock",
          },
        ]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByTitle("Sonnet 5 (1M)")).toBeDefined();
  });

  test("selecting a model on the current cli keeps the type change silent", () => {
    const onChange = vi.fn();
    const onCliModelChange = vi.fn();

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /^Opus 5\.5$/i })[0]);

    // Re-firing the type change would reset model/effort to defaults.
    expect(onChange).not.toHaveBeenCalled();
    expect(onCliModelChange).toHaveBeenCalledWith("opus-5-5");
  });

  test("selecting a model on another cli switches the type first", () => {
    const onChange = vi.fn();
    const onCliModelChange = vi.fn();

    render(
      <CliTypeSelector
        value="codex"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /^Opus 5\.5$/i })[0]);

    expect(onChange).toHaveBeenCalledWith("claude-code");
    expect(onCliModelChange).toHaveBeenCalledWith("opus-5-5");
  });

  test("selecting the Fable 5 submenu model updates both cli type and model", () => {
    const onChange = vi.fn();
    const onCliModelChange = vi.fn();

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
        availableClis={[
          {
            type: "claude-code",
            version: "2.1.52",
            provider: "bedrock",
          },
        ]}
      />
    );

    // Cursor's model list also offers a "Fable 5"; Claude's submenu entry
    // renders first (CLI_TYPE_SELECTOR_ORDER).
    fireEvent.click(screen.getAllByRole("button", { name: /^Fable 5$/i })[0]);

    expect(onChange).not.toHaveBeenCalled();
    expect(onCliModelChange).toHaveBeenCalledWith("fable");
  });

  test("cursor groups models into provider submenus with per-group reasoning", () => {
    const onChange = vi.fn();
    const onCliModelChange = vi.fn();
    const onCliEffortChange = vi.fn();

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
        onCliEffortChange={onCliEffortChange}
      />
    );

    // Provider headers render as submenu triggers.
    expect(
      screen.getByRole("button", { name: /Moonshot AI/i }),
    ).toBeDefined();

    // Reasoning inside the Anthropic group ("Thinking" exists only there).
    fireEvent.click(screen.getByRole("button", { name: /^Thinking$/i }));
    expect(onChange).toHaveBeenCalledWith("cursor");
    expect(onCliEffortChange).toHaveBeenCalledWith("thinking");

    // Model selection still works from a provider group.
    fireEvent.click(screen.getByRole("button", { name: /^Kimi K2.7 Code$/i }));
    expect(onCliModelChange).toHaveBeenCalledWith("kimi-k2.7-code");
  });

  test("filters long model lists through the search input", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={vi.fn()}
        onCliModelChange={vi.fn()}
      />
    );

    // Cursor's catalog exceeds the threshold, so its submenu has a filter.
    const search = screen.getByPlaceholderText("Search models…");
    expect(search.closest("[data-slot=dropdown-search-input-wrapper]")).not.toBeNull();
    fireEvent.change(search, { target: { value: "kimi" } });

    expect(
      screen.getByRole("button", { name: /^Kimi K2.7 Code$/i }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Composer 2.5$/i })).toBeNull();
  });

  test("selecting a reasoning effort updates cli type and effort", () => {
    const onChange = vi.fn();
    const onCliEffortChange = vi.fn();

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        cliEffort="default"
        onChange={onChange}
        onCliEffortChange={onCliEffortChange}
      />
    );

    // First "High" entry belongs to the Claude submenu (selector order).
    fireEvent.click(screen.getAllByRole("button", { name: /^High$/ })[0]);

    // Same-cli effort selection must not re-fire the type change (it would
    // reset the selected model to default).
    expect(onChange).not.toHaveBeenCalled();
    expect(onCliEffortChange).toHaveBeenCalledWith("high");
  });

  test("shows the effort suffix in the trigger for non-default effort", () => {
    render(
      <CliTypeSelector
        value="codex"
        cliModel="gpt-5.5"
        cliEffort="xhigh"
        onChange={vi.fn()}
      />
    );

    const trigger = screen.getByTitle("GPT-5.5");
    expect(trigger.textContent).toContain("Extra high");
  });

  test("shows no effort suffix for the default effort", () => {
    render(
      <CliTypeSelector
        value="codex"
        cliModel="gpt-5.5"
        cliEffort="default"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByTitle("GPT-5.5").textContent).not.toContain("Default");
  });

  test("shows tooltip affordance for the Claude default model option", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={vi.fn()}
      />
    );

    // One affordance per runtime with a "default" model (Claude + Codex + OpenCode + Cursor).
    expect(screen.getAllByLabelText("Default model info")).toHaveLength(4);
    expect(
      screen.getByText((_, element) =>
        element?.getAttribute("data-tooltip-content") ===
        "This is the default that the user has set up in the Claude Code CLI."
      )
    ).toBeDefined();
  });

  test("shows remembered last-used combos and applies model + effort together", () => {
    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      JSON.stringify({
        version: 1,
        modelsByCliType: {},
        combosByCliType: {
          codex: [
            { cliModel: "gpt-5.5", cliEffort: "medium" },
            { cliModel: "gpt-5.4", cliEffort: "default" },
          ],
        },
      })
    );

    const onChange = vi.fn();
    const onCliModelChange = vi.fn();
    const onCliEffortChange = vi.fn();

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
        onCliEffortChange={onCliEffortChange}
      />
    );

    expect(screen.getByText("Last used")).toBeDefined();
    // Only combo rows carry a combined "model + effort" label.
    fireEvent.click(screen.getByRole("button", { name: /^GPT-5\.5\s?Medium$/ }));

    expect(onChange).toHaveBeenCalledWith("codex");
    expect(onCliModelChange).toHaveBeenCalledWith("gpt-5.5");
    expect(onCliEffortChange).toHaveBeenCalledWith("medium");
  });

  test.each([
    ["claude-code", "opus", "Opus"],
    ["cursor", "claude-opus-4-8", "Opus 4.8"],
  ] as const)("preserves the label and selection of retired %s recents", (cliType, cliModel, label) => {
    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      JSON.stringify({
        version: 1,
        modelsByCliType: {},
        combosByCliType: { [cliType]: [{ cliModel, cliEffort: "default" }] },
      }),
    );
    const onCliModelChange = vi.fn();
    render(
      <CliTypeSelector
        value={cliType}
        allowedCliTypes={[cliType]}
        onChange={vi.fn()}
        onCliModelChange={onCliModelChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onCliModelChange).toHaveBeenCalledWith(cliModel);
  });

  test("shows no last-used section without remembered combos", () => {
    render(<CliTypeSelector value="claude-code" onChange={vi.fn()} />);

    expect(screen.queryByText("Last used")).toBeNull();
  });

  test("renders favorites and applies cli + model + effort", () => {
    const onChange = vi.fn();
    const onCliModelChange = vi.fn();
    const onCliEffortChange = vi.fn();

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
        onCliEffortChange={onCliEffortChange}
        favoriteCombos={[
          {
            cliType: "codex",
            cliModel: "gpt-5.5",
            cliEffort: "high",
            isAvailable: true,
          },
        ]}
      />
    );

    expect(screen.getByText("Favorites")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /^GPT-5\.5\s?High$/ }));

    expect(onChange).toHaveBeenCalledWith("codex");
    expect(onCliModelChange).toHaveBeenCalledWith("gpt-5.5");
    expect(onCliEffortChange).toHaveBeenCalledWith("high");
  });

  test("favorites are sorted by cli, then by model label", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={vi.fn()}
        favoriteCombos={[
          { cliType: "codex", cliModel: "gpt-5.5", isAvailable: true },
          { cliType: "claude-code", cliModel: "sonnet", isAvailable: true },
          { cliType: "claude-code", cliModel: "opus", isAvailable: true },
        ]}
      />
    );

    // Favorites render first in a downward menu, ahead of the runtime list.
    const rows = Array.from(
      screen.getByTestId("dropdown-menu-content").querySelectorAll("button")
    )
      .map((button) => button.textContent ?? "")
      .filter((text) => /^(Opus|Sonnet|GPT-5\.5)$/.test(text));

    expect(rows.slice(0, 3)).toEqual(["Opus", "Sonnet", "GPT-5.5"]);
  });

  test("shows no favorites section without favorite combos", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        onChange={vi.fn()}
        favoriteCombos={[]}
        onToggleFavoriteCombo={vi.fn()}
      />
    );

    expect(screen.queryByText("Favorites")).toBeNull();
  });

  test("star on a last-used row toggles the favorite without selecting it", () => {
    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      JSON.stringify({
        version: 1,
        modelsByCliType: {},
        combosByCliType: {
          codex: [{ cliModel: "gpt-5.5", cliEffort: "medium" }],
        },
      })
    );

    const onChange = vi.fn();
    const onCliModelChange = vi.fn();
    const onToggleFavoriteCombo = vi.fn();

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
        favoriteCombos={[]}
        onToggleFavoriteCombo={onToggleFavoriteCombo}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));

    expect(onToggleFavoriteCombo).toHaveBeenCalledWith({
      cliType: "codex",
      cliModel: "gpt-5.5",
      cliEffort: "medium",
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCliModelChange).not.toHaveBeenCalled();
  });

  test("star on a favorite row removes it without selecting it", () => {
    const onCliModelChange = vi.fn();
    const onToggleFavoriteCombo = vi.fn();
    const combo = {
      cliType: "codex" as const,
      cliModel: "gpt-5.5",
      cliEffort: "high",
      isAvailable: true,
    };

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={vi.fn()}
        onCliModelChange={onCliModelChange}
        favoriteCombos={[combo]}
        onToggleFavoriteCombo={onToggleFavoriteCombo}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove from favorites" })
    );

    expect(onToggleFavoriteCombo).toHaveBeenCalledWith(combo);
    expect(onCliModelChange).not.toHaveBeenCalled();
  });

  test("locked selector only shows favorites for the locked runtime", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={vi.fn()}
        allowedCliTypes={["claude-code"]}
        favoriteCombos={[
          { cliType: "claude-code", cliModel: "opus", isAvailable: true },
          {
            cliType: "codex",
            cliModel: "gpt-5.5",
            cliEffort: "high",
            isAvailable: true,
          },
        ]}
      />
    );

    expect(screen.getByText("Favorites")).toBeDefined();
    expect(screen.queryByText("GPT-5.5")).toBeNull();
  });

  test("unavailable favorite is disabled but can still be unpinned", () => {
    const onChange = vi.fn();
    const onCliModelChange = vi.fn();
    const onToggleFavoriteCombo = vi.fn();
    const combo = {
      cliType: "codex" as const,
      cliModel: "retired-model",
      cliEffort: "high",
      isAvailable: false,
    };

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
        favoriteCombos={[combo]}
        onToggleFavoriteCombo={onToggleFavoriteCombo}
      />
    );

    // Clicking the row applies nothing.
    fireEvent.click(
      screen.getByRole("button", { name: /retired-model\s?high/i })
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(onCliModelChange).not.toHaveBeenCalled();

    // The explanatory tooltip is present, and the unpin star still works.
    expect(
      screen.getByTitle(/no longer available for Codex/i)
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove from favorites" })
    );
    expect(onToggleFavoriteCombo).toHaveBeenCalledWith(combo);
  });

  test("omits not-yet-selectable runtimes from the selector list", () => {
    render(<CliTypeSelector value="claude-code" onChange={vi.fn()} />);

    for (const name of ["Antigravity CLI", "Amp", "Droid", "Copilot", "CodeRabbit"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    expect(screen.queryByText("Soon")).toBeNull();
  });

  test("selecting an advertised OpenCode model switches the type and model", () => {
    const onChange = vi.fn();
    const onCliModelChange = vi.fn();

    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={onChange}
        onCliModelChange={onCliModelChange}
        availableClis={[
          {
            type: "opencode",
            version: "1.17.13",
            models: [
              {
                slug: "anthropic/claude-sonnet-5",
                name: "Claude Sonnet 5",
              },
            ],
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Claude Sonnet 5$/i }));

    expect(onChange).toHaveBeenCalledWith("opencode");
    expect(onCliModelChange).toHaveBeenCalledWith("anthropic/claude-sonnet-5");
  });

  test("OpenCode shows a Reasoning section from the selected model's variants", () => {
    const onCliEffortChange = vi.fn();

    render(
      <CliTypeSelector
        value="opencode"
        cliModel="anthropic/claude-sonnet-5"
        cliEffort="default"
        onChange={vi.fn()}
        onCliEffortChange={onCliEffortChange}
        availableClis={[
          {
            type: "opencode",
            version: "1.17.13",
            models: [
              {
                slug: "anthropic/claude-sonnet-5",
                name: "Claude Sonnet 5",
                variants: ["low", "high"],
              },
            ],
          },
        ]}
      />
    );

    // High buttons render per runtime in selector order: Claude, Codex, then
    // the OpenCode variant entry.
    fireEvent.click(screen.getAllByRole("button", { name: /^High$/ })[2]);

    expect(onCliEffortChange).toHaveBeenCalledWith("high");
  });

  test("OpenCode shows only the default slot when nothing is advertised", () => {
    render(
      <CliTypeSelector
        value="opencode"
        cliModel="default"
        onChange={vi.fn()}
        availableClis={[{ type: "opencode", version: "1.17.13" }]}
      />
    );

    const trigger = screen.getByTitle("OpenCode");
    expect(trigger).toBeDefined();
    expect(screen.queryByText("Claude Sonnet 5")).toBeNull();
  });

  // The lane-settings menu's props (OS-1813). The stub in its test file only
  // asserts they are passed; the real menu behavior is covered here.
  test("keepOpenOnSelect keeps the menu open on a pick; the default closes it", () => {
    const { unmount } = render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={vi.fn()}
        onCliModelChange={vi.fn()}
        keepOpenOnSelect
      />
    );
    expect(screen.getByTestId("dropdown-menu-root").getAttribute("data-open")).toBe("true");
    fireEvent.click(screen.getAllByRole("button", { name: /^Opus 5\.5$/i })[0]);
    expect(screen.getByTestId("dropdown-menu-root").getAttribute("data-open")).toBe("true");
    unmount();

    render(<CliTypeSelector value="claude-code" cliModel="default" onChange={vi.fn()} onCliModelChange={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Opus 5\.5$/i })[0]);
    expect(screen.getByTestId("dropdown-menu-root").getAttribute("data-open")).toBe("false");
  });

  test("leadingItems render above the runtime list and trailingItems below it", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={vi.fn()}
        leadingItems={<div data-testid="leading-marker" />}
        trailingItems={<div data-testid="trailing-marker" />}
      />
    );

    const codexItem = screen.getByText("Codex");
    const leading = screen.getByTestId("leading-marker");
    const trailing = screen.getByTestId("trailing-marker");
    expect(leading.compareDocumentPosition(codexItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trailing.compareDocumentPosition(codexItem) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  test("triggerAriaLabel names the trigger for callers whose label is not the runtime", () => {
    render(
      <CliTypeSelector
        value="claude-code"
        cliModel="default"
        onChange={vi.fn()}
        triggerAriaLabel="Lane Build settings"
      />
    );

    expect(screen.getByRole("button", { name: "Lane Build settings" })).toBeDefined();
  });

  test("an undefined value renders no runtime as selected", () => {
    const { container, unmount } = render(<CliTypeSelector value={undefined} onChange={vi.fn()} />);
    expect(container.querySelectorAll('[class*="lucide-check"]')).toHaveLength(0);
    unmount();

    const selected = render(<CliTypeSelector value="codex" onChange={vi.fn()} />);
    expect(selected.container.querySelectorAll('[class*="lucide-check"]').length).toBeGreaterThan(0);
  });
});
