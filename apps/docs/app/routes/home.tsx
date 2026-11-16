import { Navigate } from "react-router";
import { appName, docsRoute, siteUrl } from "@/lib/shared";

// Vercel redirects `/` before this is served; other static hosts fall back to it.
export function meta() {
  return [
    { title: appName },
    { tagName: "link", rel: "canonical", href: siteUrl + docsRoute },
  ];
}

export default function Home() {
  return <Navigate to={docsRoute} replace />;
}
