import * as React from "react";

export function useMediaQuery(query: string) {
	const mediaQuery = React.useMemo(
		() => typeof window === "undefined" ? null : window.matchMedia(query),
		[query]
	);
	const subscribe = React.useCallback((listener: () => void) => {
		mediaQuery?.addEventListener("change", listener);
		return () => mediaQuery?.removeEventListener("change", listener);
	}, [mediaQuery]);
	const getSnapshot = React.useCallback(() => mediaQuery?.matches ?? false, [mediaQuery]);

	// Client-only rows use the viewport immediately; hydration keeps the server snapshot.
	return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot() {
	return false;
}
