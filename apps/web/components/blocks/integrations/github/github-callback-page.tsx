"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { Github } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { errors } from "@/convex/integrations/github/errors";
import { Centered } from "@/components/custom/centered";
import { EmptyState } from "@/components/custom/empty-state";
import { useAppConvexAuth } from "@/lib/auth/hooks";
import { getErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { ACCOUNT_STATE_PREFIX } from "@/convex/lib/contracts/github";
import { AppLink, appRoute, targetFromHref, useNavigation } from "@/lib/navigation";

/**
 * GitHub's OAuth redirect lands here under the signed-in Convoy session. The
 * backend binds the state to this user before exchanging the code once. It is
 * also the App's Setup URL, where an install opened from the picker ends.
 */
export function GithubCallbackPage() {
  const navigation = useNavigation();
  const { isAuthenticated } = useAppConvexAuth();
  const completeSetup = useAction(api.integrations.github.setup.completeSetup);
  const completeLink = useAction(api.integrations.github.accounts.completeLink);
  const params = new URLSearchParams(navigation.location.search);
  const state = params.get("state");
  const code = params.get("code");
  const installed = !code && params.has("setup_action");
  const [failure, setFailure] = useState<string | null>(null);
  // GitHub's error_description is URL text anyone can craft; show Convoy's own message.
  const error = state && code ? failure : errors.GITHUB_AUTHORIZATION_FAILED;
  const started = useRef(false);

  useEffect(() => {
    // The picker opened this tab; its own tab reloads the list on focus.
    if (installed) window.close();
  }, [installed]);

  useEffect(() => {
    if (!isAuthenticated || !state || !code || started.current) return;
    started.current = true;
    // Connect GitHub (a Linked GitHub account) returns to where it started; a repository setup opens the picker.
    const finished = state.startsWith(ACCOUNT_STATE_PREFIX)
      ? completeLink({ state, code }).then(({ returnTo }) => navigation.replace(targetFromHref(returnTo)))
      : completeSetup({ state, code }).then(({ setupId, organizationSlug, projectAlias }) =>
          navigation.replace(appRoute.projectGithubIntegration(organizationSlug, projectAlias, setupId))
        );
    finished.catch((caught: unknown) => setFailure(getErrorMessage(caught, "Could not finish connecting GitHub")));
  }, [code, completeLink, completeSetup, isAuthenticated, navigation, state]);

  if (installed) {
    return (
      <Centered variant="screen">
        <EmptyState
          icon={Github}
          title="GitHub App installed"
          description="Go back to the Convoy tab: the repository list there updates on its own."
          action={
            <Button variant="secondary" asChild>
              <AppLink href={appRoute.home()}>Open Convoy</AppLink>
            </Button>
          }
        />
      </Centered>
    );
  }

  return (
    <Centered variant="screen">
      <EmptyState
        icon={Github}
        title={error ? "GitHub connection failed" : "Connecting GitHub…"}
        description={error ?? "Checking your GitHub authorization."}
        action={
          error ? (
            <Button variant="secondary" asChild>
              <AppLink href={appRoute.home()}>Back to Convoy</AppLink>
            </Button>
          ) : null
        }
      />
    </Centered>
  );
}
