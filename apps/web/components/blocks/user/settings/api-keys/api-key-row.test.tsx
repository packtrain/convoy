/**
 * @vitest-environment jsdom
 */
import type { Id } from "@/convex/_generated/dataModel";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Table, TableBody } from "@/components/ui/table";
import { ApiKeyRow } from "./api-key-row";

vi.mock("./delete-key-dialog", () => ({
  DeleteKeyDialog: () => null,
}));

vi.mock("./edit-key-dialog", () => ({
  EditKeyDialog: () => null,
}));

describe("ApiKeyRow", () => {
  test("constrains the masked key so it cannot overlap adjacent columns", () => {
    render(
      <Table>
        <TableBody>
          <ApiKeyRow
            apiKey={{
              _id: "apiKeyId" as Id<"apiKeys">,
              name: "default",
              keyPrefix: "sk_user_P7M24Z",
              createdAt: Date.UTC(2026, 0, 1),
              lastUsedAt: Date.UTC(2026, 0, 2),
              expiresAt: Date.UTC(2026, 0, 31),
              scope: { kind: "unscoped" },
            }}
          />
        </TableBody>
      </Table>
    );

    const maskedKey = screen.getByText("sk_user_P7M24Z...");
    const maskedKeyClasses = maskedKey.getAttribute("class") ?? "";
    const cellClasses = maskedKey.closest("td")?.getAttribute("class") ?? "";

    expect(maskedKeyClasses).toContain("block");
    expect(maskedKeyClasses).toContain("max-w-full");
    expect(maskedKeyClasses).toContain("truncate");
    expect(cellClasses).toContain("overflow-hidden");
    expect(cellClasses).toContain("w-40");
  });
});

test("the row actions button is named after the key", () => {
  render(
    <Table>
      <TableBody>
        <ApiKeyRow
          apiKey={{
            _id: "named" as Id<"apiKeys">,
            name: "Laptop",
            keyPrefix: "sk_user_laptop",
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            scope: { kind: "unscoped" },
          }}
        />
      </TableBody>
    </Table>
  );

  expect(screen.getByRole("button", { name: "Laptop actions" })).toBeTruthy();
});

describe("non-expiring keys", () => {
  test("shows Never in the expiry cell and popover", async () => {
    render(
      <Table>
        <TableBody>
          <ApiKeyRow
            apiKey={{
              _id: "forever" as Id<"apiKeys">,
              name: "Forever",
              keyPrefix: "sk_user_forever",
              createdAt: Date.now(),
              lastUsedAt: Date.now(),
              scope: { kind: "unscoped" },
            }}
          />
        </TableBody>
      </Table>
    );
    expect(screen.getByText("Never").closest("td")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Forever" }));
    expect(await screen.findAllByText("Never")).toHaveLength(2);
  });
});

describe("worker key details", () => {
  test("shows worker details only in the name popover", async () => {
    render(
      <Table>
        <TableBody>
          <ApiKeyRow
            apiKey={{
              _id: "worker" as Id<"apiKeys">,
              name: "Worker",
              keyPrefix: "sk_user_worker",
              createdAt: Date.now(),
              expiresAt: Date.now() + 86400000,
              scope: { kind: "unscoped" },
              kind: "project-worker",
              sourceKeyName: "VM setup",
            }}
          />
        </TableBody>
      </Table>
    );
    expect(screen.queryByText(/Source: VM setup/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Worker" }));
    expect(await screen.findByText("Source: VM setup")).toBeDefined();
    expect(screen.getByText("Project worker")).toBeDefined();
    expect(screen.getByText("Requires a valid source key that still covers this project.")).toBeDefined();
  });

  test("marks an inactive worker within the existing row and explains it in the popover", async () => {
    render(
      <Table>
        <TableBody>
          <ApiKeyRow
            apiKey={{
              _id: "inactive" as Id<"apiKeys">,
              name: "Inactive worker",
              keyPrefix: "sk_user_inactive",
              createdAt: Date.now(),
              expiresAt: Date.now() + 86400000,
              scope: { kind: "unscoped" },
              kind: "project-worker",
              sourceKeyName: "VM setup",
              workerStatus: "source-scope",
            }}
          />
        </TableBody>
      </Table>
    );
    expect(screen.getByText("Inactive").closest("td")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inactive worker" }));
    expect(await screen.findByText("Source key no longer covers this project.")).toBeDefined();
  });
});
