"use client";

import Link, { type LinkProps } from "next/link";
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useNavigation } from "./core";
import {
  href as routeHref,
  targetFromHref,
  type RouteTarget,
} from "./target";

export type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps | "href"> &
  Omit<LinkProps, "href"> & {
    href: RouteTarget | string;
    children: ReactNode;
  };

/**
 * True for a plain left click, which a host may handle in place. Anything the
 * browser gives its own meaning (new tab/window, download, copy link) is left
 * alone. Mirrors the guard in `handleClick` below, for callers that intercept
 * an anchor's `onClick` before `AppLink` sees it.
 */
export function shouldHandleInPlaceNavigation(
  event: MouseEvent<HTMLAnchorElement>
) {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.currentTarget.hasAttribute("download") &&
    (event.currentTarget.target === "" ||
      event.currentTarget.target === "_self")
  );
}

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(
  function AppLink(
    { href, children, onClick, target, download, scroll, ...props },
    ref
  ) {
    const navigation = useNavigation();
    const nextHref = typeof href === "string" ? href : routeHref(href);

    function handleClick(event: MouseEvent<HTMLAnchorElement>) {
      onClick?.(event);

      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey ||
        download ||
        (target && target !== "_self") ||
        !isAppHref(nextHref)
      ) {
        return;
      }

      event.preventDefault();
      const route = typeof href === "string" ? targetFromHref(href, { scroll }) : href;
      navigation.push(route);
    }

    return (
      <Link
        ref={ref}
        href={nextHref}
        target={target}
        download={download}
        scroll={scroll}
        onClick={handleClick}
        {...props}
      >
        {children}
      </Link>
    );
  }
);

function isAppHref(value: string): boolean {
  if (value.startsWith("/")) {
    return true;
  }

  if (typeof window === "undefined") {
    return false;
  }

  try {
    return new URL(value, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}
