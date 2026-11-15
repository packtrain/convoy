/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ConfirmDialog, TitledDialog } from "./dialog";

afterEach(cleanup);

describe("TitledDialog", () => {
  test("renders its title and description in the shared dialog header", () => {
    render(
      <TitledDialog open title="Rename list" description="Pick a new name.">
        <p>Body</p>
      </TitledDialog>
    );

    const dialog = screen.getByRole("dialog", { name: "Rename list" });
    expect(dialog.getAttribute("data-slot")).toBe("dialog-content");
    expect(screen.getByText("Pick a new name.").closest('[data-slot="dialog-header"]')).not.toBeNull();
  });
});

describe("ConfirmDialog", () => {
  test("puts Cancel and Confirm in the shared dialog footer and closes on confirm", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete list?"
        text="This cannot be undone."
        onClose={onClose}
        confirm={{ label: "Delete", variant: "destructive", onClick: onConfirm }}
      />
    );

    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm.closest('[data-slot="dialog-footer"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" }).closest('[data-slot="dialog-footer"]')).not.toBeNull();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
