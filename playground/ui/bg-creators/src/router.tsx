import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { CreatorIndex } from "./creator-index";
import { getCreatorPage } from "./creators/creator-host";
import { creatorDefinitions } from "./creators/creator-registry";

function RootLayout(): React.JSX.Element {
  return <Outlet />;
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  component: CreatorIndex,
  getParentRoute: () => rootRoute,
  path: "/",
});

const creatorRoutes = creatorDefinitions.map((definition) =>
  createRoute({
    component: getCreatorPage(definition),
    getParentRoute: () => rootRoute,
    path: definition.path,
  }),
);

const routeTree = rootRoute.addChildren([indexRoute, ...creatorRoutes]);

export const router = createRouter({
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  routeTree,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
