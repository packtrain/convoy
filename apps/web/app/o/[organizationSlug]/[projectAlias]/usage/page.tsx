"use client";

import { useEffect } from "react";

import { appRoute, useNavigation, useRouteParams } from "@/lib/navigation";
import { Centered } from "@/components/custom/centered";
import { Spinner } from "@/components/custom/spinner";

// Usage now lives as a section inside project settings. This legacy route
// redirects there so existing bookmarks/links keep working.
export default function ProjectUsageRedirectPage() {
  const params = useRouteParams<{
    organizationSlug: string;
    projectAlias: string;
  }>();
  const navigation = useNavigation();
  const { organizationSlug, projectAlias } = params;

  useEffect(() => {
    navigation.replace(
      appRoute.projectSettings(organizationSlug, projectAlias, "usage")
    );
  }, [navigation, organizationSlug, projectAlias]);

  return (
    <Centered variant="screen">
      <Spinner size="large" text="Loading…" />
    </Centered>
  );
}
