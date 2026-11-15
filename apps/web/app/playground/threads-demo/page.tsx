"use client";

import { useEffect } from "react";
import { MOCK_THREADS } from "./[threadId]/thread-types";
import { Centered } from "@/components/custom/centered";
import { routeTarget, useNavigation } from "@/lib/navigation";

export default function ThreadDemoIndexPage() {
  const navigation = useNavigation();

  useEffect(() => {
    // Redirect to the first demo thread if available
    if (MOCK_THREADS.length > 0) {
      navigation.replace(routeTarget(`/playground/threads-demo/${MOCK_THREADS[0].id}`));
    }
  }, [navigation]);

  // Show empty state if no threads exist
  if (MOCK_THREADS.length === 0) {
    return (
      <Centered>
        <div className="text-center">
          <h2 className="text-lg font-medium text-foreground">No threads yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start a new conversation to get help with your project.
          </p>
        </div>
      </Centered>
    );
  }

  // Show loading while redirecting
  return (
    <Centered>
      <div className="text-muted-foreground">Loading...</div>
    </Centered>
  );
}
