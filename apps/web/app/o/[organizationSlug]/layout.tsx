"use client";

import { use, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppSidebar } from "@/components/blocks/sidebar/app-sidebar";
import { RouteErrorState } from "@/components/blocks/auth/route-error-state";
import { AppShellSkeleton } from "@/components/blocks/sidebar/app-shell-skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { NoAccess } from "@/components/blocks/no-access";
import { useLastResolvedRouteValue } from "@/lib/routing/use-last-resolved-route-value";
import { useLastProject } from "@/lib/routing/use-last-project";
import { useRouteParams } from "@/lib/navigation";
import { CreateTaskDialogProvider } from "@/components/blocks/tasks/create-task-dialog-context";
import { MobileNavBar } from "@/components/blocks/mobile/mobile-nav-bar";
import { MobileNavBarProvider } from "@/components/blocks/mobile/mobile-nav-context";
import { CurrentOrgProjectProvider } from "@/lib/routing/current-org-project-context";
import { GlobalTaskQuickOpen } from "@/components/blocks/tasks/global-task-quick-open";
import { QuickThreadDialog } from "@/components/blocks/thread/quick-thread";
import { NotificationToasts } from "@/components/blocks/notifications/notification-toasts";
import { useAppAuthReadiness } from "@/lib/auth/use-app-auth-readiness";
import { setLastOrganizationSlug } from "@/lib/routing/last-org-storage";

export default function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = use(params);
  const routeParams = useRouteParams<{ projectAlias?: string }>();
  const projectAlias = routeParams.projectAlias ?? null;
  const { status: authStatus, userId } = useAppAuthReadiness();

  // Avoid running access-checked queries before Convex auth is ready.
  // Otherwise, they can transiently return `null` (unauthenticated) and cause a "No Access" flash.
  const queriedOrg = useQuery(api.organizations.core.getBySlug, authStatus === "authenticated" ? { slug: organizationSlug } : "skip");
  // Keep the shell mounted through brief Convex/Clerk auth re-initialization gaps.
  const org = useLastResolvedRouteValue({
    cacheKey: userId ? `${userId}:${organizationSlug}` : null,
    enabled: authStatus === "authenticated" && Boolean(userId),
    value: queriedOrg,
  });

  // Remember the org on successful access
  useEffect(() => {
    if (org) {
      setLastOrganizationSlug(organizationSlug);
    }
  }, [org, organizationSlug]);

  useLastProject(organizationSlug, org ? projectAlias : null);

  if (authStatus === "signed-out" || authStatus === "timed-out") {
    return <RouteErrorState variant="auth" />;
  }

  // Loading state - wait for both auth and org query
  if (authStatus === "loading" || org === undefined) {
    return <AppShellSkeleton />;
  }

  // No access
  if (org === null) {
    return <NoAccess organizationSlug={organizationSlug} />;
  }

  return (
    <SidebarProvider>
      <CurrentOrgProjectProvider organizationId={org._id} organizationSlug={organizationSlug} projectAlias={projectAlias}>
        <CreateTaskDialogProvider organizationId={org._id} organizationSlug={organizationSlug} activeProjectAlias={projectAlias}>
          <MobileNavBarProvider>
            <AppSidebar organizationId={org._id} organizationSlug={organizationSlug} />
            <GlobalTaskQuickOpen organizationId={org._id} organizationSlug={organizationSlug} projectAlias={projectAlias} />
            <QuickThreadDialog organizationId={org._id} organizationSlug={organizationSlug} projectAlias={projectAlias} />
            {/* Keyed by org: a switch remounts the toaster so its cursor
                re-snaps to that org's watermark. */}
            <NotificationToasts key={org._id} />
            <SidebarInset>{children}</SidebarInset>
            {/* Global mobile bottom nav bar — fixed slots on every page. */}
            <MobileNavBar organizationId={org._id} organizationSlug={organizationSlug} />
          </MobileNavBarProvider>
        </CreateTaskDialogProvider>
      </CurrentOrgProjectProvider>
    </SidebarProvider>
  );
}
