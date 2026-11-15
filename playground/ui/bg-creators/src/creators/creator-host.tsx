import * as React from "react";

import { ToolcraftApp } from "@/toolcraft/runtime/react";

import type { CreatorDefinition, CreatorSlug } from "./creator-registry";

type CreatorPage = () => React.JSX.Element;

type CreatorAppProps = {
  definition: CreatorDefinition;
};

function CreatorApp({ definition }: CreatorAppProps): React.JSX.Element {
  const LazyCreator = React.useMemo(
    () =>
      React.lazy(async () => {
        const { appComposition } = await definition.load();

        return {
          default: function LoadedCreator(): React.JSX.Element {
            return (
              <ToolcraftApp
                canvasContent={appComposition.canvasContent}
                className="h-dvh min-h-dvh"
                controlRenderers={appComposition.controlRenderers}
                key={definition.slug}
                onPanelAction={appComposition.onPanelAction}
                renderDefaultCanvasMedia={appComposition.renderDefaultCanvasMedia}
                schema={appComposition.schema}
              />
            );
          },
        };
      }),
    [definition],
  );

  React.useEffect(() => {
    document.title = `${definition.title} · Background Creators`;
  }, [definition.title]);

  return (
    <React.Suspense fallback={null}>
      <LazyCreator />
    </React.Suspense>
  );
}

const creatorPages = new Map<CreatorSlug, CreatorPage>();

export function getCreatorPage(definition: CreatorDefinition): CreatorPage {
  const existingPage = creatorPages.get(definition.slug);

  if (existingPage) {
    return existingPage;
  }

  function CreatorPage(): React.JSX.Element {
    return <CreatorApp definition={definition} />;
  }

  creatorPages.set(definition.slug, CreatorPage);
  return CreatorPage;
}
