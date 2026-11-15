export interface RouteTarget {
  pathname: string;
  query?: URLSearchParams | Record<string, string | boolean | number | null | undefined>;
  hash?: string | null;
  scroll?: boolean;
}

function normalizeSearch(query: RouteTarget["query"]): string {
  if (!query) {
    return "";
  }

  const params = query instanceof URLSearchParams ? query : new URLSearchParams();
  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === false) {
        continue;
      }
      params.set(key, value === true ? "true" : String(value));
    }
  }

  const search = params.toString();
  return search ? `?${search}` : "";
}

export function routeTarget(
  pathname: string,
  options: Omit<RouteTarget, "pathname"> = {}
): RouteTarget {
  return {
    pathname,
    ...options,
  };
}

export function href(target: RouteTarget): string {
  const search = normalizeSearch(target.query);
  const hash = target.hash ? `#${target.hash.replace(/^#/, "")}` : "";
  return `${target.pathname}${search}${hash}`;
}

/**
 * Converts a same-origin href/path into a route target. External URLs should stay
 * outside the app navigation kernel and be rendered as plain anchors.
 */
export function targetFromHref(
  nextHref: string,
  options: Pick<RouteTarget, "scroll"> = {}
): RouteTarget {
  const parsed = new URL(nextHref, "https://convoy.local");
  return routeTarget(parsed.pathname, {
    query: new URLSearchParams(parsed.search),
    hash: parsed.hash || null,
    scroll: options.scroll,
  });
}
