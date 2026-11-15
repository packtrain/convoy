/** @vitest-environment jsdom */
import { Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import OrganizationLayout from "./layout";

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/lib/auth/use-app-auth-readiness", () => ({
  useAppAuthReadiness: () => ({ status: "loading", userId: null }),
}));
vi.mock("@/lib/navigation", () => ({ useRouteParams: () => ({}) }));
vi.mock("@/lib/routing/use-last-project", () => ({ useLastProject: () => undefined }));
vi.mock("@/components/blocks/sidebar/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/blocks/tasks/global-task-quick-open", () => ({ GlobalTaskQuickOpen: () => null }));
vi.mock("@/components/blocks/notifications/notification-toasts", () => ({ NotificationToasts: () => null }));
vi.mock("@/components/blocks/mobile/mobile-nav-bar", () => ({ MobileNavBar: () => null }));
vi.mock("@/components/blocks/tasks/create-task-dialog-context", () => ({
  CreateTaskDialogProvider: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(cleanup);

test("shows the app shell skeleton instead of a full-page spinner while auth and the org load", async () => {
  await act(async () => {
    render(
      <Suspense>
        <OrganizationLayout params={Promise.resolve({ organizationSlug: "acme" })}>
          <div>child</div>
        </OrganizationLayout>
      </Suspense>
    );
  });

  expect(screen.getByLabelText("Loading workspace").querySelector('[data-slot="skeleton"]')).not.toBeNull();
  expect(screen.queryByText("Loading")).toBeNull();
  expect(screen.queryByText("child")).toBeNull();
});
