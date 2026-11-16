import { siteUrl } from "@/lib/shared";
import { source } from "@/lib/source";

// No lastmod: a build date says nothing about content. See docs/specs/docs-seo.md.
export function loader() {
  const urls = source
    .getPages()
    .map((page) => `  <url><loc>${siteUrl}${page.url}</loc></url>`);

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`,
    { headers: { "Content-Type": "application/xml" } },
  );
}
