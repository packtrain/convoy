import type { MetadataRoute } from "next";
import { site } from "@/lib/copy";

// Playgrounds stay crawlable so crawlers read their noindex tags.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${site.url}/sitemap.xml` };
}
