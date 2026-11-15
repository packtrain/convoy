/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiKeysSection } from "./api-keys-section";
import { expectEmptyState } from "@/test-utils/empty-state";

const paginated = vi.hoisted(() => ({
  current: { results: [] as unknown[], status: "Exhausted", loadMore: (() => {}) as (n: number) => void },
}));
vi.mock("convex/react", () => ({ usePaginatedQuery: () => paginated.current }));
vi.mock("@/lib/navigation", () => ({
  useRouteParams: () => ({ organizationSlug: "acme", projectAlias: "WEB" }),
  AppLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("./create-api-key-dialog", () => ({ CreateApiKeyDialog: () => null }));
vi.mock("./api-key-row", () => ({ ApiKeyRow: () => null }));

afterEach(() => {
  cleanup();
  paginated.current = { results: [], status: "Exhausted", loadMore: () => {} };
  vi.unstubAllEnvs();
});

test.each([
  ["https://example.convex.cloud", "https://example.convex.site/api/mcp?project=acme/WEB"],
  ["http://localhost:3210", "http://localhost:3211/api/mcp?project=acme/WEB"],
])("shows and copies connection URLs for %s without opening setup", async (cliUrl, mcpUrl) => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", cliUrl);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<ApiKeysSection />);
  expect(screen.getByText(cliUrl)).toBeDefined();
  expect(screen.getByText(mcpUrl)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Copy CLI / Convex URL" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(cliUrl));
  fireEvent.click(screen.getByRole("button", { name: "Copy MCP endpoint" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(mcpUrl));
});

test("loads the next 100 keys on Load more and hides the control once exhausted", () => {
  const loadMore = vi.fn();
  paginated.current = { results: [{ _id: "k1" }], status: "CanLoadMore", loadMore };
  const { rerender } = render(<ApiKeysSection />);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(loadMore).toHaveBeenCalledWith(100);
  paginated.current = { ...paginated.current, status: "Exhausted" };
  rerender(<ApiKeysSection />);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

test("shows the shared empty state with the create action when there are no keys", () => {
  const { container } = render(<ApiKeysSection />);
  expectEmptyState("No API keys yet", {
    boundary: container.firstElementChild as HTMLElement,
    action: { role: "button", name: "Create key" },
  });
  expect(screen.getByText("Create one for CLI and MCP access.")).toBeDefined();
  expect(screen.getAllByRole("button", { name: "Create key" })).toHaveLength(1);
});

test("keeps the create action in the toolbar once keys exist", () => {
  paginated.current = { results: [{ _id: "k1" }], status: "Exhausted", loadMore: () => {} };
  render(<ApiKeysSection />);
  expect(screen.getByRole("button", { name: "Create key" }).closest("[data-slot=empty]")).toBeNull();
});

test("keeps the header and skeletons the key list while the first page loads", () => {
  paginated.current = { results: [], status: "LoadingFirstPage", loadMore: () => {} };
  render(<ApiKeysSection />);
  expect(screen.getByRole("heading", { name: "API keys" })).toBeDefined();
  expect(screen.getByLabelText("Loading API keys").querySelector('[data-slot="skeleton"]')).not.toBeNull();
  expect(screen.queryByText(/Loading/)).toBeNull();
});
