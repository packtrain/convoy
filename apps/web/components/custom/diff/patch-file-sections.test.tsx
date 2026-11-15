/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import { PatchFileSection } from "./patch-file-sections";

const FILE: CliRunDiffFile = { path: "src/a.ts", kind: "modified", additions: 2, deletions: 1 };
const noop = () => {};

describe("PatchFileSection", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("header toggles the file, hides the body when collapsed, and reports its element", () => {
    const onToggle = vi.fn();
    const registerSection = vi.fn();
    const { rerender } = render(
      <PatchFileSection file={FILE} collapsed={false} onToggle={onToggle} registerSection={registerSection} actions={<button>act</button>}>
        <p>body</p>
      </PatchFileSection>
    );

    expect(screen.getByText("body")).toBeDefined();
    expect(screen.getByText("act")).toBeDefined();
    expect(registerSection).toHaveBeenCalledWith("src/a.ts", expect.any(HTMLElement));
    fireEvent.click(screen.getByRole("button", { name: "src/a.ts" }));
    expect(onToggle).toHaveBeenCalledWith("src/a.ts");

    rerender(
      <PatchFileSection file={FILE} collapsed onToggle={onToggle} registerSection={registerSection}>
        <p>body</p>
      </PatchFileSection>
    );
    expect(screen.queryByText("body")).toBeNull();
  });

  test("binary files show a note instead of the body", () => {
    render(
      <PatchFileSection file={{ ...FILE, binary: true }} collapsed={false} onToggle={noop} registerSection={noop}>
        <p>body</p>
      </PatchFileSection>
    );
    expect(screen.queryByText("body")).toBeNull();
    expect(screen.getByText("Binary file — no diff to show.")).toBeDefined();
  });

  test("binary files can replace the note with their own body", () => {
    render(
      <PatchFileSection file={{ ...FILE, binary: true }} collapsed={false} onToggle={noop} registerSection={noop} binaryBody={<p>custom</p>}>
        <p>body</p>
      </PatchFileSection>
    );
    expect(screen.getByText("custom")).toBeDefined();
    expect(screen.queryByText("Binary file — no diff to show.")).toBeNull();
  });

  test("a patch body mounts only once its placeholder nears the viewport", () => {
    let intersect: (() => void) | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          intersect = () => callback([{ isIntersecting: true }]);
        }
        observe() {}
        disconnect() {}
      }
    );
    render(
      <PatchFileSection file={FILE} patch={"@@ -1 +1 @@\n-a\n+b"} collapsed={false} onToggle={noop} registerSection={noop}>
        <p>body</p>
      </PatchFileSection>
    );

    expect(screen.queryByText("body")).toBeNull();
    act(() => intersect?.());
    expect(screen.getByText("body")).toBeDefined();
  });
});
