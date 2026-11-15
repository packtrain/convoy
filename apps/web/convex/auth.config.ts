import { AuthConfig } from "convex/server";

// Local-demo deployments (OS-1230) point CLERK_JWT_ISSUER_DOMAIN at a placeholder: the provider
// is never exercised because no JWTs are issued (anonymous calls resolve to the demo user).
// Referencing AUTH_MODE here instead would make Convex require it on every deployment.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
