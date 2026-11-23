import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextProxy } from "next/server";
import { authMode, type AuthMode } from "@/lib/auth/auth-mode";
import { buildConvexAuthProxy } from "@/lib/auth/convex-auth-server";
import { appRoute } from "@/lib/navigation/routes";
import { buildAuthPathWithRedirect } from "@/lib/routing/auth-redirects";

const APP_TITLE = "Convoy";
const APP_DESCRIPTION = "Convoy is a platform for managing your tasks and projects.";

const LINK_PREVIEW_USER_AGENT_PATTERNS = [
  /discordbot/i,
  /facebookexternalhit/i,
  /linkedinbot/i,
  /microsoftteams/i,
  /slackbot/i,
  /telegrambot/i,
  /twitterbot/i,
  /whatsapp/i,
];

const PUBLIC_ROUTES = ["/auth/sign-in(.*)", "/auth/sign-up(.*)", "/api/agent/browser-login(.*)", "/api/app-version"];

export const isPublicRoute = createRouteMatcher(PUBLIC_ROUTES);

// Clerk verifies email and resets passwords inside its sign-in screens; Convex Auth has pages for them.
const isConvexAuthPublicRoute = createRouteMatcher([
  ...PUBLIC_ROUTES,
  appRoute.authVerifyEmail().pathname,
  appRoute.authForgotPassword().pathname,
  appRoute.authResetPassword().pathname,
]);

export function isLinkPreviewCrawler(userAgent: string | null): boolean {
  if (!userAgent) {
    return false;
  }

  return LINK_PREVIEW_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

export function createGenericLinkPreviewResponse(): NextResponse {
  const escapedTitle = APP_TITLE;
  const escapedDescription = APP_DESCRIPTION;

  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapedTitle}</title><meta name="description" content="${escapedDescription}"><meta property="og:title" content="${escapedTitle}"><meta property="og:description" content="${escapedDescription}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapedTitle}"><meta name="twitter:description" content="${escapedDescription}"></head><body><h1>${escapedTitle}</h1><p>${escapedDescription}</p></body></html>`,
    {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Type": "text/html; charset=utf-8",
      },
    }
  );
}

/** Convex Auth: a request without a session goes to sign-in before the page renders (docs/specs/auth-adapters.md#route-gate). */
export async function convexAuthGate(
  request: NextRequest,
  { getToken }: { getToken: () => Promise<string | null> }
): Promise<NextResponse | undefined> {
  if (isConvexAuthPublicRoute(request)) return undefined;
  if (isLinkPreviewCrawler(request.headers.get("user-agent"))) return createGenericLinkPreviewResponse();
  // A token check, not a backend round trip: Convex verifies the token on every call anyway.
  if (await getToken()) return undefined;
  const { pathname, search, origin } = request.nextUrl;
  const signInPath = buildAuthPathWithRedirect(appRoute.authSignIn().pathname, `${pathname}${search}`, origin);
  return NextResponse.redirect(new URL(signInPath, request.url));
}

// Builders (not module-scope constants) so the clerkMiddleware factory is
// only invoked in Clerk builds — other builds have no Clerk keys.
function buildClerkAuthMiddleware(): NextProxy {
  return clerkMiddleware(
    async (auth, request) => {
      if (!isPublicRoute(request) && isLinkPreviewCrawler(request.headers.get("user-agent"))) {
        return createGenericLinkPreviewResponse();
      }

      if (!isPublicRoute(request)) {
        await auth.protect();
      }
    },
    {
      signInUrl: "/auth/sign-in",
      signUpUrl: "/auth/sign-up",
    }
  );
}

const PROXY_BUILDERS: Record<AuthMode, () => NextProxy> = {
  clerk: buildClerkAuthMiddleware,
  convex: () => buildConvexAuthProxy(convexAuthGate),
};

export default PROXY_BUILDERS[authMode]();

export const config = {
  matcher: [
    // Skip Next.js internals, the Convex Auth routes (they manage their own cookies),
    // and all static files, unless found in search params
    "/((?!_next|auth/(?:signin|refresh|signout)(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
