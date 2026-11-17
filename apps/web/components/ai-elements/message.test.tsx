/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageResponse } from "./message";

const { useThemeMock, createCodePluginSpy } = vi.hoisted(() => ({
  useThemeMock: vi.fn((): { resolvedTheme?: string } => ({ resolvedTheme: "dark" })),
  createCodePluginSpy: vi.fn(),
}));

vi.mock("next-themes", () => ({ useTheme: useThemeMock }));
vi.mock("@streamdown/code", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@streamdown/code")>();
  return {
    ...actual,
    createCodePlugin: (options: Parameters<typeof actual.createCodePlugin>[0]) => {
      createCodePluginSpy(options);
      return actual.createCodePlugin(options);
    },
  };
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  createCodePluginSpy.mockClear();
  useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
});

describe("MessageResponse code theme", () => {
  test("keeps one light/dark highlighter while the app theme resolves", () => {
    useThemeMock.mockReturnValue({ resolvedTheme: undefined });
    const { rerender } = render(<MessageResponse>{"`a`"}</MessageResponse>);

    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    rerender(<MessageResponse>{"`b`"}</MessageResponse>);

    expect(createCodePluginSpy).toHaveBeenCalledTimes(1);
    expect(createCodePluginSpy).toHaveBeenCalledWith({
      themes: ["github-light", "github-dark-high-contrast"],
    });
  });

  test("follows the code diff theme preset", () => {
    window.localStorage.setItem("convoy.code-diff-theme", "catppuccin");
    render(<MessageResponse>{"`a`"}</MessageResponse>);

    expect(createCodePluginSpy).toHaveBeenCalledWith({
      themes: ["catppuccin-latte", "catppuccin-mocha"],
    });
  });
});

describe("MessageResponse link safety", () => {
  test("portals the confirm dialog out of the message container (OS-2047)", async () => {
    const { container } = render(<MessageResponse>{"[docs](https://example.com/a)"}</MessageResponse>);

    fireEvent.click(await screen.findByRole("button", { name: "docs" }));

    const dialog = await screen.findByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.textContent).toContain("https://example.com/a");
  });

  test("opens the link and closes the dialog on confirm", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<MessageResponse>{"[docs](https://example.com/a)"}</MessageResponse>);

    fireEvent.click(await screen.findByRole("button", { name: "docs" }));
    fireEvent.click(await screen.findByRole("button", { name: /open link/i }));

    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noreferrer");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("MessageResponse components", () => {
  test("uses a caller's component override (OS-2403)", () => {
    const { container } = render(
      <MessageResponse components={{ img: (props) => <i data-testid="caller-img" title={props.alt} /> }}>
        {"![Ready](https://example.com/ready.svg)"}
      </MessageResponse>
    );

    expect(screen.getByTestId("caller-img").title).toBe("Ready");
    expect(container.querySelector('[data-streamdown="image-wrapper"]')).toBeNull();
  });
});
