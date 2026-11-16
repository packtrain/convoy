import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { LogoText } from "@/components/logo-text";
import { docsRoute, gitConfig, landingUrl } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-1.5">
          <LogoText className="h-4 w-auto" />
          <span>Docs</span>
        </span>
      ),
      url: docsRoute,
    },
    links: [{ text: "convoy.build", url: landingUrl, external: true }],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
