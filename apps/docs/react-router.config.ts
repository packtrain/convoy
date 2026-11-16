import { copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Config } from "@react-router/dev/config";
import { createGetUrl, getSlugs } from "fumadocs-core/source";

const getUrl = createGetUrl("/docs");
const docsDir = "content/docs";

async function getDocPaths() {
  const entries = await readdir(docsDir, {
    recursive: true,
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mdx"))
    .map((entry) =>
      path.posix.join(path.relative(docsDir, entry.parentPath), entry.name),
    )
    .sort();
}

export default {
  ssr: false,
  future: {
    v8_middleware: true,
  },
  async prerender({ getStaticPaths }) {
    const paths: string[] = [];
    const excluded: string[] = [];

    for (const path of getStaticPaths()) {
      if (!excluded.includes(path)) paths.push(path);
    }

    for (const entry of await getDocPaths()) {
      const slugs = getSlugs(entry);
      paths.push(
        getUrl(slugs),
        `/llms.mdx/docs/${[...slugs, "content.md"].join("/")}`,
      );
    }

    return paths;
  },
  // Static hosts serve 404.html with a 404 status. See docs/specs/docs-seo.md.
  async buildEnd({ reactRouterConfig }) {
    const client = path.join(reactRouterConfig.buildDirectory, "client");
    await copyFile(
      path.join(client, "__spa-fallback.html"),
      path.join(client, "404.html"),
    );
  },
} satisfies Config;
