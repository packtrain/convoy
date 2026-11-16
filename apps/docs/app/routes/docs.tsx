import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { getMDXComponents } from "@/components/mdx";
import { baseOptions } from "@/lib/layout.shared";
import {
  appName,
  gitConfig,
  shareImage,
  shareImageAlt,
  siteUrl,
} from "@/lib/shared";
import { getPageMarkdownUrl, source } from "@/lib/source";
import type { Route } from "./+types/docs";

export async function loader({ params }: Route.LoaderArgs) {
  const slugs = params["*"].split("/").filter((v) => v.length > 0);
  const page = source.getPage(slugs);
  if (!page) throw new Response("Not found", { status: 404 });

  return {
    path: page.path,
    url: page.url,
    markdownUrl: getPageMarkdownUrl(page).url,
    pageTree: await source.serializePageTree(source.getPageTree()),
  };
}

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: Mdx },
    // you can define props for the component
    {
      markdownUrl,
      path,
      url,
    }: {
      markdownUrl: string;
      path: string;
      url: string;
    },
  ) {
    const components = getMDXComponents();
    const title = `${frontmatter.title} | ${appName}`;
    const canonical = siteUrl + url;
    const image = siteUrl + shareImage;

    return (
      <DocsPage toc={toc}>
        <title>{title}</title>
        <meta name="description" content={frontmatter.description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={appName} />
        <meta property="og:url" content={canonical} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={frontmatter.description} />
        <meta property="og:image" content={image} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={shareImageAlt} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={frontmatter.description} />
        <meta name="twitter:image" content={image} />
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/docs/content/docs/${path}`}
          />
        </div>
        <DocsBody>
          <Mdx components={components} />
        </DocsBody>
      </DocsPage>
    );
  },
});

export default function Page({ loaderData }: Route.ComponentProps) {
  const { pageTree, path, url, markdownUrl } = useFumadocsLoader(loaderData);

  return (
    <DocsLayout {...baseOptions()} tree={pageTree} tabs={false}>
      {clientLoader.useContent(loaderData.path, {
        markdownUrl,
        path,
        url,
      })}
    </DocsLayout>
  );
}
