import type { MetadataRoute } from "next";
import { site } from "@/lib/copy";

// No lastModified: a build date is not evidence the content changed.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${site.url}/` }];
}
