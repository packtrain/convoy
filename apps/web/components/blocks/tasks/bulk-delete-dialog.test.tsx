/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BulkDeleteDialog } from "./bulk-delete-dialog";

function renderDialog({
  totalSubtaskCount = 0,
  onOpenChange = vi.fn(),
  onKeepChildren = vi.fn(),
  onDeleteAll = vi.fn(),
}: {
  totalSubtaskCount?: number;
  onOpenChange?: (open: boolean) => void;
  onKeepChildren?: () => void;
  onDeleteAll?: () => void;
} = {}) {
  render(
    <BulkDeleteDialog
      open
      onOpenChange={onOpenChange}
      selectedCount={2}
      totalSubtaskCount={totalSubtaskCount}
      onKeepChildren={onKeepChildren}
      onDeleteAll={onDeleteAll}
    />
  );

  return {
    onKeepChildren,
    onDeleteAll,
  };
}

describe("BulkDeleteDialog", () => {
  afterEach(() => {
    cleanup();
  });

  test("confirms multi-delete without unselected subtasks", () => {
    const { onDeleteAll, onKeepChildren } = renderDialog();

    expect(screen.getByRole("heading", { name: "Delete 2 tasks?" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Keep all subtasks" })).toBeNull();
    // The Undo toast lasts only seconds, so the dialog still warns the delete is permanent.
    expect(screen.getByText("This action cannot be undone.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDeleteAll).toHaveBeenCalledOnce();
    expect(onKeepChildren).not.toHaveBeenCalled();
  });

  test("offers descendant handling when multi-delete includes unselected subtasks", () => {
    const { onDeleteAll, onKeepChildren } = renderDialog({ totalSubtaskCount: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Keep all subtasks" }));
    expect(onKeepChildren).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(onDeleteAll).toHaveBeenCalledOnce();
  });
});
