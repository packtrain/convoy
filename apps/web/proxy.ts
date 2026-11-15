import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { isLocalDemoAuthMode } from "@/lib/auth/auth-mode";

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

export const isPublicRoute = createRouteMatcher([
  "/auth/sign-in(.*)",
  "/auth/sign-up(.*)",
  "/api/agent/browser-login(.*)",
  "/api/app-version",
]);

export function isLinkPreviewCrawler(userAgent: string | null): boolean {
  if (!userAgent) {
    return false;
  }

  return LINK_PREVIEW_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

export function createGenericLinkPreviewResponse(): Response {
  const escapedTitle = APP_TITLE;
  const escapedDescription = APP_DESCRIPTION;

  return new Response(
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

// Local-demo mode (OS-1230): no Clerk keys exist, so clerkMiddleware cannot
// run. Auth is ambient (backend resolves anonymous calls to the demo user);
// only the link-preview handling is kept.
function localDemoMiddleware(request: NextRequest): Response {
  if (isLinkPreviewCrawler(request.headers.get("user-agent"))) {
    return createGenericLinkPreviewResponse();
  }
  return NextResponse.next();
}

// A builder (not a module-scope constant) so the clerkMiddleware factory is
// only invoked in Clerk builds — local-demo builds have no Clerk keys.
function buildClerkAuthMiddleware() {
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

export default isLocalDemoAuthMode ? localDemoMiddleware : buildClerkAuthMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
