"use client";

import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import {
  DANGER_CALLOUT_ACTION_CLASS,
  DangerCallout,
} from "@/components/custom/danger-callout";
import { Button } from "@/components/ui/button";
import {
  getAppVersionPollIntervalMs,
  getFrontendAppVersion,
  isAppVersionResponse,
} from "@/lib/app-version";

async function fetchLatestBuildId(): Promise<string | null> {
  try {
    const response = await fetch("/api/app-version", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (!isAppVersionResponse(body)) return null;

    return body.frontend.buildId;
  } catch {
    return null;
  }
}

function AppUpdateBanner() {
  return (
    <DangerCallout
      className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-5xl shadow-lg backdrop-blur-sm"
      title="Refresh required"
      description="You are using an older version of Convoy. Refresh to avoid errors."
      actions={
        <Button
          type="button"
          className={DANGER_CALLOUT_ACTION_CLASS}
          onClick={() => window.location.reload()}
        >
          <RotateCw className="size-4" />
          Refresh
        </Button>
      }
    />
  );
}

export function AppVersionWatcher() {
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);

  useEffect(() => {
    const currentBuildId = getFrontendAppVersion().buildId;
    const pollIntervalMs = getAppVersionPollIntervalMs();
    let disposed = false;

    const checkVersion = async () => {
      const latestBuildId = await fetchLatestBuildId();
      if (disposed || !latestBuildId || latestBuildId === currentBuildId) {
        return;
      }
      setShowUpdateBanner(true);
    };

    const intervalId = window.setInterval(() => {
      void checkVersion();
    }, pollIntervalMs);
    void checkVersion();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkVersion();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return showUpdateBanner ? <AppUpdateBanner /> : null;
}
