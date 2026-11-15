/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileTabStrip } from "./file-tab-strip";

describe("FileTabStrip", () => {
  afterEach(cleanup);

  test("renders nothing without file tabs", () => {
    const { container } = render(<FileTabStrip activeTab={null} openPaths={[]} onSelect={() => {}} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  test("lists Changes plus a closable tab per file, named by its base name", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<FileTabStrip activeTab="src/a.ts" openPaths={["src/a.ts"]} onSelect={onSelect} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    expect(onSelect).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "a.ts" }));
    expect(onSelect).toHaveBeenCalledWith("src/a.ts");
    fireEvent.click(screen.getByRole("button", { name: "Close src/a.ts" }));
    expect(onClose).toHaveBeenCalledWith("src/a.ts");
    expect(screen.getByRole("button", { name: "a.ts" }).parentElement?.querySelector("img")?.getAttribute("src")).toBe(
      "/file-icons/file_type_typescript.svg"
    );
  });
});
