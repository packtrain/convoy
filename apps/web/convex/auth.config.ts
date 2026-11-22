import { AuthConfig } from "convex/server";
import { convexAuthProvider } from "@convex-dev/auth/server";

// Local-demo and Convex Auth deployments (OS-1230, docs/specs/auth-adapters.md) point
// CLERK_JWT_ISSUER_DOMAIN at a placeholder: no Clerk JWTs are issued there.
// Referencing AUTH_MODE here instead would make Convex require it on every deployment.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
    convexAuthProvider(),
  ],
} satisfies AuthConfig;
